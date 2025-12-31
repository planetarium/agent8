import {
  streamText as _streamText,
  convertToModelMessages,
  stepCountIs,
  type SystemModelMessage,
  type UIMessage,
  NoSuchToolError,
  type ToolContent,
  type ToolModelMessage,
  type ModelMessage,
} from 'ai';
import { MAX_TOKENS, type FileMap, type Orchestration } from './constants';
import {
  DEFAULT_MODEL,
  DEFAULT_PROVIDER,
  FIXED_MODELS,
  PROVIDER_LIST,
  WORK_DIR,
  TOOL_NAMES,
  EXCLUSIVE_3D_DOC_TOOLS,
} from '~/utils/constants';
import { LLMManager } from '~/lib/modules/llm/manager';
import { createScopedLogger } from '~/utils/logger';
import { extractPropertiesFromMessage } from './utils';
import { createFileContentSearchTool, createFilesReadTool } from './tools/file-search';
import {
  getResourceSystemPrompt,
  getProjectFilesPrompt,
  getProjectDocsPrompt,
  getProjectMdPrompt,
  getProjectPackagesPrompt,
  getAgent8Prompt,
  getVibeStarter3dSpecPrompt,
  getPerformancePrompt,
} from '~/lib/common/prompts/agent8-prompts';
import { createDocTools } from './tools/docs';
import { createSearchCodebase, createSearchResources } from './tools/vectordb';
import {
  createSubmitFileActionTool,
  createSubmitModifyActionTool,
  createSubmitShellActionTool,
} from './tools/submit-actions';
import { createUnknownToolHandler } from './tools/error-handle';
import { is3dProject } from '~/lib/utils';

export type Messages = UIMessage[];

export type StreamingOptions = Omit<Parameters<typeof _streamText>[0], 'model' | 'messages' | 'prompt' | 'system'>;

function createOrchestration(): Orchestration {
  return { readSet: new Set(), updatedSet: new Set() };
}

const logger = createScopedLogger('stream-text');

const MESSAGE_COUNT_FOR_LLM = 3;

export function getMessagesForLLM(messages: UIMessage[]) {
  return messages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .slice(-MESSAGE_COUNT_FOR_LLM);
}

