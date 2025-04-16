import type { Message } from 'ai';
import { useCallback, useState } from 'react';
import { StreamingMessageParser } from '~/lib/runtime/message-parser';
import { workbenchStore } from '~/lib/stores/workbench';
import { createScopedLogger } from '~/utils/logger';
import { extractTextContent } from '~/utils/message';

const logger = createScopedLogger('useMessageParser');

const messageParser = new StreamingMessageParser({
  callbacks: {
    onArtifactOpen: (data) => {
      logger.trace('onArtifactOpen', data);

      workbenchStore.showWorkbench.set(true);
      workbenchStore.addArtifact(data);
    },
    onArtifactClose: (data) => {
      logger.trace('onArtifactClose');

      workbenchStore.updateArtifact(data, { closed: true });
    },
    onActionOpen: (data) => {
      logger.trace('onActionOpen', data.action);

      // we only add shell actions when when the close tag got parsed because only then we have the content
      if (data.action.type === 'file') {
        workbenchStore.addAction(data);
      }
    },
    onActionClose: (data) => {
      logger.trace('onActionClose', data.action);

      if (data.action.type !== 'file') {
        workbenchStore.addAction(data);
      }

      workbenchStore.runAction(data);
    },
    onActionStream: (data) => {
      logger.trace('onActionStream', data.action);
      workbenchStore.runAction(data, true);
    },
  },
});

export function useMessageParser() {
  const [parsedMessages, setParsedMessages] = useState<{ [key: number]: string }>({});

  const resetParsedMessagesFrom = useCallback((fromIndex: number) => {
    setParsedMessages((prevParsed: { [key: number]: string }) => {
      const newParsedMessages = { ...prevParsed };

      Object.keys(prevParsed).forEach((key: string) => {
        if (Number(key) >= fromIndex) {
          delete newParsedMessages[Number(key)];
        }
      });

      return newParsedMessages;
    });
  }, []);

  const parseMessages = useCallback((messages: Message[], isLoading: boolean) => {
    let reset = false;

    if (import.meta.env.DEV && !isLoading) {
      reset = true;
      messageParser.reset();
    }

    for (const [index, message] of messages.entries()) {
      if (message.role === 'assistant' || message.role === 'user') {
        const newParsedContent = messageParser.parse(message.id, extractTextContent(message));

        /**
         * KNOWN ISSUE: When a new part is added to a message, the message ID can change
         * (see: https://github.com/vercel/ai/issues/5318)
         *
         * This causes messageParser.parse() to produce duplicate content. The logic below
         * handles this by checking for overlapping content between the existing parsed content
         * and the new content being added. This is a workaround until the underlying issue
         * with message IDs changing is fixed in the AI library.
         */
        const updateParsedMessages = function (prevParsed: { [key: number]: string }) {
          const updatedMessages = { ...prevParsed };
          const existingContent = prevParsed[index] || '';

          if (!reset) {
            let finalContent = existingContent + newParsedContent;

            if (existingContent.length > 0 && newParsedContent.length > 0) {
              const maxCheckLength = Math.min(existingContent.length, newParsedContent.length);

              for (let i = 1; i <= maxCheckLength; i++) {
                const tailOfExisting = existingContent.slice(-i);
                const headOfNew = newParsedContent.slice(0, i);

                if (tailOfExisting === headOfNew) {
                  finalContent = existingContent + newParsedContent.slice(i);
                }
              }
            }

            updatedMessages[index] = finalContent;
          } else {
            updatedMessages[index] = newParsedContent;
          }

          return updatedMessages;
        };

        setParsedMessages(updateParsedMessages);
      }
    }
  }, []);

  return { parsedMessages, parseMessages, resetParsedMessagesFrom };
}
