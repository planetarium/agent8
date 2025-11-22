import { z } from 'zod/v4';
import { tool } from 'ai';
import { type FileMap, type Orchestration } from '~/lib/.server/llm/constants';
import { getFileContents, getFullPath } from '~/utils/fileUtils';
import { TOOL_NAMES, WORK_DIR } from '~/utils/constants';
import {
  SUBMIT_FILE_ACTION_FIELDS,
  SUBMIT_MODIFY_ACTION_FIELDS,
  SUBMIT_SHELL_ACTION_FIELDS,
} from '~/lib/constants/tool-fields';
import { createScopedLogger } from '~/utils/logger';
import { normalizeContent } from '~/utils/stringUtils';

function needReadFile(fileMap: FileMap, path: string): boolean {
  const fullPath = getFullPath(path);

  if (fullPath.startsWith(`${WORK_DIR}/PROJECT/`) && fullPath.endsWith('.md')) {
    return false;
  }

  if (fullPath === `${WORK_DIR}/src/assets.json`) {
    return false;
  }

  return !!getFileContents(fileMap, path);
}

export const COMPLETE_FIELD = 'complete';

/**
 * Create or overwrite a file with complete content
 */
export const createSubmitFileActionTool = (fileMap: FileMap | undefined, orchestration: Orchestration) => {
  const logger = createScopedLogger(TOOL_NAMES.SUBMIT_FILE_ACTION);

  return tool({
    description:
      'Create a new file or overwrite an existing file with complete content. Use this for: new files, small files (<100 lines), markdown files (*.md), or when rewriting most of the file.',
    inputSchema: z.object({
      [SUBMIT_FILE_ACTION_FIELDS.PATH]: z.string().describe('Relative path from cwd'),
      [SUBMIT_FILE_ACTION_FIELDS.CONTENT]: z.string().describe('Complete file content'),
    }),
    async execute(arg) {
      const path = arg[SUBMIT_FILE_ACTION_FIELDS.PATH];
      const content = arg[SUBMIT_FILE_ACTION_FIELDS.CONTENT];

      logger.info(`Submitting file action for: ${path}`);

      // Check if file exists and needs to be read first
      if (fileMap && needReadFile(fileMap, path)) {
        const seen = orchestration.readSet;

        if (!seen.has(path)) {
          logger.warn(`Existing file not read: ${path}`);

          const raw = getFileContents(fileMap, path);

          if (raw != null) {
            seen.add(path);
            return {
              [COMPLETE_FIELD]: false,
              existing_file: { path, content: raw },
              systemMessage: `CRITICAL: File "${path}" already exists and must be read before overwriting.

⚠️ DO NOT use ${TOOL_NAMES.READ_FILES_CONTENTS} tool - the complete file content is already provided above in 'existing_file'.

IMPORTANT CONSIDERATIONS:
1. Review the 'existing_file.content' to understand the current implementation
2. Maintain consistent style, imports, and patterns from the existing file
3. Preserve any important configurations or logic
4. Submit ${TOOL_NAMES.SUBMIT_FILE_ACTION} again with your improved content

The existing file content is ready for you to review - no additional tool calls needed.`,
            };
          }
        }
      }

      orchestration.updatedSet.add(path);

      return {
        [COMPLETE_FIELD]: true,
        path,
        content_size: content.length,
        type: 'file',
        systemMessage: `File "${path}" created successfully (${content.length} characters).`,
      };
    },
  });
};

/**
 * Modify existing file with multiple text replacements
 */
