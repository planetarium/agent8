import ignore from 'ignore';
import { z } from 'zod';
import type { Template } from '~/types/template';
import { STARTER_TEMPLATES } from './constants';
import Cookies from 'js-cookie';
import { extractZipTemplate } from './zipUtils';
import type { FileMap } from '~/lib/stores/files';
import { TEMPLATE_BASIC, TEMPLATE_MAP } from '~/constants/template';
import { fetchWithCache, type FetchWithCacheOptions } from '~/lib/utils';

// Zod schema for template selection response
export const TEMPLATE_SELECTION_SCHEMA = z.object({
  templateName: z.string(),
  title: z.string().default('Untitled Project'),
  projectRepo: z.string().default(''),
  nextActionSuggestion: z.string().default(''),
});

type TemplateSelection = z.infer<typeof TEMPLATE_SELECTION_SCHEMA>;

const starterTemplateSelectionPrompt = (templates: Template[]) => `
You are an experienced developer who helps people choose the best starter template for their projects.

Available templates:
${templates
  .map(
    (template) => `
<template>
  <name>${template.name}</name>
  <label>${template.label}</label>
  <description>${template.description}</description>
  ${template.tags ? `<tags>${template.tags.join(', ')}</tags>` : ''}
</template>
`,
  )
  .join('\n')}

Instructions:
1. For trivial tasks and simple scripts, always recommend the basic-vite-react template
2. For more complex projects, recommend templates from the provided list
3. Consider both technical requirements and tags
4. If no perfect match exists, recommend the closest option

nextActionSuggestion guidelines:
1. It's unacceptable for a project build to fail due to simple changes or code modifications. Please request the simplest next task.
2. The requested task should not cause the program build to fail once the unit task is completed.
3. To handle the first requested task, it is appropriate to have work at the level of modifying about one file.
4. Think of it as a work unit when developing rather than an implementation unit in the game.

Examples of good nextActionSuggestion:
- GOOD: Changing the texture of the map specifically
- GOOD: Placing trees on the map
- BAD: Setting the surrounding environment of the 3d map (This can involve many tasks.)

Selection examples:

User: I need to build a 2d platformer game
Expected response:
{
  "templateName": "basic-2d",
  "title": "Simple 2d platformer game",
  "projectRepo": "basic-2d-game",
  "nextActionSuggestion": "Please change background image."
}

User: Make a simple 3d rpg game
Expected response:
{
  "templateName": "basic-3d-quarterview",
  "title": "Simple 3d rpg game",
  "projectRepo": "basic-3d-rpg-game",
  "nextActionSuggestion": "Add a floor texture and skybox."
}

Return your selection as a JSON object with these exact fields:
- templateName: the selected template name (string)
- title: a proper title for the project (string)
- projectRepo: the name of the new project repository (string)
- nextActionSuggestion: suggestions for the next action (string, empty if none)

Important: Return ONLY the JSON object, no additional text or explanation.
MOST IMPORTANT: YOU DONT HAVE TIME TO THINK JUST START RESPONDING BASED ON HUNCH
`;

let templates: Template[] = STARTER_TEMPLATES;

