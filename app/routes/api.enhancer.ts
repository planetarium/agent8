import { type ActionFunctionArgs } from '@remix-run/cloudflare';
import { streamText as _streamText } from 'ai';
import { stripIndents } from '~/utils/stripIndent';
import { createScopedLogger } from '~/utils/logger';
import { withV8AuthUser, type ContextConsumeUserCredit } from '~/lib/verse8/middleware';
import { FIXED_MODELS } from '~/utils/constants';

export const action = withV8AuthUser(enhancerAction, { checkCredit: true });

const logger = createScopedLogger('api.enhancher');

async function enhancerAction({ context, request }: ActionFunctionArgs) {
  const { message } = await request.json<{
    message: string;
  }>();

  const provider = FIXED_MODELS.PROMPT_ENHANCER_TEMPLATE.provider;
  const model = FIXED_MODELS.PROMPT_ENHANCER_TEMPLATE.model;

  try {
    const result = await _streamText({
      model: provider.getModelInstance({
        model,
        serverEnv: context.cloudflare?.env as any,
      }),
      messages: [
        {
          role: 'user',
          content:
            `[Model: ${model}]\n\n[Provider: ${provider.name}]\n\n` +
            stripIndents`
            You are a professional prompt engineer specializing in crafting precise, effective prompts.
            Your task is to enhance prompts by making them more specific, actionable, and effective.

            I want you to improve the user prompt that is wrapped in \`<original_prompt>\` tags.

            For valid prompts:
            - Make instructions explicit and unambiguous
            - Add relevant context and constraints
            - Remove redundant information
            - Maintain the core intent
            - Ensure the prompt is self-contained
            - Use professional language

            For invalid or unclear prompts:
            - Respond with clear, professional guidance
            - Keep responses concise and actionable
            - Maintain a helpful, constructive tone
            - Focus on what the user should provide
            - Use a standard template for consistency

            IMPORTANT: Your response must ONLY contain the enhanced prompt text.
            Do not include any explanations, metadata, or wrapper tags.

            <original_prompt>
              ${message}
            </original_prompt>
          `,
        },
      ],
      system:
        'You are a senior software principal architect, you should help the user analyse the user query and enrich it with the necessary context and constraints to make it more specific, actionable, and effective. You should also ensure that the prompt is self-contained and uses professional language. Your response should ONLY contain the enhanced prompt text. Do not include any explanations, metadata, or wrapper tags.',

      onFinish: ({ usage, providerMetadata }) => {
        if (usage) {
          let cacheRead = 0;
          let cacheWrite = 0;

          if (providerMetadata?.anthropic) {
            const { cacheCreationInputTokens, cacheReadInputTokens } = providerMetadata.anthropic;

            cacheRead += Number(cacheReadInputTokens || 0);
            cacheWrite += Number(cacheCreationInputTokens || 0);
          }

          const consumeUserCredit = context.consumeUserCredit as ContextConsumeUserCredit;
          consumeUserCredit({
            model: { provider: provider.name, name: model },
            inputTokens: usage.promptTokens,
            outputTokens: usage.completionTokens,
            cacheRead,
            cacheWrite,
            description: 'Prompt Enhancer',
          });
        }
      },
    });

    // Handle streaming errors in a non-blocking way
    (async () => {
      try {
        for await (const part of result.fullStream) {
          if (part.type === 'error') {
            const error: any = part.error;
            logger.error('Streaming error:', error);
            break;
          }
        }
      } catch (error) {
        logger.error('Error processing stream:', error);
      }
    })();

    // Return the text stream directly since it's already text data
    return new Response(result.textStream, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        Connection: 'keep-alive',
        'Cache-Control': 'no-cache',
      },
    });
  } catch (error: unknown) {
    console.log(error);

    if (error instanceof Error && error.message?.includes('API key')) {
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
