import { streamText as _streamText, convertToCoreMessages, type CoreSystemMessage, type Message } from 'ai';
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
} from '~/lib/common/prompts/agent8-prompts';
import { createDocTools } from './tools/docs';
import { createSearchCodebase, createSearchResources } from './tools/vectordb';
import semver from 'semver';
import { createWriteStream, promises as fs } from 'fs';
import { pipeline } from 'stream/promises';

import path from 'path';
import os from 'os';
import { extract } from 'tar';

export type Messages = Message[];

export type StreamingOptions = Omit<Parameters<typeof _streamText>[0], 'model'>;

const logger = createScopedLogger('stream-text');

const VIBE_STARTER_3D_PACKAGE_NAME = 'vibe-starter-3d';
const VIBE_STARTER_3D_ENVIRONMENT_PACKAGE_NAME = 'vibe-starter-3d-environment';

let loadedVibeStarter3dDocs = false;
let loadedVibeStarter3dEnvironmentDocs = false;
const vibeStarter3dDocs: Record<string, string> = {};
const vibeStarter3dEnvironmentDocs: Record<string, string> = {};

function getPackageContent(files: any): string {
  const packageFile = files[`${WORK_DIR}/package.json`];

  return packageFile?.type === 'file' ? packageFile.content : '';
}

async function resolvePackageVersion(packageName: string, files: any): Promise<string> {
  try {
    const packageContent = getPackageContent(files);
    const packageJson = JSON.parse(packageContent);
    const version = packageJson.dependencies?.[packageName];

    if (version) {
      return await getActualVersion(packageName, version);
    }

    return await getLatestVersion(packageName);
  } catch {
    throw new Error(`Failed to get version from package ${packageName}`);
  }
}

async function getActualVersion(packageName: string, versionRange: string): Promise<string> {
  try {
    const res = await fetch(`https://registry.npmjs.org/${packageName}`);
    const packageInfo = (await res.json()) as { versions: Record<string, any> };
    const versions = Object.keys(packageInfo.versions);

    const actualVersion = semver.maxSatisfying(versions, versionRange);

    return actualVersion || versionRange;
  } catch {
    throw new Error(`Failed to resolve version for ${packageName}@${versionRange}`);
  }
}

async function getLatestVersion(packageName: string): Promise<string> {
  const res = await fetch(`https://registry.npmjs.org/${packageName}`);

  if (!res.ok) {
    throw new Error(`Failed to fetch package metadata: ${res.status}`);
  }

  const metadata: any = await res.json();
  const latestVersion = metadata['dist-tags']?.latest;

  if (!latestVersion) {
    throw new Error('Latest version not found');
  }

  return latestVersion;
}

function is3dProject(files: any): boolean {
  const packageJson = files[`${WORK_DIR}/package.json`];

  if (packageJson?.type === 'file' && packageJson?.content?.length > 0) {
    const packageContent = JSON.parse(packageJson.content);

    if (packageContent.dependencies?.hasOwnProperty(VIBE_STARTER_3D_PACKAGE_NAME)) {
      return true;
    }
  }

  return false;
}

