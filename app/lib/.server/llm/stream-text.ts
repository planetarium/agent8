import {
  streamText as _streamText,
  convertToCoreMessages,
  type CoreAssistantMessage,
  type CoreSystemMessage,
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

  const assistantPrompt = {
    role: 'assistant',
    content: `I understand and will follow this exact workflow:

🔧 Tool Usage Commitment:
   I have internally verified the available tools for this conversation.
   ✅ I will ONLY use tools that actually exist with EXACT spelling.
   ❌ I will NEVER attempt to call non-existent tools or use incorrect tool names.

📌 First, I will initialize my read files tracking.
   I am setting READ_FILES = [] right now, starting fresh for this conversation.

1️⃣ I will now identify and read all relevant files for this task in a single batch:
   - I will read all files that need modification
   - I will read all files with import/export relationships
   - I will read all potentially affected files

2️⃣ 🔴 MY COMMITMENT: Before modifying ANY file 🔴
   I promise to ALWAYS follow these THREE MANDATORY STEPS IN EXACT ORDER:
   
   STEP 1: I will announce: "I will modify [filename]"
   STEP 2: IMMEDIATELY AFTER STEP 1, I MUST check: "Checking if [filename] was read in THIS conversation..."
   STEP 3: Based on Step 2 result:
      - If read: "File was read in this conversation. Proceeding with modification."
      - If NOT read: "File not read in this conversation. Reading it now..." → READ THE FILE → Then modify
   
   🚨 CRITICAL: After saying "I will modify", I CANNOT proceed without doing the check.
   The check is NOT optional. I will ALWAYS do Step 2 after Step 1. NO EXCEPTIONS.
   
   I understand that skipping the check after announcement is FORBIDDEN.

3️⃣ When using modify type, I will:
   - Always create a separate boltArtifact for each modify
   - Never mix multiple modifies in one boltArtifact
   - Always use a unique ID with timestamp

I acknowledge: Files from previous conversations don't count - I must read them again in THIS conversation.`,
  } as CoreAssistantMessage;

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
    ...convertToCoreMessages(processedMessages).slice(-3),
    assistantPrompt,
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
