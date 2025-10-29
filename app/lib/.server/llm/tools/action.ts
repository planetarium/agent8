import { z } from 'zod/v4';
import { InvalidToolInputError, tool } from 'ai';
import { TOOL_ERROR, type FileMap, type Orchestration } from '~/lib/.server/llm/constants';
import { getFileContents, getFullPath } from '~/utils/fileUtils';
import { TOOL_NAMES, WORK_DIR } from '~/utils/constants';

const ACTION_SCHEMA = z.object({
  type: z.enum(['file', 'modify', 'shell']),
  path: z.string().optional(),
  content: z.string().optional(),
  modifications: z.array(z.object({ before: z.string(), after: z.string() })).optional(),
  command: z.string().optional(),
});

const ACTIONS_SCHEMA = z.array(ACTION_SCHEMA);

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
        id: z.string().optional().describe('kebab-case identifier (e.g., platformer-game)'),
        title: z
          .string()
          .min(1)
          .max(80)
          .optional()
          .describe('Descriptive title of the artifact. IMPORTANT: Do not use double quotes (") in the title.'),
        summary: z.string().min(10).max(400).optional().describe('1-3 sentences: what changed and why.'),
        actions: z.string().describe('A JSON-stringified array of file/modify/shell actions.'),
      })
      .superRefine((arg, _ctx) => {
        let parsedActions;

        try {
          parsedActions = JSON.parse(arg.actions);
        } catch {
          throw new InvalidToolInputError({
            toolInput: arg.actions,
            toolName: TOOL_NAMES.SUBMIT_ARTIFACT,
            cause: TOOL_ERROR.INVALID_JSON,
            message: 'The "actions" field must be a valid JSON string.',
          });
        }

        const actionsToValidate = Array.isArray(parsedActions) ? parsedActions : [parsedActions];
        const validationResult = ACTIONS_SCHEMA.safeParse(actionsToValidate);

        if (!validationResult.success) {
          throw new InvalidToolInputError({
            toolInput: arg.actions,
            toolName: TOOL_NAMES.SUBMIT_ARTIFACT,
            cause: TOOL_ERROR.SCHEMA_VALIDATION_FAILED,
            message: `Invalid "actions" structure: ${JSON.stringify(z.treeifyError(validationResult.error))}`,
          });
        }

        const validatedActions = validationResult.data;
        const need = new Set<string>();

        if (fileMap) {
          for (const action of validatedActions) {
            if (action.type === 'file' && action.path && action.content) {
              if (needReadFile(fileMap, action.path)) {
                need.add(action.path);
              }
            } else if (action.type === 'modify' && action.path && action.modifications) {
              if (needReadFile(fileMap, action.path)) {
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
