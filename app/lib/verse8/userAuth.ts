import Cookies from 'js-cookie';
import { FetchError } from '~/utils/errors';

export const V8_ACCESS_TOKEN_KEY = 'v8AccessToken';

export interface V8User {
  userUid: string;
  isActivated: boolean;
  email: string;
  walletAddress: string;
  name: string;
  profilePicture: string | null;
  userAddress?: string;
  role?: string;
}

export const updateV8AccessToken = (v8AccessToken: string) => {
  if (v8AccessToken) {
    Cookies.set(V8_ACCESS_TOKEN_KEY, v8AccessToken);
    localStorage.setItem(V8_ACCESS_TOKEN_KEY, v8AccessToken);
  }
};

export const verifyV8AccessToken = async (v8ApiEndpoint: string, accessToken: string): Promise<V8User> => {
  const response = await fetch(v8ApiEndpoint + '/v1/auth/verify', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const serverMessage = (await response.text()).trim();
    throw new FetchError(serverMessage || response.statusText, response.status, 'verify_access_token');
  }

  const data = (await response.json()) as Record<string, any>;

  return {
    userUid: data?.userUid || data?.userAddress || '',
    isActivated: data?.isActivated || true,
    email: data?.email || '',
    walletAddress: data?.walletAddress || '',
    name: data?.name || '',
    profilePicture: data?.profilePicture || null,
    userAddress: data?.userAddress || '',
    role: data?.role || '',
  };
};
