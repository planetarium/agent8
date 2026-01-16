export function withResolvers<T>(): PromiseWithResolvers<T> {
  if (typeof Promise.withResolvers === 'function') {
    return Promise.withResolvers();
  }

  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: any) => void;

  const promise = new Promise<T>((_resolve, _reject) => {
    resolve = _resolve;
    reject = _reject;
  });

  return {
    resolve,
    reject,
    promise,
  };
}

/**
 * Retry an async operation with configurable attempts and delay
 * @param operation - Function that returns a Promise, receives attempt number (0-indexed)
 * @param options - Retry configuration options
 * @returns The result of the successful operation
 * @throws The error from the last failed attempt
 */
export async function retry<T>(
  operation: (attempt: number) => Promise<T>,
  options?: {
    maxRetries?: number;
    delayMs?: number;
    shouldRetry?: (error: unknown, attempt: number) => boolean;
  },
): Promise<T> {
  const { maxRetries = 2, delayMs = 1000, shouldRetry } = options ?? {};

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await operation(attempt);
    } catch (error) {
      const isLastAttempt = attempt === maxRetries - 1;
      const shouldContinue = !isLastAttempt && (!shouldRetry || shouldRetry(error, attempt));

      if (!shouldContinue) {
        throw error;
      }

      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw new Error('Unexpected end of retry loop');
}
