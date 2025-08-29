import { embed, generateText, type UIMessage, type GenerateTextOnStepFinishCallback } from 'ai';
import type { IProviderSetting } from '~/types/model';
import { type FileMap } from './constants';
import { DEFAULT_MODEL, DEFAULT_PROVIDER, PROVIDER_LIST } from '~/utils/constants';
import { createFilesContext, extractPropertiesFromMessage, simplifyBoltActions } from './utils';
import { createScopedLogger } from '~/utils/logger';
import { LLMManager } from '~/lib/modules/llm/manager';
import { createOpenAI } from '@ai-sdk/openai';
import { createClient } from '@supabase/supabase-js';
import { extractTextContent } from '~/utils/message';

const logger = createScopedLogger('search-resources');

// 커스텀 타입: 실제 필요한 정보만 정의
interface ResourceSearchResult {
  text: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
}

/**
 * Extracts resource requirements from a user's request
 */
async function extractResourceRequirements(props: {
  userMessage: string;
  summary: string;
  model: any;
  contextFiles: FileMap;
  onStepFinish?: GenerateTextOnStepFinishCallback<{}>;
}) {
  const { userMessage, summary, model, contextFiles, onStepFinish } = props;

  const codeContext = createFilesContext(contextFiles, true);

  const resp = await generateText({
    system: `
      You are an AI assistant that helps developers by extracting specific resource requirements from general requests.
      Your task is to analyze a user's request and identify concrete resource needs that would benefit their project.

      CRITICAL: First determine if the request is:
      1. Complex enough to require external resources (3D models, textures, audio files, etc.)
      2. Something that can be implemented without external resources

      Only extract requirements if they are truly needed for the user's project.

      <CodeContext>
      ${codeContext}
      </CodeContext>
    `,
    prompt: `
      Here is the summary of the conversation so far:
      ${summary}

      User's request: "${userMessage}"


      First, determine if this request requires external resources by answering YES or NO:
      - Answer YES if the request involves visual assets, 3D models, audio files, or other resources
      - Answer NO if the request can be implemented without external resources

      Then, only if you answered YES, extract 1-5 specific resource requirements from this request.
      Focus ONLY on resources that are genuinely needed for the user's project.

      Format your response as a JSON object:
      {
        "requiresResources": true/false,
        "requirements": ["requirement 1", "requirement 2", ...]
      }

      IMPORTANT: If the user's request doesn't need external resources, return:
      {
        "requiresResources": false,
        "requirements": []
      }

      IMPORTANT: All requirements must be in English.
    `,
    model,
    onStepFinish,
  });

  try {
    // Extract JSON object from the response
    const jsonMatch = resp.text.match(/\{.*\}/s);

    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);

      // If LLM determined no resources needed, return empty array
      if (!parsed.requiresResources) {
        logger.info('LLM determined no resources needed for this request');
        return [];
      }

      return parsed.requirements as string[];
    } else {
      // Fallback parsing if JSON format wasn't followed
      return JSON.parse(resp.text).requirements || [];
    }
  } catch (error) {
    logger.error('Failed to parse resource requirements JSON', error);

    // Fall back to a simple extraction approach
    const lines = resp.text
      .split('\n')
      .filter((line) => line.trim().startsWith('-') || line.trim().startsWith('*'))
      .map((line) => line.replace(/^[-*]\s+/, '').trim());

    return lines.length > 0 ? lines : [];
  }
}

/**
 * Searches the vector database for relevant resources based on requirements
 */
async function searchResourcesFromVectorDB({
  requirements,
  supabase,
  openai,
  isProduction = false,
}: {
  requirements: string[];
  supabase: any;
  openai: any;
  isProduction?: boolean;
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

      const { data, error } = await supabase.rpc(isProduction ? 'match_resources_prod' : 'match_resources', {
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
  contextFiles: FileMap;
  onStepFinish?: GenerateTextOnStepFinishCallback<{}>;
}) {
  const { requirements, resources, userMessage, summary, model, contextFiles, onStepFinish } = props;

  const codeContext = createFilesContext(contextFiles, true);

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

      <CodeContext>
      ${codeContext}
      </CodeContext>
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
    onStepFinish,
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
  messages: UIMessage[];
  env?: Env;
  apiKeys?: Record<string, string>;
  files: FileMap;
  providerSettings?: Record<string, IProviderSetting>;
  promptId?: string;
  contextOptimization?: boolean;
  contextFiles?: FileMap;
  summary: string;
  onFinish?: (resp: ResourceSearchResult) => void;
}) {
  const { messages, env: serverEnv, apiKeys, providerSettings, summary, onFinish, contextFiles } = props;
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
      const { model, provider, parts } = extractPropertiesFromMessage(message);
      currentModel = model;
      currentProvider = provider;

      return { ...message, parts };
    } else if (message.role == 'assistant') {
      const parts = [...(message.parts || [])];

      for (const part of parts) {
        if (part.type === 'text') {
          part.text = simplifyBoltActions(part.text);
          part.text = part.text.replace(/<div class=\\"__boltThought__\\">.*?<\/div>/s, '');
          part.text = part.text.replace(/<think>.*?<\/think>/s, '');
        }
      }

      return { ...message, parts };
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

  const lastUserMessage = processedMessages.filter((x) => x.role == 'user').pop();

  if (!lastUserMessage) {
    throw new Error('No user message found');
  }

  const userMessageText = extractTextContent(lastUserMessage);
  const model = provider.getModelInstance({
    model: modelDetails.name,
    serverEnv,
    apiKeys,
    providerSettings,
  });

  // Track cumulative usage across all generateText calls
  const cumulativeUsage = {
    completionTokens: 0,
    promptTokens: 0,
    totalTokens: 0,
  };

  // Step 1: Extract specific resource requirements from the user's request
  const requirements = await extractResourceRequirements({
    userMessage: userMessageText,
    summary,
    model,
    contextFiles: contextFiles || {},
    onStepFinish: (resp) => {
      if (resp.usage) {
        cumulativeUsage.completionTokens += resp.usage.outputTokens ?? 0;
        cumulativeUsage.promptTokens += resp.usage.inputTokens ?? 0;
        cumulativeUsage.totalTokens += resp.usage.totalTokens ?? 0;
      }
    },
  });

  logger.info(`Extracted ${requirements.length} resource requirements:`, requirements);

  // Step 2: Search vector database for relevant resources
  const resources = await searchResourcesFromVectorDB({
    requirements,
    supabase,
    openai,
    isProduction: serverEnv?.USE_PRODUCTION_VECTOR_DB === 'true',
  });

  logger.info(`Found ${resources.length} resources`);

  // Step 3: Filter and evaluate the relevance of found resources
  const relevantResources = await filterRelevantResources({
    requirements,
    resources,
    userMessage: userMessageText,
    summary,
    model,
    contextFiles: contextFiles || {},
    onStepFinish: (resp) => {
      if (resp.usage) {
        cumulativeUsage.completionTokens += resp.usage.outputTokens ?? 0;
        cumulativeUsage.promptTokens += resp.usage.inputTokens ?? 0;
        cumulativeUsage.totalTokens += resp.usage.totalTokens ?? 0;
      }
    },
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
    // Pass the cumulative usage from both generateText calls
    const searchResult = {
      text: JSON.stringify(relevantResources.map((res) => res.id)),
      usage: {
        inputTokens: cumulativeUsage.promptTokens,
        outputTokens: cumulativeUsage.completionTokens,
        totalTokens: cumulativeUsage.totalTokens,
      },
    };
    onFinish(searchResult);
  }

  return result;
}
