import { convertToCoreMessages, streamText as _streamText, type Message } from 'ai';
import { MAX_TOKENS, type FileMap } from './constants';
import { getSystemPrompt } from '~/lib/common/prompts/prompts';
import { DEFAULT_MODEL, DEFAULT_PROVIDER, MODIFICATIONS_TAG_NAME, PROVIDER_LIST, WORK_DIR } from '~/utils/constants';
import type { IProviderSetting } from '~/types/model';
import { PromptLibrary } from '~/lib/common/prompt-library';
import { allowedHTMLElements } from '~/utils/markdown';
import { LLMManager } from '~/lib/modules/llm/manager';
import { createScopedLogger } from '~/utils/logger';
import { createFilesContext, extractPropertiesFromMessage } from './utils';
import { getFilePaths } from './select-context';

export type Messages = Message[];

export type StreamingOptions = Omit<Parameters<typeof _streamText>[0], 'model'>;

const logger = createScopedLogger('stream-text');

export async function streamText(props: {
  messages: Omit<Message, 'id'>[];
  env?: Env;
  options?: StreamingOptions;
  apiKeys?: Record<string, string>;
  files?: FileMap;
  providerSettings?: Record<string, IProviderSetting>;
  promptId?: string;
  contextOptimization?: boolean;
  contextFiles?: FileMap;
  summary?: string;
  messageSliceId?: number;
  vectorDbExamples?: FileMap;
  relevantResources?: Record<string, any>;
  tools?: Record<string, any>;
}) {
  const {
    messages,
    env: serverEnv,
    options,
    apiKeys,
    files,
    providerSettings,
    promptId,
    contextOptimization,
    contextFiles,
    summary,
    vectorDbExamples,
    relevantResources,
    tools,
  } = props;
  let currentModel = DEFAULT_MODEL;
  let currentProvider = DEFAULT_PROVIDER.name;
  let processedMessages = messages.map((message) => {
    if (message.role === 'user') {
      const { model, provider, content } = extractPropertiesFromMessage(message);
      currentModel = model;
      currentProvider = provider;

      return { ...message, content };
    } else if (message.role == 'assistant') {
      let content = message.content;
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

  const dynamicMaxTokens = modelDetails && modelDetails.maxTokenAllowed ? modelDetails.maxTokenAllowed : MAX_TOKENS;

  let systemPrompt =
    PromptLibrary.getPropmtFromLibrary(promptId || 'default', {
      cwd: WORK_DIR,
      allowedHtmlElements: allowedHTMLElements,
      modificationTagName: MODIFICATIONS_TAG_NAME,
    }) ?? getSystemPrompt();

  if (files && contextFiles && contextOptimization) {
    const codeContext = createFilesContext(contextFiles, true);
    const filePaths = getFilePaths(files);

    systemPrompt = `${systemPrompt}
Below are all the files present in the project:
---
${filePaths.join('\n')}
---

Below is the artifact containing the context loaded into context buffer for you to have knowledge of and might need changes to fullfill current user request.
CONTEXT BUFFER:
---
${codeContext}
---
`;

    if (summary) {
      systemPrompt = `${systemPrompt}
    below is the chat history till now
CHAT SUMMARY:
---
${props.summary}
---
`;
    }

    if (props.messageSliceId) {
      processedMessages = processedMessages.slice(props.messageSliceId);
    } else {
      const lastMessage = processedMessages.pop();

      if (lastMessage) {
        processedMessages = [lastMessage];
      }
    }
  }

  let resourceContext = '';

  if (files && files['/home/project/src/assets.json']) {
    const assetFile: FileMap = {};
    assetFile['/home/project/src/assets.json'] = files['/home/project/src/assets.json'];

    const assetContext = createFilesContext(assetFile, true);
    resourceContext += `\n${assetContext}\n`;
  }

  if (relevantResources && Object.keys(relevantResources).length > 0) {
    let resourcesXml = '<availableResources>\n';

    for (const key in relevantResources) {
      const resource = relevantResources[key];
      resourcesXml += '    <resource>\n';
      resourcesXml += `        <url>${resource.url}</url>\n`;
      resourcesXml += `        <description>${resource.description}</description>\n`;

      if (resource.metadata) {
        resourcesXml += '        <metadata>\n';

        for (const metaKey in resource.metadata) {
          resourcesXml += `            <${metaKey}>${resource.metadata[metaKey]}</${metaKey}>\n`;
        }
        resourcesXml += '        </metadata>\n';
      }

      resourcesXml += '    </resource>\n';
    }

    resourcesXml += '</availableResources>';

    resourceContext += `\n${resourcesXml}\n`;
  }

  systemPrompt = `${systemPrompt}


  <resource_constraints>
    <ResourceContext>
    ${resourceContext}
    </ResourceContext>

    The resources needed to fulfill the user's request are provided in the ResourceContext.
    You can only use resource urls from \`src/assets.json\` or listed in \`availableResources\` or listed url in \`<Attachments />\` user attached
    If you want to use a resource from \`<availableResources>\`, \`<Attachments />\`, add that resource to \`src/assets.json\` in your response.
    When adding to assets.json, it's good to include description and metadata along with the url. This will help the LLM utilize these resources better in future interactions.
    src/assets.json format:
    \`\`\`js filename="src/assets.json"
    {
      "images": {
        "character": {
          "url": "https://example.com/resource.png",
          "description": "A beautiful image",
          "metadata": {
            "width": 100,
            "height": 100
          }
        }
      }
    }
    \`\`\`

    The structure of assets.json is fixed at 2 levels deep. The first key is the category and the second key is the resource ID. Please always maintain this structure.
    \`\`\`js
    {
      "CATEGORY": {
        "RESOURCE_ID": {
          "url": "...",
          "description": "...",
          "metadata": {}
        }
      }
    }
    \`\`\`


  CRITICAL: Follow these strict resource management rules to prevent application errors:
    
  1. If appropriate resources are not available in assets.json:
     - Never create images directly using base64 or similar methods. even in assets.json's url part.
     - Never create URLs that are not provided.
     - For 2D games: Create visual elements using CSS or programmatic rendering in Phaser
     - For 3D games: Use Three.js to generate geometric shapes and programmatic textures
     - Use code-based solutions like CSS animations, canvas drawing, or procedural generation
     - Consider simplifying the visual design to work with available resources
     - NEVER create images directly using base64 or similar methods.
     
  
  2. Resource reference pattern:
     \`\`\`js
     import Assets from './assets.json'
     
     // Correct way to use assets
     const knightImageUrl = Assets.character.knight.url;
     \`\`\`

</resource_constraints>
`;

  if (vectorDbExamples && Object.keys(vectorDbExamples).length > 0) {
    const examplesContext = createFilesContext(vectorDbExamples, true);
    systemPrompt = `${systemPrompt}
Below are relevant code examples that might help with the current request:
EXAMPLES:
---
${examplesContext}
---
`;
  }

  logger.info(`Sending llm call to ${provider.name} with model ${modelDetails.name}`);

  /*
   * fs.appendFileSync(
   *   'last-prompt.logs',
   *   `time: ${new Date().toISOString()}\n\nsystemPrompt: ${systemPrompt}\n\nprocessedMessages: ${JSON.stringify(
   *     convertToCoreMessages(processedMessages as any),
   *     null,
   *     2,
   *   )}\n\n`,
   * );
   */

  return await _streamText({
    model: provider.getModelInstance({
      model: modelDetails.name,
      serverEnv,
      apiKeys,
      providerSettings,
    }),
    system: systemPrompt,
    maxTokens: dynamicMaxTokens,
    maxSteps: 100,
    messages: convertToCoreMessages(processedMessages as any),
    tools,
    ...options,
  });
}
