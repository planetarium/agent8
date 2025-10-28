/**
 * Calculate elapsed time in seconds from a start time
 * @param startTime - performance.now() timestamp
 * @returns Elapsed time in seconds
 */
export function getElapsedTime(startTime: number): number {
  return (performance.now() - startTime) / 1000;
}
