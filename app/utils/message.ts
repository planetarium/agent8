import type { Message } from 'ai';

export const extractTextContent = (message: Message) =>
  message.parts && message.parts.length > 0
    ? message.parts
        .filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join('')
    : message.content;
