import { createScopedLogger } from '~/utils/logger';
import { z } from 'zod/v4';

const logger = createScopedLogger('error-handle-tool');

const REGEX_ERROR_MESSAGES = {
  NOTHING_TO_REPEAT: 'nothing to repeat',
  UNTERMINATED_CHARACTER_CLASS: 'unterminated character class',
  UNTERMINATED_GROUP: 'unterminated group',
} as const;

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
      originalArgs: any;
      errorMessage: string;
    }) => {
      logger.warn(`Invalid tool arguments called: ${originalTool}`);

      const lowerErrorMessage = errorMessage.toLowerCase();
      const pattern = originalArgs;

      // Case 1: Leading quantifier
      if (lowerErrorMessage.includes(REGEX_ERROR_MESSAGES.NOTHING_TO_REPEAT) && pattern.match(/^[*+?]/)) {
        const literalPattern = `\\${pattern}`;
        const removedPattern = pattern.substring(1);

        return {
          problem: `패턴이 수량자로 시작: \`${pattern}\``,
          solution: `옵션1) \`${literalPattern}\` (리터럴) 또는 옵션2) \`${removedPattern}\` (제거)`,
          action: `수정된 pattern으로 ${originalTool} 툴을 다시 호출하세요.`,
        };
      }

      // Case 2: Unclosed bracket
      if (lowerErrorMessage.includes(REGEX_ERROR_MESSAGES.UNTERMINATED_CHARACTER_CLASS)) {
        const fixedPattern = pattern.replace(/\[/g, '\\[');
        return {
          problem: `닫히지 않은 대괄호: \`${pattern}\``,
          solution: `\`${fixedPattern}\``,
          action: `수정된 pattern으로 ${originalTool} 툴을 다시 호출하세요.`,
        };
      }

      // Case 3: Unclosed parenthesis
      if (lowerErrorMessage.includes(REGEX_ERROR_MESSAGES.UNTERMINATED_GROUP)) {
        const hasOtherMetaChars = /[.*+?^${}|[\]\\]/.test(pattern.replace(/\(/g, ''));

        if (hasOtherMetaChars) {
          const escapedPattern = pattern.replace(/[.*+?^${}()[\]\\|]/g, '\\$&');
          return {
            problem: `닫히지 않은 괄호와 특수 문자 포함: \`${pattern}\``,
            solution: `\`${escapedPattern}\``,
            action: `수정된 pattern으로 searchFileContents 툴을 다시 호출하세요.`,
          };
        } else {
          const fixedPattern = pattern.replace(/\(/g, '\\(');
          return {
            problem: `닫히지 않은 괄호: \`${pattern}\``,
            solution: `\`${fixedPattern}\``,
            action: `수정된 pattern으로 searchFileContents 툴을 다시 호출하세요.`,
          };
        }
      }

      // Unknown case
      return {
        problem: `유효하지 않은 정규식: \`${pattern}\` (${errorMessage})`,
        solution: `특수 문자 이스케이프 필요. 원본 인자:\n\`\`\`json\n${JSON.stringify(originalArgs, null, 2)}\n\`\`\``,
        action: `pattern을 수정한 후 ${originalTool} 을 다시 호출하세요.`,
      };
    },
  };
};
