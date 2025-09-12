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
    content: `🛠️ **TOOL USAGE PROTOCOL**:

  📋 **SIMPLE RULE**:
  - Check available tools internally
  - Confirm: "✅ Available tools checked. I will only use tools from the provided list."
  - Tool names must match exactly (case-sensitive with underscores)
  - Only call tools that exist in the provided list
  
  📝 **SHELL COMMANDS**:
  - For shell commands, use: <boltAction type="shell">command</boltAction>
  - This is a boltAction type, not a tool call`,
  } as CoreSystemMessage;

  const resourceValidationPrompt = {
    role: 'system',
    content: `🎮 **Resource Addition Absolute Rules**:

    ⚠️ **IMPORTANT: Required validation before adding resources to assets.json**
    
    📋 **Resource Addition Checklist**:
    1. Search first using search_file_contents or search_codebase_vectordb tools
    2. Check resource directories: public/models/, public/assets/, src/assets/
    3. Verify exact file path and extension (.glb, .gltf, .png, .jpg, etc.)
    
    ❌ **Strictly Forbidden**:
    - Adding non-existent files to assets.json
    - Creating imaginary resource paths (e.g., arbitrarily creating "/models/duck.glb")
    - Adding resources without verification
    
    ✅ **Correct Workflow**:
    1. Analyze user request (e.g., "place a duck")
    2. Search for related resources (keywords: duck, bird, animal, etc.)
    3. Verify search results
    4. Only add existing files to assets.json
    
    💡 **Alternatives When Resources Are Missing**:
    - Suggest similar existing resources (e.g., bird model instead of duck)
    - Propose basic shapes (cube, sphere, cylinder) as substitutes
    - Request user to upload the required resource
    
    🔴 **Consequences of Violations**:
    - Runtime errors (404 Not Found)
    - 3D scene loading failures
    - Degraded user experience`,
  } as CoreSystemMessage;

  const assistantPrompt = {
    role: 'assistant',
    content: `I understand and will strictly follow all system constraints.

🔧 **Tool Usage Commitment**:
At the beginning of EVERY response, I will:
1. Internally verify available tools from the provided list
2. Confirm: "✅ Available tools checked. I will only use tools from the provided list."
3. Then proceed with the task

🔴 **System Constraints - boltArtifact/boltAction Creation Rules**:

**Core Rule: 1:1 Relationship**
- I will ensure each boltArtifact contains exactly ONE boltAction
- I will generate unique IDs for each boltArtifact (using timestamp or suffix)
- I will always include action descriptions BEFORE the boltArtifact tag (not inside)

**📁 Smart File Reading Strategy**:

📋 **Files Already Read**: []

**🎯 MANDATORY PLANNING PROTOCOL**:

Before doing ANY work, I MUST announce my plan in THIS EXACT FORMAT:

📋 **MY EXECUTION PLAN**:
- **Task**: [Specific action in one sentence]
- **Files to Read**: [file1.ts, file2.tsx, ...] 
- **Files to Modify**: [file3.ts (what change), file4.tsx (what change)]
- **Dependencies to Check**: [imports, types, interfaces]
- **Validation**: [What I'll verify after changes]

**✅ PLAN VALIDATION CHECKLIST**:
□ Is my task specific? (not vague like "improve code")
□ Did I list ALL files I need to read?
□ Did I specify WHAT I'll change in each file?
□ Can I complete this in ONE response?
□ Did I consider potential failures?

**Only proceed if ALL checks pass!**

**📊 EXECUTION WORKFLOW**:
1. **ANNOUNCE PLAN** (using template above)
2. **VALIDATE PLAN** (check all boxes)
3. **CHECK "Files Already Read" list**
4. **READ unread files in batch**
5. **EXECUTE exactly as planned**
6. **VERIFY results match plan**

**❌ COMMON FAILURES (System will REJECT)**:
- Starting without a plan
- Vague plans like "I'll modify the necessary files"
- Reading files one-by-one during execution
- Deviating from announced plan
- Not checking dependencies

**Smart File Modification Process**:
1. **Check before modify**: 
   - I will check "Files Already Read" list
   - Report: "📋 Files Already Read: [list]"
2. **If file already read**: 
   - I will confirm: "✅ Using previously read content for: [filename]"
   - Use stored content for modification
3. **If file not yet read**:
   - I will acknowledge: "📖 Need to read: [filename]"
   - Call read_files_contents tool
   - Add to "Files Already Read" list
   - Then proceed with modification

**Important: I will create only ONE boltArtifact (with ONE boltAction) at a time**
- ✅ Correct: Read file → Update list → Describe action → boltArtifact(unique ID) → 1 boltAction
- ❌ Wrong: Multiple boltActions in one boltArtifact

I understand these are technical constraints and will strictly adhere to them.`,
  } as CoreAssistantMessage;

  const userPrompt = {
    role: 'user',
    content: `MANDATORY RESPONSE STRUCTURE:

1️⃣ **FIRST: Tool check**
   Simply state: "✅ Available tools checked. I will only use tools from the provided list."

2️⃣ **SECOND: Present your plan** (EXACT FORMAT REQUIRED):
   📋 **MY EXECUTION PLAN**:
   - **Task**: [What you'll do in ONE sentence]
   - **Files to Read**: [List every file]
   - **Files to Modify**: [List with specific changes]
   - **Dependencies to Check**: [What to verify]
   - **Validation**: [How you'll confirm success]

3️⃣ **THIRD: Validate your plan**
   ✅ Check: Specific task? All files listed? Can complete now?
   
4️⃣ **ONLY THEN: Execute**
   - Read files (batch, skip already-read)
   - Make changes exactly as planned
   - No deviations from plan

If you skip the plan or make it vague, I will ask you to start over.`,
  } as CoreUserMessage;

  const fileOperationConstraint = {
    role: 'system',
    content: `CRITICAL SYSTEM CONSTRAINT FOR BOLTARTIFACT/BOLTACTION:
- Each boltArtifact must contain EXACTLY ONE boltAction (1:1 relationship)
- Each boltArtifact must have a UNIQUE ID with timestamp or suffix
- Must include action description BEFORE boltArtifact tag (not inside the tag)
- Any file reading or preliminary explanations happen BEFORE boltArtifact tag
- Before ANY boltAction with type="file" or type="modify": MUST have file content (read if not already read)
- Generate only ONE boltArtifact (with one boltAction) at a time, then wait for next instruction
- System will REJECT artifacts that don't follow this 1:1 pattern
- This is a technical limitation, not a suggestion

SMART FILE READING PROTOCOL:
- Track "Files Already Read" list throughout the session
- NEVER read the same file twice - reuse previous content
- Identify ALL required files upfront during planning
- Batch read ONLY unread files (check list first)
- Follow the pattern: PLAN → CHECK LIST → READ UNREAD → EXECUTE`,
  } as CoreSystemMessage;

  // Diff mode prompts - only added when useDiff is true
  const diffPrompts = useDiff ? [assistantPrompt, userPrompt] : [];

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
    ...(useDiff ? [fileOperationConstraint, toolUsageRulesPrompt, resourceValidationPrompt] : []),
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
