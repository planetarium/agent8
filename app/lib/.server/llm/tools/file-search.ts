import { z } from 'zod';
import { searchFileContentsByPattern, getFileContents } from '~/utils/fileUtils';
import type { FileMap } from '~/lib/.server/llm/constants';
import { tool } from 'ai';
import { WORK_DIR } from '~/utils/constants';

/**
 * Tool for searching file contents with pattern matching (similar to grep)
 */
export const createFileContentSearchTool = (fileMap: FileMap) => {
  return tool({
    description:
      'READ ONLY TOOL : Search file contents for specific patterns or text, similar to grep. Use this tool when you need to find specific code patterns, variable definitions, or text within files. These tools only provide read functionality and cannot change the state of files. Changes to files should be performed through output, not tool calls.',
    parameters: z.object({
      pattern: z.string().describe('Text pattern or regular expression to search for in file content'),
      caseSensitive: z.boolean().describe('Whether the search should be case-sensitive (default: false)'),
      beforeLines: z
        .number()
        .describe('Number of lines to include before each match, similar to grep -B option (default: 0)'),
      afterLines: z
        .number()
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
      const actualCaseSensitive = caseSensitive ?? false;
      const actualBeforeLines = beforeLines ?? 0;
      const actualAfterLines = afterLines ?? 0;

      const results = searchFileContentsByPattern(
        fileMap,
        pattern,
        actualCaseSensitive,
        actualBeforeLines,
        actualAfterLines,
      );

      // Format results to be more user-friendly
      return {
        pattern,
        totalMatches: results.length,
        matchingFiles: results.map((result) => ({
          path: result.path.replace(WORK_DIR + '/', ''),
          matches: result.matches.map((match) => ({
            line: match.line,
            text: match.text,
            contextLines: match.contextLines,
          })),
        })),
      };
    },
  });
};

/**
 * Tool for getting all contents of a file
 */
export const createFilesReadTool = (fileMap: FileMap) => {
  return tool({
    description:
      'READ ONLY TOOL : Read the full contents of files from the specified paths. Use this tool when you need to examine the complete contents of specific files. This tool only provides read functionality and cannot change the state of files. Changes to files should be performed through output, not tool calls. CRITICAL: If it has already been read, it should not be called again with the same path.',
    parameters: z.object({
      pathList: z.array(z.string()).describe('The list of paths to the files you want to read.'),
    }),
    execute: async ({ pathList }: { pathList: string[] }) => {
      const files: Record<string, { content?: string; error?: string }> = {};

      pathList.forEach((path) => {
        const content = getFileContents(fileMap, path);

        if (content === null) {
          files[path] = {
            error: `File not found or cannot be read: ${path}. The file may not exist, might be a directory, or could be a binary file.`,
          };
        } else {
          files[path] = { content };
        }
      });

      return Object.keys(files)
        .map((name) => `<file name="${name}">\n${files[name].content}\n</file>`)
        .join('\n');
    },
  });
};

/**
 * Creates all file search tools with the provided FileMap
 */
export const createFileSearchTools = (fileMap: FileMap) => {
  return {
    search_file_contents: createFileContentSearchTool(fileMap),
    read_files_contents: createFilesReadTool(fileMap),
  };
};
