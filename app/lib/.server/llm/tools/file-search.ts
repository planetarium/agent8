import { z } from 'zod';
import { searchFileContentsByPattern, searchFilesByName, getFileContents } from '~/utils/fileUtils';
import type { FileMap } from '~/lib/.server/llm/constants';

/**
 * Tool for searching file contents with pattern matching (similar to grep)
 */
export const createFileContentSearchTool = (fileMap: FileMap) => {
  return {
    description:
      'Search file contents for specific patterns or text, similar to grep. Use this tool when you need to find specific code patterns, variable definitions, or text within files. These tools only provide read functionality and cannot change the state of files. Changes to files should be performed through output, not tool calls.',
    parameters: z.object({
      pattern: z.string().describe('Text pattern or regular expression to search for in file content'),
      caseSensitive: z.boolean().optional().describe('Whether the search should be case-sensitive (default: false)'),
      beforeLines: z
        .number()
        .optional()
        .describe('Number of lines to include before each match, similar to grep -B option (default: 0)'),
      afterLines: z
        .number()
        .optional()
        .describe('Number of lines to include after each match, similar to grep -A option (default: 0)'),
    }),
    execute: async ({
      pattern,
      caseSensitive,
      beforeLines,
      afterLines,
    }: {
      pattern: string;
      caseSensitive?: boolean;
      beforeLines?: number;
      afterLines?: number;
    }) => {
      const results = searchFileContentsByPattern(fileMap, pattern, caseSensitive, beforeLines, afterLines);

      // Format results to be more user-friendly
      return {
        totalMatches: results.length,
        matchingFiles: results.map((result) => ({
          path: result.path,
          matches: result.matches.map((match) => ({
            line: match.line,
            text: match.text,
            contextLines: match.contextLines,
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
      'Search for files by their filename or pattern. Use this tool when you need to find specific files by name or extension. These tools only provide read functionality and cannot change the state of files. Changes to files should be performed through output, not tool calls.',
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
 * Tool for getting all contents of a file
 */
export const createFileReadTool = (fileMap: FileMap) => {
  return {
    description:
      'Read the full contents of a file from the specified path. Use this tool when you need to examine the complete contents of a specific file. This tool only provides read functionality and cannot change the state of files. Changes to files should be performed through output, not tool calls.',
    parameters: z.object({
      path: z
        .string()
        .describe(
          'The path to the file you want to read. Can be relative or absolute (prefixed with workspace directory)',
        ),
    }),
    execute: async ({ path }: { path: string }) => {
      const content = getFileContents(fileMap, path);

      if (content === null) {
        return {
          success: false,
          error: `File not found or cannot be read: ${path}. The file may not exist, might be a directory, or could be a binary file.`,
        };
      }

      return {
        success: true,
        path,
        content,
      };
    },
  };
};

/**
 * Creates all file search tools with the provided FileMap
 */
export const createFileSearchTools = (fileMap: FileMap) => {
  return {
    search_file_contents: createFileContentSearchTool(fileMap),
    search_files_by_name: createFileNameSearchTool(fileMap),
    read_file_contents: createFileReadTool(fileMap),
  };
};
