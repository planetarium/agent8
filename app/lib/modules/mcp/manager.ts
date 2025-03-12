import { createToolSet, type ToolSet } from './toolset';
import { createScopedLogger } from '~/utils/logger';
import type { MCPConfig, MCPServerConfig } from './config';

const logger = createScopedLogger('MCPManager');

/**
 * MCP Manager Class
 * Central management of MCP-related functionality (configuration, toolset)
 */
export class MCPManager {
  private static _instance: MCPManager;
  private _toolset: ToolSet | null = null;
  private _config: MCPConfig = { mcpServers: {} };

  private constructor(private readonly _env: Record<string, string | undefined> = {}) {
    this._loadConfigFromEnvironment();
  }

  /**
   * Returns MCPManager instance
   * @param env Environment variables object (optional)
   */
  static getInstance(env: Record<string, string | undefined> = {}): MCPManager {
    if (!MCPManager._instance) {
      MCPManager._instance = new MCPManager(env);
    }

    return MCPManager._instance;
  }

  /**
   * Load MCP server configuration from environment variables
   * Finds environment variables with MCP_SSE_ prefix and converts them to server settings
   * Example: MCP_SSE_TEST=http://localhost:3001/sse -> Sets baseUrl for 'test' server
   */
  private _loadConfigFromEnvironment(): void {
    const mcpServers: Record<string, MCPServerConfig> = {};
    const MCP_PREFIX = 'MCP_SSE_';

    // Iterate through all environment variables
    for (const [key, value] of Object.entries(this._env)) {
      // Look for environment variables with MCP_SSE_ prefix
      if (key.startsWith(MCP_PREFIX)) {
        // Extract server name (convert to lowercase for consistency)
        const serverName = key.slice(MCP_PREFIX.length).toLowerCase();

        if (serverName && value) {
          mcpServers[serverName] = {
            baseUrl: value,
          };
        }
      }
    }

    this._config = { mcpServers };
  }

  /**
   * Returns current loaded MCP configuration
   */
  getConfig(): MCPConfig {
    return this._config;
  }

  /**
   * Returns configuration for a specific server
   * @param serverName Server name
   */
  getServerConfig(serverName: string): MCPServerConfig | undefined {
    return this._config.mcpServers[serverName];
  }

  /**
   * Returns list of all server names
   */
  getAllServerNames(): string[] {
    return Object.keys(this._config.mcpServers);
  }

  /**
   * Initialize MCP toolset
   * Converts MCP servers to AI SDK tools
   */
  async initializeTools(): Promise<Record<string, any>> {
    try {
      // Create ToolSetConfig based on MCP server settings
      const toolSetConfig = {
        mcpServers: Object.entries(this._config.mcpServers).reduce(
          (acc, [name, serverConfig]) => {
            acc[name] = {
              baseUrl: serverConfig.baseUrl,
            };
            return acc;
          },
          {} as Record<string, { baseUrl: string }>,
        ),
      };

      // Create ToolSet
      const toolset = await createToolSet(toolSetConfig);
      this._toolset = toolset;
      logger.info(`MCP toolset initialization completed: ${Object.keys(toolset.tools).length} tools loaded`);

      return toolset.tools;
    } catch (error) {
      logger.error('MCP toolset initialization error:', error);
      return {};
    }
  }

  /**
   * Returns MCP toolset
   */
  get tools() {
    return this._toolset?.tools || {};
  }

  /**
   * Returns MCP clients
   */
  get clients() {
    return this._toolset?.clients || {};
  }
}
