import type { UIMessage } from 'ai';

export const extractTextContent = (message: UIMessage) => {
  // AI SDK v5에서는 모든 메시지가 parts 구조를 사용
  if (message.parts && message.parts.length > 0) {
    return message.parts
      .filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join('');
  }

  // parts가 없거나 비어있는 경우 빈 문자열 반환
  return '';
};
