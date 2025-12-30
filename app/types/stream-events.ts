/**
 * Error data structure sent from server during streaming.
 */
export interface ServerErrorData {
  type: 'error';
  reason: 'credit-consume' | 'stream-processing';
  message: string;
  prompt: string;
  elapsedTime: string;
}

/**
 * Stream event payload wrapper for errors.
 * Sent by server (api.chat.ts) and consumed by client (Chat.client.tsx).
 */
export type DataErrorPayload = {
  type: 'data-error';
  data: ServerErrorData;
};
