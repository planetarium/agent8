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
 * Queue to limit concurrent tool executions in Cloudflare Workers environment
 */
class ConcurrencyQueue {
  private _maxConcurrency: number;
  private _running = 0;
  private _queue: Array<() => void> = [];

  constructor(maxConcurrency: number) {
    this._maxConcurrency = maxConcurrency;
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // Wait until we have available slot
    if (this._running >= this._maxConcurrency) {
      logger.info(
        `[ConcurrencyQueue] Waiting... (${this._running}/${this._maxConcurrency} running, ${this._queue.length} in queue)`,
      );

      await new Promise<void>((resolve) => {
        this._queue.push(resolve);
      });

      logger.info(`[ConcurrencyQueue] Starting execution (slot available)`);
    }

    this._running++;
    logger.info(`[ConcurrencyQueue] Executing (${this._running}/${this._maxConcurrency} running)`);

    try {
      return await fn();
    } finally {
      this._running--;
      logger.info(
        `[ConcurrencyQueue] Completed (${this._running}/${this._maxConcurrency} running, ${this._queue.length} waiting)`,
      );

      // Process next in queue
      const next = this._queue.shift();

      if (next) {
        logger.info(`[ConcurrencyQueue] Releasing next task from queue`);
        next();
      }
    }
  }
}

// Create global concurrency queue (max 3 concurrent for Cloudflare Workers subrequest limit)
const concurrencyQueue = new ConcurrencyQueue(3);

/**
 * Extended Tool interface with progress reporting capability
 */
interface ProgressAwareTool extends Omit<Tool, 'execute'> {
  progressEmitter?: ProgressEmitter;
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

        toolset.tools[toolName] = {
          description: tool.description || '',
          inputSchema,
          execute: async (args) => {
            const executeTask = async () => {
              /*
               * We don't keep clients due to CloudFlare worker's connection limit.
               * Instead, we create a new client for each tool call.
               */
              let client: Client | null = null;

              try {
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
                    },
                    resetTimeoutOnProgress: true,
                  },
                );

                return result;
              } catch (error) {
                logger.error(`MCP client[${serverName}] error: ${error}`);

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
            };

            // Use concurrency queue to limit concurrent executions
            logger.info(`[${serverName}] Queueing tool execution`);

            return concurrencyQueue.execute(executeTask);
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
