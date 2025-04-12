import type { Message } from 'ai';
import { stripMetadata } from '~/components/chat/UserMessage';
import { workbenchStore } from '~/lib/stores/workbench';
import { repoStore } from '~/lib/stores/repo';
import { WORK_DIR } from '~/utils/constants';
import { V8_ACCESS_TOKEN_KEY } from '~/lib/verse8/userAuth';

export const commitChanges = async (message: Message) => {
  const repositoryName = repoStore.get().name;

  let files = [];
  const content =
    message.parts && message.parts.length > 1
      ? message.parts
          .filter((part) => part.type === 'text')
          .map((part) => part.text)
          .join('')
      : message.content;

  if (!repositoryName) {
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
${content.replace(/(<boltAction[^>]*>)(.*?)(<\/boltAction>)/gs, '$1$3')}
</V8AssistantMessage>`;

  // API 호출하여 변경사항 커밋
  const response = await fetch('/api/commit-changes', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      files,
      repositoryName,
      commitMessage,
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to commit changes: ${response.status} ${response.statusText}`);
  }

  return await response.json();
};

export const downloadProjectZip = async (projectPath: string) => {
  const response = await fetch(
    `${import.meta.env.VITE_GITBASE_PERSISTENCE_URL}/git/download?projectPath=${encodeURIComponent(projectPath)}`,
    {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${localStorage.getItem(V8_ACCESS_TOKEN_KEY)}`,
      },
    },
  );

  if (!response.ok) {
    throw new Error(`Failed to download project zip: ${response.status} ${response.statusText}`);
  }

  return response.blob();
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

  const response = await fetch(`${import.meta.env.VITE_GITBASE_PERSISTENCE_URL}/git/commits?${queryParams}`, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${localStorage.getItem(V8_ACCESS_TOKEN_KEY)}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch commits: ${response.status} ${response.statusText}`);
  }

  return await response.json();
};

export const getProjects = async () => {
  const response = await fetch(`${import.meta.env.VITE_GITBASE_PERSISTENCE_URL}/git/projects`, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${localStorage.getItem(V8_ACCESS_TOKEN_KEY)}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch projects: ${response.status} ${response.statusText}`);
  }

  return await response.json();
};

export const deleteProject = async (projectId: string) => {
  const response = await fetch(`${import.meta.env.VITE_GITBASE_PERSISTENCE_URL}/git/projects/${projectId}`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${localStorage.getItem(V8_ACCESS_TOKEN_KEY)}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch projects: ${response.status} ${response.statusText}`);
  }

  return await response.json();
};

export const updateProjectDescription = async (projectPath: string, description: string) => {
  const response = await fetch(`${import.meta.env.VITE_GITBASE_PERSISTENCE_URL}/git/description`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${localStorage.getItem(V8_ACCESS_TOKEN_KEY)}`,
    },
    body: JSON.stringify({
      projectPath,
      description,
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch projects: ${response.status} ${response.statusText}`);
  }

  return await response.json();
};
