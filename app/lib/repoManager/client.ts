import type { Message } from 'ai';
import { stripMetadata } from '~/components/chat/UserMessage';
import { workbenchStore } from '~/lib/stores/workbench';
import { repoStore } from '~/lib/stores/repo';
import { createScopedLogger } from '~/utils/logger';
import { WORK_DIR } from '~/utils/constants';

const logger = createScopedLogger('client.commitChanges');

export const commitChanges = async (message: Message) => {
  try {
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

    const result = (await response.json()) as any;

    if (result.success) {
      logger.info('Changes committed successfully:', result.data);
    } else {
      logger.error('Failed to commit changes:', result.error);
    }

    return result;
  } catch (error) {
    logger.error('Error committing changes:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
};
