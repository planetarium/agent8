import type { Message } from 'ai';
import axios from 'axios';
import { stripMetadata } from '~/components/chat/UserMessage';
import { workbenchStore } from '~/lib/stores/workbench';
import { repoStore } from '~/lib/stores/repo';
import { WORK_DIR } from '~/utils/constants';
import { isCommitHash, unzipCode } from './utils';
import type { FileMap } from '~/lib/stores/files';

export const commitChanges = async (message: Message) => {
  const projectName = repoStore.get().name;
  const projectPath = repoStore.get().path;
  const title = repoStore.get().title;
  const isFirstCommit = !projectPath;

  // Get revertTo from URL query parameters
  const url = new URL(window.location.href);
  const revertToParam = url.searchParams.get('revertTo');
  const revertTo = revertToParam && isCommitHash(revertToParam) ? revertToParam : null;

  let files = [];
  const content =
    message.parts && message.parts.length > 1
      ? message.parts
          .filter((part) => part.type === 'text')
          .map((part) => part.text)
          .join('')
      : message.content;

  if (isFirstCommit) {
    // If repositoryName is not set, commit all files
    files = Object.entries(workbenchStore.files.get())
      .filter(([_, file]) => file && (file as any).content)
      .map(([path, file]) => ({
        path: path.replace(WORK_DIR + '/', ''),
        content: (file as any).content,
      }));
  } else {
    // If not, commit the files in the message
    const regex = /<boltAction[^>]*filePath="([^"]+)"[^>]*>/g;
    const matches = [...content.matchAll(regex)];
    const filePaths = matches.map((match) => match[1]);

    files = filePaths.map((filePath) => ({
      path: filePath,
      content: (workbenchStore.files.get()[`${WORK_DIR}/${filePath}`] as any).content,
    }));
  }

  const promptAnnotation = message.annotations?.find((annotation: any) => annotation.type === 'prompt') as any;
  const userMessage = promptAnnotation?.prompt || 'Commit changes';

  const commitMessage = `${stripMetadata(userMessage)}
<V8UserMessage>
${userMessage}
</V8UserMessage>
<V8AssistantMessage>
${content.replace(/(<boltAction[^>]*filePath[^>]*>)(.*?)(<\/boltAction>)/gs, '$1$3')}
</V8AssistantMessage>`;

  // API 호출하여 변경사항 커밋
  const response = await axios.post('/api/gitlab/commits', {
    projectName,
    isFirstCommit,
    description: title,
    files,
    commitMessage,
    baseCommit: revertTo,
  });

  if (revertTo) {
    window.history.replaceState({}, '', location.pathname);
  }

  return response.data;
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

export const getProjects = async () => {
  const response = await axios.get('/api/gitlab/projects');

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

export const forkProject = async (projectPath: string, projectName: string, commitSha: string, description: string) => {
  const response = await axios.post('/api/gitlab/fork', {
    projectPath,
    projectName,
    commitSha,
    description,
  });

  return response.data;
};
