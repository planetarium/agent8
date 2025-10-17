import type { UIMessage } from 'ai';
import axios from 'axios';
import { stripMetadata } from '~/components/chat/UserMessage';
import { workbenchStore } from '~/lib/stores/workbench';
import { DEFAULT_TASK_BRANCH, repoStore } from '~/lib/stores/repo';
import { WORK_DIR } from '~/utils/constants';
import { isCommitHash, unzipCode } from './utils';
import type { FileMap } from '~/lib/stores/files';
import { filesToArtifactsNoContent } from '~/utils/fileUtils';
import { extractAllTextContent } from '~/utils/message';
import { changeChatUrl } from '~/utils/url';
import { SETTINGS_KEYS } from '~/lib/stores/settings';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('persistenceGitbase');
const MAX_ASSISTANT_MESSAGE_SIZE = 20 * 1024; // 20KB for assistant message content

const truncateMessage = (message: string, maxSize: number): string => {
  if (message.length <= maxSize) {
    return message;
  }

  const truncated = message.substring(0, maxSize - 20) + '\n...(truncated)';
  logger.warn(`Assistant message truncated from ${message.length} to ${truncated.length} bytes (max: ${maxSize})`);

  return truncated;
};

export const isEnabledGitbasePersistence =
  import.meta.env.VITE_GITLAB_PERSISTENCE_ENABLED === 'true' &&
  localStorage.getItem(SETTINGS_KEYS.TEMPORARY_MODE) !== 'true';

export const getCommit = async (projectPath: string, commitHash: string) => {
  const response = await axios.get(`/api/gitlab/commits/${commitHash}`, {
    params: {
      projectPath,
    },
  });

  return response.data;
};

export const commitChanges = async (message: UIMessage, callback?: (commitHash: string) => void) => {
  const projectName = repoStore.get().name;
  const projectPath = repoStore.get().path;
  const taskBranch = repoStore.get().taskBranch || 'develop';
  const title = repoStore.get().title;
  const isFirstCommit = !projectPath;

  logger.info(`Starting commit process - Project: ${projectName}, Path: ${projectPath}, Branch: ${taskBranch}`);

  // Get revertTo from URL query parameters
  const url = new URL(window.location.href);
  const revertToParam = url.searchParams.get('revertTo');
  const revertTo = revertToParam && isCommitHash(revertToParam) ? revertToParam : null;

  let files = [];
  const content = extractAllTextContent(message);

  if (isFirstCommit) {
    // If repositoryName is not set, commit all files
    files = Object.entries(workbenchStore.files.get())
      .filter(([_, file]) => file && (file as any).content)
      .reduce(
        (acc, [path, file]) => {
          const normalizedPath = path.replace(WORK_DIR + '/', '');

          // Only add if path doesn't already exist
          if (!acc.some((f) => f.path === normalizedPath)) {
            acc.push({
              path: normalizedPath,
              content: (file as any).content,
            });
          }

          return acc;
        },
        [] as Array<{ path: string; content: string }>,
      );
  } else {
    // If not, commit the files in the message
    const regex = /<boltAction[^>]*filePath="([^"]+)"[^>]*>([\s\S]*?)<\/bolt/g; // Sometimes, file tags do not close.

    const matches = [...content.matchAll(regex)];
    const container = await workbenchStore.container;

    // Use Map to store unique files
    const fileMap = new Map<string, string>();

    // Add default files first
    const envFile = await container.fs.readFile(`.env`, 'utf-8');

    if (envFile) {
      fileMap.set('.env', envFile);
    }

    const packageJsonFile = await container.fs.readFile(`package.json`, 'utf-8');

    if (packageJsonFile) {
      fileMap.set('package.json', packageJsonFile);
    }

    // Add files from matches (skip if already in fileMap)
    for (const match of matches) {
      const filePath = match[1];

      // Only read and add if not already in fileMap
      if (!fileMap.has(filePath)) {
        const remoteContainerFile = await container.fs.readFile(filePath, 'utf-8');
        fileMap.set(filePath, remoteContainerFile);
      }
    }

    files = Array.from(fileMap.entries()).map(([path, content]) => ({ path, content }));

    if (files.length === 0) {
      // If no files are found, create a temporary file
      files = [{ path: 'commitedAt', content: Date.now().toString() }];
    }
  }

  // Parse shell rm commands for file deletion
  const deletedFilesSet = new Set<string>();
  const shellRmRegex = /<boltAction[^>]*type="shell"[^>]*>([\s\S]*?)<\/boltAction>/g;
  const rmMatches = [...content.matchAll(shellRmRegex)];

  for (const match of rmMatches) {
    const shellContent = match[1].trim();

    // Only process "rm filename" pattern (single file, no flags)
    const rmMatch = /^rm\s+([^\s]+)$/.exec(shellContent);

    if (rmMatch) {
      const filePath = rmMatch[1];

      // Safety checks: ignore wildcards, directories, and paths with flags
      if (!filePath.includes('*') && !filePath.endsWith('/') && !shellContent.includes('-')) {
        // Add only if not already in the set (avoid duplicates)
        if (!deletedFilesSet.has(filePath)) {
          deletedFilesSet.add(filePath);
          logger.info(`Detected file deletion: ${filePath}`);
        }
      }
    }
  }

  const deletedFiles = Array.from(deletedFilesSet);

  const prompt = (message as any).parts?.find((part: any) => part.type === 'data-prompt')?.data?.prompt || null;
  const userMessage = prompt || 'Commit changes';
  const commitMessage = `${stripMetadata(userMessage)}
<V8Metadata>${JSON.stringify({ taskBranch })}</V8Metadata>
<V8UserMessage>
${userMessage}
</V8UserMessage>
<V8AssistantMessage>
${truncateMessage(
  content
    .replace(/(<toolResult><div[^>]*?>)(.*?)(<\/div><\/toolResult>)/gs, '$1`{"result":"(truncated)"}`$3')
    .replace(/(<boltAction type="file"[^>]*>)([\s\S]*?)(<\/boltAction>)/gs, '$1(truncated)$3')
    .replace(/(<boltAction type="modify"[^>]*>)([\s\S]*?)(<\/boltAction>)/gs, '$1(truncated)$3'),
  MAX_ASSISTANT_MESSAGE_SIZE,
)}
</V8AssistantMessage>`;

  // API 호출하여 변경사항 커밋
  const response = await axios.post('/api/gitlab/commits', {
    projectName,
    isFirstCommit,
    description: title,
    files,
    deletedFiles,
    commitMessage,
    baseCommit: revertTo,
    branch: taskBranch,
  });

  const result = response.data;

  if (!result.data.commitHash) {
    throw new Error('The code commit has failed.');
  }

  if (isFirstCommit) {
    repoStore.set({
      name: result.data.project.name,
      path: result.data.project.path,
      title: result.data.project.description.split('\n')[0] || result.data.project.name,
      taskBranch,
    });
    changeChatUrl(result.data.project.path, { replace: true, ignoreChangeEvent: true });
  }

  if (revertTo) {
    changeChatUrl(result.data.project.path, { replace: true, ignoreChangeEvent: true });
  }

  callback?.(result.data.commitHash);

  return result;
};

