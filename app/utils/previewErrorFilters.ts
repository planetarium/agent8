export const IGNORED_PREVIEW_ERROR_PATTERNS: RegExp[] = [
  /Cannot redefine property: ethereum/,
];

export function shouldIgnorePreviewError(message?: string): boolean {
  if (!message) {
    return false;
  }
  return IGNORED_PREVIEW_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}
