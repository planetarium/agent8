import { type ActionFunctionArgs } from '@remix-run/cloudflare';
import { createUIMessageStream, createUIMessageStreamResponse, generateId, type UIMessage } from 'ai';
import { MAX_RESPONSE_SEGMENTS, MAX_TOKENS } from '~/lib/.server/llm/constants';
import { CONTINUE_PROMPT } from '~/lib/common/prompts/prompts';
import { streamText, getMessagesForLLM, type Messages, type StreamingOptions } from '~/lib/.server/llm/stream-text';
import { createScopedLogger } from '~/utils/logger';
import { getMCPConfigFromCookie } from '~/lib/api/cookies';
import { createToolSet } from '~/lib/modules/mcp/toolset';
import { withV8AuthUser, type ContextUser, type ContextConsumeUserCredit } from '~/lib/verse8/middleware';
import { extractPropertiesFromMessage } from '~/lib/.server/llm/utils';
import type { ProgressAnnotation } from '~/types/context';
import { extractTextContent } from '~/utils/message';
import SwitchableStream from '~/lib/.server/llm/switchable-stream';
import { TOOL_NAMES } from '~/utils/constants';
import { COMPLETE_FIELD } from '~/lib/.server/llm/tools/generate-artifact';
import { normalizeContent, sanitizeXmlAttributeValue } from '~/utils/stringUtils';

function createBoltArtifactXML(id?: string, title?: string, body?: string): string {
  const artifactId = id || 'unknown';
  const artifactTitle = sanitizeXmlAttributeValue(title);
  const artifactBody = body || '';

  return `<boltArtifact id="${artifactId}" title="${artifactTitle}">${artifactBody}</boltArtifact>`;
}

function toBoltArtifactXML(a: any) {
  const { id, title, actions } = a;

  // Group modify actions by path
  const modifyGroups = new Map<string, any[]>();
  const otherActions: any[] = [];

  for (const act of actions) {
    if (act.type === 'modify' && act.path && act.before && act.after) {
      if (!modifyGroups.has(act.path)) {
        modifyGroups.set(act.path, []);
      }

      // Normalize before and after content (skip for markdown files)
      modifyGroups.get(act.path)!.push({
        before: act.before,
        after: act.after,
      });
    } else {
      otherActions.push(act);
    }
  }

  // Create grouped modify actions
  const groupedModifyActions: any[] = [];

  for (const [path, modifications] of modifyGroups) {
    groupedModifyActions.push({
      type: 'modify',
      path,
      modifications,
    });
  }

  // Combine and process all actions
  const allActions = [...groupedModifyActions, ...otherActions]
    .filter(
      (act: any) =>
        (act.content && act.path) ||
        (act.type === 'modify' && act.path && act.modifications) ||
        (act.type === 'shell' && act.command && !act.path),
    )
    .sort((a: any, b: any) => {
      if (a.type === 'shell' && b.type !== 'shell') {
        return -1;
      }

      if (a.type !== 'shell' && b.type === 'shell') {
        return 1;
      }

      return 0;
    });

  const body = allActions
    .map((act: any) => {
      if (act.type === 'modify' && act.modifications) {
        return `  <boltAction type="modify" filePath="${act.path}"><![CDATA[${JSON.stringify(act.modifications)}]]></boltAction>`;
      }

      if (act.path && act.content !== undefined) {
        // Normalize file content (skip for markdown files)
        const normalizedContent = act.path.endsWith('.md') ? act.content : normalizeContent(act.content);
        return `  <boltAction type="file" filePath="${act.path}">${normalizedContent}</boltAction>`;
      }

      return `  <boltAction type="shell">${act.command}</boltAction>`;
    })
    .join('\n');

  return createBoltArtifactXML(id, title, body);
}

export const action = withV8AuthUser(chatAction, { checkCredit: true });

