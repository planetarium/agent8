import { createScopedLogger } from '~/utils/logger';
import { z } from 'zod/v4';

const logger = createScopedLogger('error-handle-tool');

export const createUnknownToolHandler = () => {
  return {
    description: '', // Intentionally empty to hide from LLM
    parameters: z.object({
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

export const createInvalidToolArgumentsHandler = () => {
  return {
    description: '', // Intentionally empty to hide from LLM
    parameters: z.object({
      originalTool: z.string(),
      originalArgs: z.string(),
      errorMessage: z.string(),
    }),
    execute: async ({
      originalTool,
      originalArgs,
      errorMessage,
    }: {
      originalTool: string;
      originalArgs: string;
      errorMessage: string;
    }) => {
      logger.warn(`Invalid tool arguments called: ${originalTool}`);

      return {
        result: `An argument error occurred when calling the tool '${originalTool}'. Provided arguments: ${originalArgs}. Error message: ${errorMessage}. Please revise the arguments and try the '${originalTool}' tool again.`,
      };
    },
  };
};
