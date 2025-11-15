import { z } from 'zod/v4';
import { tool } from 'ai';
import { type FileMap, type Orchestration } from '~/lib/.server/llm/constants';
import { getFileContents, getFullPath } from '~/utils/fileUtils';
import { TOOL_NAMES, WORK_DIR } from '~/utils/constants';
import { GENERATE_ARTIFACT_FIELDS, ACTION_FIELDS } from '~/lib/constants/tool-fields';
import { createScopedLogger } from '~/utils/logger';
import { normalizeContent } from '~/utils/stringUtils';

const ACTION_SCHEMA = z.discriminatedUnion('type', [
  z.object({
    [ACTION_FIELDS.TYPE]: z.literal('file'),
    [ACTION_FIELDS.PATH]: z.string().describe('relative-path from cwd'),
    [ACTION_FIELDS.CONTENT]: z.string().describe('complete file content'),
  }),
  z.object({
    [ACTION_FIELDS.TYPE]: z.literal('modify'),
    [ACTION_FIELDS.PATH]: z.string().describe('relative-path from cwd'),
    [ACTION_FIELDS.BEFORE]: z.string().describe('exact text to find in file'),
    [ACTION_FIELDS.AFTER]: z.string().describe('new text to replace with'),
  }),
  z.object({
    [ACTION_FIELDS.TYPE]: z.literal('shell'),
    [ACTION_FIELDS.COMMAND]: z
      .string()
      .describe(
        'shell command to execute. ALLOWED COMMANDS (ONLY): - Package management: bun add <package-name> - File deletion: rm <file-path>',
      ),
  }),
]);

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

// Helper function to check if action is valid path-based action
const isValidPathAction = (action: any): boolean => {
  if (!action) {
    return false;
  }

  if (action[ACTION_FIELDS.TYPE] === 'file') {
    return action[ACTION_FIELDS.PATH] && action[ACTION_FIELDS.CONTENT];
  }

  if (action[ACTION_FIELDS.TYPE] === 'modify') {
    return action[ACTION_FIELDS.PATH] && action[ACTION_FIELDS.BEFORE] && action[ACTION_FIELDS.AFTER];
  }

  return false;
};

export const COMPLETE_FIELD = 'complete';

const logger = createScopedLogger(TOOL_NAMES.GENERATE_ARTIFACT);

export const createGenerateArtifactTool = (fileMap: FileMap | undefined, orchestration: Orchestration) => {
  return tool({
    description:
      "**CRITICAL FUNCTION** - Generates artifacts and returns results for verification. This function processes your changes and waits for validation. You MUST call this to generate output AND check the results. Think of this as 'generate and verify' - you must confirm the generation succeeded before proceeding.",
    inputSchema: z.object({
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
      [GENERATE_ARTIFACT_FIELDS.ACTIONS]: z.array(ACTION_SCHEMA).describe('List of file/modify/shell actions'),
    }),
    async execute(arg) {
      const allPathActions = (arg[GENERATE_ARTIFACT_FIELDS.ACTIONS] || []).filter(isValidPathAction) as Array<{
        [ACTION_FIELDS.PATH]: string;
      }>;

      const need = new Set<string>();

      if (fileMap) {
        for (const action of allPathActions) {
          const needsRead = needReadFile(fileMap, action[ACTION_FIELDS.PATH]);

          if (needsRead) {
            need.add(action[ACTION_FIELDS.PATH]);
          }
        }
      }

      const seen = orchestration.readSet;
      const missingPaths = [...need].filter((p) => !seen.has(p));

      const result: any = {};

      if (fileMap && missingPaths.length > 0) {
        logger.warn('generate artifact schema validation failed: missing paths');
        logger.warn('seen: ', Array.from(seen));
        logger.warn('need: ', Array.from(need));
        logger.warn('missing paths: ', missingPaths);

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
        result.systemMessage = `IMPORTANT: Your previous artifact generation attempt failed because you didn't read these files first: [${missingPaths.map((p) => `"${p}"`).join(', ')}]. The file contents have been provided in the response. You MUST generate the artifact again with the same changes using the provided file contents.`;
        result[COMPLETE_FIELD] = false;
      } else if (allPathActions.length === 0) {
        logger.warn('generate artifact schema validation failed: no actions');

        if (fileMap && seen.size === 0) {
          result.systemMessage = `Before using the ${TOOL_NAMES.GENERATE_ARTIFACT} tool, you must first read relevant files to understand the codebase context. Use the ${TOOL_NAMES.READ_FILES_CONTENTS} tool to explore related files, then try again.`;
        } else {
          result.systemMessage = 'To fulfill the user request, you must create or modify at least one file.';
        }

        result[COMPLETE_FIELD] = false;
      } else if (fileMap) {
        // Validate that 'before' text exists in files for modify actions
        const invalidModifications: Array<{ path: string; before: string }> = [];

        for (const action of arg[GENERATE_ARTIFACT_FIELDS.ACTIONS] || []) {
          if (action[ACTION_FIELDS.TYPE] === 'modify') {
            // Type guard ensures TypeScript knows this is a modify action
            const modifyAction = action as {
              type: 'modify';
              path: string;
              before: string;
              after: string;
            };
            const path = modifyAction[ACTION_FIELDS.PATH];
            const before = modifyAction[ACTION_FIELDS.BEFORE];
            const fileContent = getFileContents(fileMap, path);

            if (fileContent && before) {
              let isIncluded = fileContent.includes(before);

              // If original doesn't match and it's not a markdown file, try normalized content
              if (!isIncluded && !path.endsWith('.md')) {
                const normalizedBefore = normalizeContent(before);
                isIncluded = fileContent.includes(normalizedBefore);
              }

              if (!isIncluded) {
                invalidModifications.push({ path, before });
              }
            }
          }
        }

        if (invalidModifications.length > 0) {
          logger.warn('generate artifact validation failed: before text not found in file');
          logger.warn('invalid modifications: ', JSON.stringify(invalidModifications, null, 2));

          const errorDetails = invalidModifications
            .map(({ path, before }) => {
              const preview = before.length > 100 ? before.substring(0, 100) + '...' : before;
              return `  • File "${path}": The specified 'before' text does not exist in the file\n    Preview of what you tried: "${preview}"`;
            })
            .join('\n');

          result.systemMessage = `CRITICAL ERROR: The '${ACTION_FIELDS.BEFORE}' text must exist in the file EXACTLY as written. These modifications will fail:\n\n${errorDetails}\n\nYou have already read these files, but the '${ACTION_FIELDS.BEFORE}' text you provided does not match the actual file content.\n\nYou MUST:\n1. Carefully review the file content you already read\n2. Find the EXACT text you want to replace (character by character, including all whitespace)\n3. Copy it EXACTLY without any changes or assumptions\n4. Paste it into the '${ACTION_FIELDS.BEFORE}' field\n5. Try again with the correct exact text from the file`;
          result[COMPLETE_FIELD] = false;
        } else {
          // Mark artifact generation complete - caller must verify results
          orchestration.submitted = true;
          result[COMPLETE_FIELD] = true;
          result.systemMessage = 'Artifact generated. Complete your response immediately.';
        }
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
