/**
 * Type definitions related to MCP(Model Context Protocol) configuration
 */

/**
 * MCP server configuration interface
 */
export interface MCPServerConfig {
  name: string;
  url: string;
  enabled: boolean;
  v8AuthIntegrated: boolean;
}

export type MCPConfigSource = 'cookie' | 'env';

/**
 * MCP global configuration interface
 */
export interface MCPConfig {
  source: MCPConfigSource;
  servers: Record<string, MCPServerConfig>;
}
