import {
  streamText as _streamText,
  convertToCoreMessages,
  type CoreAssistantMessage,
  type CoreSystemMessage,
  type CoreUserMessage,
  type Message,
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
import { getAgent8PromptAddDiff } from '~/lib/common/prompts/agent8-prompts-add-diff';
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
  let useDiff = false;

  const processedMessages = messages.map((message) => {
    if (message.role === 'user') {
      const { model, provider, parts, useDiff: extractedUseDiff } = extractPropertiesFromMessage(message);
      currentModel = model === 'auto' ? FIXED_MODELS.DEFAULT_MODEL.model : model;
      currentProvider = model === 'auto' ? FIXED_MODELS.DEFAULT_MODEL.provider.name : provider;

      // Update useDiff if found in message
      if (extractedUseDiff !== undefined) {
        useDiff = extractedUseDiff;
      }

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

  // Select appropriate prompt based on useDiff from messages
  const systemPrompt = useDiff ? getAgent8PromptAddDiff(WORK_DIR) : getAgent8Prompt(WORK_DIR);
  logger.info(`🔴🔴🔴 Using diff mode: ${useDiff}`);

  const docTools = await createDocTools(serverEnv as Env, files);

  const codebaseTools = await createSearchCodebase(serverEnv as Env);
  const resourcesTools = await createSearchResources(serverEnv as Env);
  let combinedTools: Record<string, any> = { ...tools, ...docTools, ...codebaseTools, ...resourcesTools };

  if (files) {
    // Add file search tools
    const fileSearchTools = createFileSearchTools(files);
    combinedTools = {
      ...combinedTools,
      ...fileSearchTools,
    };
  }

  const vibeStarter3dSpecPrompt = await getVibeStarter3dSpecPrompt(files);

  /*
   * const assistantPrompt = {
   *   role: 'assistant',
   *   content: `작업을 아래 순서로 진행하겠습니다.
   *   1 어떤 수정 사항을 변경할지 모든 파일 목록을 정의하겠습니다.
   *   2. 수정에 필요한 파일을 읽겠습니다(한번에 읽을 수 없다면 여러번 요청해서라도 반드시 모든 파일을 읽겠습니다).
   *   2-1. 추가로 연관된 파일을 읽겠습니다(반복).
   *   3. 수정 코드를 생성하겠습니다.`,
   * } as CoreAssistantMessage;
   */

  const assistantPrompt = {
    role: 'assistant',
    content: `알겠습니다. 시스템 제약으로 인해 boltAction 생성 시 다음 규칙을 준수하겠습니다:

🔴 **시스템 제약사항 - boltAction 생성 규칙**:

**파일 수정/생성 시 필수 프로세스**:
1. **boltAction type="file" 또는 type="modify" 전**: 반드시 해당 파일 경로 설명
2. **boltAction type="file" 또는 type="modify" 전**: 반드시 read_files_contents 툴 호출
3. **boltAction type="file" 또는 type="modify"**: 읽은 내용 기반으로만 생성

**중요: 한 번에 하나의 boltAction만 생성**
- ✅ 올바른 예: 설명 → 읽기 → boltAction 1개 → 다음 파일 설명 → 읽기 → boltAction 1개
- ❌ 잘못된 예: 여러 boltAction을 연속으로 생성

**시스템이 거부하는 패턴**:
- read_files_contents 없이 boltAction type="file" 또는 type="modify" 생성 시 시스템 오류
- 여러 boltAction을 동시에 생성 시 첫 번째만 처리됨
- 파일 내용 확인 없이 수정 시 데이터 손실 위험

이는 기술적 제약이므로 반드시 준수하겠습니다.`,
  } as CoreAssistantMessage;

  const userPrompt = {
    role: 'user',
    content: `🚨 시스템 경고: boltAction 생성 제약
- boltAction type="file" 또는 type="modify"를 생성하기 전에 반드시 read_files_contents를 먼저 호출해야 합니다
- 이 순서를 어기면 시스템이 boltAction을 거부합니다
- 여러 boltAction을 한번에 생성하지 마세요. 하나씩 처리해야 합니다
- 반드시 한글로 응답하세요`,
  } as CoreUserMessage;

  // 파일 작업 제약 시스템 프롬프트 추가
  const fileOperationConstraint = {
    role: 'system',
    content: `CRITICAL SYSTEM CONSTRAINT FOR BOLTACTION:
- Before ANY boltAction with type="file" or type="modify": MUST call read_files_contents first
- Generate only ONE boltAction at a time, then wait for next instruction
- System will REJECT boltActions that don't follow this pattern
- This is a technical limitation, not a suggestion`,
  } as CoreSystemMessage;

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
    fileOperationConstraint,
    ...convertToCoreMessages(processedMessages).slice(-3),
    assistantPrompt,
    userPrompt,
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
