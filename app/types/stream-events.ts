/**
 * Error data structure sent from server during streaming.
 */
export interface ServerErrorData {
  type: 'error';
  reason: 'credit-consume' | 'stream-processing' | 'transform-stream' | 'llm-generation';
  message: string;
  metadata?: Record<string, any>;
}

/**
 * Stream event payload wrapper for errors.
 * Sent by server (api.chat.ts) and consumed by client (Chat.client.tsx).
 */
export type DataErrorPayload = {
  type: 'data-error';
  transient?: boolean;
  data: ServerErrorData;
};

export type DataLogPayload = {
  type: 'data-log';
  transient: boolean;
  data: { message: string };
};

export type DataProgressPayload = {
  type: 'data-progress';
  transient: boolean;
  data: {
    type: 'progress';
    status: 'in-progress' | 'complete' | 'failed';
    order: number;
    message: string;
    label?: string;
    percentage?: number;
  };
};