export async function streamText(props: {
  messages: Array<Omit<UIMessage, 'id'>>;
  env?: Env;
  options?: StreamingOptions;
  files?: FileMap;
  tools?: Record<string, any>;
  abortSignal?: AbortSignal;
  toolResults?: ToolContent;
  onDebugLog?: (message: string) => void;
}) {
  const { messages, env: serverEnv, options, files, tools, abortSignal, toolResults, onDebugLog } = props;
  let currentModel = DEFAULT_MODEL;
  let currentProvider = DEFAULT_PROVIDER.name;

  const orchestration = createOrchestration();

  onDebugLog?.('Processing tool results');

  // Populate orchestration.readSet from toolResults if provided (for retry scenarios)
  if (toolResults && Array.isArray(toolResults)) {
    for (const toolResult of toolResults) {
      if (toolResult.type === 'tool-result' && toolResult.toolName === TOOL_NAMES.READ_FILES_CONTENTS) {
        const output = toolResult.output?.value as any;

        if (output?.files && Array.isArray(output.files)) {
          for (const file of output.files) {
            if (file.path && file.content) {
              orchestration.readSet.add(file.path);
            }
          }
        }
      }
    }
  }

  onDebugLog?.('Processing messages');

  const processedMessages = messages
    .map((message) => {
      if (message.role === 'user') {
        const { model, provider, parts } = extractPropertiesFromMessage(message);
        currentModel = model === 'auto' ? FIXED_MODELS.DEFAULT_MODEL.model : model;
        currentProvider = model === 'auto' ? FIXED_MODELS.DEFAULT_MODEL.provider.name : provider;

        return { ...message, parts };
      } else if (message.role == 'assistant') {
        const parts = [...(message.parts || [])];
        const newParts = [];

        for (const part of parts) {
          if (part.type === 'text') {
            let text = part.text;
            text = text.replace(/<div class=\\"__boltThought__\\">.*?<\/div>/s, '');
            text = text.replace(/<think>.*?<\/think>/s, '');
            text = text.replace(/(<boltAction[^>]*>)([\s\S]*?)(<\/boltAction>)/gs, '');
            text = text.replace(/(<toolCall[^>]*>)([\s\S]*?)(<\/toolCall>)/gs, '');
            text = text.replace(/(<toolResult[^>]*>)([\s\S]*?)(<\/toolResult>)/gs, '');

            if (text.trim().length > 0) {
              newParts.push({ ...part, text });
            }
          } else {
            newParts.push(part);
          }
        }

        return { ...message, parts: newParts };
      }

      return message;
    })
    .filter((message) => {
      if (message.parts && Array.isArray(message.parts) && message.parts.length === 0) {
        return false;
      }

      return true;
    });

  onDebugLog?.('Selecting model');

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

  onDebugLog?.('Creating tools');

  const systemPrompt = getAgent8Prompt(WORK_DIR);

  const docTools = await createDocTools(serverEnv as Env, files);

  const codebaseTools = await createSearchCodebase(serverEnv as Env);
  const resourcesTools = await createSearchResources(serverEnv as Env);
  const submitFileActionTool = createSubmitFileActionTool(files, orchestration);
  const submitModifyActionTool = createSubmitModifyActionTool(files, orchestration);
  const submitShellActionTool = createSubmitShellActionTool();
  const unknownToolHandlerTool = createUnknownToolHandler();

  let combinedTools: Record<string, any> = {
    ...tools,
    ...codebaseTools,
    ...resourcesTools,
    [TOOL_NAMES.SUBMIT_FILE_ACTION]: submitFileActionTool,
    [TOOL_NAMES.SUBMIT_MODIFY_ACTION]: submitModifyActionTool,
    [TOOL_NAMES.SUBMIT_SHELL_ACTION]: submitShellActionTool,
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

  if (docTools && Object.keys(docTools).length > 0) {
    const filteredDocTools = is3dProject(files)
      ? docTools
      : Object.fromEntries(Object.entries(docTools).filter(([key]) => !EXCLUSIVE_3D_DOC_TOOLS.includes(key)));

    combinedTools = {
      ...combinedTools,
      ...filteredDocTools,
    };
  }

  const performancePrompt = getPerformancePrompt(is3dProject(files));
  const vibeStarter3dSpecPrompt = await getVibeStarter3dSpecPrompt(files);

  onDebugLog?.('Preparing prompts');

  /*
   * ============================================
   * Prompt Classification (by change frequency: low → high)
   * ============================================
   */

  // 1. Static - Shared across all users/projects (highest cache hit rate)
  const staticPrompts = [systemPrompt];

  // 2. Project Type - Shared among 2D/3D users respectively
  const projectTypePrompts = [performancePrompt, vibeStarter3dSpecPrompt, getProjectDocsPrompt(files)];

  // 3. Project Context - Shared within same project sessions
  const projectContextPrompts = [
    getProjectFilesPrompt(files),
    getProjectPackagesPrompt(files),
    getResourceSystemPrompt(files),
  ];

  // 4. Dynamic - Frequently changed (low cache hit rate)
  const dynamicPrompts = [getProjectMdPrompt(files)];

  // Compose system messages in order of change frequency (low → high)
  let coreMessages: ModelMessage[] = [
    ...[...staticPrompts, ...projectTypePrompts, ...projectContextPrompts, ...dynamicPrompts].filter(Boolean).map(
      (content) =>
        ({
          role: 'system',
          content,
        }) as SystemModelMessage,
    ),
  ];

  // Add tool results before recent messages (for retry scenarios with previous file reads)
  if (toolResults && toolResults.length > 0) {
    coreMessages.push({
      role: 'tool',
      content: toolResults,
    } as ToolModelMessage);
  }

  // Add recent model messages (converted from UI messages - includes assistant's text + user retry request)
  coreMessages.push(...convertToModelMessages(processedMessages).slice(-MESSAGE_COUNT_FOR_LLM));

  // Filter out empty messages
  coreMessages = coreMessages.filter((message) => {
    if (Array.isArray(message.content)) {
      return message.content.length > 0;
    } else if (typeof message.content === 'string') {
      return message.content.trim().length > 0;
    }

    return true;
  });

  if (modelDetails.name.includes('anthropic')) {
    coreMessages[coreMessages.length - 1].providerOptions = {
      anthropic: { cacheControl: { type: 'ephemeral' } },
    };
  }

  onDebugLog?.('Starting stream');

  const result = _streamText({
    model: provider.getModelInstance({
      model: modelDetails.name,
      serverEnv,
    }),
    abortSignal,
    maxOutputTokens: dynamicMaxTokens,
    stopWhen: [stepCountIs(30)],
    messages: coreMessages,
    tools: combinedTools,
    toolChoice: 'auto',
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
      }

      return null;
    },
    ...options,
  });

  return result;
}
