/**
 * Module for converting MCP servers to AI SDK tools
 */

import { type Tool } from 'ai';
import { type JSONSchema7 } from 'ai';
import { jsonSchema } from 'ai';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createScopedLogger } from '~/utils/logger';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import type { MCPConfig } from './config';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

const logger = createScopedLogger('MCPToolset');

/**
 * Progress event type for tool execution progress
 */
export type ProgressEvent = {
  toolName: string;
  type: 'start' | 'progress' | 'complete';
  data: any;
};

/**
 * Subscriber function type for progress events
 */
export type ProgressSubscriber = (event: ProgressEvent) => void;

/**
 * Class that manages subscribers for progress events
 */
export class ProgressEmitter {
  private _subscribers: ProgressSubscriber[] = [];
  private _toolName: string;

  constructor(toolName: string) {
    this._toolName = toolName;
  }

  /**
   * Subscribe to progress events
   * @param subscriber Callback function that will receive progress events
   * @returns A function to unsubscribe
   */
  subscribe(subscriber: ProgressSubscriber): () => void {
    this._subscribers.push(subscriber);

    // Return function to unsubscribe
    return () => {
      const index = this._subscribers.indexOf(subscriber);

      if (index !== -1) {
        this._subscribers.splice(index, 1);
      }
    };
  }

  /**
   * Emit a progress event to all subscribers
   * @param type Event type (start, progress, complete)
   * @param data Event data
   */
  emit(type: 'start' | 'progress' | 'complete', data: any): void {
    const event: ProgressEvent = {
      toolName: this._toolName,
      type,
      data,
    };

    // Notify all subscribers
    for (const subscriber of this._subscribers) {
      try {
        subscriber(event);
      } catch (error) {
        logger.error(`Error in progress subscriber: ${error}`);
      }
    }
  }
}

/**
 * Extended Tool interface with progress reporting capability
 */
interface ProgressAwareTool extends Omit<Tool, 'execute'> {
  progressEmitter: ProgressEmitter;
  execute: (args: any) => Promise<object>;
}

export interface ToolSet {
  tools: Record<string, ProgressAwareTool>;
}

/**
 * Convert MCP servers to AI SDK toolset
 * @param config Toolset configuration
 * @returns Toolset and MCP clients
 */
export async function createToolSet(config: MCPConfig, v8AuthToken?: string): Promise<ToolSet> {
  const toolset: ToolSet = {
    tools: {},
  };

  if (!v8AuthToken) {
    logger.warn('No V8 auth token provided, MCP server will not be authenticated');
  }

  const fetchWithV8Auth = (url: string | URL, options?: RequestInit) => {
    const headers = new Headers(options?.headers);
    headers.set('Authorization', `Bearer ${v8AuthToken}`);

    return fetch(url.toString(), { ...options, headers });
  };

  // Convert server config to array for parallel processing
  const serverEntries = Object.entries(config.servers);

  // Function to process a single server
  const processServer = async ([serverName, serverConfig]: [string, any]) => {
    if (!serverConfig.enabled) {
      logger.info(`MCP server ${serverName} is disabled`);
      return;
    }

    const url = new URL(serverConfig.url);
    const v8AuthIntegrated = v8AuthToken && serverConfig.v8AuthIntegrated;
    const requestInit = v8AuthIntegrated
      ? {
          headers: {
            Authorization: `Bearer ${v8AuthToken}`,
          },
        }
      : undefined;

    const createClient = async () => {
      let transport: Transport;

      if (url.pathname.endsWith('/sse')) {
        // Create SSE transport layer - direct initialization
        transport = new SSEClientTransport(url, {
          eventSourceInit: v8AuthIntegrated ? { fetch: fetchWithV8Auth } : undefined,
          requestInit,
        });
      } else {
        transport = new StreamableHTTPClientTransport(url, {
          requestInit,
        });
      }

      const client = new Client({
        name: `${serverName}-client`,
        version: '1.0.0',
      });

      logger.info(`[${serverName}] Attempting to connect client...`);

      try {
        await client.connect(transport);
        logger.info(`[${serverName}] Client connection successful`);
      } catch (error) {
        logger.error(`[${serverName}] Client connection failed: ${error}`);
        throw error;
      }

      return client;
    };

    let client: Client | null = null;

    try {
      // Create MCP client
      client = await createClient();

      // Get list of tools
      const toolList = await client.listTools();

      // Convert each tool to AI SDK tool
      for (const tool of toolList.tools) {
        let toolName = tool.name;

        if (toolName !== serverName) {
          toolName = `${serverName}_${toolName}`;
        }

        // Replace spaces with dashes due to AI SDK tool name restrictions
        toolName = toolName.replaceAll(' ', '-');

        const inputSchema = jsonSchema({
          ...tool.inputSchema,
          properties: tool.inputSchema.properties ?? {},
          additionalProperties: false,
        } as JSONSchema7);

        // Create a progress emitter for this tool
        const progressEmitter = new ProgressEmitter(toolName);

        toolset.tools[toolName] = {
          description: tool.description || '',
          inputSchema,
          progressEmitter,
          execute: async (args) => {
            /*
             * We don't keep clients due to CloudFlare worker's connection limit.
             * Instead, we create a new client for each tool call.
             */
            let client: Client | null = null;

            try {
              // Emit start event
              progressEmitter.emit('start', { status: 'started' });

              client = await createClient();

              const result = await client.callTool(
                {
                  name: tool.name,
                  arguments: args,
                },
                CallToolResultSchema,
                {
                  onprogress: (progress) => {
                    logger.info(`Progress: ${JSON.stringify(progress)}`);

                    // Emit progress event
                    progressEmitter.emit('progress', progress);
                  },
                  resetTimeoutOnProgress: true,
                },
              );

              // Emit complete event
              progressEmitter.emit('complete', { status: 'completed' });

              return result;
            } catch (error) {
              logger.error(`MCP client[${serverName}] error: ${error}`);
              progressEmitter.emit('complete', {
                status: 'failed',
              });

              return {
                error: (error as Error).message || String(error),
                success: false,
              };
            } finally {
              if (client) {
                logger.info(`[${serverName}] Closing tool execution client connection`);
                await client.close();
                logger.info(`[${serverName}] Tool execution client connection closed`);
              }
            }
          },
        } as ProgressAwareTool;
      }
    } catch (error) {
      logger.error(`MCP client[${serverName}] error:`, error);
    } finally {
      if (client) {
        logger.info(`[${serverName}] Closing client connection`);
        await client.close();
        logger.info(`[${serverName}] Client connection closed`);
      }
    }
  };

  /*
   * Process servers in parallel batches of maximum 2 at a time
   * due to CloudFlare's limit on the number of simultaneous connections.
   */
  const concurrencyLimit = 2;

  for (let i = 0; i < serverEntries.length; i += concurrencyLimit) {
    const batch = serverEntries.slice(i, i + concurrencyLimit);
    await Promise.all(batch.map(processServer));
  }

  return toolset;
}
