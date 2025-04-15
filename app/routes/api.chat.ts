import { type ActionFunctionArgs } from '@remix-run/cloudflare';
import { createDataStream, generateId } from 'ai';
import { MAX_RESPONSE_SEGMENTS, MAX_TOKENS, type FileMap } from '~/lib/.server/llm/constants';
import { CONTINUE_PROMPT } from '~/lib/common/prompts/prompts';
import { streamText, type Messages, type StreamingOptions } from '~/lib/.server/llm/stream-text';
import SwitchableStream from '~/lib/.server/llm/switchable-stream';
import type { IProviderSetting } from '~/types/model';
import { createScopedLogger } from '~/utils/logger';
import { getFilePaths, selectContext } from '~/lib/.server/llm/select-context';
import type { ContextAnnotation, ProgressAnnotation } from '~/types/context';
import { WORK_DIR } from '~/utils/constants';
import { createSummary } from '~/lib/.server/llm/create-summary';
import { extractPropertiesFromMessage } from '~/lib/.server/llm/utils';
import { searchVectorDB } from '~/lib/.server/llm/search-vectordb';
import { searchResources } from '~/lib/.server/llm/search-resources';
import { getMCPConfigFromCookie } from '~/lib/api/cookies';
import { cleanupToolSet, createToolSet } from '~/lib/modules/mcp/toolset';
import { withV8AuthUser, type ContextConsumeUserCredit } from '~/lib/verse8/middleware';

export const action = withV8AuthUser(chatAction, { checkCredit: true });

const logger = createScopedLogger('api.chat');

// See also https://sdk.vercel.ai/docs/ai-sdk-ui/stream-protocol
const TEXT_PART_PREFIX = '0';
const REASONING_PART_PREFIX = 'g';
const TOOL_CALL_PART_PREFIX = '9';
const TOOL_RESULT_PART_PREFIX = 'a';

function parseCookies(cookieHeader: string): Record<string, string> {
  const cookies: Record<string, string> = {};

  const items = cookieHeader.split(';').map((cookie) => cookie.trim());

  items.forEach((item) => {
    const [name, ...rest] = item.split('=');

    if (name && rest) {
      const decodedName = decodeURIComponent(name.trim());
      const decodedValue = decodeURIComponent(rest.join('=').trim());
      cookies[decodedName] = decodedValue;
    }
  });

  return cookies;
}

