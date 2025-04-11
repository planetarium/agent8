import type { Message } from 'ai';
import { stripMetadata } from '~/components/chat/UserMessage';
import { repoStore } from '~/lib/stores/repo';
import { workbenchStore } from '~/lib/stores/workbench';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('client.commitChanges');

export const commitChanges = async (message: Message) => {
  try {
    const { name: repositoryName } = repoStore.get();
    const content =
      message.parts && message.parts.length > 1
        ? message.parts
            .filter((part) => part.type === 'text')
            .map((part) => part.text)
            .join('')
        : message.content;

    const regex = /<boltAction[^>]*filePath="([^"]+)"[^>]*>/g;
    const matches = [...content.matchAll(regex)];
    const filePaths = matches.map((match) => match[1]);

    const files = filePaths.map((filePath) => ({
      path: filePath,
      content: (workbenchStore.files.get()[`/home/project/${filePath}`] as any).content,
    }));

    const promptAnnotation = message.annotations?.find((annotation: any) => annotation.type === 'prompt') as any;
    const userMessage = promptAnnotation?.prompt || 'Commit changes';

    const commitMessage = `${stripMetadata(userMessage)}
<V8UserMessage>
${userMessage}
</V8UserMessage>
<V8AssistantMessage>
${stripMetadata(content)}
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
