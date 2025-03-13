import { embed, generateText, type CoreTool, type GenerateTextResult, type Message } from 'ai';
import type { IProviderSetting } from '~/types/model';
import { type FileMap } from './constants';
import { DEFAULT_MODEL, DEFAULT_PROVIDER, PROVIDER_LIST } from '~/utils/constants';
import { extractPropertiesFromMessage, simplifyBoltActions } from './utils';
import { createScopedLogger } from '~/utils/logger';
import { LLMManager } from '~/lib/modules/llm/manager';
import { createOpenAI } from '@ai-sdk/openai';
import { createClient } from '@supabase/supabase-js';

const logger = createScopedLogger('search-resources');

/**
 * Extracts resource requirements from a user's request
 */
async function extractResourceRequirements(props: { userMessage: string; summary: string; model: any }) {
  const { userMessage, summary, model } = props;

  const resp = await generateText({
    system: `
      You are an AI assistant that helps developers by extracting specific resource requirements from general requests.
      Your task is to analyze a user's request and identify concrete resource needs that would benefit their project.
    `,
    prompt: `
      Here is the summary of the conversation so far:
      ${summary}

      User's request: "${userMessage}"

      Extract 1-5 specific resource requirements from this request.
      Focus on visual assets, 3D models, audio files, or other resources that the user might need for their project.
      
      For example:
      - If the user asks for "a 3D RPG game", you might extract "3D character models", "fantasy environment assets", "RPG sound effects", etc.
      - If the user asks for "a space shooter", you might extract "spaceship 3D models", "space background textures", "explosion effects", etc.

      Format your response as a JSON array of strings, with each string being a specific resource requirement:
      ["requirement 1", "requirement 2", "requirement 3", ...]

      IMPORTANT: Return an empty array if no resource requirements are found.
      IMPORTANT: All requirements must be in English.
      IMPORTANT: Be specific about the type of resource needed.
    `,
    model,
  });

  try {
    // Extract just the JSON array from the response (remove any extra text)
    const jsonMatch = resp.text.match(/\[.*\]/s);

    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]) as string[];
    } else {
      return JSON.parse(resp.text) as string[];
    }
  } catch (error) {
    logger.error('Failed to parse resource requirements JSON', error);

    // Fall back to a simple extraction approach
    const lines = resp.text
      .split('\n')
      .filter((line) => line.trim().startsWith('-') || line.trim().startsWith('*'))
      .map((line) => line.replace(/^[-*]\s+/, '').trim());

    return lines.length > 0 ? lines : [userMessage];
  }
}

/**
 * Searches the vector database for relevant resources based on requirements
 */
async function searchResourcesFromVectorDB({
  requirements,
  supabase,
  openai,
}: {
  requirements: string[];
  supabase: any;
  openai: any;
}) {
  const results = [];
  const seenIds = new Set<string>();

  // Search for each requirement
  for (const requirement of requirements) {
    try {
      const { embedding } = await embed({
        model: openai.embedding('text-embedding-ada-002'),
        value: requirement,
      });

      const { data, error } = await supabase.rpc('match_resources', {
        query_embedding: embedding,
        match_count: 5,
      });

      if (error) {
        logger.error(`Vector search error for "${requirement}":`, error);
        continue;
      }

      if (data && data.length > 0) {
        // Only add items that haven't been seen before
        for (const item of data) {
          if (!seenIds.has(item.id)) {
            seenIds.add(item.id);
            results.push({
              ...item,
              requirement,
            });
          }
        }
      }
    } catch (error) {
      logger.error(`Error searching for "${requirement}":`, error);
    }
  }

  return results;
}

/**
 * Filters and evaluates the usefulness of resources for the current request
 */
async function filterRelevantResources(props: {
  requirements: string[];
  resources: any[];
  userMessage: string;
  summary: string;
  model: any;
}) {
  const { requirements, resources, userMessage, summary, model } = props;

  if (resources.length === 0) {
    return [];
  }

  const resourcesData = resources.map((res) => ({
    id: res.id,
    description: res.description,
    url: res.url,
    metadata: res.metadata,
    similarity: res.similarity,
    requirement: res.requirement,
  }));

  const resp = await generateText({
    system: `
      You are an AI assistant that helps developers by evaluating the relevance of resources to their project needs.
      Your task is to analyze resources retrieved from a database and determine which ones are truly relevant 
      and helpful for the user's current request.
    `,
    prompt: `
      Here is the summary of the conversation so far:
      ${summary}

      User's request: "${userMessage}"

      Resource requirements extracted from the request:
      ${requirements.map((req) => `- ${req}`).join('\n')}

      Found resources:
      ${JSON.stringify(resourcesData, null, 2)}

      Evaluate each resource and decide if it's relevant and helpful for the user's request.
      Focus on the description field of each resource to understand what it provides.
      
      IMPORTANT: Your response must be a valid JSON array containing only the IDs of relevant resources.
      Example format: ["1", "3", "5"]
      
      If none of the resources are relevant, return an empty array: []
    `,
    model,
  });

  try {
    // Extract just the JSON array from the response (remove any extra text)
    const jsonMatch = resp.text.match(/\[.*\]/s);

    if (jsonMatch) {
      const selectedIds = JSON.parse(jsonMatch[0]) as string[];
      return resources.filter((res) => selectedIds.includes(String(res.id)));
    } else {
      // If no JSON array pattern is found, try parsing the entire response
      const parsedIds = JSON.parse(resp.text) as string[];
      return resources.filter((res) => parsedIds.includes(String(res.id)));
    }
  } catch (error) {
    logger.error('Failed to parse filtered resources JSON', error);

    // Return a subset of resources if parsing fails
    return resources.slice(0, 3);
  }
}

