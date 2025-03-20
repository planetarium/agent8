import { type ActionFunctionArgs } from '@remix-run/cloudflare';
import { streamText } from '~/lib/.server/llm/stream-text';
import { getApiKeysFromCookie, getProviderSettingsFromCookie } from '~/lib/api/cookies';
import { createScopedLogger } from '~/utils/logger';
import { PROVIDER_LIST } from '~/utils/constants';
import { stripIndents } from '~/utils/stripIndent';

export async function action(args: ActionFunctionArgs) {
  return imageDescriptionAction(args);
}

const logger = createScopedLogger('api.image-description');

async function imageDescriptionAction({ context, request }: ActionFunctionArgs) {
  const { imageUrl } = await request.json<{
    imageUrl: string;
  }>();

  const provider = PROVIDER_LIST.find((p) => p.name === 'OpenRouter');
  const model = 'google/gemini-2.0-flash-lite-001';

  // Validate inputs
  if (!imageUrl || typeof imageUrl !== 'string') {
    throw new Response('Invalid or missing imageUrl', {
      status: 400,
      statusText: 'Bad Request',
    });
  }

  const cookieHeader = request.headers.get('Cookie');
  const apiKeys = getApiKeysFromCookie(cookieHeader);
  const providerSettings = getProviderSettingsFromCookie(cookieHeader);

  try {
    const result = await streamText({
      messages: [
        {
          role: 'user',
          content:
            `[Model: ${model}]\n\n[Provider: ${provider?.name}]\n\n` +
            stripIndents`
            <image_url>
              ${imageUrl}
            </image_url>
          `,
        },
      ],
      env: context.cloudflare?.env as any,
      apiKeys,
      providerSettings,
      options: {
        system:
          'Provide a concise description of the image, focusing on key elements relevant for deciding its use in a game. Include basic visual details, potential uses (e.g., background, character, item), dominant colors, and the overall style. Keep the description under 120 characters.',
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

    // Return the text stream directly
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
