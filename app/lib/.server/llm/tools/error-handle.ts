import { createScopedLogger } from '~/utils/logger';
import { TOOL_NAMES } from '~/utils/constants';
import { jsonSchema } from 'ai';

const logger = createScopedLogger('error-handle-tool');

export const createUnknownToolHandler = () => {
  return {
    [TOOL_NAMES.UNKNOWN_HANDLER]: {
      description: '', // Intentionally empty to hide from LLM
      inputSchema: jsonSchema({
        type: 'object',
        properties: {
          originalTool: { type: 'string' },
          originalArgs: { type: 'string' },
        },
        required: ['originalTool', 'originalArgs'],
        additionalProperties: false,
      }),
      execute: async ({ originalTool }: { originalTool: string; originalArgs: any }) => {
        logger.warn(`Unknown tool called: ${originalTool}`);
        return {
          result: `Tool '${originalTool}' is not registered. Please use one of the available tools.`,
        };
      },
    },
  };
};