export async function searchResources(props: {
  messages: Message[];
  env?: Env;
  apiKeys?: Record<string, string>;
  files: FileMap;
  providerSettings?: Record<string, IProviderSetting>;
  promptId?: string;
  contextOptimization?: boolean;
  summary: string;
  onFinish?: (resp: GenerateTextResult<Record<string, CoreTool<any, any>>, never>) => void;
}) {
  const { messages, env: serverEnv, apiKeys, providerSettings, summary, onFinish } = props;
  const supabase = createClient(
    serverEnv!.SUPABASE_URL || process.env.SUPABASE_URL!,
    serverEnv!.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  const openai = createOpenAI({
    apiKey: serverEnv!.OPENAI_API_KEY || process.env.OPENAI_API_KEY,
  });
  let currentModel = DEFAULT_MODEL;
  let currentProvider = DEFAULT_PROVIDER.name;

  const processedMessages = messages.map((message) => {
    if (message.role === 'user') {
      const { model, provider, content } = extractPropertiesFromMessage(message);
      currentModel = model;
      currentProvider = provider;

      return { ...message, content };
    } else if (message.role == 'assistant') {
      let content = message.content;

      content = simplifyBoltActions(content);
      content = content.replace(/<div class=\\"__boltThought__\\">.*?<\/div>/s, '');
      content = content.replace(/<think>.*?<\/think>/s, '');

      return { ...message, content };
    }

    return message;
  });

  const provider = PROVIDER_LIST.find((p) => p.name === currentProvider) || DEFAULT_PROVIDER;
  const staticModels = LLMManager.getInstance().getStaticModelListFromProvider(provider);
  let modelDetails = staticModels.find((m) => m.name === currentModel);

  if (!modelDetails) {
    const modelsList = [
      ...(provider.staticModels || []),
      ...(await LLMManager.getInstance().getModelListFromProvider(provider, {
        apiKeys,
        providerSettings,
        serverEnv: serverEnv as any,
      })),
    ];

    if (!modelsList.length) {
      throw new Error(`No models found for provider ${provider.name}`);
    }

    modelDetails = modelsList.find((m) => m.name === currentModel);

    if (!modelDetails) {
      // Fallback to first model
      logger.warn(
        `MODEL [${currentModel}] not found in provider [${provider.name}]. Falling back to first model. ${modelsList[0].name}`,
      );
      modelDetails = modelsList[0];
    }
  }

  const extractTextContent = (message: Message) =>
    Array.isArray(message.content)
      ? (message.content.find((item) => item.type === 'text')?.text as string) || ''
      : message.content;

  const lastUserMessage = processedMessages.filter((x) => x.role == 'user').pop();

  if (!lastUserMessage) {
    throw new Error('No user message found');
  }

  const userMessageText = extractTextContent(lastUserMessage);
  const model = provider.getModelInstance({
    model: currentModel,
    serverEnv,
    apiKeys,
    providerSettings,
  });

  // Step 1: Extract specific resource requirements from the user's request
  const requirements = await extractResourceRequirements({
    userMessage: userMessageText,
    summary,
    model,
  });

  logger.info(`Extracted ${requirements.length} resource requirements:`, requirements);

  // Step 2: Search vector database for relevant resources
  const resources = await searchResourcesFromVectorDB({ requirements, supabase, openai });

  logger.info(`Found ${resources.length} resources`);

  // Step 3: Filter and evaluate the relevance of found resources
  const relevantResources = await filterRelevantResources({
    requirements,
    resources,
    userMessage: userMessageText,
    summary,
    model,
  });

  logger.info(`Selected ${relevantResources.length} relevant resources`);

  // Step 4: Format and return relevant resources
  const result: Record<string, any> = {};

  // Format resources as a structured object to be passed to the LLM
  relevantResources.forEach((resource, index) => {
    result[`resource-${index + 1}`] = {
      url: resource.url,
      description: resource.description,
      metadata: resource.metadata || {},
      requirement: resource.requirement || 'Resource',
    };
  });

  if (onFinish) {
    // This is needed to maintain compatibility with the original function
    const mockResp = {
      text: JSON.stringify(relevantResources.map((res) => res.id)),
      choices: [{ text: '' }],
    } as any;
    onFinish(mockResp);
  }

  return result;
}