export const selectStarterTemplate = async (options: { message: string }) => {
  try {
    const branch = import.meta.env.VITE_USE_PRODUCTION_TEMPLATE === 'true' ? 'production' : 'main';
    const response = await fetch(
      `https://raw.githubusercontent.com/planetarium/agent8-templates/${branch}/templates.json`,
    );
    templates = await response.json();
  } catch {
    console.log('Failed to fetch templates, using local fallback');
    templates = STARTER_TEMPLATES;
  }

  const { message } = options;
  const requestBody = {
    message,
    system: starterTemplateSelectionPrompt(templates),
  };

  const response = await fetch('/api/startcall', {
    method: 'POST',
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    let errorMessage = await response.text();

    // 에러 메시지가 비어있는 경우 상태 코드에 따른 기본 메시지 제공
    if (!errorMessage.trim()) {
      switch (response.status) {
        case 401:
          errorMessage = 'Authentication failed. Please check your API key.';
          break;
        case 429:
          errorMessage = 'Rate limit exceeded. Please try again later.';
          break;
        case 500:
          errorMessage = 'Server error occurred. Please try again.';
          break;
        default:
          errorMessage = `Request failed with status ${response.status}`;
      }
    }

    throw new Error(errorMessage);
  }

  // generateObject returns the structured object directly
  const selectedTemplate = (await response.json()) as TemplateSelection;

  if (!selectedTemplate.templateName) {
    console.log('No template selected, using blank template');
    return {};
  }

  const template: Template | undefined = templates.find((t) => t.name == selectedTemplate.templateName);

  if (template) {
    return {
      template,
      title: selectedTemplate.title,
      projectRepo: selectedTemplate.projectRepo,
      nextActionSuggestion: selectedTemplate.nextActionSuggestion,
    };
  }

  return {};
};

const getGitHubRepoContent = async (repoName: string, path: string = '', env?: Env): Promise<FileMap> => {
  const baseUrl = 'https://api.github.com';
  const cacheOptions: FetchWithCacheOptions = { onlyUrl: true, forcePublic: true, ignoreVary: true };

  try {
    const token = Cookies.get('githubToken') || import.meta.env.VITE_GITHUB_ACCESS_TOKEN || env?.GITHUB_TOKEN;
    const headers: HeadersInit = {
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'agent8',
    };

    // Add your GitHub token if needed
    if (token) {
      headers.Authorization = 'token ' + token;
    }

    const ref = env?.VITE_USE_PRODUCTION_TEMPLATE === 'true' ? 'production' : 'main';

    const url = `${baseUrl}/repos/${repoName}/contents/${path}?ref=${ref}`;
    const request = new Request(url, { headers });
    const response = await fetchWithCache(request, cacheOptions);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data: any = await response.json();

    const fileMap: FileMap = {};

    // If it's a single file, return its content
    if (!Array.isArray(data)) {
      if (data.type === 'file') {
        /*
         * If it's a file, get its content
         * Use TextDecoder to properly handle Korean and other non-ASCII characters
         */
        const content = new TextDecoder('utf-8').decode(Uint8Array.from(atob(data.content), (c) => c.charCodeAt(0)));
        const filePath = `${data.path}`;
        fileMap[filePath] = {
          type: 'file',
          content,
          isBinary: false,
        };

        return fileMap;
      }
    }

    // Process directory contents recursively
    await Promise.all(
      data.map(async (item: any) => {
        if (item.type === 'dir') {
          // Recursively get contents of subdirectories
          const subDirContents = await getGitHubRepoContent(repoName, item.path, env);

          // Merge subdirectory contents into the main fileMap
          Object.assign(fileMap, subDirContents);
        } else if (item.type === 'file') {
          // Fetch file content (construct URL with ref if provided)
          const fileUrl = `${baseUrl}/repos/${repoName}/contents/${item.path}?ref=${ref}`;
          const request = new Request(fileUrl, { headers });
          const fileResponse = await fetchWithCache(request, cacheOptions);
          const fileData: any = await fileResponse.json();

          // TextDecoder를 사용하여 UTF-8로 올바르게 디코딩
          const content = new TextDecoder('utf-8').decode(
            Uint8Array.from(atob(fileData.content), (c) => c.charCodeAt(0)),
          );

          const filePath = `${item.path}`;
          fileMap[filePath] = {
            type: 'file',
            content,
            isBinary: false,
          };
        }
      }),
    );

    return fileMap;
  } catch (error) {
    console.error('Error fetching repo contents:', error);
    throw error;
  }
};

async function getTemplateFileMap(githubRepo: string, path: string, env?: Env): Promise<FileMap | undefined> {
  try {
    const files = await getGitHubRepoContent(githubRepo, path, env);

    const fileMap: FileMap = {};

    if (path) {
      for (const key in files) {
        fileMap[key.replace(path + '/', '')] = files[key];
      }
    }

    return fileMap;
  } catch (error) {
    console.log('[Template] GitHub fetch failed, using fallback:', path, error);

    return TEMPLATE_MAP[path];
  }
}

export async function getTemplates(githubRepo: string, path: string, title?: string, env?: Env) {
  let isFallback = false;
  let fileMap = await getTemplateFileMap(githubRepo, path, env);

  if (!fileMap) {
    fileMap = TEMPLATE_BASIC;
    isFallback = true;
  }

  const messages = generateTemplateMessages(fileMap, title);

  return { fileMap, messages, isFallback };
}

export async function getZipTemplates(zipFile: File, title?: string) {
  const fileMap = await extractZipTemplate(await zipFile.arrayBuffer());
  return { fileMap, messages: generateTemplateMessages(fileMap, title) };
}

function generateTemplateMessages(fileMap: FileMap, title?: string) {
  const files = [];

  for (const key in fileMap) {
    if (fileMap[key]!.type === 'file') {
      files.push({
        name: key,
        path: key,
        content: fileMap[key]!.content,
      });
    }
  }

  let filteredFiles = files;

  /*
   * ignoring common unwanted files
   * exclude    .git
   */
  filteredFiles = filteredFiles.filter((x) => x.path.startsWith('.git') == false);

  // exclude    lock files
  const comminLockFiles = ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml'];
  filteredFiles = filteredFiles.filter((x) => comminLockFiles.includes(x.name) == false);

  // exclude    .bolt
  filteredFiles = filteredFiles.filter((x) => x.path.startsWith('.bolt') == false);

  // check for ignore file in .bolt folder
  const templateIgnoreFile = files.find((x) => x.path.startsWith('.bolt') && x.name == 'ignore');

  const filesToImport = {
    files: filteredFiles,
    ignoreFile: [] as typeof filteredFiles,
  };

  if (templateIgnoreFile) {
    // redacting files specified in ignore file
    const ignorepatterns = templateIgnoreFile.content.split('\n').map((x) => x.trim());
    const ig = ignore().add(ignorepatterns);

    // filteredFiles = filteredFiles.filter(x => !ig.ignores(x.path))
    const ignoredFiles = filteredFiles.filter((x) => ig.ignores(x.path));

    filesToImport.files = filteredFiles;
    filesToImport.ignoreFile = ignoredFiles;
  }

  const assistantMessage = `
<boltArtifact id="imported-files" title="${title || 'Importing Starter Files'}" type="bundled">
${filesToImport.files
  .map(
    (file) =>
      `<boltAction type="file" filePath="${file.path}">
${file.content}
</boltAction>`,
  )
  .join('\n')}
</boltArtifact>
`;
  let userMessage = ``;
  const templatePromptFile = files.filter((x) => x.path.startsWith('.bolt')).find((x) => x.name == 'prompt');

  if (templatePromptFile) {
    userMessage = `
TEMPLATE INSTRUCTIONS:
${templatePromptFile.content}

IMPORTANT: Dont Forget to install the dependencies before running the app
---
`;
  }

  if (filesToImport.ignoreFile.length > 0) {
    userMessage =
      userMessage +
      `
STRICT FILE ACCESS RULES - READ CAREFULLY:

The following files are READ-ONLY and must never be modified:
${filesToImport.ignoreFile.map((file) => `- ${file.path}`).join('\n')}

Permitted actions:
✓ Import these files as dependencies
✓ Read from these files
✓ Reference these files

Strictly forbidden actions:
❌ Modify any content within these files
❌ Delete these files
❌ Rename these files
❌ Move these files
❌ Create new versions of these files
❌ Suggest changes to these files

Any attempt to modify these protected files will result in immediate termination of the operation.

If you need to make changes to functionality, create new files instead of modifying the protected ones listed above.
---
`;
  }

  userMessage += `
---
template import is done, and you can now use the imported files,
edit only the files that need to be changed, and you can create new files as needed.
NO NOT EDIT/WRITE ANY FILES THAT ALREADY EXIST IN THE PROJECT AND DOES NOT NEED TO BE MODIFIED
---
Now that the Template is imported please continue with my original request
`;

  return {
    assistantMessage,
    userMessage,
  };
}
