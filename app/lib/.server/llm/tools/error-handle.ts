import { createScopedLogger } from '~/utils/logger';
import { z } from 'zod/v4';

const logger = createScopedLogger('error-handle-tool');

export const createUnknownToolHandler = () => {
  return {
    description: '', // Intentionally empty to hide from LLM
    inputSchema: z.object({
      originalTool: z.string(),
      originalArgs: z.string(),
    }),
    execute: async ({ originalTool }: { originalTool: string; originalArgs: any }) => {
      logger.warn(`Unknown tool called: ${originalTool}`);
      return {
        result: `Tool '${originalTool}' is not registered. Please use one of the available tools.`,
      };
    },
  };
};

export const createInvalidToolInputHandler = () => {
  return {
    description: '', // Intentionally empty to hide from LLM
    inputSchema: z.object({
      originalTool: z.string(),
    }),
    execute: async ({ originalTool }: { originalTool: string }) => {
      logger.warn(`Invalid tool input called: ${originalTool}`);
      return {
        result: `The arguments provided for the '${originalTool}' tool are invalid. Please review the usage instructions for this tool and try again.`,
      };
    },
  };
};
