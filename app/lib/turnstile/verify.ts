import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('turnstile.verify');

const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export interface TurnstileVerifyResponse {
  success: boolean;
  'error-codes'?: string[];
  challenge_ts?: string;
  hostname?: string;
}

export async function verifyTurnstileToken(
  token: string,
  secretKey: string,
  remoteIp?: string,
): Promise<TurnstileVerifyResponse> {
  try {
    const formData = new FormData();
    formData.append('secret', secretKey);
    formData.append('response', token);

    if (remoteIp) {
      formData.append('remoteip', remoteIp);
    }

    const response = await fetch(TURNSTILE_VERIFY_URL, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      logger.error(`Turnstile API error: ${response.status}`);
      return { success: false, 'error-codes': ['api-error'] };
    }

    const result = await response.json<TurnstileVerifyResponse>();

    if (!result.success) {
      logger.warn('Turnstile verification failed:', result['error-codes']);
    }

    return result;
  } catch (error) {
    logger.error('Turnstile verification error:', error);
    return { success: false, 'error-codes': ['internal-error'] };
  }
}
