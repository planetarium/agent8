import { z } from 'zod/v4';
import { tool } from 'ai';
import type { FileMap, Orchestration } from '~/lib/.server/llm/constants';
import { getFileContents, getFullPath } from '~/utils/fileUtils';
import { TOOL_NAMES, WORK_DIR } from '~/utils/constants';

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
    description: 'Submit the final artifact. Call this tool with JSON instead of outputting tags as text.',
    inputSchema: z
      .object({
        id: z.string().optional().describe('kebab-case identifier (e.g., platformer-game)'),
        title: z.string().optional().describe('Descriptive title of the artifact'),
        actions: z
          .array(
            z.union([
              z.object({
                type: z.literal('file'),
                filePath: z.string().describe('Relative path from cwd'),
                content: z.string().describe('Complete file content'),
              }),
              z.object({
                type: z.literal('modify'),
                filePath: z.string().describe('Relative path from cwd'),
                modifications: z
                  .array(
                    z.object({
                      before: z.string().describe('Exact text to find in file'),
                      after: z.string().describe('New text to replace with'),
                    }),
                  )
                  .describe('List of text replacements'),
              }),
              z.object({
                type: z.literal('shell'),
                command: z.string().describe('Shell command to execute'),
              }),
            ]),
          )
          .describe('List of file/modify/shell actions'),
      })
      .superRefine((val, ctx) => {
        const need = new Set<string>();

        if (fileMap) {
          for (const action of val.actions) {
            if (action.type === 'file' && action.filePath && action.content) {
              if (needReadFile(fileMap, action.filePath)) {
                need.add(action.filePath);
              }
            } else if (action.type === 'modify' && action.filePath && action.modifications) {
              if (needReadFile(fileMap, action.filePath)) {
                need.add(action.filePath);
              }
            }
          }
        }

        const missingPaths = [...need].filter((p) => !orchestration.readSet.has(p));

        if (missingPaths.length) {
          ctx.addIssue({
            code: 'custom',
            path: ['actions'],
            message: JSON.stringify({
              name: 'NEED_READ_FILES',
              reason: 'You attempted to submit without reading all existing files referenced by file/modify actions.',
              missingPaths,
              nextAction: {
                tool: TOOL_NAMES.READ_FILES_CONTENTS,
                args: { paths: missingPaths },
                then: `call ${TOOL_NAMES.SUBMIT_ARTIFACT} again with the same payload, adding any newly read file contents if needed.`,
              },
            }),
          });
        }
      }),
    async execute() {
      orchestration.submitted = true;

      return { ok: true };
    },
  });
};
