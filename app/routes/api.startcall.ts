import { type ActionFunctionArgs } from '@remix-run/cloudflare';
import { generateObject } from 'ai';
import { FIXED_MODELS } from '~/utils/constants';
import { createScopedLogger } from '~/utils/logger';
import { withV8AuthUser, type ContextConsumeUserCredit } from '~/lib/verse8/middleware';
import { TEMPLATE_SELECTION_SCHEMA } from '~/utils/selectStarterTemplate';

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
    const result = await generateObject({
      model: provider.getModelInstance({
        model,
        serverEnv: env,
      }),
      schema: TEMPLATE_SELECTION_SCHEMA,
      messages: [
        {
          role: 'system',
          content: system,
          providerOptions: {
            anthropic: {
              cacheControl: { type: 'ephemeral' },
            },
          },
        },
        {
          role: 'user',
          content: `${message}`,
        },
      ],
      abortSignal: request.signal,
    });

    // Process usage after generation
    if (result.usage) {
      let cacheRead = 0;
      let cacheWrite = 0;

      if (result.providerMetadata?.anthropic) {
        const { cacheCreationInputTokens, cacheReadInputTokens } = result.providerMetadata.anthropic;
        cacheRead += Number(cacheReadInputTokens || 0);
        cacheWrite += Number(cacheCreationInputTokens || 0);
      }

      const consumeUserCredit = context.consumeUserCredit as ContextConsumeUserCredit;
      await consumeUserCredit({
        model: { provider: provider.name, name: model },
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        cacheRead,
        cacheWrite,
        description: 'Start Call',
      });
    }

    return result.toJsonResponse();
  } catch (error: unknown) {
    logger.error(error);

    if (error instanceof Error && error.message?.includes('API key')) {
      throw new Response('Invalid or missing API key', {
        status: 401,
        statusText: 'Unauthorized',
      });
    }

    // 실제 에러 메시지를 body에 포함시키기
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    throw new Response(errorMessage, {
      status: 500,
      statusText: 'Internal Server Error',
    });
  }
}
