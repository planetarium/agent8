import type { ActionFunctionArgs } from '@remix-run/cloudflare';
import { verifyTurnstileToken } from './verify';
import { getCachedVerification, setCachedVerification } from './cache';
import { TURNSTILE_TOKEN_HEADER } from './client';

const DEFAULT_CACHE_TTL_SECONDS = 300;

function getRemoteIp(request: Request): string {
  return (
    request.headers.get('CF-Connecting-IP') ||
    request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
    'unknown'
  );
}

function withCacheHeader(response: Response, status: string): Response {
  const newResponse = new Response(response.body, response);
  newResponse.headers.set('X-Turnstile-Cache', status);

  return newResponse;
}

export function withTurnstile(handler: (args: ActionFunctionArgs) => Promise<Response>) {
  return async (args: ActionFunctionArgs): Promise<Response> => {
    const { context, request } = args;
    const env = { ...context.cloudflare?.env, ...process.env } as Env;

    // Skip if disabled
    if (env.TURNSTILE_ENABLED !== 'true') {
      return handler(args);
    }

    const token = request.headers.get(TURNSTILE_TOKEN_HEADER);

    if (!token) {
      return new Response('Turnstile verification required', {
        status: 403,
        statusText: 'Forbidden',
      });
    }

    const remoteIp = getRemoteIp(request);

    // Check KV cache first
    if (env.TURNSTILE_CACHE) {
      const cached = await getCachedVerification(env.TURNSTILE_CACHE, token, remoteIp);

      if (cached) {
        const response = await handler(args);

        return withCacheHeader(response, 'hit');
      }
    }

    // Verify with Cloudflare
    const verifyResult = await verifyTurnstileToken(token, env.TURNSTILE_SECRET_KEY, remoteIp);

    if (!verifyResult.success) {
      const message = verifyResult['error-codes']?.includes('timeout-or-duplicate')
        ? 'Verification token expired or already used'
        : 'Bot verification failed';

      return new Response(message, {
        status: 403,
        statusText: 'Forbidden',
      });
    }

    // Cache the successful verification
    let cacheStatus = 'no-kv';

    if (env.TURNSTILE_CACHE) {
      const cacheTtl = parseInt(env.VITE_TURNSTILE_CACHE_TTL, 10) || DEFAULT_CACHE_TTL_SECONDS;
      const result = await setCachedVerification(env.TURNSTILE_CACHE, token, remoteIp, cacheTtl);
      cacheStatus = result.success ? 'new' : `error:${result.error}`;
    }

    const response = await handler(args);

    return withCacheHeader(response, cacheStatus);
  };
}
