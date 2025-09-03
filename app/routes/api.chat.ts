import { type ActionFunctionArgs } from '@remix-run/cloudflare';
import { createUIMessageStream, createUIMessageStreamResponse, generateId } from 'ai';
import { MAX_RESPONSE_SEGMENTS, MAX_TOKENS } from '~/lib/.server/llm/constants';
import { CONTINUE_PROMPT } from '~/lib/common/prompts/prompts';
import { streamText, type Messages, type StreamingOptions } from '~/lib/.server/llm/stream-text';
import { createScopedLogger } from '~/utils/logger';
import { getMCPConfigFromCookie } from '~/lib/api/cookies';
import { createToolSet } from '~/lib/modules/mcp/toolset';
import { withV8AuthUser, type ContextUser, type ContextConsumeUserCredit } from '~/lib/verse8/middleware';
import { extractTextContent } from '~/utils/message';
import { extractPropertiesFromMessage } from '~/lib/.server/llm/utils';
import type { ProgressAnnotation } from '~/types/context';
import SwitchableStream from '~/lib/.server/llm/switchable-stream';

export const action = withV8AuthUser(chatAction, { checkCredit: true });

const logger = createScopedLogger('api.chat');

async function chatAction({ context, request }: ActionFunctionArgs) {
  const env = { ...context.cloudflare.env, ...process.env } as Env;
  const { messages, files } = await request.json<{
    messages: Messages;
    files: any;
    promptId?: string;
    contextOptimization: boolean;
  }>();

  // Debug: files 데이터 수신 상태 확인
  logger.info('[DEBUG] API Chat - Received files data:', {
    filesCount: files ? Object.keys(files).length : 0,
    filesKeys: files ? Object.keys(files).slice(0, 5) : [], // 처음 5개만 표시
    hasFiles: !!files && Object.keys(files).length > 0,
    firstFileExample:
      files && Object.keys(files).length > 0
        ? { path: Object.keys(files)[0], type: files[Object.keys(files)[0]]?.type }
        : null,
  });

  const cookieHeader = request.headers.get('Cookie');

  const stream = new SwitchableStream();

  const cumulativeUsage = {
    completionTokens: 0,
    promptTokens: 0,
    cacheWrite: 0,
    cacheRead: 0,
    totalTokens: 0,
  };

  try {
    const mcpConfig = getMCPConfigFromCookie(cookieHeader);

    const mcpToolset = await createToolSet(mcpConfig, (context.user as ContextUser)?.accessToken);
    const mcpTools = mcpToolset.tools;

    const totalMessageContent = messages.reduce((acc, message) => acc + extractTextContent(message), '');
    logger.debug(`Total message length: ${totalMessageContent.split(' ').length} words`);

    const messageStream = createUIMessageStream({
      execute: async ({ writer }) => {
        let progressCounter = 1;
        const progressUnsubscribers: Array<() => void> = [];

        const toolProgressIds = new Map<string, string>();
        const responseProgressId = generateId();

        const lastUserMessage = messages.filter((x) => x.role === 'user').pop();

        if (lastUserMessage) {
          writer.write({
            type: 'data-prompt',
            id: generateId(),
            data: {
              prompt: extractTextContent(lastUserMessage),
            },
          });
        }

        logger.info(`MCP tools count: ${Object.keys(mcpTools).length}`);

        for (const toolName in mcpTools) {
          if (mcpTools[toolName]?.progressEmitter) {
            const tool = mcpTools[toolName];
            const unsubscribe = tool.progressEmitter.subscribe((event) => {
              const { type, data, toolName: eventToolName } = event;

              // Generate and manage unique IDs for each tool
              let toolProgressId = toolProgressIds.get(eventToolName);

              if (!toolProgressId) {
                toolProgressId = generateId();
                toolProgressIds.set(eventToolName, toolProgressId);
              }

              console.log('[DEBUG] type: ', type);

              if (type === 'start') {
                writer.write({
                  type: 'data-progress',
                  id: toolProgressId,
                  data: {
                    type: 'progress',
                    status: 'in-progress',
                    order: progressCounter++,
                    message: `Tool '${eventToolName}' execution started`,
                  } as any,
                });
              } else if (type === 'progress') {
                writer.write({
                  type: 'data-progress',
                  id: toolProgressId,
                  data: {
                    type: 'progress',
                    status: 'in-progress',
                    order: progressCounter++,
                    message: `Tool '${eventToolName}' executing: ${data.status || ''}`,
                    percentage: data.percentage ? Number(data.percentage) : undefined,
                  } as any,
                });
              } else if (type === 'complete') {
                writer.write({
                  type: 'data-progress',
                  id: toolProgressId,
                  data: {
                    type: 'progress',
                    status: data.status === 'failed' ? 'failed' : 'complete',
                    order: progressCounter++,
                    message:
                      data.status === 'failed'
                        ? `Tool '${eventToolName}' execution failed`
                        : `Tool '${eventToolName}' execution completed`,
                  } as any,
                });

                // Remove tool progress ID after completion
                toolProgressIds.delete(eventToolName);
                unsubscribe();
              }
            });

            progressUnsubscribers.push(unsubscribe);
            logger.info(`Subscribed to progress events for tool: ${toolName}`);
          }
        }

        const options: StreamingOptions = {
          toolChoice: 'auto',
          onFinish: async ({ text: content, finishReason, usage, providerMetadata }) => {
            console.log('[DEBUG] onFinish: ', content);

            logger.debug('usage', JSON.stringify(usage));

            const lastUserMessage = messages.filter((x) => x.role == 'user').slice(-1)[0];
            const { model, provider } = extractPropertiesFromMessage(lastUserMessage);

            if (usage) {
              cumulativeUsage.promptTokens += usage.inputTokens || 0;
              cumulativeUsage.completionTokens += usage.outputTokens || 0;
              cumulativeUsage.totalTokens += usage.totalTokens || 0;
            }

            if (providerMetadata?.anthropic) {
              const { cacheCreationInputTokens, cacheReadInputTokens } = providerMetadata.anthropic;

              cumulativeUsage.cacheWrite += Number(cacheCreationInputTokens || 0);
              cumulativeUsage.cacheRead += Number(cacheReadInputTokens || 0);
            }

            if (finishReason !== 'length') {
              writer.write({
                type: 'data-usage',
                id: responseProgressId,
                data: {
                  completionTokens: cumulativeUsage.completionTokens,
                  promptTokens: cumulativeUsage.promptTokens,
                  totalTokens: cumulativeUsage.totalTokens,
                  cacheWrite: cumulativeUsage.cacheWrite,
                  cacheRead: cumulativeUsage.cacheRead,
                },
              });

              writer.write({
                type: 'data-progress',
                id: responseProgressId,
                data: {
                  label: 'response',
                  status: 'complete',
                  order: progressCounter++,
                  message: 'Response Generated',
                },
              });
              await new Promise((resolve) => setTimeout(resolve, 0));

              const consumeUserCredit = context.consumeUserCredit as ContextConsumeUserCredit;
              await consumeUserCredit({
                model: { provider, name: model },
                inputTokens: cumulativeUsage.promptTokens,
                outputTokens: cumulativeUsage.completionTokens,
                cacheRead: cumulativeUsage.cacheRead,
                cacheWrite: cumulativeUsage.cacheWrite,
                description: `Generate Response`,
              });

              // stream.close();
              return;
            }

            if (stream.switches >= MAX_RESPONSE_SEGMENTS) {
              throw Error('Cannot continue message: Maximum segments reached');
            }

            const switchesLeft = MAX_RESPONSE_SEGMENTS - stream.switches;

            logger.info(`Reached max token limit (${MAX_TOKENS}): Continuing message (${switchesLeft} switches left)`);

            messages.push({ id: generateId(), role: 'assistant', parts: [{ type: 'text', text: content }] });
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

            writer.merge(result.toUIMessageStream());

            return;
          },
        };

        writer.write({
          type: 'data-progress',
          id: responseProgressId,
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

        writer.merge(result.toUIMessageStream());
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
          let isInReasoning = false;
          let reasoningTextId: string | null = null;

          const toolCallToTextIdMap = new Map<string, string>();

          return (chunk, controller) => {
            switch (chunk.type) {
              case 'reasoning-start': {
                if (!isInReasoning) {
                  isInReasoning = true;
                  reasoningTextId = generateId();

                  controller.enqueue({
                    type: 'text-start',
                    id: reasoningTextId,
                  });

                  controller.enqueue({
                    type: 'text-delta',
                    id: reasoningTextId,
                    delta: '<div class="__boltThought__">',
                  });
                }

                break;
              }

              case 'reasoning-delta': {
                if (isInReasoning && reasoningTextId) {
                  controller.enqueue({
                    type: 'text-delta',
                    id: reasoningTextId,
                    delta: chunk.delta,
                  });
                }

                break;
              }

              case 'reasoning-end': {
                // console.log('[DEBUG] reasoning-end', chunk);

                if (isInReasoning && reasoningTextId) {
                  controller.enqueue({
                    type: 'text-delta',
                    id: reasoningTextId,
                    delta: '</div>\n',
                  });

                  controller.enqueue({
                    type: 'text-end',
                    id: reasoningTextId,
                  });

                  isInReasoning = false;
                  reasoningTextId = null;
                }

                break;
              }

              case 'tool-input-available': {
                // console.log('[DEBUG] tool-input-available', chunk);

                const toolCall = {
                  toolCallId: chunk.toolCallId,
                  toolName: chunk.toolName,
                  input: chunk.input,
                };

                const divString = `\n<toolCall><div class="__toolCall__" id="${chunk.toolCallId}">\`${JSON.stringify(toolCall).replaceAll('`', '&grave;')}\`</div></toolCall>\n`;

                let textId = toolCallToTextIdMap.get(chunk.toolCallId);

                if (!textId) {
                  textId = generateId();
                  toolCallToTextIdMap.set(chunk.toolCallId, textId);
                }

                controller.enqueue({
                  type: 'text-start',
                  id: textId,
                });

                controller.enqueue({
                  type: 'text-delta',
                  id: textId,
                  delta: divString,
                });

                controller.enqueue({
                  type: 'text-end',
                  id: textId,
                });

                console.log('[DEBUG] tool-input-available transformed to text stream');

                break;
              }

              case 'tool-output-available': {
                console.log('[DEBUG] tool-output-available', chunk);

                const toolResult = {
                  toolCallId: chunk.toolCallId,
                  result: chunk.output,
                };

                const divString = `\n<toolResult><div class="__toolResult__" id="${chunk.toolCallId}">\`${JSON.stringify(toolResult).replaceAll('`', '&grave;')}\`</div></toolResult>\n`;
                const textId = generateId();

                controller.enqueue({
                  type: 'text-start',
                  id: textId,
                });

                controller.enqueue({
                  type: 'text-delta',
                  id: textId,
                  delta: divString,
                });

                controller.enqueue({
                  type: 'text-end',
                  id: textId,
                });

                toolCallToTextIdMap.delete(chunk.toolCallId);
                break;
              }

              case 'text-start':
              case 'text-delta':
              case 'text-end': {
                controller.enqueue(chunk);
                break;
              }
              default: {
                controller.enqueue(chunk);
                break;
              }
            }
          };
        })(),
      }),
    );

    return createUIMessageStreamResponse({ stream: messageStream });
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
