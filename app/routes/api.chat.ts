import { type ActionFunctionArgs } from '@remix-run/cloudflare';
import { createUIMessageStream, createUIMessageStreamResponse, generateId, type UIMessage } from 'ai';
import { MAX_RESPONSE_SEGMENTS, MAX_TOKENS } from '~/lib/.server/llm/constants';
import { CONTINUE_PROMPT } from '~/lib/common/prompts/prompts';
import { streamText, type Messages, type StreamingOptions } from '~/lib/.server/llm/stream-text';
import { createScopedLogger } from '~/utils/logger';
import { getMCPConfigFromCookie } from '~/lib/api/cookies';
import { createToolSet } from '~/lib/modules/mcp/toolset';
import { withV8AuthUser, type ContextUser, type ContextConsumeUserCredit } from '~/lib/verse8/middleware';
import { extractPropertiesFromMessage } from '~/lib/.server/llm/utils';
import type { ProgressAnnotation } from '~/types/context';
import { extractTextContent } from '~/utils/message';
import SwitchableStream from '~/lib/.server/llm/switchable-stream';
import { TOOL_NAMES } from '~/utils/constants';
import { normalizeContent, sanitizeXmlAttributeValue } from '~/utils/stringUtils';
import { COMPLETE_FIELD } from '~/lib/.server/llm/tools/submit-actions';
import {
  SUBMIT_FILE_ACTION_FIELDS,
  SUBMIT_MODIFY_ACTION_FIELDS,
  SUBMIT_SHELL_ACTION_FIELDS,
} from '~/lib/constants/tool-fields';

function createBoltArtifactXML(id?: string, title?: string, body?: string): string {
  const artifactId = id || 'unknown';
  const artifactTitle = sanitizeXmlAttributeValue(title);
  const artifactBody = body || '';

  return `<boltArtifact id="${artifactId}" title="${artifactTitle}">${artifactBody}</boltArtifact>`;
}

function toBoltSubmitActionsXML(artifactCounter: number, toolName: (typeof SUBMIT_ACTIONS_TOOLS)[number], input: any) {
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

  return createBoltArtifactXML(`artifact-${artifactCounter}`, undefined, xmlContent);
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
  const { messages, files } = await request.json<{
    messages: Messages;
    files: any;
    promptId?: string;
    contextOptimization: boolean;
  }>();

  const cookieHeader = request.headers.get('Cookie');

  const stream = new SwitchableStream();

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
                  writer.write({
                    type: 'data-progress',
                    transient: true,
                    data: {
                      type: 'progress',
                      status: 'in-progress',
                      order: progressCounter++,
                      message: `Tool '${toolName}' execution started`,
                    } as any,
                  });
                } else if (type === 'progress') {
                  writer.write({
                    type: 'data-progress',
                    transient: true,
                    data: {
                      type: 'progress',
                      status: 'in-progress',
                      order: progressCounter++,
                      message: `Tool '${toolName}' executing: ${data.status || ''}`,
                      percentage: data.percentage ? Number(data.percentage) : undefined,
                    } as any,
                  });
                } else if (type === 'complete') {
                  writer.write({
                    type: 'data-progress',
                    transient: true,
                    data: {
                      type: 'progress',
                      status: data.status === 'failed' ? 'failed' : 'complete',
                      order: progressCounter++,
                      message:
                        data.status === 'failed'
                          ? `Tool '${toolName}' execution failed`
                          : `Tool '${toolName}' execution completed`,
                    },
                  } as any);

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
            logger.info(`finishReason: ${finishReason}`);
            logger.info(`cachedInputTokens: ${totalUsage?.cachedInputTokens}`);

            const lastUserMessage = messages.filter((x) => x.role == 'user').slice(-1)[0];

            const { model, provider } = extractPropertiesFromMessage(lastUserMessage);

            if (totalUsage) {
              cumulativeUsage.promptTokens += totalUsage.inputTokens || 0;
              cumulativeUsage.completionTokens += (totalUsage.outputTokens || 0) + (totalUsage.reasoningTokens || 0);
              cumulativeUsage.totalTokens += totalUsage.totalTokens || 0;
            }

            if (providerMetadata?.anthropic) {
              const { cacheCreationInputTokens, cacheReadInputTokens } = providerMetadata.anthropic;

              cumulativeUsage.cacheWrite += Number(cacheCreationInputTokens || 0);
              cumulativeUsage.cacheRead += Number(cacheReadInputTokens || 0);
            }

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

              writer.write({
                type: 'data-progress',
                transient: true,
                data: {
                  type: 'progress',
                  label: 'response',
                  status: 'complete',
                  order: progressCounter++,
                  message: 'Response Generated',
                } as ProgressAnnotation,
              });
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

                writer.write({
                  type: 'data-error',
                  data: {
                    type: 'error',
                    reason: 'credit-consume',
                    message: error instanceof Error ? error.message : 'Failed to consume user credit',
                  },
                });
              }

              // stream.close();
              return;
            }

            if (stream.switches >= MAX_RESPONSE_SEGMENTS) {
              throw Error('Cannot continue message: Maximum segments reached');
            }

            const switchesLeft = MAX_RESPONSE_SEGMENTS - stream.switches;

            logger.info(`Reached max token limit (${MAX_TOKENS}): Continuing message (${switchesLeft} switches left)`);

            // Only add assistant message if content is not empty
            if (content && content.trim().length > 0) {
              messages.push({ id: generateId(), role: 'assistant', parts: [{ type: 'text', text: content }] });
            }

            messages.push({
              id: generateId(),
              role: 'user',
              parts: [{ type: 'text', text: `[Model: ${model}]\n\n[Provider: ${provider}]\n\n${CONTINUE_PROMPT}` }],
            });

            const result = await streamText({
              messages,
              env,
              options,
              files,
              tools: mcpTools,
              abortSignal: request.signal,
            });

            writer.merge(result.toUIMessageStream({ sendReasoning: false }));

            return;
          },
        };

        writer.write({
          type: 'data-progress',
          transient: true,
          data: {
            type: 'progress',
            label: 'response',
            status: 'in-progress',
            order: progressCounter++,
            message: 'Generating Response',
          } as ProgressAnnotation,
        });

        const result = await streamText({
          messages,
          env,
          options,
          files,
          tools: mcpTools,
          abortSignal: request.signal,
        });

        writer.merge(result.toUIMessageStream({ sendReasoning: false }));
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

                  const xmlContent = toBoltSubmitActionsXML(++artifactCounter, toolName, input);
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