export const createSubmitModifyActionTool = (fileMap: FileMap | undefined, orchestration: Orchestration) => {
  const logger = createScopedLogger(TOOL_NAMES.SUBMIT_MODIFY_ACTION);

  return tool({
    description:
      'Modify an existing file by replacing multiple exact text segments. CRITICAL: You MUST read the file first using read_files_contents tool. Use this for: large files (>100 lines) with targeted changes, when making 1-10 small modifications.',
    inputSchema: z.object({
      [SUBMIT_MODIFY_ACTION_FIELDS.PATH]: z.string().describe('Relative path from cwd'),
      [SUBMIT_MODIFY_ACTION_FIELDS.ITEMS]: z
        .array(
          z.object({
            [SUBMIT_MODIFY_ACTION_FIELDS.BEFORE]: z.string().describe('Exact text to find in file'),
            [SUBMIT_MODIFY_ACTION_FIELDS.AFTER]: z.string().describe('New text to replace with'),
          }),
        )
        .min(1)
        .describe('Array of modifications to apply to the file'),
    }),
    async execute(arg) {
      const path = arg[SUBMIT_MODIFY_ACTION_FIELDS.PATH];
      const items = arg[SUBMIT_MODIFY_ACTION_FIELDS.ITEMS];

      logger.info(`Submitting modify action for: ${path} with ${items.length} modifications`);

      // Check if file was already modified in this conversation
      if (orchestration.updatedSet.has(path)) {
        logger.warn(`File already modified in this conversation: ${path}`);
        return {
          [COMPLETE_FIELD]: false,
          systemMessage: `CRITICAL: File "${path}" was already modified in this conversation.

⚠️ You cannot use ${TOOL_NAMES.SUBMIT_MODIFY_ACTION} on files that have been modified in this conversation.

REQUIRED ACTION:
Use ${TOOL_NAMES.SUBMIT_FILE_ACTION} instead with the complete updated file content, including all your changes.`,
        };
      }

      // Check if file needs to be read first
      if (fileMap && needReadFile(fileMap, path)) {
        const seen = orchestration.readSet;

        if (!seen.has(path)) {
          logger.warn(`File not read: ${path}`);

          const raw = getFileContents(fileMap, path);

          if (raw != null) {
            seen.add(path);
            return {
              [COMPLETE_FIELD]: false,
              existing_file: { path, content: raw },
              systemMessage: `CRITICAL: File "${path}" must be read before modification.

⚠️ DO NOT use ${TOOL_NAMES.READ_FILES_CONTENTS} tool - the complete file content is already provided above in 'existing_file'.

NEXT STEPS:
1. Review the 'existing_file.content' provided in this response
2. Find the EXACT text segment you want to modify (copy it character-by-character)
3. Submit ${TOOL_NAMES.SUBMIT_MODIFY_ACTION} again with the exact 'before' text from the file

The existing file content is ready for you to use - no additional tool calls needed.`,
            };
          }
        }
      }

      // Validate that all 'before' texts exist in the file
      if (fileMap) {
        const fileContent = getFileContents(fileMap, path);

        if (fileContent) {
          const invalidItems: Array<{ before: string; index: number }> = [];

          items.forEach((item, index) => {
            const before = item[SUBMIT_MODIFY_ACTION_FIELDS.BEFORE];
            let isIncluded = fileContent.includes(before);

            // Try normalized content for non-markdown files
            if (!isIncluded && !path.endsWith('.md')) {
              const normalizedBefore = normalizeContent(before);
              isIncluded = fileContent.includes(normalizedBefore);
            }

            if (!isIncluded) {
              invalidItems.push({ before, index });
            }
          });

          if (invalidItems.length > 0) {
            logger.warn(`Invalid modifications found: ${invalidItems.length} items`);

            const errorDetails = invalidItems
              .map(({ before, index }) => {
                const preview = before.length > 100 ? before.substring(0, 100) + '...' : before;
                return `  • Modification #${index + 1}: The specified 'before' text does not exist in the file\n    Preview of what you tried: "${preview}"`;
              })
              .join('\n');

            return {
              [COMPLETE_FIELD]: false,
              systemMessage: `CRITICAL ERROR: Some 'before' texts don't exist in "${path}":\n\n${errorDetails}\n\nYou have already read this file, but the 'before' text you provided does not match the actual file content.\n\nYou MUST:\n1. Carefully review the file content you already read\n2. Find the EXACT text you want to replace (character by character, including all whitespace)\n3. Copy it EXACTLY without any changes or assumptions\n4. Paste it into the 'before' field\n5. Try again with the correct exact text from the file`,
            };
          }
        }
      }

      orchestration.updatedSet.add(path);

      return {
        [COMPLETE_FIELD]: true,
        path,
        modifications_count: items.length,
        type: 'modify',
        systemMessage: `File "${path}" modified successfully (${items.length} ${items.length === 1 ? 'change' : 'changes'} applied).`,
      };
    },
  });
};

/**
 * Execute a shell command
 */
export const createSubmitShellActionTool = () => {
  const logger = createScopedLogger(TOOL_NAMES.SUBMIT_SHELL_ACTION);

  return tool({
    description:
      'Execute a shell command. ALLOWED COMMANDS ONLY: Package management (pnpm/bun add <package-name>), File deletion (rm <file-path>) - use ONLY when user EXPLICITLY requests file deletion.',
    inputSchema: z.object({
      [SUBMIT_SHELL_ACTION_FIELDS.COMMAND]: z
        .string()
        .describe(
          'Shell command to execute. ALLOWED: pnpm/bun add <package-name>, rm <file-path>. FORBIDDEN: pnpm/bun run, ls, cd, mkdir, mv, cp, rm -rf, or any dangerous commands.',
        ),
    }),
    async execute(arg) {
      const command = arg[SUBMIT_SHELL_ACTION_FIELDS.COMMAND];

      logger.info(`Submitting shell action: ${command}`);

      // Basic command validation
      const trimmedCommand = command.trim();

      // Check for dangerous commands
      if (
        trimmedCommand.includes('rm -rf') ||
        trimmedCommand.includes('/*') ||
        trimmedCommand.includes('*') ||
        trimmedCommand.startsWith('npm run') ||
        trimmedCommand.startsWith('yarn run') ||
        trimmedCommand.startsWith('pnpm run') ||
        trimmedCommand.startsWith('bun run')
      ) {
        logger.warn(`Dangerous command blocked: ${command}`);
        return {
          [COMPLETE_FIELD]: false,
          systemMessage: `FORBIDDEN: The command "${command}" is not allowed. Only package management (bun add) and file deletion (rm <file-path>) are permitted.`,
        };
      }

      return {
        [COMPLETE_FIELD]: true,
        command,
        type: 'shell',
        systemMessage: `Shell command executed successfully: ${command}`,
      };
    },
  });
};
