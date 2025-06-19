/**
 * Cleans stack traces to show relative paths instead of full URLs
 * RemoteContainer uses fly.dev and verse8.io domains, not webcontainer-api.io
 */
export function cleanStackTrace(stackTrace: string): string {
  /*
   * RemoteContainer doesn't use webcontainer-api.io, so we can simply return the stack trace
   * In the future, this could be enhanced to clean fly.dev or verse8.io URLs if needed
   */
  return stackTrace;
}
