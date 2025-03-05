import { embed, generateText, type CoreTool, type GenerateTextResult, type Message } from 'ai';
import ignore from 'ignore';
import type { IProviderSetting } from '~/types/model';
import { IGNORE_PATTERNS, type FileMap } from './constants';
import { DEFAULT_MODEL, DEFAULT_PROVIDER, PROVIDER_LIST } from '~/utils/constants';
import { extractPropertiesFromMessage, simplifyBoltActions } from './utils';
import { createScopedLogger } from '~/utils/logger';
import { LLMManager } from '~/lib/modules/llm/manager';
import { supabase } from '~/utils/supabase';
import { openai } from '@ai-sdk/openai';

// Common patterns to ignore, similar to .gitignore
const ig = ignore().add(IGNORE_PATTERNS);
const logger = createScopedLogger('search-vectordb');

/**
 * Extracts concrete requirements from a user's request to search for code examples
 */
async function extractRequirements(props: { userMessage: string; summary: string; model: any }) {
  const { userMessage, summary, model } = props;

  const resp = await generateText({
    system: `
      You are an AI assistant that helps developers by extracting specific coding requirements from general requests.
      Your task is to analyze a user's request and identify concrete technical implementation requirements 
      that would benefit from code examples.
    `,
    prompt: `
      Here is the summary of the conversation so far:
      ${summary}

      User's request: "${userMessage}"

      Extract 1-10 specific technical implementation requirements from this request.
      Focus on aspects that might benefit from existing code examples, especially complex or difficult-to-implement features.
      
      For example:
      - If the user asks for "an RPG game", you might extract "2D character movement system", "turn-based combat logic", etc.
      - If the user asks for "a chat application", you might extract "WebSocket connection handling", "message history storage", etc.

      Format your response as a JSON array of strings, with each string being a specific requirement:
      ["requirement 1", "requirement 2", "requirement 3", ...]

      IMPORTANT: Return an empty array if no requirements are found.
      IMPORTANT: All requirements must be in English.
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
    logger.error('Failed to parse requirements JSON', error);

    // Fall back to a simple extraction approach
    const lines = resp.text
      .split('\n')
      .filter((line) => line.trim().startsWith('-') || line.trim().startsWith('*'))
      .map((line) => line.replace(/^[-*]\s+/, '').trim());

    return lines.length > 0 ? lines : [userMessage];
  }
}

/**
 * Searches the vector database for relevant code examples based on requirements
 */
async function searchExamplesFromVectorDB(requirements: string[]) {
  const results = [];
  const seenIds = new Set<string>();

  // Search for each requirement
  for (const requirement of requirements) {
    try {
      const { embedding } = await embed({
        model: openai.embedding('text-embedding-ada-002'),
        value: requirement,
      });

      const { data, error } = await supabase.rpc('match_codebase', {
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
 * Filters and evaluates the usefulness of code examples for the current request
 */
async function filterRelevantExamples(props: {
  requirements: string[];
  examples: any[];
  userMessage: string;
  summary: string;
  model: any;
}) {
  const { requirements, examples, userMessage, summary, model } = props;

  if (examples.length === 0) {
    return [];
  }

  const examplesData = examples.map((ex) => ({
    id: ex.id,
    description: ex.description,
    clientCode: ex.client_code
      ? ex.client_code.length > 300
        ? ex.client_code.substring(0, 300) + '...'
        : ex.client_code
      : '',
    serverCode: ex.server_code
      ? ex.server_code.length > 300
        ? ex.server_code.substring(0, 300) + '...'
        : ex.server_code
      : '',
    similarity: ex.similarity,
    requirement: ex.requirement,
  }));

  const resp = await generateText({
    system: `
      You are an AI assistant that helps developers by evaluating the relevance of code examples to their needs.
      Your task is to analyze code examples retrieved from a database and determine which ones are truly relevant 
      and helpful for the user's current request.
    `,
    prompt: `
      Here is the summary of the conversation so far:
      ${summary}

      User's request: "${userMessage}"

      Requirements extracted from the request:
      ${requirements.map((req) => `- ${req}`).join('\n')}

      Found code examples:
      ${JSON.stringify(examplesData, null, 2)}

      Evaluate each example and decide if it's relevant and helpful for the user's request.
      Focus on the description field of each example to understand what the code does.
      
      IMPORTANT: Your response must be a valid JSON array containing only the IDs of relevant examples.
      Example format: ["1", "3", "5"]
      
      If none of the examples are relevant, return an empty array: []
    `,
    model,
  });

  console.log(resp.text);

  try {
    // Extract just the JSON array from the response (remove any extra text)
    const jsonMatch = resp.text.match(/\[.*\]/s);

    if (jsonMatch) {
      const selectedIds = JSON.parse(jsonMatch[0]) as string[];
      return examples.filter((ex) => selectedIds.includes(String(ex.id)));
    } else {
      // If no JSON array pattern is found, try parsing the entire response
      const parsedIds = JSON.parse(resp.text) as string[];
      return examples.filter((ex) => parsedIds.includes(String(ex.id)));
    }
  } catch (error) {
    logger.error('Failed to parse filtered examples JSON', error);

    // Return a subset of examples if parsing fails
    return examples.slice(0, 2);
  }
}

export async function searchVectorDB(props: {
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

  // Step 1: Extract specific requirements from the user's request
  const requirements = await extractRequirements({
    userMessage: userMessageText,
    summary,
    model,
  });

  logger.info(`Extracted ${requirements.length} requirements:`, requirements);

  // Step 2: Search vector database for relevant code examples
  const codeExamples = await searchExamplesFromVectorDB(requirements);

  logger.info(`Found ${codeExamples.length} code examples`);

  // Step 3: Filter and evaluate the relevance of found examples
  const relevantExamples = await filterRelevantExamples({
    requirements,
    examples: codeExamples,
    userMessage: userMessageText,
    summary,
    model,
  });

  logger.info(`Selected ${relevantExamples.length} relevant examples`);

  // Step 4: Format and return relevant examples
  const result: FileMap = {};

  // Format examples as virtual files to be consistent with the current API
  relevantExamples.forEach((example, index) => {
    const basePath = `example-${index + 1}`;

    if (example.client_code) {
      result[`${basePath}/client`] = {
        type: 'file',
        content: example.client_code,
        isBinary: false,
      };
    }

    if (example.server_code) {
      result[`${basePath}/server.js`] = {
        type: 'file',
        content: example.server_code,
        isBinary: false,
      };
    }

    result[`${basePath}/description.md`] = {
      type: 'file',
      content: `# ${example.requirement || 'Code Example'}\n\n${example.description}`,
      isBinary: false,
    };
  });

  if (onFinish) {
    // This is needed to maintain compatibility with the original function
    const mockResp = {
      text: JSON.stringify(relevantExamples.map((ex) => ex.id)),
      choices: [{ text: '' }],
    } as any;
    onFinish(mockResp);
  }

  return result;
}

export function getFilePaths(files: FileMap) {
  let filePaths = Object.keys(files);
  filePaths = filePaths.filter((x) => {
    const relPath = x.replace('/home/project/', '');
    return !ig.ignores(relPath);
  });

  return filePaths;
}
