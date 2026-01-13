import axios from 'axios';

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
 * Helper function to check if an error is an abort/cancel error
 * Supports: DOMException (fetch), CanceledError (axios)
 */
export function isAbortError(error: unknown): boolean {
  // fetch API: DOMException with name 'AbortError'
  if (error instanceof DOMException && error.name === 'AbortError') {
    return true;
  }

  // axios: CanceledError
  if (axios.isCancel(error)) {
    return true;
  }

  return false;
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

export class SkipToastError extends FetchError {
  constructor(
    message: string,
    public status: number,
    public context?: string,
  ) {
    super(message, status, context);
    this.name = 'SkipToastError';
  }
}

/**
 * Error thrown when LLM repeats a previous response (tool-input-start detected)
 */
export class LLMRepeatResponseError extends Error {
  constructor(message: string = 'llm-repeat-response') {
    super(message);
    this.name = 'LLMRepeatResponseError';
  }
}
