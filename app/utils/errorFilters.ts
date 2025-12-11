import type { ActionAlert } from '~/types/actions';
import { logger } from './logger';
import { workbenchStore } from '~/lib/stores/workbench';
import { WORK_DIR } from '~/utils/constants';

/**
 * Error patterns to ignore by type
 * - Only patterns matching each error type (preview, vite, build, etc.) are applied
 * - When adding a new type, add pattern array with corresponding key
 */
export const IGNORED_ERROR_PATTERNS = {
  preview: {
    // Development environment related (HMR, resource loading, etc.)
    development: [/HMRClient/, /Couldn't load texture blob/, /null pointer passed to rust/, /Failed to load animation/],

    // Browser environment related (extensions, etc.)
    browser: [/Cannot redefine property: ethereum/, /chrome-extension:\/\//],

    // Warning messages - don't break the app, actual errors will be caught later
    warnings: [/^Warning:/],
  },

  // Add vite, build, terminal, etc. as needed
} as const;

/**
 * Stack trace section extraction pattern
 */
const STACK_TRACE_SECTION_PATTERN = /Stack trace:[\s\S]*/i;

/**
 * Pattern to extract HTTP/HTTPS URLs from content
 */
const HTTP_URL_PATTERN = /https?:\/\/[^\s"'<>]+/gi;

type ErrorType = keyof typeof IGNORED_ERROR_PATTERNS;

/**
 * Pattern cache for performance optimization
 */
const patternCache = new Map<ErrorType, RegExp[]>();

/**
 * Returns all patterns for a specific error type as a flat array (cached)
 */
function getPatternsForType(type: ErrorType): RegExp[] {
  if (!patternCache.has(type)) {
    const patterns = IGNORED_ERROR_PATTERNS[type];
    patternCache.set(type, Object.values(patterns).flat());
  }

  return patternCache.get(type)!;
}

/**
 * Gets the list of filenames from workbenchStore (including server.js which may be generated)
 * Returns a Set of filenames (without path) for quick lookup
 */
function getWorkbenchFileNames(): Set<string> {
  const files = workbenchStore.files.get();
  const fileNames = new Set<string>();

  for (const filePath of Object.keys(files)) {
    const dirent = files[filePath];

    if (dirent?.type === 'file') {
      // Extract just the filename from the path
      const fileName = filePath.split('/').pop();

      if (fileName) {
        fileNames.add(fileName);
      }
    }
  }

  // Always include server.js as it may be dynamically generated
  fileNames.add('server.js');

  return fileNames;
}

/**
 * Checks if stack trace contains any file from workbench
 * Returns true (should filter) if NO workbench files are found in stack trace
 */
function hasUnknownFileInStackTrace(content: string): boolean {
  const stackTrace = content.match(STACK_TRACE_SECTION_PATTERN)?.[0];

  logger.warn('#### [ErrorFilter] hasUnknownFileInStackTrace called, stackTrace found:', !!stackTrace);

  if (!stackTrace) {
    return false;
  }

  const workbenchFiles = getWorkbenchFileNames();

  logger.warn('#### [ErrorFilter] Workbench files count:', workbenchFiles.size);
  logger.warn('#### [ErrorFilter] Workbench files:\n', JSON.stringify(Array.from(workbenchFiles), null, 2));

  if (workbenchFiles.size === 0) {
    logger.warn('#### [ErrorFilter] No workbench files found, returning false');
    return false;
  }

  /**
   * Build regex pattern from workbench filenames
   * - Escape special regex characters and match filename in path context
   * - Case-sensitive matching (no 'i' flag) to ensure exact filename match
   * - Extension is included in filename for precise matching (e.g., EnemyManager.tsx)
   */
  const escapedFileNames = Array.from(workbenchFiles).map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const fileNamesPattern = new RegExp(`\\/(${escapedFileNames.join('|')})(?:[?:]|$)`);

  const hasMatch = fileNamesPattern.test(stackTrace);

  logger.warn('#### [ErrorFilter] Stack trace file check:', {
    pattern: fileNamesPattern.toString(),
    hasMatchInStackTrace: hasMatch,
    stackTracePreview: stackTrace.substring(0, 500),
  });

  logger.warn('#### [ErrorFilter] hasUnknownFileInStackTrace result:', !hasMatch);

  // Return true if NO workbench files are found in stack trace
  return !hasMatch;
}

/**
 * Gets URLs from assets.json if it exists in workbench
 * Returns a Set of URLs or null if assets.json doesn't exist
 */
function getAssetsJsonUrls(): Set<string> | null {
  const files = workbenchStore.files.get();

  // Look for assets.json in any location
  for (const filePath of Object.keys(files)) {
    if (filePath.endsWith('/assets.json') || filePath === `${WORK_DIR}/assets.json`) {
      const dirent = files[filePath];

      if (dirent?.type === 'file' && dirent.content) {
        try {
          const assetsData = JSON.parse(dirent.content);
          const urls = new Set<string>();

          /**
           * Extract URLs from assets.json structure
           * Common structures: array of objects with url field, or object with url values
           */
          extractUrlsFromObject(assetsData, urls);

          return urls.size > 0 ? urls : null;
        } catch {
          logger.warn('Failed to parse assets.json');

          return null;
        }
      }
    }
  }

  return null;
}

/**
 * Recursively extracts URLs from an object/array structure
 */
function extractUrlsFromObject(obj: unknown, urls: Set<string>): void {
  if (!obj || typeof obj !== 'object') {
    return;
  }

  if (Array.isArray(obj)) {
    for (const item of obj) {
      extractUrlsFromObject(item, urls);
    }
  } else {
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      if (typeof value === 'string' && (key === 'url' || key === 'src' || key === 'path')) {
        // Normalize URL for comparison (remove trailing slashes, etc.)
        urls.add(normalizeUrl(value));
      } else if (typeof value === 'object') {
        extractUrlsFromObject(value, urls);
      }
    }
  }
}

/**
 * Normalizes a URL for comparison
 */
function normalizeUrl(url: string): string {
  try {
    // Remove trailing slash and normalize
    return url.replace(/\/+$/, '').toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

/**
 * Extracts HTTP/HTTPS URLs from content
 */
function extractHttpUrls(content: string): string[] {
  HTTP_URL_PATTERN.lastIndex = 0;

  const urls: Set<string> = new Set();
  let match;

  while ((match = HTTP_URL_PATTERN.exec(content)) !== null) {
    urls.add(normalizeUrl(match[0]));
  }

  return Array.from(urls);
}

/**
 * Checks if HTTP URLs in content don't match any assets.json URLs
 * Returns true if assets.json exists and ALL HTTP URLs are NOT in assets.json
 */
function hasUnknownHttpUrl(content: string): boolean {
  const assetsUrls = getAssetsJsonUrls();

  logger.debug('#### [ErrorFilter] Assets.json URLs:', assetsUrls ? Array.from(assetsUrls) : 'No assets.json found');

  // If no assets.json exists, don't filter based on URLs
  if (!assetsUrls) {
    return false;
  }

  const httpUrls = extractHttpUrls(content);

  logger.debug('#### [ErrorFilter] HTTP URLs in error content:', httpUrls);

  // If no HTTP URLs in content, don't filter
  if (httpUrls.length === 0) {
    return false;
  }

  /**
   * Check if ALL URLs are unknown (not in assets.json)
   * We use partial matching since assets.json may have base URLs
   */
  const allUnknown = httpUrls.every((url) => {
    for (const assetUrl of assetsUrls) {
      if (url.includes(assetUrl) || assetUrl.includes(url)) {
        logger.debug('#### [ErrorFilter] URL match found:', { errorUrl: url, assetUrl });

        return false; // Found a match
      }
    }

    return true; // No match found
  });

  logger.debug('#### [ErrorFilter] HTTP URL check result:', { allUnknown, willFilter: allUnknown });

  return allUnknown;
}

/**
 * Determines whether to ignore ActionAlert
 * - Only applies patterns matching alert.type
 * - Checks both content and description fields
 * - Undefined types are not filtered
 * - Filters errors with unknown files in stack trace (not in workbench)
 * - Filters errors with HTTP URLs not matching assets.json
 */
export function shouldIgnoreError(alert: ActionAlert | undefined): boolean {
  if (!alert?.content) {
    return true;
  }

  const content = alert.content;
  const description = alert.description || '';

  if (content.trim() === 'undefined' || content.trim().length < 16) {
    return true;
  }

  logger.debug('#### [ErrorFilter] content:', content, 'description:', description);

  /**
   * Check if stack trace contains files from workbench (user code)
   * - If workbench file found → user code error → DON'T filter (show to AI)
   * - If NO workbench file found → external error → filter (ignore)
   */
  if (alert.type === 'preview') {
    const isUnknownFile = hasUnknownFileInStackTrace(content);

    if (!isUnknownFile) {
      // Workbench file found in stack trace - this is user code error, show it
      logger.debug('#### [ErrorFilter] ✅ Workbench file found in stack trace, showing error to AI');
      return false;
    }

    // No workbench file found - check if it's related to assets.json URLs
    const isUnknownUrl = hasUnknownHttpUrl(content);

    if (isUnknownFile && !isUnknownUrl) {
      // Unknown file but URL matches assets.json - could be asset loading error, show it
      logger.debug('#### [ErrorFilter] ✅ Asset URL found, showing error to AI');
      return false;
    }

    // Unknown file AND unknown URL - external error, filter it
    logger.warn('#### 🔄 External error detected (no workbench file, no asset URL):', content);

    return true;
  }

  // If no patterns for the type, do not filter
  if (!(alert.type in IGNORED_ERROR_PATTERNS)) {
    return false;
  }

  const patterns = getPatternsForType(alert.type as ErrorType);

  // Check patterns against both content and description (Warning messages are in description)
  return patterns.some((pattern) => pattern.test(content) || pattern.test(description));
}
