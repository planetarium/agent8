import { type ActionFunctionArgs } from '@remix-run/cloudflare';
import { createUIMessageStream, createUIMessageStreamResponse, generateId, type UIMessage } from 'ai';
import { CONTINUE_PROMPT } from '~/lib/common/prompts/prompts';
import { streamText, type Messages, type StreamingOptions } from '~/lib/.server/llm/stream-text';
import { createScopedLogger } from '~/utils/logger';
import { getMCPConfigFromCookie } from '~/lib/api/cookies';
import { createToolSet } from '~/lib/modules/mcp/toolset';
import { withV8AuthUser, type ContextUser, type ContextConsumeUserCredit } from '~/lib/verse8/middleware';
import { extractPropertiesFromMessage } from '~/lib/.server/llm/utils';
import { extractTextContent } from '~/utils/message';
import { ERROR_NAMES, TOOL_NAMES } from '~/utils/constants';
import { isAbortError, LLMRepeatResponseError } from '~/utils/errors';
import { normalizeContent, sanitizeXmlAttributeValue } from '~/utils/stringUtils';
import { COMPLETE_FIELD } from '~/lib/.server/llm/tools/submit-actions';
import {
  SUBMIT_FILE_ACTION_FIELDS,
  SUBMIT_MODIFY_ACTION_FIELDS,
  SUBMIT_SHELL_ACTION_FIELDS,
} from '~/lib/constants/tool-fields';
import type { DataErrorPayload, DataLogPayload, DataProgressPayload } from '~/types/stream-events';

function createDataError(
  reason: DataErrorPayload['data']['reason'],
  message: string,
  metadata?: Record<string, unknown>,
): DataErrorPayload {
  return {
    type: 'data-error',
    transient: true,
    data: {
      type: 'error',
      reason,
      message,
      ...(metadata && { metadata }),
    },
  };
}

function createDataLog(message: string): DataLogPayload {
  return {
    type: 'data-log',
    transient: true,
    data: { message },
  };
}

function createDataProgress(
  status: DataProgressPayload['data']['status'],
  order: number,
  message: string,
  options?: { label?: string; percentage?: number },
): DataProgressPayload {
  return {
    type: 'data-progress',
    transient: true,
    data: {
      type: 'progress',
      status,
      order,
      message,
      ...(options?.label && { label: options.label }),
      ...(options?.percentage !== undefined && { percentage: options.percentage }),
    },
  };
}

function createBoltArtifactXML(id?: string, title?: string, body?: string): string {
  const artifactId = id || 'unknown';
  const artifactTitle = sanitizeXmlAttributeValue(title);
  const artifactBody = body || '';

  return `<boltArtifact id="${artifactId}" title="${artifactTitle}">${artifactBody}</boltArtifact>`;
}

function toBoltSubmitActionsXML(
  artifactCounter: number,
  toolName: (typeof SUBMIT_ACTIONS_TOOLS)[number],
  input: any,
  isSyntaxFix: boolean = false,
) {
  let xmlContent = '';

  if (toolName === TOOL_NAMES.SUBMIT_FILE_ACTION) {
    const normalizedContent = input[SUBMIT_FILE_ACTION_FIELDS.PATH].endsWith('.md')
      ? input[SUBMIT_FILE_ACTION_FIELDS.CONTENT]
      : normalizeContent(input[SUBMIT_FILE_ACTION_FIELDS.CONTENT]);
    xmlContent = `  <boltAction type="file" filePath="${input[SUBMIT_FILE_ACTION_FIELDS.PATH]}">${normalizedContent}</boltAction>`;
  } else if (toolName === TOOL_NAMES.SUBMIT_MODIFY_ACTION) {
    xmlContent = `  <boltAction type="modify" filePath="${input[SUBMIT_MODIFY_ACTION_FIELDS.PATH]}"><![CDATA[${JSON.stringify(input[SUBMIT_MODIFY_ACTION_FIELDS.ITEMS])}]]></boltAction>`;
  } else if (toolName === TOOL_NAMES.SUBMIT_SHELL_ACTION) {
    let command = input[SUBMIT_SHELL_ACTION_FIELDS.COMMAND];

    // Normalize package manager commands to bun
    command = command
      .replace(/^npm add /, 'bun add ')
      .replace(/^yarn add /, 'bun add ')
      .replace(/^pnpm add /, 'bun add ');

    xmlContent = `  <boltAction type="shell">${command}</boltAction>`;
  }

  const artifactId = isSyntaxFix ? `syntax-fix-artifact-${artifactCounter}` : `artifact-${artifactCounter}`;

  return createBoltArtifactXML(artifactId, undefined, xmlContent);
}