async function chatAction({ context, request }: ActionFunctionArgs) {
  const { messages, files, promptId, contextOptimization } = await request.json<{
    messages: Messages;
    files: any;
    promptId?: string;
    contextOptimization: boolean;
  }>();

  const cookieHeader = request.headers.get('Cookie');
  const parsedCookies = parseCookies(cookieHeader || '');

  const apiKeys = JSON.parse(parsedCookies.apiKeys || '{}');
  const providerSettings: Record<string, IProviderSetting> = JSON.parse(parsedCookies.providers || '{}');
  const stream = new SwitchableStream();

  const cumulativeUsage = {
    completionTokens: 0,
    promptTokens: 0,
    totalTokens: 0,
  };
  const encoder: TextEncoder = new TextEncoder();
  let progressCounter: number = 1;

  try {
    const mcpConfig = getMCPConfigFromCookie(cookieHeader);
    const mcpToolset = await createToolSet(mcpConfig);
    const mcpTools = mcpToolset.tools;
    logger.debug(`mcpConfig: ${JSON.stringify(mcpConfig)}`);

    const totalMessageContent = messages.reduce((acc, message) => acc + message.content, '');
    logger.debug(`Total message length: ${totalMessageContent.split(' ').length}, words`);

    let lastChunk: string | undefined = undefined;

    const dataStream = createDataStream({
      async execute(dataStream) {
        const lastUserMessage = messages.filter((x) => x.role == 'user').pop();

        if (lastUserMessage) {
          dataStream.writeMessageAnnotation({
            type: 'prompt',
            prompt: lastUserMessage.content,
          } as any);
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
                  dataStream.writeData({
                    type: 'progress',
                    status: 'in-progress',
                    order: progressCounter++,
                    message: `Tool '${toolName}' execution started`,
                  } as any);
                } else if (type === 'progress') {
                  dataStream.writeData({
                    type: 'progress',
                    status: 'in-progress',
                    order: progressCounter++,
                    message: `Tool '${toolName}' executing: ${data.status || ''}`,
                    percentage: data.percentage ? Number(data.percentage) : undefined,
                  } as any);
                } else if (type === 'complete') {
                  dataStream.writeData({
                    type: 'progress',
                    status: 'complete',
                    order: progressCounter++,
                    message: `Tool '${toolName}' execution completed`,
                  } as any);

                  // Automatically unsubscribe after complete
                  unsubscribe();
                }
              });

              // Store unsubscribe function for cleanup
              progressUnsubscribers.push(unsubscribe);

              logger.info(`Subscribed to progress events for tool: ${toolName}`);
            }
          }
        }

        const filePaths = getFilePaths(files || {});
        let filteredFiles: FileMap | undefined = undefined;
        let summary: string | undefined = undefined;
        let messageSliceId = 0;
        let vectorDbExamples: FileMap = {};
        const chatId = messages.slice(-1)?.[0]?.id;

        if (messages.length > 3) {
          messageSliceId = messages.length - 3;
        }

        if (filePaths.length > 0 && contextOptimization) {
          logger.debug('Generating Chat Summary');
          dataStream.writeData({
            type: 'progress',
            label: 'summary',
            status: 'in-progress',
            order: progressCounter++,
            message: 'Analysing Request',
          } satisfies ProgressAnnotation);

          // Create a summary of the chat
          logger.debug(`Messages count: ${messages.length}`);

          summary = await createSummary({
            messages: [...messages],
            env: context.cloudflare?.env,
            apiKeys,
            providerSettings,
            promptId,
            contextOptimization,
            abortSignal: request.signal,
            onFinish(resp) {
              if (resp.usage) {
                logger.debug('createSummary token usage', JSON.stringify(resp.usage));
                cumulativeUsage.completionTokens += resp.usage.completionTokens || 0;
                cumulativeUsage.promptTokens += resp.usage.promptTokens || 0;
                cumulativeUsage.totalTokens += resp.usage.totalTokens || 0;
              }
            },
          });
          dataStream.writeData({
            type: 'progress',
            label: 'summary',
            status: 'complete',
            order: progressCounter++,
            message: 'Analysis Complete',
          } satisfies ProgressAnnotation);

          dataStream.writeMessageAnnotation({
            type: 'chatSummary',
            summary,
            chatId,
          } as ContextAnnotation);

          // Update context buffer
          logger.debug('Updating Context Buffer');
          dataStream.writeData({
            type: 'progress',
            label: 'context',
            status: 'in-progress',
            order: progressCounter++,
            message: 'Determining Files to Read',
          } satisfies ProgressAnnotation);

          // Select context files
          logger.debug(`Messages count: ${messages.length}`);
          filteredFiles = await selectContext({
            messages: [...messages],
            env: context.cloudflare?.env,
            apiKeys,
            files,
            providerSettings,
            promptId,
            contextOptimization,
            summary,
            abortSignal: request.signal,
            onFinish(resp) {
              if (resp.usage) {
                logger.debug('selectContext token usage', JSON.stringify(resp.usage));
                cumulativeUsage.completionTokens += resp.usage.completionTokens || 0;
                cumulativeUsage.promptTokens += resp.usage.promptTokens || 0;
                cumulativeUsage.totalTokens += resp.usage.totalTokens || 0;
              }
            },
          });

          if (filteredFiles) {
            logger.debug(`files in context : ${JSON.stringify(Object.keys(filteredFiles))}`);
          }

          dataStream.writeMessageAnnotation({
            type: 'codeContext',
            files: Object.keys(filteredFiles).map((key) => {
              let path = key;

              if (path.startsWith(WORK_DIR)) {
                path = path.replace(WORK_DIR, '');
              }

              return path;
            }),
          } as ContextAnnotation);

          dataStream.writeData({
            type: 'progress',
            label: 'context',
            status: 'complete',
            order: progressCounter++,
            message: 'Code Files Selected',
          } satisfies ProgressAnnotation);

          // logger.debug('Code Files Selected');
        }

        // Search vector database for relevant code examples
        logger.debug('Searching Vector Database for Examples');
        dataStream.writeData({
          type: 'progress',
          label: 'vectordb',
          status: 'in-progress',
          order: progressCounter++,
          message: 'Searching for Code Examples',
        } satisfies ProgressAnnotation);

        const [vectorDBResult, relevantResources] = await Promise.all([
          searchVectorDB({
            messages: [...messages],
            env: context.cloudflare?.env,
            apiKeys,
            files,
            providerSettings,
            promptId,
            contextOptimization,
            contextFiles: filteredFiles,
            summary: summary || 'This is first user request',
            onFinish(resp) {
              if (resp.usage) {
                logger.debug('searchVectorDB token usage', JSON.stringify(resp.usage));
                cumulativeUsage.completionTokens += resp.usage.completionTokens || 0;
                cumulativeUsage.promptTokens += resp.usage.promptTokens || 0;
                cumulativeUsage.totalTokens += resp.usage.totalTokens || 0;
              }
            },
          }),
          searchResources({
            messages: [...messages],
            env: context.cloudflare?.env,
            apiKeys,
            files,
            providerSettings,
            promptId,
            contextOptimization,
            contextFiles: filteredFiles,
            summary: summary || 'This is first user request',
            onFinish(resp) {
              if (resp.usage) {
                logger.debug('searchResources token usage', JSON.stringify(resp.usage));
                cumulativeUsage.completionTokens += resp.usage.completionTokens || 0;
                cumulativeUsage.promptTokens += resp.usage.promptTokens || 0;
                cumulativeUsage.totalTokens += resp.usage.totalTokens || 0;
              }
            },
          }),
        ]);

        vectorDbExamples = vectorDBResult.result;

        const exampleCount = Object.keys(vectorDbExamples).length;
        logger.debug(`Found ${exampleCount} relevant code examples`);

        dataStream.writeData({
          type: 'progress',
          label: 'vectordb',
          status: 'complete',
          order: progressCounter++,
          message: `Found ${exampleCount} Code Examples`,
        } satisfies ProgressAnnotation);

        dataStream.writeData({
          type: 'progress',
          label: 'vectordb-requirements',
          status: 'complete',
          order: progressCounter++,
          message: `Requirements:${vectorDBResult.requirements}`,
        } satisfies ProgressAnnotation);

        dataStream.writeData({
          type: 'progress',
          label: 'vectordb-found',
          status: 'complete',
          order: progressCounter++,
          message: `Found :${vectorDBResult.examples.map((v) => v.path)}`,
        } satisfies ProgressAnnotation);

        // Search for relevant resources
        logger.debug('Searching for relevant resources');
        dataStream.writeData({
          type: 'progress',
          label: 'resources',
          status: 'in-progress',
          order: progressCounter++,
          message: 'Searching for Relevant Resources',
        } satisfies ProgressAnnotation);

        const resourceCount = Object.keys(relevantResources).length;
        logger.debug(`Found ${resourceCount} relevant resources`);

        dataStream.writeData({
          type: 'progress',
          label: 'resources',
          status: 'complete',
          order: progressCounter++,
          message: `Found ${resourceCount} Relevant Resources`,
        } satisfies ProgressAnnotation);

        // Stream the text
        const options: StreamingOptions = {
          toolChoice: 'auto',
          onFinish: async ({ text: content, finishReason, usage }) => {
            logger.debug('usage', JSON.stringify(usage));

            const lastUserMessage = messages.filter((x) => x.role == 'user').slice(-1)[0];
            const { model, provider } = extractPropertiesFromMessage(lastUserMessage);

            if (usage) {
              cumulativeUsage.completionTokens += usage.completionTokens || 0;
              cumulativeUsage.promptTokens += usage.promptTokens || 0;
              cumulativeUsage.totalTokens += usage.totalTokens || 0;
            }

            if (finishReason !== 'length') {
              dataStream.writeMessageAnnotation({
                type: 'usage',
                value: {
                  completionTokens: cumulativeUsage.completionTokens,
                  promptTokens: cumulativeUsage.promptTokens,
                  totalTokens: cumulativeUsage.totalTokens,
                },
              });

              dataStream.writeData({
                type: 'progress',
                label: 'response',
                status: 'complete',
                order: progressCounter++,
                message: 'Response Generated',
              } satisfies ProgressAnnotation);
              await new Promise((resolve) => setTimeout(resolve, 0));

              const consumeUserCredit = context.consumeUserCredit as ContextConsumeUserCredit;
              await consumeUserCredit({
                model: { provider, name: model },
                inputTokens: cumulativeUsage.promptTokens,
                outputTokens: cumulativeUsage.completionTokens,
                description: `Generate Response (${chatId})`,
              });

              // stream.close();
              return;
            }

            if (stream.switches >= MAX_RESPONSE_SEGMENTS) {
              throw Error('Cannot continue message: Maximum segments reached');
            }

            const switchesLeft = MAX_RESPONSE_SEGMENTS - stream.switches;

            logger.info(`Reached max token limit (${MAX_TOKENS}): Continuing message (${switchesLeft} switches left)`);

            messages.push({ id: generateId(), role: 'assistant', content });
            messages.push({
              id: generateId(),
              role: 'user',
              content: `[Model: ${model}]\n\n[Provider: ${provider}]\n\n${CONTINUE_PROMPT}`,
            });

            const result = await streamText({
              messages,
              env: context.cloudflare?.env,
              options,
              apiKeys,
              files,
              providerSettings,
              promptId,
              contextOptimization,
              contextFiles: filteredFiles,
              summary,
              messageSliceId,
              vectorDbExamples,
              relevantResources,
              tools: mcpTools,
              abortSignal: request.signal,
            });

            result.mergeIntoDataStream(dataStream);

            (async () => {
              try {
                for await (const part of result.fullStream) {
                  if (part.type === 'error') {
                    const error: any = part.error;
                    logger.error(`${error}`);

                    return;
                  }
                }
              } catch (e: any) {
                if (e.name === 'AbortError') {
                  logger.info('Request aborted.');
                  return;
                }

                throw e;
              }
            })();

            return;
          },
        };

        dataStream.writeData({
          type: 'progress',
          label: 'response',
          status: 'in-progress',
          order: progressCounter++,
          message: 'Generating Response',
        } satisfies ProgressAnnotation);

        const result = await streamText({
          messages,
          env: context.cloudflare?.env,
          options,
          apiKeys,
          files,
          providerSettings,
          promptId,
          contextOptimization,
          contextFiles: filteredFiles,
          summary,
          messageSliceId,
          vectorDbExamples,
          relevantResources,
          tools: mcpTools,
          abortSignal: request.signal,
        });

        (async () => {
          try {
            for await (const part of result.fullStream) {
              if (part.type === 'error') {
                const error: any = part.error;
                logger.error(`${error}`);

                return;
              }
            }
          } catch (e: any) {
            if (e.name === 'AbortError') {
              logger.info('Request aborted.');
              return;
            }

            throw e;
          }
        })();
        result.mergeIntoDataStream(dataStream);
      },
      onError: (error: any) => `Custom error: ${error.message}`,
    }).pipeThrough(
      new TransformStream({
        transform: (chunk, controller) => {
          if (!lastChunk) {
            lastChunk = ' ';
          }

          if (typeof chunk === 'string') {
            if (chunk.startsWith(REASONING_PART_PREFIX) && !lastChunk.startsWith(REASONING_PART_PREFIX)) {
              controller.enqueue(encoder.encode(`${TEXT_PART_PREFIX}:"<div class=\\"__boltThought__\\">"\n`));
            }

            if (lastChunk.startsWith(REASONING_PART_PREFIX) && !chunk.startsWith(REASONING_PART_PREFIX)) {
              controller.enqueue(encoder.encode(`${TEXT_PART_PREFIX}:"</div>\\n"\n`));
            }
          }

          lastChunk = chunk;

          let transformedChunk = chunk;

          if (typeof chunk === 'string') {
            if (chunk.startsWith(REASONING_PART_PREFIX)) {
              let content = chunk.split(':').slice(1).join(':');

              if (content.endsWith('\n')) {
                content = content.slice(0, content.length - 1);
              }

              transformedChunk = `${TEXT_PART_PREFIX}:${content}\n`;
            }

            if (chunk.startsWith(TOOL_CALL_PART_PREFIX)) {
              let content = chunk.split(':').slice(1).join(':');

              if (content.endsWith('\n')) {
                content = content.slice(0, content.length - 1);
              }

              const { toolCallId } = JSON.parse(content);
              const divString = `<div class="__toolCall__" id="${toolCallId}">\`${content.replaceAll('`', '&grave;')}\`</div>`;

              transformedChunk = `${TEXT_PART_PREFIX}:${JSON.stringify(divString)}\n`;
            }

            if (chunk.startsWith(TOOL_RESULT_PART_PREFIX)) {
              let content = chunk.split(':').slice(1).join(':');

              if (content.endsWith('\n')) {
                content = content.slice(0, content.length - 1);
              }

              const { toolCallId } = JSON.parse(content);
              const divString = `<div class="__toolResult__" id="${toolCallId}">\`${content.replaceAll('`', '&grave;')}\`</div>`;

              transformedChunk = `${TEXT_PART_PREFIX}:${JSON.stringify(divString)}\n`;
            }
          }

          // Convert the string stream to a byte stream
          const str = typeof transformedChunk === 'string' ? transformedChunk : JSON.stringify(transformedChunk);
          controller.enqueue(encoder.encode(str));
        },
        async flush() {
          await cleanupToolSet(mcpToolset);
        },
      }),
    );

    return new Response(dataStream, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        Connection: 'keep-alive',
        'Cache-Control': 'no-cache',
        'Text-Encoding': 'chunked',
      },
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
