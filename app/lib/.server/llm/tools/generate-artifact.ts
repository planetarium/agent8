import { z } from 'zod/v4';
import { tool } from 'ai';
import { type FileMap, type Orchestration } from '~/lib/.server/llm/constants';
import { getFileContents, getFullPath } from '~/utils/fileUtils';
import { TOOL_NAMES, WORK_DIR } from '~/utils/constants';
import {
  GENERATE_ARTIFACT_FIELDS,
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

export const COMPLETE_FIELD = 'complete';

export const createGenerateArtifactTool = (fileMap: FileMap | undefined, orchestration: Orchestration) => {
  return tool({
    description:
      "**CRITICAL FUNCTION** - Generates artifacts and returns results for verification. This function processes your changes and waits for validation. You MUST call this to generate output AND check the results. Think of this as 'generate and verify' - you must confirm the generation succeeded before proceeding.",
    inputSchema: z
      .object({
        [GENERATE_ARTIFACT_FIELDS.ID]: z.string().optional().describe('kebab-case identifier (e.g., platformer-game)'),
        [GENERATE_ARTIFACT_FIELDS.TITLE]: z
          .string()
          .min(1)
          .max(80)
          .optional()
          .describe('Descriptive title of the artifact.'),
        [GENERATE_ARTIFACT_FIELDS.SUMMARY]: z
          .string()
          .min(10)
          .max(400)
          .optional()
          .describe('1-3 sentences: what changed and why.'),
        [GENERATE_ARTIFACT_FIELDS.FILE_ACTIONS]: z
          .array(FILE_ACTION_SCHEMA)
          .optional()
          .describe('A list of file creation/update actions.'),
        [GENERATE_ARTIFACT_FIELDS.MODIFY_ACTIONS]: z
          .array(MODIFY_ACTION_SCHEMA)
          .optional()
          .describe('A list of file modification actions.'),
        [GENERATE_ARTIFACT_FIELDS.SHELL_ACTIONS]: z
          .array(SHELL_ACTION_SCHEMA)
          .optional()
          .describe('A list of shell command actions.'),
      })
      .superRefine((_arg, _ctx) => {
        console.log('#### generate artifact schema validation started');
      }),
    async execute(arg) {
      console.log('#### generate artifact tool executed');

      const allPathActions = [
        ...(arg[GENERATE_ARTIFACT_FIELDS.FILE_ACTIONS] || []),
        ...(arg[GENERATE_ARTIFACT_FIELDS.MODIFY_ACTIONS] || []),
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

      const seen = orchestration.readSet;
      const missingPaths = [...need].filter((p) => !seen.has(p));

      const result: any = {};

      if (fileMap && missingPaths.length > 0) {
        console.log('#### generate artifact schema validation failed: missing paths');

        const out: Array<{
          path: string;
          content?: string;
        }> = [];

        for (const path of missingPaths) {
          const raw = getFileContents(fileMap, path);

          if (raw != null) {
            seen.add(path);
            out.push({ path, content: raw });
          }
        }

        result.files = out;
        result.systemMessage = `IMPORTANT: Your previous artifact generation attempt failed because you didn't read these files first: ${missingPaths.join(', ')}. The file contents have been provided in the response. You MUST generate the artifact again with the same changes using the provided file contents.`;
        result[COMPLETE_FIELD] = false;
      } else if (allPathActions.length === 0) {
        console.log('#### generate artifact schema validation failed: no actions');

        if (fileMap && seen.size === 0) {
          result.systemMessage = `Before using the ${TOOL_NAMES.GENERATE_ARTIFACT} tool, you must first read relevant files to understand the codebase context. Use the ${TOOL_NAMES.READ_FILES_CONTENTS} tool to explore related files, then try again.`;
        } else {
          result.systemMessage = 'To fulfill the user request, you must create or modify at least one file.';
        }

        result[COMPLETE_FIELD] = false;
      } else {
        // Mark artifact generation complete - caller must verify results
        orchestration.submitted = true;
        result[COMPLETE_FIELD] = true;
        result.systemMessage = 'Artifact generated. Complete your response immediately.';
      }

      return result;
    },
  });
};
