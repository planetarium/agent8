import Cookies from 'js-cookie';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('userAuth');

export const V8_ACCESS_TOKEN_KEY = 'v8AccessToken';

export const updateV8AccessToken = (v8AccessToken: string) => {
  if (v8AccessToken) {
    Cookies.set(V8_ACCESS_TOKEN_KEY, v8AccessToken);
    localStorage.setItem(V8_ACCESS_TOKEN_KEY, v8AccessToken);
  }
};

export const verifyV8AccessToken = async (
  v8ApiEndpoint: string,
  accessToken: string,
): Promise<{ userUid: string; isActivated: boolean; email: string; walletAddress: string }> => {
  try {
    const response = await fetch(v8ApiEndpoint + '/v1/auth/verify', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      throw new Error('Failed to verify V8 access token');
    }

    const data = (await response.json()) as Record<string, any>;

    return {
      userUid: data?.userUid || data?.userAddress || '',
      isActivated: data?.isActivated || false,
      email: data?.email || '',
      walletAddress: data?.walletAddress || '',
    };
  } catch (error) {
    logger.error('Failed to verify V8 access token', error);
    return { userUid: '', isActivated: false, email: '', walletAddress: '' };
  }
};
