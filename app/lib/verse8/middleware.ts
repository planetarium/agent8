import type { ActionFunctionArgs } from '@remix-run/node';
import { consumeUserCredit, getUserCredit } from './credit';
import { verifyV8AccessToken } from './userAuth';
import { getUserAuthFromCookie } from '~/lib/api/cookies';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('middleware.withV8AuthUser');

interface V8AuthUserOptions {
  checkActivated?: boolean;
  checkCredit?: boolean;
}

export type ContextConsumeUserCredit = (args: {
  model: { provider: string; name: string };
  inputTokens: number | undefined;
  outputTokens: number | undefined;
  cacheRead?: number;
  cacheWrite?: number;
  description?: string;
}) => Promise<void>;

export type ContextUser = {
  accessToken: string;
  uid: string;
  email: string;
  walletAddress: string;
  isActivated: boolean;
  credit: string;
};

export function withV8AuthUser(handler: any, options: V8AuthUserOptions = {}) {
  return async (args: ActionFunctionArgs) => {
    const { context, request } = args;

    try {
      const env = { ...context.cloudflare.env, ...process.env } as Env;

      if (env.VITE_ACCESS_CONTROL_ENABLED !== 'true') {
        const enhancedContext = {
          ...context,
          user: { accessToken: null, uid: 'unknown', email: null, walletAddress: null, isActivated: false, credit: 0 },
          consumeUserCredit: () => {
            logger.warn('consumeUserCredit is disabled');
          },
        };
        return await handler({ ...args, context: enhancedContext });
      }

      const cookieHeader = request.headers.get('Cookie');
      const { accessToken } = getUserAuthFromCookie(cookieHeader);

      if (!accessToken) {
        return new Response('Unauthorized (no access token)', { status: 401 });
      }

      const { userUid, email, walletAddress, isActivated } = await verifyV8AccessToken(
        env.VITE_V8_API_ENDPOINT,
        accessToken,
      );

      if (!userUid) {
        return new Response('Unauthorized (Not found user)', { status: 401 });
      }

      if (options.checkActivated !== false && !isActivated) {
        return new Response('Account is not activated', { status: 403 });
      }

      let credit;

      if (options.checkCredit === true) {
        credit = await getUserCredit(env.VITE_V8_CREDIT_ENDPOINT, userUid, {
          clientId: env.V8_CREDIT_CLIENT_ID,
          clientSecret: env.V8_CREDIT_CLIENT_SECRET,
        });

        if (credit <= 0n) {
          return new Response(`Insufficient credit`, { status: 402 });
        }
      }

      // 검증된 사용자 정보를 context에 추가
      const enhancedContext = {
        ...context,
        user: {
          accessToken,
          uid: userUid,
          email,
          walletAddress,
          isActivated,
          credit: credit?.toString() || '0',
        } as ContextUser,
        consumeUserCredit: (consumeArgs: {
          inputTokens: number;
          outputTokens: number;
          cacheWrite?: number;
          cacheRead?: number;
          description?: string;
          model: { provider: string; name: string };
        }) =>
          consumeUserCredit(
            env.VITE_V8_CREDIT_ENDPOINT,
            userUid,
            {
              clientId: env.V8_CREDIT_CLIENT_ID,
              clientSecret: env.V8_CREDIT_CLIENT_SECRET,
            },
            consumeArgs,
          ),
      };

      const response = await handler({ ...args, context: enhancedContext });

      return response;
    } catch (error: any) {
      logger.error('V8 Auth Middleware Error', error);
      return new Response(error.message, { status: 400 });
    }
  };
}
