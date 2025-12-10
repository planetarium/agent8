/**
 * Generate unique verse ID for Agent8 projects
 */
export function generateVerseId(account: string): string {
  return `${account}-${Date.now()}`;
}

/**
 * Generate .env content for Agent8 projects
 */
export function getEnvContent(account: string): string {
  const verseId = generateVerseId(account);
  return `VITE_AGENT8_ACCOUNT=${account}\nVITE_AGENT8_VERSE=${verseId}`;
}
