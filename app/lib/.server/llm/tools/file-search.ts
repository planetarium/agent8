import { z } from 'zod';
import { searchFileContentsByPattern, getFileContents } from '~/utils/fileUtils';
import { type FileMap, TOOL_ERROR } from '~/lib/.server/llm/constants';
import { InvalidToolArgumentsError, tool } from 'ai';
import { TOOL_NAMES, WORK_DIR } from '~/utils/constants';
import type { LanguageModelV1FunctionToolCall } from '@ai-sdk/provider';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('file-search-tools');

/**
 * Regex error message constants for pattern repair
 * These are matched case-insensitively for defensive programming
 */
const REGEX_ERROR_MESSAGES = {
  NOTHING_TO_REPEAT: 'nothing to repeat',
  UNTERMINATED_CHARACTER_CLASS: 'unterminated character class',
  UNTERMINATED_GROUP: 'unterminated group',
} as const;

/**
 * Repairs invalid regex patterns in tool calls
 */
function repairRegexPattern(toolCall: LanguageModelV1FunctionToolCall, error: unknown) {
  const toolArgs = (error as any).toolArgs;

  logger.warn('[DEBUG] ### repairRegexPattern 1');

  if (!toolArgs) {
    return null;
  }

  logger.warn('[DEBUG] ### repairRegexPattern 2');

  try {
    const args = JSON.parse(toolArgs);
    const pattern = args.pattern;

    // error.cause에 원본 RegExp 에러가 있을 수 있음
    const cause = (error as any).cause;
    const errorMessage = cause instanceof Error ? cause.message.toLowerCase() : String(cause).toLowerCase();

    // Case 1: Leading quantifier
    if (errorMessage.includes(REGEX_ERROR_MESSAGES.NOTHING_TO_REPEAT) && pattern.match(/^[*+?]/)) {
      const fixedPattern = '.' + pattern;
      return {
        ...toolCall,
        args: JSON.stringify({ ...args, pattern: fixedPattern }),
      };
    }

    // Case 2: Unclosed bracket (assumed to be intended as a literal)
    if (errorMessage.includes(REGEX_ERROR_MESSAGES.UNTERMINATED_CHARACTER_CLASS)) {
      const fixedPattern = pattern.replace(/\[/g, '\\[');
      return {
        ...toolCall,
        args: JSON.stringify({ ...args, pattern: fixedPattern }),
      };
    }

    // Case 3: Unclosed parenthesis (assumed to be intended as a literal)
    if (errorMessage.includes(REGEX_ERROR_MESSAGES.UNTERMINATED_GROUP)) {
      const fixedPattern = pattern.replace(/\(/g, '\\(');
      return {
        ...toolCall,
        args: JSON.stringify({ ...args, pattern: fixedPattern }),
      };
    }

    // Ambiguous case - cannot determine how to repair
    logger.warn('The error is an ambiguous regex repair case', {
      pattern,
      errorMessage,
    });

    return null;
  } catch (error) {
    logger.error('Failed to repair regex pattern:', {
      toolCallArgs: toolCall.args,
      error: error instanceof Error ? error.message : String(error),
    });

    return null;
  }
}

/**
 * Tool for searching file contents with pattern matching (similar to grep)
 */
export const createFileContentSearchTool = (fileMap: FileMap) => {
  return tool({
    description:
      'READ ONLY TOOL : Search file contents for specific patterns or text, similar to grep. Use this tool when you need to find specific code patterns, variable definitions, or text within files. These tools only provide read functionality and cannot change the state of files. Changes to files should be performed through output, not tool calls.',
    parameters: z
      .object({
        pattern: z.string(),
        caseSensitive: z.boolean().optional(),
        beforeLines: z.number().optional(),
        afterLines: z.number().optional(),
      })
      .superRefine((data) => {
        try {
          new RegExp(data.pattern, data.caseSensitive ? 'g' : 'gi');
        } catch (error) {
          throw new InvalidToolArgumentsError({
            toolArgs: JSON.stringify(data),
            toolName: TOOL_NAMES.SEARCH_FILE_CONTENTS,
            cause: error,
            message: JSON.stringify({
              name: TOOL_ERROR.INVALID_REGEX_PATTERN,
              message: error instanceof Error ? error.message : String(error),
            }),
          });
        }
      }),
    execute: async ({ pattern, caseSensitive, beforeLines, afterLines }) => {
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
    searchFileContents: createFileContentSearchTool(fileMap),
    readFilesContents: createFilesReadTool(fileMap),
  };
};
