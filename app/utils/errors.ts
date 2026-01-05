/**
 * Custom error class for fetch/HTTP errors with status code
 */
export class FetchError extends Error {
  constructor(
    message: string,
    public status: number,
    public context?: string,
  ) {
    super(message);
    this.name = 'FetchError';
  }
}

/**
 * Helper function to extract HTTP status code from various error types
 * Supports: FetchError, Response, and any object with a status property
 */
export function getErrorStatus(error: unknown): number | null {
  // Check for Response instance
  if (error instanceof Response) {
    return error.status;
  }

  // Check for any object with a status property (includes FetchError, ChatTransportError, etc.)
  if (error && typeof error === 'object' && 'status' in error) {
    const status = (error as any).status;

    if (typeof status === 'number') {
      return status;
    }
  }

  return null;
}
