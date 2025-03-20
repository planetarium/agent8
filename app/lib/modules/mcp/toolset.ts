/**
 * Module for converting MCP servers to AI SDK tools
 */

import { type Tool } from 'ai';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { JSONSchemaToZod } from '@dmitryrechkin/json-schema-to-zod';
import { createScopedLogger } from '~/utils/logger';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';

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

export interface ToolSetConfig {
  mcpServers: Record<
    string,
    {
      baseUrl: string;
    }
  >;
}

export interface ToolSet {
  tools: Record<string, ProgressAwareTool>;
  clients: Record<string, Client>;
}

/**
 * Convert MCP servers to AI SDK toolset
 * @param config Toolset configuration
 * @returns Toolset and MCP clients
 */
export async function createToolSet(config: ToolSetConfig): Promise<ToolSet> {
  const toolset: ToolSet = {
    tools: {},
    clients: {},
  };

  for (const [serverName, serverConfig] of Object.entries(config.mcpServers)) {
    // Create SSE transport layer - direct initialization
    const url = new URL(serverConfig.baseUrl);
    const transport = new SSEClientTransport(url);

    // Create MCP client
    const client = new Client({
      name: `${serverName}-client`,
      version: '1.0.0',
    });

    client.onerror = (error) => {
      logger.error(`MCP client error: ${error}`);
    };

    toolset.clients[serverName] = client;

    try {
      // Connect client
      await client.connect(transport);

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

        /*
         * Convert JSON Schema to Zod object
         * Type assert tool.inputSchema as any to resolve type errors
         */
        const zodSchema = JSONSchemaToZod.convert(tool.inputSchema as any);

        // Create a progress emitter for this tool
        const progressEmitter = new ProgressEmitter(toolName);

        toolset.tools[toolName] = {
          description: tool.description || '',
          parameters: zodSchema, // Use converted Zod schema
          progressEmitter,
          execute: async (args) => {
            // Emit start event
            progressEmitter.emit('start', { status: 'started' });

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
              },
            );

            // Emit complete event
            progressEmitter.emit('complete', { status: 'completed' });

            return result;
          },
        } as ProgressAwareTool;
      }
    } catch (error) {
      logger.error(`Failed to connect to MCP server ${serverName}:`, error);
    }
  }

  return toolset;
}