export const commitUserChanged = async () => {
  const modifiedFiles = workbenchStore.getModifiedFiles();
  const projectName = repoStore.get().name;
  const title = repoStore.get().title;
  const taskBranch = repoStore.get().taskBranch || 'develop';

  const url = new URL(window.location.href);
  const revertToParam = url.searchParams.get('revertTo');
  const revertTo = revertToParam && isCommitHash(revertToParam) ? revertToParam : null;

  if (!modifiedFiles || Object.keys(modifiedFiles).length === 0) {
    return {};
  }

  const files = Object.entries(modifiedFiles)
    .filter(([_, file]) => file && (file as any).content)
    .map(([path, file]) => ({
      path: path.replace(WORK_DIR + '/', ''),
      content: (file as any).content,
    }));

  const response = await axios.post('/api/gitlab/commits', {
    projectName,
    isFirstCommit: false,
    description: title,
    files,
    commitMessage: `The user changed the files.\n${filesToArtifactsNoContent(files, `${Date.now()}`)}`,
    baseCommit: revertTo,
    branch: taskBranch,
  });

  const result = response.data;

  if (!result.data.commitHash) {
    throw new Error('The user changed files commit has failed.');
  }

  if (revertTo) {
    changeChatUrl(location.pathname, { replace: true, searchParams: { revertTo: result.data.commitHash } });
  }

  return result;
};

export const downloadProjectZip = async (projectPath: string, commitSha?: string) => {
  const response = await axios.get(`/api/gitlab/download`, {
    params: {
      projectPath,
      commitSha,
    },
    responseType: 'blob',
  });

  return response.data;
};

export const fetchProjectFiles = async (projectPath: string, commitSha?: string): Promise<FileMap> => {
  const zipBlob = await downloadProjectZip(projectPath, commitSha);
  return unzipCode(zipBlob);
};

