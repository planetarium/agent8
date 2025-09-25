import { jsonSchema } from 'ai';
import { TOOL_NAMES } from '~/utils/constants';

export const createSubmitArtifactActionTool = () => {
  return {
    [TOOL_NAMES.SUBMIT_ARTIFACT]: {
      description: 'Submit the final artifact. Call this tool with JSON instead of outputting tags as text.',
      inputSchema: jsonSchema({
        type: 'object',
        properties: {
          id: { type: 'string', description: 'kebab-case identifier (e.g., platformer-game)' },
          title: { type: 'string', description: 'Descriptive title of the artifact' },
          actions: {
            type: 'array',
            description: 'List of file/shell actions',
            items: {
              oneOf: [
                {
                  type: 'object',
                  properties: {
                    type: { const: 'file' },
                    filePath: { type: 'string', description: 'Relative path from cwd' },
                    content: { type: 'string', description: 'Complete file content' },
                  },
                  required: ['type', 'filePath', 'content'],
                  additionalProperties: false,
                },
                {
                  type: 'object',
                  properties: {
                    type: { const: 'shell' },
                    command: { type: 'string', description: 'Shell command to execute' },
                  },
                  required: ['type', 'command'],
                  additionalProperties: false,
                },
              ],
            },
          },
        },
        required: ['id', 'title', 'actions'],
        additionalProperties: false,
      }),
    },
  };
};
