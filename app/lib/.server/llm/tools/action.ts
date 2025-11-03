import { z } from 'zod/v4';
import { InvalidToolInputError, tool } from 'ai';
import { TOOL_ERROR, type FileMap, type Orchestration } from '~/lib/.server/llm/constants';
import { getFileContents, getFullPath } from '~/utils/fileUtils';
import { TOOL_NAMES, WORK_DIR } from '~/utils/constants';
import {
  SUBMIT_ARTIFACT_FIELDS,
  FILE_ACTION_FIELDS,
  MODIFY_ACTION_FIELDS,
  MODIFICATION_FIELDS,
  SHELL_ACTION_FIELDS,
} from '~/lib/constants/tool-fields';

const FILE_ACTION_SCHEMA = z.object({
  [FILE_ACTION_FIELDS.PATH]: z.string().describe('relative-path from cwd'),
  [FILE_ACTION_FIELDS.CONTENT]: z.string().describe('complete file content'),
});

const MODIFY_ACTION_SCHEMA = z.object({
  [MODIFY_ACTION_FIELDS.PATH]: z.string().describe('relative-path from cwd'),
  [MODIFY_ACTION_FIELDS.MODIFICATIONS]: z.array(
    z.object({
      [MODIFICATION_FIELDS.BEFORE]: z.string().describe('exact text to find in file'),
      [MODIFICATION_FIELDS.AFTER]: z.string().describe('new text to replace with'),
    }),
  ),
});

const SHELL_ACTION_SCHEMA = z.object({
  [SHELL_ACTION_FIELDS.COMMAND]: z
    .string()
    .describe(
      'shell command to execute. ALLOWED COMMANDS (ONLY): - Package management: bun add <package-name> - File deletion: rm <file-path>',
    ),
});

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

export const createSubmitArtifactActionTool = (fileMap: FileMap | undefined, orchestration: Orchestration) => {
  return tool({
    description:
      "**MANDATORY OUTPUT FORMAT** - This is the ONLY way to return your work to the user. You MUST call this tool to complete ANY user request. Think of this as your 'submit' or 'return' button - without calling this, the user receives nothing.",
    inputSchema: z
      .object({
        [SUBMIT_ARTIFACT_FIELDS.ID]: z.string().optional().describe('kebab-case identifier (e.g., platformer-game)'),
        [SUBMIT_ARTIFACT_FIELDS.TITLE]: z
          .string()
          .min(1)
          .max(80)
          .optional()
          .describe('Descriptive title of the artifact.'),
        [SUBMIT_ARTIFACT_FIELDS.SUMMARY]: z
          .string()
          .min(10)
          .max(400)
          .optional()
          .describe('1-3 sentences: what changed and why.'),
        [SUBMIT_ARTIFACT_FIELDS.FILE_ACTIONS]: z
          .array(FILE_ACTION_SCHEMA)
          .optional()
          .describe('A list of file creation/update actions.'),
        [SUBMIT_ARTIFACT_FIELDS.MODIFY_ACTIONS]: z
          .array(MODIFY_ACTION_SCHEMA)
          .optional()
          .describe('A list of file modification actions.'),
        [SUBMIT_ARTIFACT_FIELDS.SHELL_ACTIONS]: z
          .array(SHELL_ACTION_SCHEMA)
          .optional()
          .describe('A list of shell command actions.'),
      })
      .superRefine((arg, _ctx) => {
        const allPathActions = [
          ...(arg[SUBMIT_ARTIFACT_FIELDS.FILE_ACTIONS] || []),
          ...(arg[SUBMIT_ARTIFACT_FIELDS.MODIFY_ACTIONS] || []),
        ];

        const need = new Set<string>();

        if (fileMap) {
          for (const action of allPathActions) {
            if (action.path) {
              const needsRead = needReadFile(fileMap, action.path);

              if (needsRead) {
                need.add(action.path);
              }
            }
          }
        }

        const missingPaths = [...need].filter((p) => !orchestration.readSet.has(p));

        if (missingPaths.length) {
          throw new InvalidToolInputError({
            toolInput: '',
            toolName: TOOL_NAMES.SUBMIT_ARTIFACT,
            cause: TOOL_ERROR.MISSING_FILE_CONTEXT,
            message: JSON.stringify({ name: TOOL_ERROR.MISSING_FILE_CONTEXT, paths: missingPaths }),
          });
        }
      }),
    async execute() {
      orchestration.submitted = true;

      return { ok: true };
    },
  });
};
