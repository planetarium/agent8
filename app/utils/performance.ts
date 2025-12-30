/**
 * Calculate elapsed time in seconds from a start time
 * @param startTime - performance.now() timestamp
 * @returns Elapsed time in seconds, 0 if startTime is undefined
 */
export function getElapsedTime(startTime: number | undefined): number {
  if (!startTime) {
    return 0;
  }

  return (performance.now() - startTime) / 1000;
}
