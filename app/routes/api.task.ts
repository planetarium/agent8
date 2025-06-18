import { type ActionFunctionArgs } from '@remix-run/cloudflare';
import { createDataStream, generateId } from 'ai';
import { MAX_RESPONSE_SEGMENTS, MAX_TOKENS } from '~/lib/.server/llm/constants';
import { CONTINUE_PROMPT } from '~/lib/common/prompts/prompts';
import { streamText, type Messages, type StreamingOptions } from '~/lib/.server/llm/stream-text';
import SwitchableStream from '~/lib/.server/llm/switchable-stream';
import { createScopedLogger } from '~/utils/logger';
import type { ProgressAnnotation } from '~/types/context';
import { extractPropertiesFromMessage } from '~/lib/.server/llm/utils';
import { getMCPConfigFromCookie } from '~/lib/api/cookies';
import { createToolSet } from '~/lib/modules/mcp/toolset';
import { withV8AuthUser, type ContextConsumeUserCredit, type ContextUser } from '~/lib/verse8/middleware';

export const action = withV8AuthUser(taskAction, { checkCredit: true });

const logger = createScopedLogger('api.task');

// See also https://sdk.vercel.ai/docs/ai-sdk-ui/stream-protocol
const TEXT_PART_PREFIX = '0';
const REASONING_PART_PREFIX = 'g';
const TOOL_CALL_PART_PREFIX = '9';
const TOOL_RESULT_PART_PREFIX = 'a';

