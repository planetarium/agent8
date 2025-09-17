import type { Message } from 'ai';
import { useCallback, useState } from 'react';
import { StreamingMessageParser } from '~/lib/runtime/message-parser';
import { workbenchStore } from '~/lib/stores/workbench';
import { createScopedLogger } from '~/utils/logger';
import { extractTextContent } from '~/utils/message';

const logger = createScopedLogger('useMessageParser');

const messageParser = new StreamingMessageParser({
  callbacks: {
    onActionOpen: (data) => {
      logger.trace('onActionOpen', data.action);

      // Show workbench when action is detected
      workbenchStore.showWorkbench.set(true);

      // Add action to workbench (shell actions are added on close)
      if (data.action.type !== 'shell') {
        workbenchStore.addAction(data);
      }
    },
    onActionClose: async (data) => {
      logger.trace('onActionClose', data.action);

      // Add shell actions when close tag is parsed (content is complete)
      if (data.action.type === 'shell') {
        workbenchStore.addAction(data);
      }

      // Run the action
      workbenchStore.runAction(data);
    },
    onActionStream: (data) => {
      logger.trace('onActionStream', data.action);

      //workbenchStore.runAction(data, true);
    },
  },
});

export function useMessageParser() {
  const [parsedMessages, setParsedMessages] = useState<{ [key: number]: string }>({});

  const parseMessages = useCallback((messages: Message[]) => {
    messageParser.reset();

    for (const [index, message] of messages.entries()) {
      if (message.role === 'assistant' || message.role === 'user') {
        const newParsedContent = messageParser.parse(message.id, extractTextContent(message));
        setParsedMessages((prev) => ({ ...prev, [index]: newParsedContent }));
      }
    }
  }, []);

  return { parsedMessages, parseMessages };
}