function getVibeStarter3dDocsPrompt(): string {
  if (Object.keys(vibeStarter3dDocs).length === 0) {
    return '';
  }

  const docsContent = Object.entries(vibeStarter3dDocs)
    .map(
      ([key, content]) => `
      <doc_file name="${key}">
        ${content}
      </doc_file>`,
    )
    .join('\n');

  return `
<PROJECT_DESCRIPTION>
    These files contain essential information that must be understood before performing any work on the project. Please always familiarize yourself with the contents of these files before starting any task.
    <docs_files>
      ${docsContent}
    </docs_files>
</PROJECT_DESCRIPTION>
`;
}

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

  if (is3dProject(files)) {
    logger.debug('@@@@@@@ 3D Project');
    await updateVibeLibrariesDocs(files);
  }

  const docTools = await createDocTools(serverEnv as Env);

  const keysToRemove: string[] = [];
  const checkToolName = 'vibe_starter_3d_environment';
  Object.keys(docTools).forEach((key) => {
    if (key.includes(checkToolName)) {
      logger.debug(`Found docTools key containing '${checkToolName}': ${key}`);

      if (vibeStarter3dEnvironmentDocs.hasOwnProperty(key)) {
        docTools[key].execute = async () => {
          return { content: vibeStarter3dEnvironmentDocs[key] };
        };
      } else {
        keysToRemove.push(key);
      }
    }
  });

  keysToRemove.forEach((key) => {
    delete docTools[key];
    logger.debug(`Removed docTools key '${key}' as it's not found in ${VIBE_STARTER_3D_ENVIRONMENT_PACKAGE_NAME}:docs`);
  });

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

  const coreMessages = [
    ...[
      systemPrompt,
      getProjectFilesPrompt(files),
      getProjectDocsPrompt(files),
      getVibeStarter3dDocsPrompt(),
      getProjectPackagesPrompt(files),
      getResourceSystemPrompt(files),
    ].map(
      (content) =>
        ({
          role: 'system',
          content,
        }) as CoreSystemMessage,
    ),
    {
      role: 'system',
      content: getProjectMdPrompt(files),

      providerOptions: {
        anthropic: { cacheControl: { type: 'ephemeral' } },
      },
    } as CoreSystemMessage,
    ...convertToCoreMessages(processedMessages).slice(-3),
  ];

  coreMessages[coreMessages.length - 1].providerOptions = {
    anthropic: { cacheControl: { type: 'ephemeral' } },
  };

  const result = await _streamText({
    model: provider.getModelInstance({
      model: modelDetails.name,
      serverEnv,
    }),
    abortSignal,
    maxTokens: dynamicMaxTokens,
    maxSteps: 10,
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

async function updateVibeLibrariesDocs(files: any) {
  if (!loadedVibeStarter3dDocs) {
    logger.debug(`updateVibeLibrariesDocs: ${VIBE_STARTER_3D_PACKAGE_NAME}`);

    try {
      const docs = await getPackageMarkdownDocs(VIBE_STARTER_3D_PACKAGE_NAME, files);
      Object.keys(vibeStarter3dDocs).forEach((key) => delete vibeStarter3dDocs[key]);
      Object.assign(vibeStarter3dDocs, docs);
      loadedVibeStarter3dDocs = true;
    } catch {
      // Nothing.
    }
  }

  if (!loadedVibeStarter3dEnvironmentDocs) {
    try {
      logger.debug(`updateVibeLibrariesDocs: ${VIBE_STARTER_3D_ENVIRONMENT_PACKAGE_NAME}`);

      const docs = await getPackageMarkdownDocs(VIBE_STARTER_3D_ENVIRONMENT_PACKAGE_NAME, files);
      Object.keys(vibeStarter3dEnvironmentDocs).forEach((key) => delete vibeStarter3dEnvironmentDocs[key]);
      Object.assign(vibeStarter3dEnvironmentDocs, docs);
      loadedVibeStarter3dEnvironmentDocs = true;
    } catch {
      // Nothing.
    }
  }
}

async function getPackageMarkdownDocs(packageName: string, files: any): Promise<Record<string, string>> {
  const result: Record<string, string> = {};

  try {
    const version = await resolvePackageVersion(packageName, files);
    logger.debug(`getPackageMarkdownDocs ${packageName} version: ${version}`);

    const tgzUrl = `https://registry.npmjs.org/${packageName}/-/${packageName}-${version}.tgz`;

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'npm-docs-'));
    const tgzPath = path.join(tempDir, `${packageName}-${version}.tgz`);

    const response = await fetch(tgzUrl);

    if (!response.ok) {
      throw new Error(`Failed to download: ${response.statusText}`);
    }

    if (response.body) {
      await pipeline(response.body as any, createWriteStream(tgzPath));
    }

    await extract({
      file: tgzPath,
      cwd: tempDir,
      strip: 1,
    });

    const docsDir = path.join(tempDir, 'docs');

    const docsfiles = await fs.readdir(docsDir, { withFileTypes: true });

    for (const file of docsfiles) {
      if (file.isFile() && file.name.endsWith('.md')) {
        try {
          const fullPath = path.join(docsDir, file.name);
          const content = await fs.readFile(fullPath, 'utf-8');
          const fileName = path.parse(file.name).name;
          result[fileName] = content;
          logger.debug(`Loaded markdown file: ${file.name} as key: ${fileName}`);
        } catch (error) {
          logger.error(`Failed to read markdown file ${file.name}:`, error);
        }
      }
    }
    await fs.rm(tempDir, { recursive: true, force: true });

    return result;
  } catch {
    throw new Error(`No models found for provider`);
  }
}
