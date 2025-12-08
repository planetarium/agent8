interface ServerErrorData {
  type: 'error';
  reason: 'credit-consume';
  message: string;
}

export type DataErrorPayload = {
  type: 'data-error';
  data: ServerErrorData;
};

export function isServerError(data: unknown): data is ServerErrorData {
  return typeof data === 'object' && data !== null && 'type' in data && data.type === 'error' && 'message' in data;
}
