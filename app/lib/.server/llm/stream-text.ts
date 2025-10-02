import {
  streamText as _streamText,
  convertToModelMessages,
  stepCountIs,
  type SystemModelMessage,
  type UIMessage,
  NoSuchToolError,
  InvalidToolInputError,
  hasToolCall,
} from 'ai';
import { MAX_TOKENS, TOOL_ERROR, type FileMap, type Orchestration } from './constants';
import { DEFAULT_MODEL, DEFAULT_PROVIDER, FIXED_MODELS, PROVIDER_LIST, WORK_DIR, TOOL_NAMES } from '~/utils/constants';
import { LLMManager } from '~/lib/modules/llm/manager';
import { createScopedLogger } from '~/utils/logger';
import { extractPropertiesFromMessage } from './utils';
import { createFileContentSearchTool, createFileSearchTools, createFilesReadTool } from './tools/file-search';
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
import { createInvalidToolInputHandler } from './tools/error-handle';
import { createSubmitArtifactActionTool } from './tools/action';
import { createUnknownToolHandler } from './tools/error-handle';

export type Messages = UIMessage[];

export type StreamingOptions = Omit<Parameters<typeof _streamText>[0], 'model' | 'messages' | 'prompt' | 'system'>;

function createOrchestration(): Orchestration {
  return { readSet: new Set(), submitted: false };
}

const logger = createScopedLogger('stream-text');

export async function streamText(props: {
  messages: Array<Omit<UIMessage, 'id'>>;
  env?: Env;
  options?: StreamingOptions;
  files?: FileMap;
  tools?: Record<string, any>;
  abortSignal?: AbortSignal;
}) {
  const { messages, env: serverEnv, options, files, tools, abortSignal } = props;
  const toolRepairAttempts = new Map<string, number>();
  const MAX_REPAIR_ATTEMPTS = 3;

  let currentModel = DEFAULT_MODEL;
  let currentProvider = DEFAULT_PROVIDER.name;

  const orchestration = createOrchestration();

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
  const invalidToolArgumentsHandler = await createInvalidToolInputHandler();
  const submitArtifactActionTool = createSubmitArtifactActionTool(files, orchestration);
  const unknownToolHandlerTool = createUnknownToolHandler();

  let combinedTools: Record<string, any> = {
    ...tools,
    ...docTools,
    ...codebaseTools,
    ...resourcesTools,
    [TOOL_NAMES.INVALID_TOOL_ARGUMENTS]: invalidToolArgumentsHandler,
    [TOOL_NAMES.SUBMIT_ARTIFACT]: submitArtifactActionTool,
    [TOOL_NAMES.UNKNOWN_HANDLER]: unknownToolHandlerTool,
  };

  if (files) {
    // Add file search tools
    combinedTools = {
      ...combinedTools,
      [TOOL_NAMES.SEARCH_FILE_CONTENTS]: createFileContentSearchTool(files),
      [TOOL_NAMES.READ_FILES_CONTENTS]: createFilesReadTool(files, orchestration),
    };
  }

  const vibeStarter3dSpecPrompt = await getVibeStarter3dSpecPrompt(files);

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
          }) as SystemModelMessage,
      ),
    {
      role: 'system',
      content: getProjectMdPrompt(files),
    } as SystemModelMessage,
    ...convertToModelMessages(processedMessages).slice(-3),
  ];

  if (modelDetails.name.includes('anthropic')) {
    coreMessages[coreMessages.length - 1].providerOptions = {
      anthropic: { cacheControl: { type: 'ephemeral' } },
    };
  }

  const result = _streamText({
    model: provider.getModelInstance({
      model: modelDetails.name,
      serverEnv,
    }),
    abortSignal,
    maxOutputTokens: dynamicMaxTokens,
    stopWhen: [stepCountIs(15), hasToolCall(TOOL_NAMES.SUBMIT_ARTIFACT)],
    messages: coreMessages,
    tools: combinedTools,
    toolChoice: { type: 'tool', toolName: TOOL_NAMES.SUBMIT_ARTIFACT },
    experimental_repairToolCall: async ({ toolCall, error }) => {
      // Handle unknown tool calls gracefully
      if (NoSuchToolError.isInstance(error)) {
        // Redirect to our unknown tool handler
        return {
          type: 'tool-call',
          toolCallId: toolCall.toolCallId,
          toolName: TOOL_NAMES.UNKNOWN_HANDLER,
          input: JSON.stringify({
            originalTool: toolCall.toolName,
            originalArgs: JSON.stringify(toolCall.input),
          }),
        };
      } else if (InvalidToolInputError.isInstance(error)) {
        if (toolCall.toolName === TOOL_NAMES.SUBMIT_ARTIFACT && error.message) {
          const match = error.message.match(/Error message:\s*({.*})/);

          if (match) {
            const errorData = match[1];
            const parsedError = JSON.parse(errorData);

            if (parsedError.name === TOOL_ERROR.MISSING_FILE_CONTEXT && parsedError.paths) {
              return {
                type: 'tool-call',
                toolCallId: toolCall.toolCallId,
                toolName: TOOL_NAMES.READ_FILES_CONTENTS,
                input: JSON.stringify({ pathList: parsedError.paths }),
              };
            }
          }
        } else {
          const toolName = toolCall.toolName;
          const currentAttempts = toolRepairAttempts.get(toolName) || 0;

          if (currentAttempts >= MAX_REPAIR_ATTEMPTS) {
            logger.warn(`Max repair attempts (${MAX_REPAIR_ATTEMPTS}) reached for toolCallId: ${toolCall.toolCallId}`);
            return null;
          }

          toolRepairAttempts.set(toolName, currentAttempts + 1);

          return {
            type: 'tool-call',
            toolCallId: toolCall.toolCallId,
            toolName: TOOL_NAMES.INVALID_TOOL_ARGUMENTS,
            input: JSON.stringify({
              originalTool: toolCall.toolName,
            }),
          };
        }
      }

      return null;
    },

    prepareStep: async () => {
      if (orchestration.submitted) {
        return {
          activeTools: [],
        };
      }

      return undefined;
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
