import {
  streamText as _streamText,
  convertToModelMessages,
  stepCountIs,
  hasToolCall,
  jsonSchema,
  type SystemModelMessage,
  type UIMessage,
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

export type Messages = UIMessage[];

export type StreamingOptions = Omit<Parameters<typeof _streamText>[0], 'model' | 'messages' | 'prompt' | 'system'>;

const logger = createScopedLogger('stream-text');

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

const submitArtifactTool = {
  description: 'Submit the final artifact. Call this tool with JSON instead of outputting tags as text.',
  inputSchema: jsonSchema({
    type: 'object',
    properties: {
      id: { type: 'string', description: 'kebab-case identifier (e.g., platformer-game)' },
      title: { type: 'string', description: 'Descriptive title of the artifact' },
      actions: {
        type: 'array',
        description: 'List of file/shell actions',
        items: {
          oneOf: [
            {
              type: 'object',
              properties: {
                type: { const: 'file' },
                filePath: { type: 'string', description: 'Relative path from cwd' },
                content: { type: 'string', description: 'Complete file content' },
              },
              required: ['type', 'filePath', 'content'],
              additionalProperties: false,
            },
            {
              type: 'object',
              properties: {
                type: { const: 'shell' },
                command: { type: 'string', description: 'Shell command to execute' },
              },
              required: ['type', 'command'],
              additionalProperties: false,
            },
          ],
        },
      },
    },
    required: ['id', 'title', 'actions'],
    additionalProperties: false,
  }),
};

export async function streamText(props: {
  messages: Array<Omit<UIMessage, 'id'>>;
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
  let combinedTools: Record<string, any> = {
    ...tools,
    ...docTools,
    ...codebaseTools,
    ...resourcesTools,
    [TOOL_NAMES.UNKNOWN_HANDLER]: unknownToolHandler,
    [TOOL_NAMES.SUBMIT_ARTIFACT]: submitArtifactTool,
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
            originalArgs: toolCall.input,
          }),
        };
      }

      // For other errors, let AI SDK handle them normally
      return null;
    },
    providerOptions: {
      openai: {
        include: [], // reasoning.encrypted_content 제외하여 thoughtSignature 제거
      },
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
