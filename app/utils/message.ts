import type { UIMessage } from 'ai';

export const extractTextContent = (message: UIMessage) => {
  try {
    if (message.parts && Array.isArray(message.parts)) {
      return message.parts
        .filter((part) => part.type === 'text')
        .map((part) => {
          if ('text' in part) {
            return part.text || '';
          }

          return '';
        })
        .join('');
    }

    return '';
  } catch (error) {
    console.error('getMessageText error:', error, message);
    return '';
  }
};
