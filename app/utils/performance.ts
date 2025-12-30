/**
 * Calculate elapsed time in seconds from a start time
 * @param startTime - performance.now() timestamp
 * @returns Elapsed time in seconds with unit (e.g., "1.23 sec"), "-1 sec" if startTime is undefined
 */
export function getElapsedTime(startTime: number | undefined): string {
  if (!startTime) {
    return 'N/A';
  }

  return `${((performance.now() - startTime) / 1000).toFixed(2)} sec`;
}
