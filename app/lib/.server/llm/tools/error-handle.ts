import { z } from 'zod/v4';
import { createScopedLogger } from '~/utils/logger';
import { TOOL_NAMES } from '~/utils/constants';

const logger = createScopedLogger('error-handle-tool');

export const createUnknownToolHandler = () => {
  return {
    [TOOL_NAMES.UNKNOWN_HANDLER]: {
      description: '', // Intentionally empty to hide from LLM
      parameters: z.object({
        originalTool: z.string(),
        originalArgs: z.any(),
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
