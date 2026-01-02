export class HTTPError extends Error {
  constructor(
    message: string,
    public status: number,
    public context?: string,
  ) {
    super(message);
    this.name = 'HTTPError';
  }
}

export function isHTTPError(error: unknown): error is HTTPError {
  return error instanceof HTTPError;
}

export function getErrorStatus(error: unknown): number | null {
  if (isHTTPError(error)) {
    return error.status;
  }

  if (error && typeof error === 'object' && 'status' in error) {
    return (error as any).status;
  }

  return null;
}
