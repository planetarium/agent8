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

  const toolUsageRulesPrompt = {
    role: 'system',
    content: `🛠️ **툴 사용 절대 규칙**:

  ⚠️ **중요: 툴 호출 전 반드시 확인**
  1. 제공된 툴 목록에서만 툴을 선택하여 사용하세요
  2. 툴 이름은 정확히 일치해야 합니다 (대소문자, 언더스코어 포함)
  3. 존재하지 않는 툴을 절대 호출하지 마세요 (예: shell, bash, cmd 등)
  
  📋 **툴 호출 체크리스트**:
  □ 툴 이름이 제공된 목록과 정확히 일치하는가?
  □ 언더스코어(_)와 소문자를 정확히 사용했는가?
  □ 툴의 파라미터가 올바른가?
  
  🚨 **'shell' 툴 호출 시도 시**:
  - "Model tried to call unavailable tool 'shell'" 에러 발생
  - 작업이 즉시 중단됨
  - 프로젝트 진행 불가능
  
  💡 **중요**: 반드시 사용 가능한 툴 목록을 먼저 확인 후, 있는 툴만 호출하세요. shell은 툴이 아니므로 절대 호출하지 마세요.`,
  } as CoreSystemMessage;

  const resourceValidationPrompt = {
    role: 'system',
    content: `🎮 **리소스 추가 절대 규칙**:

    ⚠️ **중요: assets.json에 리소스 추가 전 필수 검증**
    
    📋 **리소스 추가 전 체크리스트**:
    1. search_file_contents 또는 search_codebase_vectordb 툴로 먼저 검색
    2. public/models/, public/assets/, src/assets/ 등 리소스 디렉토리 확인
    3. 정확한 파일 경로와 확장자(.glb, .gltf, .png, .jpg 등) 확인
    
    ❌ **절대 금지 사항**:
    - 존재하지 않는 파일을 assets.json에 추가
    - 상상으로 리소스 경로 생성 (예: "/models/duck.glb" 임의 생성)
    - 확인 없이 리소스 추가
    
    ✅ **올바른 작업 순서**:
    1. 사용자 요청 분석 (예: "오리를 배치해줘")
    2. 관련 리소스 검색 (duck, bird, animal 등 키워드)
    3. 검색 결과 확인
    4. 존재하는 파일만 assets.json에 추가
    
    💡 **리소스가 없을 경우 대안**:
    - 유사한 기존 리소스 제안 (예: 오리 대신 새 모델)
    - 기본 도형(큐브, 구, 실린더)으로 대체 제안
    - 사용자에게 리소스 업로드 요청
    
    🔴 **위반 시 결과**:
    - 런타임 에러 발생 (404 Not Found)
    - 3D 씬 로딩 실패
    - 사용자 경험 저하`,
  } as CoreSystemMessage;

  // Diff mode prompts - only added when useDiff is true
  const diffPrompts: (CoreAssistantMessage | CoreUserMessage)[] = [];

  const assistantPrompt = {
    role: 'assistant',
    content: `알겠습니다. 시스템 제약으로 인해 boltArtifact/boltAction 생성 시 다음 규칙을 준수하겠습니다:

🔴 **시스템 제약사항 - boltArtifact/boltAction 생성 규칙**:

**핵심 규칙: 1:1 관계**
- 각 boltArtifact는 정확히 하나의 boltAction만 포함
- 각 boltArtifact는 유니크한 ID 필요 (timestamp 또는 suffix 추가)
- boltArtifact 태그 전에 해당 action 설명 필수 (태그 내부가 아님)

**📁 파일 읽기 상태 관리 시스템**:
- 세션 동안 read_files_contents 툴로 읽은 모든 파일을 기억합니다
- 읽은 파일 목록을 내부적으로 추적하여 중복 읽기를 방지합니다
- 파일 수정 전 반드시 해당 파일이 읽은 파일 목록에 있는지 확인합니다

**읽은 파일 체크 프로세스**:
1. **내부 읽기 목록 확인**: read_files_contents로 읽은 파일인지 체크
2. **명확한 상태 선언**:
   - 읽은 파일: "✅ [파일명]을 이미 읽었습니다. 내용을 기반으로 수정합니다."
   - 읽지 않은 파일: "❌ [파일명]을 아직 읽지 않았습니다. 먼저 파일을 읽겠습니다."
3. **읽지 않은 파일 처리**: read_files_contents 툴 호출 후 목록에 추가

**파일 수정/생성 시 필수 프로세스**:
1. **boltAction type="file" 또는 type="modify" 전**: 반드시 해당 파일 경로 설명
2. **boltAction type="file" 또는 type="modify" 전**: 읽은 파일 목록에서 확인
   - 목록에 있음: "✅ 이미 읽었습니다. 기존 내용을 토대로 수정하겠습니다." 선언
   - 목록에 없음: "❌ 읽지 않았습니다. 파일을 읽겠습니다." 선언 → read_files_contents 툴 호출
3. **boltAction type="file" 또는 type="modify"**: 읽은 내용 기반으로만 생성

**중요: 한 번에 하나의 boltArtifact(하나의 boltAction)만 생성**
- ✅ 올바른 예: 파일 읽기 → action 설명 → boltArtifact(유니크 ID) → boltAction 1개
- ❌ 잘못된 예: 하나의 boltArtifact에 여러 boltAction 포함

**시스템이 거부하는 패턴**:
- 파일 읽기 확인 없이 boltAction type="file" 또는 type="modify" 생성 시 시스템 오류
- 하나의 boltArtifact에 여러 boltAction 포함 시 오류
- 유니크하지 않은 artifact ID 사용 시 충돌 위험
- 파일 내용 확인 없이 수정 시 데이터 손실 위험

이는 기술적 제약이므로 반드시 준수하겠습니다.`,
  } as CoreAssistantMessage;

  const userPrompt = {
    role: 'user',
    content: `- 반드시 한글로 응답하세요`,
  } as CoreUserMessage;

  const fileOperationConstraint = {
    role: 'system',
    content: `CRITICAL SYSTEM CONSTRAINT FOR BOLTARTIFACT/BOLTACTION:
- Each boltArtifact must contain EXACTLY ONE boltAction (1:1 relationship)
- Each boltArtifact must have a UNIQUE ID with timestamp or suffix
- Must include action description BEFORE boltArtifact tag (not inside the tag)
- Any file reading or preliminary explanations happen BEFORE boltArtifact tag
- Before ANY boltAction with type="file" or type="modify": MUST call read_files_contents first
- Generate only ONE boltArtifact (with one boltAction) at a time, then wait for next instruction
- System will REJECT artifacts that don't follow this 1:1 pattern
- This is a technical limitation, not a suggestion`,
  } as CoreSystemMessage;

  diffPrompts.push(assistantPrompt, userPrompt);

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
    ...(useDiff ? [toolUsageRulesPrompt] : []),
    ...(useDiff ? [resourceValidationPrompt] : []),
    ...convertToCoreMessages(processedMessages).slice(-3),
    ...diffPrompts,
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
