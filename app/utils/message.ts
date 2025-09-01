import type { UIMessage } from 'ai';

export const extractTextContent = (message: UIMessage) => {
  if (message.parts && message.parts.length > 0) {
    return message.parts
      .filter((part) => part.type === 'text')
      .map((part) => part.text || '')
      .join('');
  }

  return '';
};
