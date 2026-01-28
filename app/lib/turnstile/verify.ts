import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('turnstile.verify');

const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/**
 * Error codes for Turnstile verification.
 * TIMEOUT_OR_DUPLICATE: Cloudflare - token expired or already used
 * API_ERROR: Internal - Cloudflare API request failed
 * INTERNAL_ERROR: Internal - unexpected error during verification
 */
export const TURNSTILE_ERROR_CODES = {
  TIMEOUT_OR_DUPLICATE: 'timeout-or-duplicate',
  API_ERROR: 'api-error',
  INTERNAL_ERROR: 'internal-error',
} as const;

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
      return { success: false, 'error-codes': [TURNSTILE_ERROR_CODES.API_ERROR] };
    }

    const result = await response.json<TurnstileVerifyResponse>();

    if (!result.success) {
      logger.warn('Turnstile verification failed:', result['error-codes']);
    }

    return result;
  } catch (error) {
    logger.error('Turnstile verification error:', error);
    return { success: false, 'error-codes': [TURNSTILE_ERROR_CODES.INTERNAL_ERROR] };
  }
}
