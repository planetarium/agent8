export const IGNORED_PREVIEW_ERROR_PATTERNS: RegExp[] = [
  /Cannot redefine property: ethereum/,
  /chrome-extension:\/\//,
];

export function shouldIgnorePreviewError(message?: string): boolean {
  if (!message) {
    return true;
  }

  if (message.trim() === 'undefined' || message.trim().length < 16) {
    return true;
  }

  return IGNORED_PREVIEW_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}
