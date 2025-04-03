import type { ActionFunctionArgs } from '@remix-run/node';
import { consumeUserCredit, getUserCredit } from './credit';
import { verifyV8AccessToken } from './userAuth';
import { getUserAuthFromCookie } from '~/lib/api/cookies';

interface V8AuthUserOptions {
  checkActivated?: boolean; // 활성화 여부
  checkCredit?: boolean; // 크레딧/포인트 체크 여부
  customValidation?: (user: any, context: any) => Promise<boolean>; // 커스텀 검증 함수
}

export type ContextConsumeUserCredit = (
  inputTokens: string,
  outputTokens: string,
  description?: string,
  model?: { provider: string; name: string },
) => Promise<void>;

export function withV8AuthUser(handler: any, options: V8AuthUserOptions = {}) {
  return async (args: ActionFunctionArgs) => {
    const { context, request } = args;

    try {
      const env = { ...context.cloudflare.env, ...process.env } as Env;

      if (env.VITE_ACCESS_CONTROL_ENABLED !== 'true') {
        const enhancedContext = {
          ...context,
          user: { uid: 'unknown', isActivated: false, credit: 0 },
          consumeUserCredit: () => {
            console.warn('consumeUserCredit is disabled');
          },
        };
        return await handler({ ...args, context: enhancedContext });
      }

      const cookieHeader = request.headers.get('Cookie');
      const { accessToken } = getUserAuthFromCookie(cookieHeader);

      if (!accessToken) {
        return new Response('Unauthorized (no access token)', { status: 401 });
      }

      const { userUid, isActivated } = await verifyV8AccessToken(env.VITE_V8_API_ENDPOINT, accessToken);

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
        user: { uid: userUid, isActivated, credit: credit?.toString() },
        consumeUserCredit: (
          inputTokens: string,
          outputTokens: string,
          description?: string,
          model?: { provider: string; name: string },
        ) =>
          consumeUserCredit(
            env.VITE_V8_CREDIT_ENDPOINT,
            userUid,
            {
              clientId: env.V8_CREDIT_CLIENT_ID,
              clientSecret: env.V8_CREDIT_CLIENT_SECRET,
            },
            inputTokens,
            outputTokens,
            description,
            model,
          ),
      };

      const response = await handler({ ...args, context: enhancedContext });

      return response;
    } catch (error: any) {
      console.error('V8 Auth Middleware Error', error);
      return new Response(error.message, { status: 400 });
    }
  };
}
