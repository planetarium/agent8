import type { UIMessage } from 'ai';
import { useCallback, useState } from 'react';
import { StreamingMessageParser } from '~/lib/runtime/message-parser';
import { workbenchStore } from '~/lib/stores/workbench';
import { createScopedLogger } from '~/utils/logger';
import { extractTextContent } from '~/utils/message';
import { logManager } from '~/lib/debug/LogManager';

const logger = createScopedLogger('useMessageParser');

const messageParser = new StreamingMessageParser({
  callbacks: {
    onArtifactOpen: (data) => {
      logger.trace('onArtifactOpen', data);

      workbenchStore.showWorkbench.set(true);
      workbenchStore.addArtifact(data);
    },
    onArtifactClose: (data) => {
      logManager.add('useMessageParser-20');
      logger.trace('onArtifactClose');

      workbenchStore.closeArtifact(data);
    },
    onActionOpen: (data) => {
      logManager.add('useMessageParser-26');
      logger.trace('onActionOpen', data.action);

      // we only add shell actions when when the close tag got parsed because only then we have the content
      if (data.action.type !== 'shell') {
        workbenchStore.addAction(data);
      }
    },
    onActionClose: async (data) => {
      logManager.add('useMessageParser-35');
      logger.trace('onActionClose', data.action);

      if (data.action.type === 'shell') {
        workbenchStore.addAction(data);
      }

      workbenchStore.runAction(data);
    },
    onActionStream: (data) => {
      logger.trace('onActionStream', data.action);

      // workbenchStore.runAction(data, true);
    },
  },
});

export function useMessageParser() {
  const [parsedMessages, setParsedMessages] = useState<{ [key: number]: string }>({});

  const parseMessages = useCallback((messages: UIMessage[]) => {
    logManager.add('useMessageParser-51');
    messageParser.reset();

    for (const [index, message] of messages.entries()) {
      if (message.role === 'assistant' || message.role === 'user') {
        logManager.add('useMessageParser-61');

        const newParsedContent = messageParser.parse(message.id, extractTextContent(message));
        setParsedMessages((prev) => ({ ...prev, [index]: newParsedContent }));
      }
    }
  }, []);

  return { parsedMessages, parseMessages };
}
