import {
  streamText as _streamText,
  convertToModelMessages,
  stepCountIs,
  hasToolCall,
  jsonSchema,
  type SystemModelMessage,
  type UIMessage,
} from 'ai';
import { MAX_TOKENS, type FileMap } from './constants';
import { DEFAULT_MODEL, DEFAULT_PROVIDER, FIXED_MODELS, PROVIDER_LIST, WORK_DIR } from '~/utils/constants';
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

const generateBoltArtifactToolName = 'generate_bolt_artifact';

export const generateBoltArtifact = {
  description: '최종 산출물(아티팩트)을 제출한다. 태그는 출력하지 말고 JSON으로 이 도구를 호출하라.',
  inputSchema: jsonSchema({
    type: 'object',
    properties: {
      id: { type: 'string', description: 'kebab-case 식별자(예: platformer-game)' },
      title: { type: 'string' },
      actions: {
        type: 'array',
        description: '파일/셸 동작 목록',
        items: {
          oneOf: [
            {
              type: 'object',
              properties: {
                type: { const: 'file' },
                filePath: { type: 'string', description: 'cwd 기준 상대경로' },
                content: { type: 'string' },
              },
              required: ['type', 'filePath', 'content'],
              additionalProperties: false,
            },
            {
              type: 'object',
              properties: {
                type: { const: 'shell' },
                command: { type: 'string' }, // pnpm add ... 등
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
  async execute(input: {
    id: string;
    title: string;
    actions: Array<{ type: 'file'; filePath: string; content: string } | { type: 'shell'; command: string }>;
  }) {
    // (권장) 최소 검증: filePath는 상대경로여야 함
    for (const a of input.actions) {
      if (a.type === 'file' && (/^\//.test(a.filePath) || a.filePath.includes('..'))) {
        throw new Error(`filePath는 cwd 기준 상대경로여야 합니다: ${a.filePath}`);
      }
    }

    return {
      id: input.id,
      title: input.title,
      actions: input.actions,
    };
  },
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
    [generateBoltArtifactToolName]: generateBoltArtifact,
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

  const result = await _streamText({
    model: provider.getModelInstance({
      model: modelDetails.name,
      serverEnv,
    }),
    abortSignal,
    maxOutputTokens: dynamicMaxTokens,
    stopWhen: [stepCountIs(15), hasToolCall(generateBoltArtifactToolName)],
    messages: coreMessages,
    tools: combinedTools,
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

  /*
   * (async () => {
   *   try {
   *     for await (const part of result.fullStream) {
   *       if (part.type === 'error') {
   *         const error: any = (part as any).error;
   *         logger.error(`stream error: ${error}`);
   */

  /*
   *         return;
   *       }
   */

  /*
   *       if (part.type === 'tool-result' && (part as any).toolName === generateBoltArtifactToolName) {
   *         const raw = (part as any).result;
   *         const xml = typeof raw === 'string' ? raw : typeof raw?.xml === 'string' ? raw.xml : JSON.stringify(raw);
   */

  /*
   *         (result as any).finalBoltArtifact = xml;
   *         logger.info('✅ Captured <boltArtifact> XML from finalize tool.');
   */

  /*
   *         return; // 더 받을 필요 없음
   *       }
   *     }
   */

  /*
   *     if (!(result as any).finalBoltArtifact) {
   *       logger.warn(`⚠️ Stream ended without a ${generateBoltArtifactToolName} result.`);
   *     }
   *   } catch (e: any) {
   *     if (e.name === 'AbortError') {
   *       logger.info('Request aborted.');
   *       return;
   *     }
   */

  /*
   *     logger.error(e);
   *     throw e;
   *   }
   * })();
   */

  return result;
}
