import {
  streamText as _streamText,
  convertToCoreMessages,
  type CoreAssistantMessage,
  type CoreSystemMessage,
  type Message,
  NoSuchToolError,
} from 'ai';
import { z } from 'zod';
import { MAX_TOKENS, type FileMap } from './constants';
import { DEFAULT_MODEL, DEFAULT_PROVIDER, FIXED_MODELS, PROVIDER_LIST, WORK_DIR, TOOL_NAMES } from '~/utils/constants';
import { LLMManager } from '~/lib/modules/llm/manager';
import { createScopedLogger } from '~/utils/logger';
import { extractPropertiesFromMessage } from './utils';
import { createFileSearchTools } from './tools/file-search';
import {
  getResourceSystemPrompt,
  getProjectFilesPrompt,
  getProjectDocsPrompt,
  getProjectMdPrompt,
  getProjectPackagesPrompt,
  getAgent8Prompt,
  getVibeStarter3dSpecPrompt,
} from '~/lib/common/prompts/agent8-prompts';
import { createDocTools } from './tools/docs';
import { createSearchCodebase, createSearchResources } from './tools/vectordb';

export type Messages = Message[];

export type StreamingOptions = Omit<Parameters<typeof _streamText>[0], 'model'>;

const logger = createScopedLogger('stream-text');

export async function streamText(props: {
  messages: Array<Omit<Message, 'id'>>;
  env?: Env;
  options?: StreamingOptions;
  files?: FileMap;
  tools?: Record<string, any>;
  abortSignal?: AbortSignal;
}) {
  const { messages, env: serverEnv, options, files, tools, abortSignal } = props;
  let currentModel = DEFAULT_MODEL;
  let currentProvider = DEFAULT_PROVIDER.name;

  const processedMessages = messages.map((message) => {
    if (message.role === 'user') {
      const { model, provider, parts } = extractPropertiesFromMessage(message);
      currentModel = model === 'auto' ? FIXED_MODELS.DEFAULT_MODEL.model : model;
      currentProvider = model === 'auto' ? FIXED_MODELS.DEFAULT_MODEL.provider.name : provider;

      return { ...message, parts };
    } else if (message.role == 'assistant') {
      const parts = [...(message.parts || [])];

      for (const part of parts) {
        if (part.type === 'text') {
          part.text = part.text.replace(/<div class=\\"__boltThought__\\">.*?<\/div>/s, '');
          part.text = part.text.replace(/<think>.*?<\/think>/s, '');
          part.text = part.text.replace(/(<boltAction[^>]*>)([\s\S]*?)(<\/boltAction>)/gs, '');
          part.text = part.text.replace(/(<toolCall[^>]*>)([\s\S]*?)(<\/toolCall>)/gs, '');
          part.text = part.text.replace(/(<toolResult[^>]*>)([\s\S]*?)(<\/toolResult>)/gs, '');
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

  const dynamicMaxTokens = modelDetails && modelDetails.maxTokenAllowed ? modelDetails.maxTokenAllowed : MAX_TOKENS;

  const systemPrompt = getAgent8Prompt(WORK_DIR);

  const docTools = await createDocTools(serverEnv as Env, files);

  const codebaseTools = await createSearchCodebase(serverEnv as Env);
  const resourcesTools = await createSearchResources(serverEnv as Env);

  /*
   * Unknown tool handler for graceful error handling
   * Empty description to prevent LLM from selecting this tool directly
   */
  const unknownToolHandler = {
    description: '', // Intentionally empty to hide from LLM
    parameters: z.object({
      originalTool: z.string(),
      originalArgs: z.any(),
    }),
    execute: async ({ originalTool }: { originalTool: string; originalArgs: any }) => {
      logger.warn(`Unknown tool called: ${originalTool}`);
      return {
        result: `Tool '${originalTool}' is not registered. Please use one of the available tools.`,
      };
    },
  };

  let combinedTools: Record<string, any> = {
    ...tools,
    ...docTools,
    ...codebaseTools,
    ...resourcesTools,
    [TOOL_NAMES.UNKNOWN_HANDLER]: unknownToolHandler,
  };

  if (files) {
    // Add file search tools
    const fileSearchTools = createFileSearchTools(files);
    combinedTools = {
      ...combinedTools,
      ...fileSearchTools,
    };
  }

  const vibeStarter3dSpecPrompt = await getVibeStarter3dSpecPrompt(files);

  const allMessages = convertToCoreMessages(processedMessages);
  const previousMessages = allMessages.slice(-3, -1);
  const latestMessage = allMessages.slice(-1);

  // Create a combined context message to preserve order
  const contextSeparator = `

========================================
[PREVIOUS CONTEXT ENDS HERE]
========================================
[YOUR CURRENT RESPONSE STARTS HERE]
- File tracking begins NOW
- You have read ZERO files in THIS response
- Any files mentioned above were from PREVIOUS responses
========================================

`;

  const coreMessages = [
    ...[
      systemPrompt,
      getProjectFilesPrompt(files),
      getProjectDocsPrompt(files),
      vibeStarter3dSpecPrompt,
      getProjectPackagesPrompt(files),
      getResourceSystemPrompt(files),
    ]
      .filter(Boolean)
      .map(
        (content) =>
          ({
            role: 'system',
            content,
          }) as CoreSystemMessage,
      ),
    {
      role: 'system',
      content: getProjectMdPrompt(files),
    } as CoreSystemMessage,
    ...previousMessages,
    {
      role: 'assistant',
      content: contextSeparator,
    } as CoreAssistantMessage,
    ...latestMessage,
  ];

  if (modelDetails.name.includes('anthropic')) {
    coreMessages[coreMessages.length - 1].providerOptions = {
      anthropic: { cacheControl: { type: 'ephemeral' } },
    };
  }

  const result = await _streamText({
    model: provider.getModelInstance({
      model: modelDetails.name,
      serverEnv,
    }),
    abortSignal,
    maxTokens: dynamicMaxTokens,
    maxSteps: 20,
    messages: coreMessages,
    tools: combinedTools,
    experimental_repairToolCall: async ({ toolCall, error }) => {
      // Handle unknown tool calls gracefully
      if (NoSuchToolError.isInstance(error)) {
        // Redirect to our unknown tool handler
        return {
          toolCallType: 'function',
          toolCallId: toolCall.toolCallId,
          toolName: TOOL_NAMES.UNKNOWN_HANDLER,
          args: JSON.stringify({
            originalTool: toolCall.toolName,
            originalArgs: toolCall.args,
          }),
        };
      }

      // For other errors, let AI SDK handle them normally
      return null;
    },
    ...options,
  });

  (async () => {
    try {
      for await (const part of result.fullStream) {
        if (part.type === 'error') {
          const error: any = part.error;
          logger.error(`${error}`);

          return;
        }
      }
    } catch (e: any) {
      if (e.name === 'AbortError') {
        logger.info('Request aborted.');
        return;
      }

      throw e;
    }
  })();

  return result;
}