async function taskAction({ context, request }: ActionFunctionArgs) {
  const env = { ...context.cloudflare.env, ...process.env } as Env;
  const { messages, files } = await request.json<{
    messages: Messages;
    files: any;
    promptId?: string;
    contextOptimization: boolean;
  }>();

  console.log('messages ===>', messages);

  const cookieHeader = request.headers.get('Cookie');

  const stream = new SwitchableStream();

  const cumulativeUsage = {
    completionTokens: 0,
    promptTokens: 0,
    cacheWrite: 0,
    cacheRead: 0,
    totalTokens: 0,
  };
  const encoder: TextEncoder = new TextEncoder();
  let progressCounter: number = 1;

  try {
    const mcpConfig = getMCPConfigFromCookie(cookieHeader);
    const mcpToolset = await createToolSet(mcpConfig, (context.user as ContextUser)?.accessToken);
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
                    status: data.status === 'failed' ? 'failed' : 'complete',
                    order: progressCounter++,
                    message:
                      data.status === 'failed'
                        ? `Tool '${toolName}' execution failed}`
                        : `Tool '${toolName}' execution completed`,
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

        // Stream the text
        const options: StreamingOptions = {
          toolChoice: 'auto',
          onFinish: async ({ text: content, finishReason, usage, providerMetadata }) => {
            logger.debug('usage', JSON.stringify(usage));

            const lastUserMessage = messages.filter((x) => x.role == 'user').slice(-1)[0];
            const { model, provider } = extractPropertiesFromMessage(lastUserMessage);

            if (usage) {
              cumulativeUsage.completionTokens += usage.completionTokens || 0;
              cumulativeUsage.promptTokens += usage.promptTokens || 0;
              cumulativeUsage.totalTokens += usage.totalTokens || 0;
            }

            if (providerMetadata?.anthropic) {
              const { cacheCreationInputTokens, cacheReadInputTokens } = providerMetadata.anthropic;

              cumulativeUsage.cacheWrite += Number(cacheCreationInputTokens || 0);
              cumulativeUsage.cacheRead += Number(cacheReadInputTokens || 0);
            }

            if (finishReason !== 'length') {
              dataStream.writeMessageAnnotation({
                type: 'usage',
                value: {
                  completionTokens: cumulativeUsage.completionTokens,
                  promptTokens: cumulativeUsage.promptTokens,
                  totalTokens: cumulativeUsage.totalTokens,
                  cacheWrite: cumulativeUsage.cacheWrite,
                  cacheRead: cumulativeUsage.cacheRead,
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

            messages.push({ id: generateId(), role: 'assistant', content });
            messages.push({
              id: generateId(),
              role: 'user',
              content: `[Model: ${model}]\n\n[Provider: ${provider}]\n\n${CONTINUE_PROMPT}`,
            });

            const result = await streamText({
              messages,
              env,
              options,
              files,
              tools: mcpTools,
              abortSignal: request.signal,
              systemPrompt: getTaskBreakdownPrompt(),
            });

            result.mergeIntoDataStream(dataStream);

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
          env,
          options,
          files,
          tools: mcpTools,
          abortSignal: request.signal,
          systemPrompt: getTaskBreakdownPrompt(),
        });
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
              const divString = `\n<toolCall><div class="__toolCall__" id="${toolCallId}">\`${content.replaceAll('`', '&grave;')}\`</div></toolCall>\n`;

              transformedChunk = `${TEXT_PART_PREFIX}:${JSON.stringify(divString)}\n`;
            }

            if (chunk.startsWith(TOOL_RESULT_PART_PREFIX)) {
              let content = chunk.split(':').slice(1).join(':');

              if (content.endsWith('\n')) {
                content = content.slice(0, content.length - 1);
              }

              const { toolCallId } = JSON.parse(content);
              const divString = `\n<toolResult><div class="__toolResult__" id="${toolCallId}">\`${content.replaceAll('`', '&grave;')}\`</div></toolResult>\n`;

              transformedChunk = `${TEXT_PART_PREFIX}:${JSON.stringify(divString)}\n`;
            }
          }

          // Convert the string stream to a byte stream
          const str = typeof transformedChunk === 'string' ? transformedChunk : JSON.stringify(transformedChunk);
          controller.enqueue(encoder.encode(str));
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

// Build advanced system prompt for task breakdown
function getTaskBreakdownPrompt(): string {
  return `You are an AI project task breakdown expert specialized in analyzing Product Requirements Documents (PRDs) or user requirements and breaking them down into structured development tasks.

**Your Response Process:**
1. First, analyze and understand the user's requirements thoroughly
2. Explain your analysis thinking and breakdown approach  
3. Describe how you plan to organize the tasks
4. Then provide the structured JSON output using the special markers

Analyze the provided requirement content and generate a concise list of top-level development tasks, with no more than 5 tasks. Each task should represent a logical unit of work needed to implement the requirements, focusing on the most direct and effective implementation approach while avoiding unnecessary complexity or over-engineering.

**Task Breakdown Guidelines:**
1. Each task should be atomic and focused on a single responsibility, following the latest best practices and standards
2. Order tasks logically - consider dependencies and implementation sequence
3. Early tasks should focus on setup and core functionality, then advanced features
4. Include clear validation/testing approach for each task
5. Set appropriate dependency IDs (tasks can only depend on tasks with lower IDs)
6. Assign priority (high/medium/low) based on criticality and dependency order
7. Include detailed implementation guidance in the "details" field
8. If requirements contain specific libraries, database schemas, frameworks, tech stacks, or other implementation details, STRICTLY ADHERE to these requirements
9. Focus on filling gaps left by requirements or areas that aren't fully specified, while preserving all explicit requirements
10. Always provide the most direct path to implementation, avoiding over-engineering or roundabout approaches
11. Include specific, actionable guidance for each task
12. Set reasonable estimated time and acceptance criteria

**Output Format:**
First, provide your thinking process and analysis in natural language.

Then, when you're ready to provide the structured result, wrap it in this div:

<div class="__boltThought__">
{
  "summary": "Task breakdown summary description",
  "tasks": [
    {
      "id": "1",
      "title": "Task title",
      "description": "Task description", 
      "details": "Detailed implementation guidance and technical details",
      "testStrategy": "Validation and testing approach",
      "priority": "high|medium|low",
      "dependencies": ["Dependent task IDs"]
    }
  ],
  "totalTasks": number_of_tasks,
  "generatedAt": "ISO_timestamp",
  "metadata": {
    "projectName": "Project name",
    "sourceFile": "Source file",
    "totalTasks": number_of_tasks
  }
}
</div>

Make sure the JSON is valid and properly formatted inside the div.`;
}
