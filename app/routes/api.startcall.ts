import { type ActionFunctionArgs } from '@remix-run/cloudflare';
import { generateText } from 'ai';
import { FIXED_MODELS } from '~/utils/constants';
import { createScopedLogger } from '~/utils/logger';
import { withV8AuthUser, type ContextConsumeUserCredit } from '~/lib/verse8/middleware';

export const action = withV8AuthUser(startcallAction, { checkCredit: true });

const logger = createScopedLogger('api.startcall');

async function startcallAction({ context, request }: ActionFunctionArgs) {
  const env = { ...process.env, ...context.cloudflare?.env } as Env;
  const { system, message } = await request.json<{
    system: string;
    message: string;
  }>();

  const provider = FIXED_MODELS.SELECT_STARTER_TEMPLATE.provider;
  const model = FIXED_MODELS.SELECT_STARTER_TEMPLATE.model;

  try {
    const result = await generateText({
      model: provider.getModelInstance({
        model,
        serverEnv: env,
      }),
      messages: [
        {
          role: 'system',
          content: system,
          providerOptions: {
            anthropic: { cacheControl: { type: 'ephemeral' } },
          },
        },
        {
          role: 'user',
          content: `${message}`,
        },
      ],
      onStepFinish: async ({ usage, providerMetadata }) => {
        if (usage) {
          let cacheRead = 0;
          let cacheWrite = 0;

          if (providerMetadata?.anthropic) {
            const { cacheCreationInputTokens, cacheReadInputTokens } = providerMetadata.anthropic;

            cacheRead += Number(cacheReadInputTokens || 0);
            cacheWrite += Number(cacheCreationInputTokens || 0);
          }

          const consumeUserCredit = context.consumeUserCredit as ContextConsumeUserCredit;
          await consumeUserCredit({
            model: { provider: provider.name, name: model },
            inputTokens: usage.promptTokens,
            outputTokens: usage.completionTokens,
            cacheRead,
            cacheWrite,
            description: 'Start Call',
          });
        }
      },
      abortSignal: request.signal,
    });

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  } catch (error: unknown) {
    logger.error(error);

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
