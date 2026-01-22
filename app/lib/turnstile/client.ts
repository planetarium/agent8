export const TURNSTILE_TOKEN_HEADER = 'X-Turnstile-Token';

let getTokenFn: (() => Promise<string>) | null = null;

/**
 * Client-side token cache.
 * TTL is derived from server's VITE_TURNSTILE_CACHE_TTL, minus 5 seconds buffer
 * to ensure client cache expires before server cache (avoids edge case rejections).
 */
const DEFAULT_CACHE_TTL_SECONDS = 300;
const SERVER_CACHE_TTL_SECONDS = parseInt(import.meta.env.VITE_TURNSTILE_CACHE_TTL, 10) || DEFAULT_CACHE_TTL_SECONDS;
const CLIENT_CACHE_TTL_MS = (SERVER_CACHE_TTL_SECONDS - 5) * 1000;

let cachedToken: string | null = null;
let tokenExpiresAt: number = 0;

export function setTurnstileTokenGetter(fn: () => Promise<string>) {
  getTokenFn = fn;
}

/**
 * Clear the cached token. Call this at the start of a new user action
 * (e.g., when the send button is clicked) to get a fresh token.
 */
export function clearTurnstileTokenCache() {
  cachedToken = null;
  tokenExpiresAt = 0;
}

export async function getTurnstileHeaders(): Promise<Record<string, string>> {
  // Check if we have a valid cached token
  if (cachedToken && tokenExpiresAt > Date.now()) {
    return { [TURNSTILE_TOKEN_HEADER]: cachedToken };
  }

  // Turnstile not configured
  if (!getTokenFn) {
    return {};
  }

  const token = await getTokenFn();

  // Cache the token
  cachedToken = token;
  tokenExpiresAt = Date.now() + CLIENT_CACHE_TTL_MS;

  return { [TURNSTILE_TOKEN_HEADER]: token };
}