export const getProjectCommits = async (
  projectPath: string,
  options: { branch?: string; untilCommit?: string; page?: number } = {},
) => {
  const queryParams = new URLSearchParams({
    projectPath,
  });

  if (options.branch) {
    queryParams.append('branch', options.branch);
  }

  if (options.untilCommit) {
    queryParams.append('untilCommit', options.untilCommit);
  }

  if (options.page) {
    queryParams.append('page', options.page.toString());
  }

  const response = await axios.get(`/api/gitlab/commits`, {
    params: Object.fromEntries(queryParams),
  });

  return response.data;
};

export const getTags = async (projectPath: string) => {
  const response = await axios.get(`/api/gitlab/tags`, {
    params: { projectPath },
  });

  return response.data;
};

export const getLastCommitHash = async (projectPath: string, branch?: string): Promise<string> => {
  const {
    data: { commits },
  } = await getProjectCommits(projectPath, { branch, page: 1 });

  if (!commits || commits.length === 0) {
    throw new Error('No commits found in the specified branch');
  }

  return commits[0].id;
};

export const getProjects = async () => {
  const response = await axios.get('/api/gitlab/projects');

  return response.data;
};

export const getPublicProject = async (projectPath: string) => {
  const response = await axios.get('/api/gitlab/public-project', {
    params: { projectPath },
  });

  return response.data;
};

export const deleteProject = async (projectId: string) => {
  const response = await axios.delete(`/api/gitlab/projects`, {
    params: {
      projectId,
    },
  });

  return response.data;
};

export const updateProjectDescription = async (projectPath: string, description: string) => {
  const response = await axios.post('/api/gitlab/description', {
    projectPath,
    description,
  });

  return response.data;
};

export const forkProject = async (
  projectPath: string,
  projectName: string,
  commitSha: string | undefined,
  description: string,
  metadata?: {
    resetEnv?: boolean;
    fromVerseId?: string;
  },
) => {
  const response = await axios.post('/api/gitlab/fork', {
    projectPath,
    projectName,
    commitSha,
    description,
    metadata,
  });

  return response.data;
};

export const getCommitDiff = async (projectPath: string, commitHash: string) => {
  const response = await axios.get(`/api/gitlab/diff`, {
    params: {
      projectPath,
      commitHash,
    },
  });

  return response.data;
};

export const getTaskBranches = async (projectPath: string) => {
  const response = await axios.get('/api/gitlab/task-branches', {
    params: {
      projectPath,
    },
  });

  return response.data;
};

export const createTaskBranch = async (projectPath: string) => {
  const url = new URL(window.location.href);
  const revertToParam = url.searchParams.get('revertTo');
  const revertTo = revertToParam && isCommitHash(revertToParam) ? revertToParam : null;

  const response = await axios.post('/api/gitlab/task-branches', {
    projectPath,
    action: 'create',
    baseRef: revertTo || 'develop',
  });

  return response.data;
};

export const mergeTaskBranch = async (projectPath: string, fromBranch: string) => {
  const response = await axios.post('/api/gitlab/task-branches', {
    projectPath,
    action: 'merge',
    from: fromBranch,
    to: DEFAULT_TASK_BRANCH,
  });

  return response.data;
};

export const removeTaskBranch = async (projectPath: string, branchName: string) => {
  const response = await axios.post('/api/gitlab/task-branches', {
    projectPath,
    action: 'remove',
    from: branchName,
  });

  return response.data;
};

export const revertBranch = async (projectPath: string, branchName: string, commitHash: string) => {
  const response = await axios.post('/api/gitlab/revert-branch', {
    projectPath,
    branchName,
    commitHash,
  });

  return response.data;
};

export const createProjectAccessToken = async (projectPath: string) => {
  const response = await axios.post('/api/gitlab/project-access-token', {
    projectPath,
  });

  return response.data;
};

export const getProjectAccessTokenStatus = async (projectPath: string) => {
  const response = await axios.get('/api/gitlab/project-access-token', {
    params: { projectPath },
  });

  return response.data;
};

export const revokeAllProjectAccessTokens = async (projectPath: string) => {
  const response = await axios.delete('/api/gitlab/project-access-token', {
    data: { projectPath },
  });

  return response.data;
};

export const revokeProjectAccessToken = async (projectPath: string, tokenId: number) => {
  const response = await axios.delete('/api/gitlab/project-access-token', {
    data: { projectPath, tokenId },
  });

  return response.data;
};