const IGNORE_TOOL_TYPES = ['tool-input-start', 'tool-input-delta', 'tool-input-end'];
const MAX_GENERATE_ARTIFACT_RETRIES = 2;

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

        // Track generate_artifact retry attempts
        let generateArtifactRetryCount = 0;
        const collectedToolResults: any[] = [];

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
          onFinish: async ({ text: content, finishReason, totalUsage, providerMetadata, response }) => {
            const lastUserMessage = messages.filter((x) => x.role == 'user').slice(-1)[0];

            const { model, provider, parts: lastUserMessageParts } = extractPropertiesFromMessage(lastUserMessage);

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

            // Check if generate_artifact tool was called
            const hasGenerateArtifact = response?.messages?.some((msg: any) => {
              if (msg.role !== 'tool') {
                return false;
              }

              return msg.content?.some(
                (item: any) =>
                  item.type === 'tool-result' &&
                  item.toolName === TOOL_NAMES.GENERATE_ARTIFACT &&
                  item.output?.value?.[COMPLETE_FIELD] === true,
              );
            });

            logger.info(
              `onFinish callback: finishReason(${finishReason}), hasGenerateArtifact(${hasGenerateArtifact}), content length(${content.trim().length})`,
            );

            // Retry if tool was not called and response is not empty
            if (!hasGenerateArtifact && generateArtifactRetryCount < MAX_GENERATE_ARTIFACT_RETRIES) {
              generateArtifactRetryCount++;
              logger.warn(
                `Model finished without generating artifact via ${TOOL_NAMES.GENERATE_ARTIFACT} tool. Retry attempt ${generateArtifactRetryCount}/${MAX_GENERATE_ARTIFACT_RETRIES}...`,
              );

              /*
               * Collect tool-results from response to pass to streamText
               * These will be added as ToolModelMessage in the core messages
               */
              if (response?.messages && response.messages.length > 0) {
                for (const msg of response.messages) {
                  if (msg.role === 'tool') {
                    // Collect tool-results (exclude GENERATE_ARTIFACT)
                    const toolResults = Array.isArray(msg.content)
                      ? msg.content.filter(
                          (item: any) => item.type === 'tool-result' && item.toolName !== TOOL_NAMES.GENERATE_ARTIFACT,
                        )
                      : [];

                    if (toolResults.length > 0) {
                      collectedToolResults.push(...toolResults);
                    }
                  }
                }
              }

              // Add assistant's text response if present
              if (content && content.trim().length > 0) {
                messages.push({
                  id: generateId(),
                  role: 'assistant',
                  parts: [{ type: 'text', text: content }],
                });
              }

              let retryMessageText = `Understood. I will now call the ${TOOL_NAMES.GENERATE_ARTIFACT} tool to generate the artifact with the changes I just described.\n\n[IMPORTANT: Continue responding in the SAME LANGUAGE as the user's original request above.]`;

              // Create a copy of messages with the assistant message we're about to add
              const tempMessages = [...messages];
              tempMessages.push({
                id: generateId(),
                role: 'assistant',
                parts: [{ type: 'text', text: retryMessageText }],
              });

              const messagesForLLM = getMessagesForLLM(tempMessages);
              const hasUserInMessagesForLLM = messagesForLLM.some((msg: any) => msg.role === 'user');

              if (!hasUserInMessagesForLLM) {
                const userRequestText =
                  lastUserMessageParts
                    ?.filter((part: any) => part.type === 'text')
                    .map((part: any) => part.text)
                    .join(' ') || 'the requested task';

                retryMessageText = `[User Request: ${userRequestText}]\n\n${retryMessageText}`;
              }

              messages.push({
                id: generateId(),
                role: 'assistant',
                parts: [
                  {
                    type: 'text',
                    text: retryMessageText,
                  },
                ],
              });

              // Retry with forced tool choice, passing tool results
              const retryResult = await streamText({
                messages,
                env,
                options,
                files,
                tools: mcpTools,
                abortSignal: request.signal,
                toolResults: collectedToolResults.length > 0 ? collectedToolResults : undefined,
              });

              writer.merge(retryResult.toUIMessageStream({ sendReasoning: false }));

              return;
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
          const generateArtifactInputs = new Map<string, unknown>();

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
                if (chunk.toolName === TOOL_NAMES.GENERATE_ARTIFACT) {
                  generateArtifactInputs.set(chunk.toolCallId, chunk.input);

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
                if (generateArtifactInputs.has(chunk.toolCallId)) {
                  const artifactData = generateArtifactInputs.get(chunk.toolCallId);
                  generateArtifactInputs.delete(chunk.toolCallId);

                  if (!(chunk.output as any)?.[COMPLETE_FIELD]) {
                    break;
                  }

                  const xmlContent = toBoltArtifactXML(artifactData);

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
                // Skip generateArtifact.
                if (generateArtifactInputs.has(chunk.toolCallId)) {
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