export const action = withV8AuthUser(chatAction, { checkCredit: true });

const IGNORE_TOOL_TYPES = ['tool-input-start', 'tool-input-delta', 'tool-input-end'];
const SUBMIT_ACTIONS_TOOLS = [
  TOOL_NAMES.SUBMIT_FILE_ACTION,
  TOOL_NAMES.SUBMIT_MODIFY_ACTION,
  TOOL_NAMES.SUBMIT_SHELL_ACTION,
] as const;
const logger = createScopedLogger('api.chat');

async function chatAction({ context, request }: ActionFunctionArgs) {
  const env = { ...context.cloudflare.env, ...process.env } as Env;
  const { messages, files, isSyntaxFix } = await request.json<{
    messages: Messages;
    files: any;
    promptId?: string;
    contextOptimization: boolean;
    isSyntaxFix?: boolean;
  }>();

  const cookieHeader = request.headers.get('Cookie');

  // Helper function to check if request has been aborted
  const checkAborted = () => {
    if (request.signal.aborted) {
      logger.info('Request aborted by client');
      throw new DOMException('Request aborted by client', ERROR_NAMES.ABORT);
    }
  };

  const cumulativeUsage = {
    completionTokens: 0,
    promptTokens: 0,
    cacheWrite: 0,
    cacheRead: 0,
    totalTokens: 0,
  };

  const extractTextPartsToStringify = (message: UIMessage) => {
    try {
      if (message.parts && Array.isArray(message.parts)) {
        return message.parts.map((part) => JSON.stringify(part)).join(' ');
      }

      return '';
    } catch (error) {
      console.error('extractTextPartsToStringify error:', error, message);
      return '';
    }
  };

  try {
    const mcpConfig = getMCPConfigFromCookie(cookieHeader);
    const mcpToolset = await createToolSet(mcpConfig, (context.user as ContextUser)?.accessToken);
    const mcpTools = mcpToolset.tools;
    logger.debug(`mcpConfig: ${JSON.stringify(mcpConfig)}`);

    const totalMessageContent = messages.reduce((acc, message) => acc + extractTextPartsToStringify(message), '');
    logger.debug(`Total message length: ${totalMessageContent.split(' ').length} words`);

    const messageStream = createUIMessageStream({
      async execute({ writer }) {
        let progressCounter = 1;

        const lastUserMessage = messages.filter((x) => x.role === 'user').pop();

        if (lastUserMessage) {
          writer.write({
            type: 'data-prompt',
            data: {
              role: 'user',
              prompt: extractTextContent(lastUserMessage),
            },
          });
        }

        // Track unsubscribe functions to clean up later if needed
        const progressUnsubscribers: Array<() => void> = [];
        logger.info(`MCP tools count: ${Object.keys(mcpTools).length}`);

        for (const toolName in mcpTools) {
          if (mcpTools[toolName]) {
            const tool = mcpTools[toolName];

            // Subscribe to progress events if emitter is available
            if (tool.progressEmitter) {
              // Subscribe to the tool's progress events
              const unsubscribe = tool.progressEmitter.subscribe((event) => {
                const { type, data, toolName } = event;

                if (type === 'start') {
                  writer.write(
                    createDataProgress('in-progress', progressCounter++, `Tool '${toolName}' execution started`),
                  );
                } else if (type === 'progress') {
                  writer.write(
                    createDataProgress(
                      'in-progress',
                      progressCounter++,
                      `Tool '${toolName}' executing: ${data.status || ''}`,
                      {
                        percentage: data.percentage ? Number(data.percentage) : undefined,
                      },
                    ),
                  );
                } else if (type === 'complete') {
                  writer.write(
                    createDataProgress(
                      data.status === 'failed' ? 'failed' : 'complete',
                      progressCounter++,
                      data.status === 'failed'
                        ? `Tool '${toolName}' execution failed`
                        : `Tool '${toolName}' execution completed`,
                    ),
                  );

                  // Automatically unsubscribe after complete
                  unsubscribe();
                }
              });

              progressUnsubscribers.push(unsubscribe);
              logger.info(`Subscribed to progress events for tool: ${toolName}`);
            }
          }
        }

        const options: StreamingOptions = {
          toolChoice: 'auto',
          onFinish: async ({ text: content, finishReason, totalUsage, providerMetadata }) => {
            const inputTokens = totalUsage?.inputTokens || 0;
            const cachedInputTokens = totalUsage?.cachedInputTokens || 0;
            const cachedRatio =
              inputTokens > 0 && cachedInputTokens > 0 ? cachedInputTokens / (inputTokens + cachedInputTokens) : 0;
            logger.info(
              `finishReason: ${finishReason}, inputTokens: ${inputTokens}, cachedInputTokens: ${cachedInputTokens}, cachedPercentage: ${Math.round(cachedRatio * 100)}%`,
            );

            const lastUserMessage = messages.filter((x) => x.role == 'user').slice(-1)[0];

            const { model, provider } = extractPropertiesFromMessage(lastUserMessage);

            if (totalUsage) {
              cumulativeUsage.promptTokens += totalUsage.inputTokens || 0;
              cumulativeUsage.completionTokens += (totalUsage.outputTokens || 0) + (totalUsage.reasoningTokens || 0);
              cumulativeUsage.totalTokens += totalUsage.totalTokens || 0;
            }

            if (providerMetadata?.anthropic) {
              const { cacheCreationInputTokens } = providerMetadata.anthropic;

              cumulativeUsage.cacheWrite += Number(cacheCreationInputTokens || 0);
            }

            cumulativeUsage.cacheRead += cachedInputTokens;

            if (finishReason !== 'length') {
              writer.write({
                type: 'finish',
                messageMetadata: {
                  type: 'usage',
                  value: {
                    completionTokens: cumulativeUsage.completionTokens,
                    promptTokens: cumulativeUsage.promptTokens,
                    totalTokens: cumulativeUsage.totalTokens,
                    cacheWrite: cumulativeUsage.cacheWrite,
                    cacheRead: cumulativeUsage.cacheRead,
                  },
                },
              });

              writer.write(
                createDataProgress('complete', progressCounter++, 'Response Generated', { label: 'response' }),
              );
              await new Promise((resolve) => setTimeout(resolve, 0));

              try {
                const consumeUserCredit = context.consumeUserCredit as ContextConsumeUserCredit;
                await consumeUserCredit({
                  model: { provider, name: model },
                  inputTokens: cumulativeUsage.promptTokens,
                  outputTokens: cumulativeUsage.completionTokens,
                  cacheRead: cumulativeUsage.cacheRead,
                  cacheWrite: cumulativeUsage.cacheWrite,
                  description: `Generate Response`,
                });
              } catch (error) {
                logger.error('Failed to consume user credit:', error);
                writer.write(
                  createDataError(
                    'credit-consume',
                    error instanceof Error ? error.message : 'Failed to consume user credit',
                  ),
                );
              }

              return;
            }

            // Only add assistant message if content is not empty
            if (content && content.trim().length > 0) {
              messages.push({ id: generateId(), role: 'assistant', parts: [{ type: 'text', text: content }] });
            }

            messages.push({
              id: generateId(),
              role: 'user',
              parts: [{ type: 'text', text: `[Model: ${model}]\n\n[Provider: ${provider}]\n\n${CONTINUE_PROMPT}` }],
            });

            checkAborted();

            const result = await streamText({
              messages,
              env,
              options,
              files,
              tools: mcpTools,
              abortSignal: request.signal,
            });

            try {
              const uiStream = result.toUIMessageStream({ sendReasoning: false });
              const reader = uiStream.getReader();

              while (true) {
                checkAborted();

                const { done, value } = await reader.read();

                if (done) {
                  break;
                }

                writer.write(value);
              }
            } catch (error) {
              // AbortError is expected when client disconnects
              if (isAbortError(error)) {
                logger.info('Continuation streaming aborted by client');
                return;
              }

              writer.write(
                createDataError(
                  'stream-processing-continuation',
                  error instanceof Error ? error.message : 'Stream processing continuation failed',
                ),
              );
            }

            return;
          },
        };

        writer.write(
          createDataProgress('in-progress', progressCounter++, 'Generating Response', { label: 'response' }),
        );

        writer.write(createDataLog('StartLLM'));

        checkAborted();

        const result = await streamText({
          messages,
          env,
          options,
          files,
          tools: mcpTools,
          abortSignal: request.signal,
          onDebugLog: (message) => {
            writer.write(createDataLog(message));
          },
        });

        writer.write(createDataLog('EndLLM'));

        try {
          writer.write(createDataLog('ToUIMessageStream'));

          const uiStream = result.toUIMessageStream({ sendReasoning: false });

          writer.write(createDataLog('GetReader'));

          const reader = uiStream.getReader();

          writer.write(createDataLog('StartLoop'));

          let prevLogMessage: string | null = null;

          // Step-level repeat detection
          let currentStepContent = '';
          let previousStepContent = '';
          let consecutiveRepeatCount = 0;
          const MAX_CONSECUTIVE_REPEATS = 2;

          // Text-delta repeat detection (within a single step)
          let textDeltaHistory: string[] = [];
          const MAX_TEXT_DELTA_REPEATS = 2;
          const MIN_DELTA_LENGTH_FOR_REPEAT_CHECK = 10;
          const MAX_TEXT_DELTA_HISTORY_SIZE = 20;

          while (true) {
            checkAborted();

            const { done, value } = await reader.read();

            if (done) {
              writer.write(createDataLog('LoopDone'));
              break;
            }

            const messageType = value.type;

            // Step start: begin content collection
            if (messageType === 'start-step') {
              currentStepContent = '';
            }

            // Reset text-delta history when non-text-delta message arrives
            if (messageType !== 'text-delta') {
              textDeltaHistory = [];
            }

            // Collect step content
            if (messageType === 'text-delta' && 'delta' in value) {
              const delta = value.delta || '';
              currentStepContent += delta;

              // Check for repeated content (3+ same deltas in recent 20, only for deltas >= 10 chars)
              if (delta.length >= MIN_DELTA_LENGTH_FOR_REPEAT_CHECK) {
                textDeltaHistory.push(delta);

                if (textDeltaHistory.length > MAX_TEXT_DELTA_HISTORY_SIZE) {
                  textDeltaHistory.shift();
                }

                const repeatCount = textDeltaHistory.filter((h) => h === delta).length;

                if (repeatCount > MAX_TEXT_DELTA_REPEATS) {
                  throw new LLMRepeatResponseError();
                }
              }
            } else if (messageType === 'tool-input-available' && 'toolName' in value && 'input' in value) {
              try {
                currentStepContent += `tool:${value.toolName}:${JSON.stringify(value.input)}`;
              } catch {
                currentStepContent += `tool:${value.toolName}:[unstringifiable]`;
              }
            }

            // Step end: compare with previous step
            if (messageType === 'finish-step') {
              if (currentStepContent && currentStepContent === previousStepContent) {
                consecutiveRepeatCount++;

                if (consecutiveRepeatCount >= MAX_CONSECUTIVE_REPEATS) {
                  throw new LLMRepeatResponseError();
                }
              } else {
                consecutiveRepeatCount = 0;
              }

              previousStepContent = currentStepContent;
            }

            let logMessage: string = value.type ?? 'unknown';
            logMessage = logMessage.replace('tool-input', 't-i');
            logMessage = logMessage.replace('tool-output', 't-o');
            logMessage = logMessage.replace('text-delta', 't-d');

            if ('toolName' in value && value.toolName) {
              logMessage += `: ${value.toolName}`;
            }

            if (logMessage !== prevLogMessage) {
              writer.write(createDataLog(logMessage));
              prevLogMessage = logMessage;
            }

            writer.write(value);
          }
        } catch (error) {
          // AbortError is expected when client disconnects
          if (isAbortError(error)) {
            logger.info('Stream processing aborted by client');
            return;
          }

          // LLM repeat response error
          if (error instanceof LLMRepeatResponseError) {
            logger.info('LLM repeat response detected');
            writer.write(createDataError('llm-repeat-response', error.message));

            return;
          }

          writer.write(
            createDataError('stream-processing', error instanceof Error ? error.message : 'Stream processing failed'),
          );
        }
      },
      onError: (error: unknown) => {
        const message = (error as Error).message;

        if (message?.includes('Overloaded')) {
          return `Custom error: ${message}. Please try changing the model.`;
        }

        return `Custom error: ${message}`;
      },
    }).pipeThrough(
      new TransformStream({
        transform: (() => {
          let artifactCounter = 0;
          const submitActionsInputs = new Map<
            string,
            { toolName: (typeof SUBMIT_ACTIONS_TOOLS)[number]; input: unknown }
          >();

          return (chunk, controller) => {
            try {
              const messageType = chunk.type;

              // reasoning message
              switch (messageType) {
                case 'reasoning-start': {
                  controller.enqueue({
                    type: 'text-start',
                    id: chunk.id,
                  });

                  controller.enqueue({
                    type: 'text-delta',
                    id: chunk.id,
                    delta: '<div class="__boltThought__">',
                  });
                  break;
                }

                case 'reasoning-delta': {
                  const sanitizedDelta = chunk.delta.replace(/\[REDACTED\]/g, '');

                  controller.enqueue({
                    type: 'text-delta',
                    id: chunk.id,
                    delta: sanitizedDelta,
                  });

                  break;
                }

                case 'reasoning-end': {
                  controller.enqueue({
                    type: 'text-delta',
                    id: chunk.id,
                    delta: '</div>\n',
                  });

                  controller.enqueue({
                    type: 'text-end',
                    id: chunk.id,
                  });

                  break;
                }

                // tool call message
                case 'tool-input-available': {
                  if (SUBMIT_ACTIONS_TOOLS.includes(chunk.toolName as (typeof SUBMIT_ACTIONS_TOOLS)[number])) {
                    submitActionsInputs.set(chunk.toolCallId, {
                      toolName: chunk.toolName as (typeof SUBMIT_ACTIONS_TOOLS)[number],
                      input: chunk.input,
                    });

                    break;
                  }

                  const toolCall = {
                    toolCallId: chunk.toolCallId,
                    toolName: chunk.toolName,
                    input: chunk.input,
                  };

                  const divString = `\n<toolCall><div class="__toolCall__" id="${chunk.toolCallId}">\`${JSON.stringify(toolCall).replaceAll('`', '&grave;')}\`</div></toolCall>\n`;

                  controller.enqueue({
                    type: 'text-start',
                    id: toolCall.toolCallId,
                  });

                  controller.enqueue({
                    type: 'text-delta',
                    id: toolCall.toolCallId,
                    delta: divString,
                  });

                  controller.enqueue({
                    type: 'text-end',
                    id: toolCall.toolCallId,
                  });

                  break;
                }

                // tool result message
                case 'tool-output-available': {
                  if (submitActionsInputs.has(chunk.toolCallId)) {
                    const { toolName, input } = submitActionsInputs.get(chunk.toolCallId)!;
                    submitActionsInputs.delete(chunk.toolCallId);

                    if (!(chunk.output as any)?.[COMPLETE_FIELD]) {
                      break;
                    }

                    const xmlContent = toBoltSubmitActionsXML(++artifactCounter, toolName, input, isSyntaxFix);
                    controller.enqueue({
                      type: 'text-start',
                      id: chunk.toolCallId,
                    });

                    controller.enqueue({
                      type: 'text-delta',
                      id: chunk.toolCallId,
                      delta: '\n' + xmlContent + '\n',
                    });

                    controller.enqueue({
                      type: 'text-end',
                      id: chunk.toolCallId,
                    });

                    break;
                  }

                  const toolResult = {
                    toolCallId: chunk.toolCallId,
                    result: chunk.output,
                  };

                  const divString = `\n<toolResult><div class="__toolResult__" id="${chunk.toolCallId}">\`${JSON.stringify(toolResult).replaceAll('`', '&grave;')}\`</div></toolResult>\n`;

                  controller.enqueue({
                    type: 'text-start',
                    id: toolResult.toolCallId,
                  });

                  controller.enqueue({
                    type: 'text-delta',
                    id: toolResult.toolCallId,
                    delta: divString,
                  });

                  controller.enqueue({
                    type: 'text-end',
                    id: toolResult.toolCallId,
                  });

                  break;
                }

                case 'tool-output-error': {
                  // Skip submit actions.
                  if (submitActionsInputs.has(chunk.toolCallId)) {
                    break;
                  }

                  const toolResult = {
                    toolCallId: chunk.toolCallId,
                    result: chunk.errorText,
                  };

                  const divString = `\n<toolResult><div class="__toolResult__" id="${chunk.toolCallId}">\`${JSON.stringify(toolResult).replaceAll('`', '&grave;')}\`</div></toolResult>\n`;

                  controller.enqueue({
                    type: 'text-start',
                    id: toolResult.toolCallId,
                  });

                  controller.enqueue({
                    type: 'text-delta',
                    id: toolResult.toolCallId,
                    delta: divString,
                  });

                  controller.enqueue({
                    type: 'text-end',
                    id: toolResult.toolCallId,
                  });
                  break;
                }

                default: {
                  if (!IGNORE_TOOL_TYPES.includes(messageType)) {
                    controller.enqueue(chunk);
                  }

                  break;
                }
              }
            } catch (err) {
              const chunkAny = chunk as any;
              const chunkMeta = {
                type: chunkAny?.type,
                id: chunkAny?.id,
                toolName: chunkAny?.toolName,
                toolCallId: chunkAny?.toolCallId,
              };
              const message = err instanceof Error ? err.message : String(err);

              logger.error('[ui-stream transform error]', chunkMeta, err);

              try {
                controller.enqueue(createDataError('transform-stream', message, chunkMeta));
              } catch (enqueueError) {
                logger.error('[ui-stream transform] failed to enqueue data-error', enqueueError);
              }
            }
          };
        })(),
      }),
    );

    return createUIMessageStreamResponse({
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        Connection: 'keep-alive',
        'Cache-Control': 'no-cache',
        'Text-Encoding': 'chunked',
      },
      stream: messageStream,
    });
  } catch (error: any) {
    logger.error(error);

    if (error.message?.includes('API key')) {
      throw new Response('Invalid or missing API key', {
        status: 401,
        statusText: 'Unauthorized',
      });
    }

    throw new Response(null, {
      status: 500,
      statusText: 'Internal Server Error',
    });
  }
}
