import { embed, generateText, type CoreTool, type GenerateTextResult, type Message } from 'ai';
import ignore from 'ignore';
import type { IProviderSetting } from '~/types/model';
import { IGNORE_PATTERNS, type FileMap } from './constants';
import { DEFAULT_MODEL, DEFAULT_PROVIDER, PROVIDER_LIST } from '~/utils/constants';
import { createFilesContext, extractPropertiesFromMessage, simplifyBoltActions } from './utils';
import { createScopedLogger } from '~/utils/logger';
import { LLMManager } from '~/lib/modules/llm/manager';
import { createOpenAI } from '@ai-sdk/openai';
import { createClient } from '@supabase/supabase-js';

// Common patterns to ignore, similar to .gitignore
const ig = ignore().add(IGNORE_PATTERNS);
const logger = createScopedLogger('search-vectordb');

/**
 * Extracts concrete requirements from a user's request to search for code examples
 */
async function extractRequirements(props: {
  userMessage: string;
  summary: string;
  model: any;
  contextFiles: FileMap;
  onStepFinish?: (resp: any) => void;
}) {
  const { userMessage, summary, model, contextFiles, onStepFinish } = props;

  const codeContext = createFilesContext(contextFiles, true);

  const resp = await generateText({
    system: `
      You are an AI assistant that helps developers by extracting specific coding requirements from general requests.
      Your task is to analyze a user's request and identify concrete technical implementation requirements
      that would benefit from code examples.

      CRITICAL: First determine if the request is:
      1. Complex enough to require code examples (complex game mechanics, multiplayer functionality, etc.)
      2. Something that can be easily implemented by an LLM without examples (simple UI, basic game logic, etc.)

      Only extract requirements if they are truly complex or would benefit significantly from existing code examples.

      <CodeContext>
      ${codeContext}
      </CodeContext>
    `,
    prompt: `
      Here is the summary of the conversation so far:
      ${summary}

      User's request: "${userMessage}"

      First, determine if this request requires code examples by answering YES or NO:
      - Answer YES if the request involves complex implementation details that would benefit from existing code examples
      - Answer NO if the request is straightforward enough for an LLM to implement without examples

      Then, only if you answered YES, extract 1-5 specific technical implementation requirements from this request.
      Focus ONLY on aspects that are complex and would genuinely benefit from existing code examples.
      If you've created requirements, add the user's original request in English as one of the requirements at the end.

      Format your response as a JSON object:
      {
        "requiresExamples": true/false,
        "requirements": ["requirement 1", "requirement 2", ...]
      }

      IMPORTANT: If the user's request is simple enough to implement without examples, return:
      {
        "requiresExamples": false,
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

      // If LLM determined no examples needed, return empty array
      if (!parsed.requiresExamples) {
        logger.info('LLM determined no examples needed for this request');
        return [];
      }

      return parsed.requirements as string[];
    } else {
      // Fallback parsing if JSON format wasn't followed
      return JSON.parse(resp.text).requirements || [];
    }
  } catch (error) {
    logger.error('Failed to parse requirements JSON', error);

    // Fall back to a simple extraction approach
    const lines = resp.text
      .split('\n')
      .filter((line) => line.trim().startsWith('-') || line.trim().startsWith('*'))
      .map((line) => line.replace(/^[-*]\s+/, '').trim());

    return lines.length > 0 ? lines : [];
  }
}

/**
 * Searches the vector database for relevant code examples based on requirements
 */
async function searchExamplesFromVectorDB({
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
  contextFiles: FileMap;
  onStepFinish?: (resp: any) => void;
}) {
  const { requirements, examples, userMessage, summary, model, contextFiles, onStepFinish } = props;

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

  const codeContext = createFilesContext(contextFiles, true);

  const resp = await generateText({
    system: `
      You are an AI assistant that helps developers by evaluating the relevance of code examples to their needs.
      Your task is to analyze code examples retrieved from a database and determine which ones are truly relevant
      and helpful for the user's current request.

      CRITICAL: Be very selective. Only include examples that are DIRECTLY relevant to the specific requirements.
      An example should only be included if it demonstrates implementation techniques that would be non-trivial
      for an LLM to generate from scratch.

      <CodeContext>
      ${codeContext}
      </CodeContext>
    `,
    prompt: `
      Here is the summary of the conversation so far:
      ${summary}

      User's request: "${userMessage}"

      Requirements extracted from the request:
      ${requirements.map((req) => `- ${req}`).join('\n')}

      Found code examples:
      ${JSON.stringify(examplesData, null, 2)}

      Evaluate each example and decide if it's HIGHLY relevant and helpful for the user's request.
      Focus on the description and code snippets to understand what the code does.

      For each example, ask:
      1. Does this example directly address one of the complex requirements?
      2. Would this code be difficult for an LLM to generate without an example?
      3. Is this example of high quality and demonstrative of best practices?

      Only include examples that receive "yes" answers to ALL three questions.

      IMPORTANT: Your response must be a valid JSON array containing only the IDs of highly relevant examples.
      Example format: ["1", "3", "5"]

      If none of the examples are highly relevant, return an empty array: []
    `,
    model,
    onStepFinish,
  });

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

    // Return no examples if parsing fails - better to return nothing than irrelevant examples
    return [];
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
  contextFiles?: FileMap;
  summary: string;
  onFinish?: (resp: GenerateTextResult<Record<string, CoreTool<any, any>>, never>) => void;
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

  // Step 1: Extract specific requirements from the user's request
  const requirements = await extractRequirements({
    userMessage: userMessageText,
    summary,
    model,
    contextFiles: contextFiles || {},
    onStepFinish: (resp) => {
      if (resp.usage) {
        cumulativeUsage.completionTokens += resp.usage.completionTokens || 0;
        cumulativeUsage.promptTokens += resp.usage.promptTokens || 0;
        cumulativeUsage.totalTokens += resp.usage.totalTokens || 0;
      }
    },
  });

  logger.info(`Extracted ${requirements.length} requirements:`, requirements);

  // Step 2: Search vector database for relevant code examples
  const codeExamples = await searchExamplesFromVectorDB({ requirements, supabase, openai });

  logger.info(`Found ${codeExamples.length} code examples`);

  // Step 3: Filter and evaluate the relevance of found examples
  const relevantExamples = await filterRelevantExamples({
    requirements,
    examples: codeExamples,
    userMessage: userMessageText,
    summary,
    model,
    contextFiles: contextFiles || {},
    onStepFinish: (resp) => {
      if (resp.usage) {
        cumulativeUsage.completionTokens += resp.usage.completionTokens || 0;
        cumulativeUsage.promptTokens += resp.usage.promptTokens || 0;
        cumulativeUsage.totalTokens += resp.usage.totalTokens || 0;
      }
    },
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
    // Pass the cumulative usage from both generateText calls
    const mockResp = {
      text: JSON.stringify(relevantExamples.map((ex) => ex.id)),
      choices: [{ text: '' }],
      usage: cumulativeUsage,
    } as any;
    onFinish(mockResp);
  }

  return { result, examples: relevantExamples, requirements };
}

export function getFilePaths(files: FileMap) {
  let filePaths = Object.keys(files);
  filePaths = filePaths.filter((x) => {
    const relPath = x.replace('/home/project/', '');
    return !ig.ignores(relPath);
  });

  return filePaths;
}
