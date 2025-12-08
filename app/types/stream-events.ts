/**
 * Error data structure sent from server during streaming.
 */
export interface ServerErrorData {
  type: 'error';
  reason: 'credit-consume';
  message: string;
}

/**
 * Stream event payload wrapper for errors.
 * Sent by server (api.chat.ts) and consumed by client (Chat.client.tsx).
 */
export type DataErrorPayload = {
  type: 'data-error';
  data: ServerErrorData;
};

/**
 * Type guard to check if data is a ServerErrorData.
 * @param data - Unknown data from stream
 * @returns True if data matches ServerErrorData structure
 */
export function isServerError(data: unknown): data is ServerErrorData {
  return typeof data === 'object' && data !== null && 'type' in data && data.type === 'error' && 'message' in data;
}
