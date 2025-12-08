import type { V8User } from '~/lib/verse8/userAuth';

/**
 * Setup .env content for Agent8 projects
 * Creates unique VITE_AGENT8_ACCOUNT and VITE_AGENT8_VERSE values per project
 */
export function setupEnvContent(user: V8User): string {
  const account = user.walletAddress;
  const verseId = `${account}-${Date.now()}`;

  return `VITE_AGENT8_ACCOUNT=${account}\nVITE_AGENT8_VERSE=${verseId}`;
}
