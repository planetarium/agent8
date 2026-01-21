const CACHE_KEY_PREFIX = 'turnstile:';

interface CachedVerification {
  ip: string;
}

/**
 * Hash token to create a short, fixed-length key for KV storage.
 * Cloudflare KV has a 512-byte key limit, but Turnstile tokens are 2000+ chars.
 */
async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));

  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function getCachedVerification(kv: KVNamespace, token: string, ip: string): Promise<boolean> {
  try {
    const tokenHash = await hashToken(token);
    const key = `${CACHE_KEY_PREFIX}${tokenHash}`;
    const cached = await kv.get<CachedVerification>(key, 'json');

    if (!cached) {
      return false;
    }

    // IP binding check - reject if token was issued to a different IP
    if (cached.ip !== ip) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

export async function setCachedVerification(
  kv: KVNamespace,
  token: string,
  ip: string,
  ttlSeconds: number,
): Promise<{ success: boolean; error?: string }> {
  try {
    // Cloudflare KV minimum TTL is 60 seconds
    const safeTtl = Math.max(ttlSeconds, 60);
    const tokenHash = await hashToken(token);
    const key = `${CACHE_KEY_PREFIX}${tokenHash}`;

    await kv.put(key, JSON.stringify({ ip }), {
      expirationTtl: safeTtl,
    });

    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    return { success: false, error: errorMessage };
  }
}
