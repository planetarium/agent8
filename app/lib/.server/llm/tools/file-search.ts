import { z } from 'zod';
import { searchFileContentsByPattern, searchFilesByName } from '~/utils/fileUtils';
import type { FileMap } from '~/lib/.server/llm/constants';

/**
 * Tool for searching file contents with pattern matching (similar to grep)
 */
export const createFileContentSearchTool = (fileMap: FileMap) => {
  return {
    description:
      'Search file contents for specific patterns or text, similar to grep. Use this tool when you need to find specific code patterns, variable definitions, or text within files.',
    parameters: z.object({
      pattern: z.string().describe('Text pattern or regular expression to search for in file content'),
      caseSensitive: z.boolean().optional().describe('Whether the search should be case-sensitive (default: false)'),
    }),
    execute: async ({ pattern, caseSensitive }: { pattern: string; caseSensitive?: boolean }) => {
      const results = searchFileContentsByPattern(fileMap, pattern, caseSensitive);

      // Format results to be more user-friendly
      return {
        totalMatches: results.length,
        matchingFiles: results.map((result) => ({
          path: result.path,
          matches: result.matches.map((match) => ({
            line: match.line,
            text: match.text,
          })),
        })),
      };
    },
  };
};

/**
 * Tool for searching files by filename
 */
export const createFileNameSearchTool = (fileMap: FileMap) => {
  return {
    description:
      'Search for files by their filename or pattern. Use this tool when you need to find specific files by name or extension.',
    parameters: z.object({
      pattern: z.string().describe('Text pattern or regular expression to match against filenames'),
      caseSensitive: z.boolean().optional().describe('Whether the search should be case-sensitive (default: false)'),
    }),
    execute: async ({ pattern, caseSensitive }: { pattern: string; caseSensitive?: boolean }) => {
      const results = searchFilesByName(fileMap, pattern, caseSensitive);

      return {
        totalFiles: results.length,
        files: results.map((file) => ({
          path: file.path,
          type: file.type,
        })),
      };
    },
  };
};

/**
 * Creates both file search tools with the provided FileMap
 */
export const createFileSearchTools = (fileMap: FileMap) => {
  return {
    search_file_contents: createFileContentSearchTool(fileMap),
    search_files_by_name: createFileNameSearchTool(fileMap),
  };
};
