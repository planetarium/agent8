import { z } from 'zod/v4';
import { InvalidToolInputError, tool } from 'ai';
import { TOOL_ERROR, type FileMap, type Orchestration } from '~/lib/.server/llm/constants';
import { getFileContents, getFullPath } from '~/utils/fileUtils';
import { TOOL_NAMES, WORK_DIR } from '~/utils/constants';

const ACTION_SCHEMA = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('file'),
    path: z.string().describe('Relative path from cwd'),
    content: z.string().describe('Complete file content'),
  }),
  z.object({
    type: z.literal('modify'),
    path: z.string().describe('Relative path from cwd'),
    modifications: z.array(
      z.object({
        before: z.string().describe('Exact text to find in file'),
        after: z.string().describe('New text to replace with'),
      }),
    ),
  }),
  z.object({
    type: z.literal('shell'),
    command: z.string().describe('Shell command to execute'),
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

export const createSubmitArtifactActionTool = (fileMap: FileMap | undefined, orchestration: Orchestration) => {
  return tool({
    description: 'Submit the result or artifact for the request. Must be called.',
    inputSchema: z
      .object({
        id: z.string().optional().describe('kebab-case identifier (e.g., platformer-game)'),
        title: z.string().optional().describe('Descriptive title of the artifact'),
        actions: z.array(ACTION_SCHEMA).describe('List of file/modify/shell actions'),
      })
      .superRefine((arg, _ctx) => {
        const need = new Set<string>();

        if (fileMap) {
          for (const action of arg.actions) {
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
