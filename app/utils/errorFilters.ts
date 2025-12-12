import type { ActionAlert } from '~/types/actions';
import { logger } from './logger';
import { workbenchStore } from '~/lib/stores/workbench';
import { WORK_DIR } from '~/utils/constants';

/**
 * Error patterns to ignore by type
 * - Only patterns matching each error type (preview, vite, build, etc.) are applied
 * - When adding a new type, add pattern array with corresponding key
 */
const IGNORED_ERROR_PATTERNS = {
  preview: {
    // Development environment related (HMR, resource loading, etc.)
    development: [/HMRClient/, /Couldn't load texture blob/, /null pointer passed to rust/, /Failed to load animation/],

    // Browser environment related (extensions, etc.)
    browser: [/Cannot redefine property: ethereum/, /chrome-extension:\/\//],
  },

  // Add vite, build, terminal, etc. as needed
} as const;

/**
 * Minimum length for error content to be considered valid
 * Errors shorter than this are likely noise or incomplete messages
 */
const MIN_ERROR_CONTENT_LENGTH = 16;

/**
 * Executable file extensions that can appear in stack traces
 */
const STACK_TRACE_FILE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.json']);

/**
 * Stack trace section extraction pattern
 */
const STACK_TRACE_SECTION_PATTERN = /Stack trace:[\s\S]*/i;

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
 * Gets the list of executable filenames from workbenchStore (including server.js which may be generated)
 * Returns a Set of filenames (without path) for quick lookup
 * Filters out non-executable files (.md, .json, .css, .svg, images, etc.) as they won't appear in stack traces
 */
function getWorkbenchFileNames(): Set<string> {
  const files = workbenchStore.files.get();
  const fileNames = new Set<string>();

  for (const filePath of Object.keys(files)) {
    const dirent = files[filePath];

    if (dirent?.type === 'file') {
      const fileName = filePath.split('/').pop();

      if (fileName) {
        const hasExecutableExt = STACK_TRACE_FILE_EXTENSIONS.has(fileName.slice(fileName.lastIndexOf('.')));

        if (hasExecutableExt) {
          fileNames.add(fileName);
        }
      }
    }
  }

  return fileNames;
}

/**
 * Checks if stack trace contains any file from workbench
 * Returns true if workbench files are found in stack trace, false otherwise
 */
function hasWorkbenchFileInMessage(message: string): boolean {
  const workbenchFiles = getWorkbenchFileNames();

  if (workbenchFiles.size === 0) {
    return false;
  }

  const escapedFileNames = Array.from(workbenchFiles).map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const fileNamesPattern = new RegExp(`\\/(${escapedFileNames.join('|')})(?:[?:]|$)`);
  const matchResult = message.match(fileNamesPattern);

  if (matchResult) {
    logger.debug('[ErrorFilter] 🎯 Matched workbench file:', matchResult[1]);
    return true;
  }

  return false;
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
      if (key === 'url' && typeof value === 'string') {
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
  return url.replace(/\/+$/, '').toLowerCase();
}

/**
 * Checks if any HTTP URL in message matches assets.json URLs
 * Returns true if matching URLs are found, false otherwise
 */
function hasAssetsUrlInMessage(message: string): boolean {
  const assetsUrls = getAssetsJsonUrls();

  if (!assetsUrls) {
    return false;
  }

  // Create regex pattern from assets URLs (escape special chars)
  const escapedUrls = Array.from(assetsUrls).map((url) => url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const assetsPattern = new RegExp(`(${escapedUrls.join('|')})`, 'i');

  const matchResult = message.match(assetsPattern);

  if (matchResult) {
    logger.debug('[ErrorFilter] 🎯 Matched asset URL:', matchResult[1]);
    return true;
  }

  return false;
}

/**
 * Determines whether to ignore ActionAlert
 * - Filters out very short content (less than MIN_ERROR_CONTENT_LENGTH characters)
 * - Only applies patterns matching alert.type
 * - Checks both content and description fields
 * - Undefined types are not filtered
 * - For preview type: Shows errors with workbench files in stack trace
 * - For preview type: Shows errors with assets.json URLs in stack trace
 * - For preview type: Filters errors with unknown files/URLs (not in workbench or assets.json)
 */
export function shouldIgnoreError(alert: ActionAlert): boolean {
  const description = alert.description;
  const content = alert.content;

  if (content.trim().length < MIN_ERROR_CONTENT_LENGTH) {
    return true;
  }

  logger.debug('[ErrorFilter] Alert details:', {
    description,
    content,
  });

  // check IGNORED_ERROR_PATTERNS for any type (preview, vite, build, etc.)
  if (alert.type in IGNORED_ERROR_PATTERNS) {
    const patterns = getPatternsForType(alert.type as ErrorType);
    const isIgnoredPattern = patterns.some((pattern) => pattern.test(content) || pattern.test(description));

    if (isIgnoredPattern) {
      logger.debug('[ErrorFilter] ✅ Matched IGNORED_ERROR_PATTERNS, ignoring error');
      return true;
    }
  }

  // preview type, additionally check workbench files and assets URLs
  if (alert.type === 'preview') {
    const stackTraceMessage = content.match(STACK_TRACE_SECTION_PATTERN)?.[0];

    if (!stackTraceMessage) {
      logger.debug('[ErrorFilter] No stack trace message found, showing error');
      return false;
    }

    if (hasWorkbenchFileInMessage(stackTraceMessage)) {
      logger.debug('[ErrorFilter] ✅ Workbench file found in stack trace, showing error');
      return false;
    }

    if (hasAssetsUrlInMessage(stackTraceMessage)) {
      logger.debug('[ErrorFilter] ✅ Asset URL found, showing error');
      return false;
    }

    return true;
  }

  return false;
}
