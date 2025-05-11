import type { MCPConfig, MCPServerConfig } from '~/lib/modules/mcp/config';
import { V8_ACCESS_TOKEN_KEY } from '~/lib/verse8/userAuth';

export function parseCookies(cookieHeader: string | null) {
  const cookies: Record<string, string> = {};

  if (!cookieHeader) {
    return cookies;
  }

  // Split the cookie string by semicolons and spaces
  const items = cookieHeader.split(';').map((cookie) => cookie.trim());

  items.forEach((item) => {
    const [name, ...rest] = item.split('=');

    if (name && rest.length > 0) {
      // Decode the name and value, and join value parts in case it contains '='
      const decodedName = decodeURIComponent(name.trim());
      const decodedValue = decodeURIComponent(rest.join('=').trim());
      cookies[decodedName] = decodedValue;
    }
  });

  return cookies;
}

export function getApiKeysFromCookie(cookieHeader: string | null): Record<string, string> {
  const cookies = parseCookies(cookieHeader);
  return cookies.apiKeys ? JSON.parse(cookies.apiKeys) : {};
}

export function getProviderSettingsFromCookie(cookieHeader: string | null): Record<string, any> {
  const cookies = parseCookies(cookieHeader);
  return cookies.providers ? JSON.parse(cookies.providers) : {};
}

export function getMCPConfigFromCookie(cookieHeader: string | null): MCPConfig {
  const cookies = parseCookies(cookieHeader);

  // for backward compatibility, use cookies.mcpSseServers.
  const servers: MCPServerConfig[] = cookies.mcpSseServers
    ? JSON.parse(cookies.mcpSseServers).map((server: MCPServerConfig) => ({
        ...server,
        v8AuthIntegrated: server.v8AuthIntegrated ?? false,
      }))
    : [];

  return {
    source: 'cookie',
    servers: Object.fromEntries(servers.map((server) => [server.name, server])),
  };
}

export function getUserAuthFromCookie(cookieHeader: string | null): { accessToken: string } {
  const cookies = parseCookies(cookieHeader);
  return {
    accessToken: cookies[V8_ACCESS_TOKEN_KEY],
  };
}
