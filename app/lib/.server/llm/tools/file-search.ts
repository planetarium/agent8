import { z } from 'zod/v4';
import { searchFileContentsByPattern, getFileContents } from '~/utils/fileUtils';
import { type FileMap, type Orchestration } from '~/lib/.server/llm/constants';
import { WORK_DIR } from '~/utils/constants';
import { tool } from 'ai';

/**
 * Tool for searching file contents with pattern matching (similar to grep)
 */
export const createFileContentSearchTool = (fileMap: FileMap) => {
  return tool({
    description:
      'READ ONLY TOOL : Search file contents for specific patterns or text, similar to grep. Use this tool when you need to find specific code patterns, variable definitions, or text within files. These tools only provide read functionality and cannot change the state of files. Changes to files should be performed through output, not tool calls.',
    inputSchema: z.object({
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
export const createFilesReadTool = (fileMap: FileMap, orchestration: Orchestration) => {
  const seen = orchestration.readSet;

  return tool({
    description:
      'READ ONLY TOOL : Read the full contents of files from the specified paths. Use this tool when you need to examine the complete contents of specific files. This tool only provides read functionality and cannot change the state of files. Changes to files should be performed through output, not tool calls. CRITICAL: If it has already been read, it should not be called again with the same path.',
    inputSchema: z.object({
      pathList: z.union([z.array(z.string()), z.string()]).describe('The list of paths to the files you want to read.'),
    }),
    outputSchema: z.object({
      files: z.array(
        z.object({
          path: z.string(),
          content: z.string().optional(),
          error: z.string().optional(),
          skippedAsDuplicate: z.boolean().optional(),
        }),
      ),
      complete: z.boolean(),
    }),
    async execute({ pathList }) {
      const out: Array<{
        path: string;
        content?: string;
        error?: string;
        skippedAsDuplicate?: boolean;
      }> = [];

      let paths: string[];

      if (typeof pathList === 'string') {
        try {
          const parsed = JSON.parse(pathList);
          paths = Array.isArray(parsed) ? parsed : [pathList];
        } catch {
          paths = [pathList];
        }
      } else {
        paths = Array.isArray(pathList) ? pathList : [pathList];
      }

      for (const path of paths) {
        if (seen.has(path)) {
          out.push({ path, skippedAsDuplicate: true });
          continue;
        }

        const raw = getFileContents(fileMap, path);

        if (raw == null) {
          out.push({ path, error: `File not found / unreadable: ${path}` });
          continue;
        }

        seen.add(path);
        out.push({ path, content: raw });
      }

      return { files: out, complete: true };
    },
  });
};
