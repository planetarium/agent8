/*
 * BigQuery REST API integration for Cloudflare Pages Functions
 * Updated to use Durable Object for batched logging
 */

// Simple logger for Pages Functions
export const logger = {
  info: (message: string) => console.log(`[${new Date().toISOString()}] INFO access-log [PROD] ${message}`),
  warn: (message: string) => console.log(`[${new Date().toISOString()}] WARN access-log [PROD] ${message}`),
  error: (message: string) => console.log(`[${new Date().toISOString()}] ERROR access-log [PROD] ${message}`),
};

// Type definitions
export interface AccessLogData {
  method: string;
  path: string;
  query: string | null;
  statusCode: number;
  responseTime: number;
  ip: string;
  userAgent: string;
  serviceName?: string;
  requestId?: string;
}

// Process query parameters with length limits
const MAX_QUERY_VALUE_LENGTH = 1000;

export const processQueryParams = (search: string): Record<string, string> | null => {
  if (!search || search.length <= 1) {
    return null;
  }

  try {
    const params = new URLSearchParams(search);
    const result: Record<string, string> = {};

    for (const [key, value] of params) {
      // Simple length limit only
      if (value.length > MAX_QUERY_VALUE_LENGTH) {
        result[key] = value.substring(0, MAX_QUERY_VALUE_LENGTH) + '...[TRUNCATED]';
      } else {
        result[key] = value;
      }
    }

    return Object.keys(result).length > 0 ? result : null;
  } catch (error) {
    console.warn('Failed to parse query parameters:', error instanceof Error ? error.message : 'Unknown error');
    return null;
  }
};

// Filter out static assets and development tools
export const shouldSkipLogging = (path: string): boolean => {
  // Skip all static assets
  if (
    path.includes('/assets/') ||
    path.includes('/build/') ||
    path.includes('/public/') ||
    path.includes('.css') ||
    path.includes('.js') ||
    path.includes('.map') ||
    path.includes('/icons/') ||
    path.includes('.svg') ||
    path.includes('.png') ||
    path.includes('.jpg') ||
    path.includes('.ico') ||
    path.includes('.woff') ||
    path.includes('.ttf') ||
    path.includes('/favicon')
  ) {
    return true;
  }

  // Skip development tools
  if (path.includes('/@vite/') || path.includes('/__vite_ping') || path.includes('/node_modules/')) {
    return true;
  }

  return false;
};

// Sharding configuration for millisecond-based load distribution
const SHARD_COUNT = 8; // 8 shards for 8x parallelism

/**
 * Get millisecond-based shard ID for concurrent request distribution
 * Each millisecond maps to a different shard for true parallel processing
 */
function getMillisecondShardId(): number {
  const now = Date.now();
  return now % SHARD_COUNT;
}

/**
 * Get sharded Durable Object stub for access log buffer
 * Uses millisecond-based sharding for concurrent request distribution
 */
function getAccessLogBuffer(env: any): DurableObjectStub {
  // Get the Durable Object namespace from environment
  const durableObjectNamespace = env?.ACCESS_LOG_BUFFER;

  if (!durableObjectNamespace) {
    throw new Error('ACCESS_LOG_BUFFER Durable Object namespace not found in environment');
  }

  // Millisecond-based sharding: each request gets distributed across shards
  const shardId = getMillisecondShardId();
  const shardName = `access-log-buffer-shard-${shardId}`;
  const id = durableObjectNamespace.idFromName(shardName);

  return durableObjectNamespace.get(id);
}

/**
 * Send log data to sharded Durable Object buffer
 * Uses millisecond-based sharding for true concurrent request distribution
 * RPC communication for clean and type-safe calls
 */
async function sendToDurableObject(logData: AccessLogData, env: any): Promise<void> {
  const durableObject = getAccessLogBuffer(env) as any;

  // Simple RPC call to current time-based shard
  await durableObject.addLog(logData);
}

/**
 * Main access logging function
 * Uses millisecond-based sharding across 8 Durable Object instances
 * Each concurrent request automatically distributed to different shards
 */
export const logAccess = async (data: AccessLogData, env?: any): Promise<void> => {
  // Skip if not relevant
  if (shouldSkipLogging(data.path)) {
    return;
  }

  // Simple direct processing - fast HTTP fetch to Durable Object
  if (env?.ACCESS_LOG_BUFFER) {
    try {
      await sendToDurableObject(data, env);
    } catch (error) {
      // Error isolation: logging failures don't affect service
      console.error('Access logging failed:', error instanceof Error ? error.message : 'Unknown error');
    }
  }
};

// Export utility for manual flush (debugging/monitoring)
export const flushLogs = async (env: any, targetShardId?: number): Promise<Response> => {
  try {
    const durableObjectNamespace = env?.ACCESS_LOG_BUFFER;

    if (!durableObjectNamespace) {
      throw new Error('ACCESS_LOG_BUFFER namespace not found');
    }

    // If specific shard requested, flush only that shard
    if (targetShardId !== undefined) {
      if (targetShardId < 0 || targetShardId >= SHARD_COUNT) {
        return new Response(`Invalid shard ID. Must be 0-${SHARD_COUNT - 1}`, { status: 400 });
      }

      const shardName = `access-log-buffer-shard-${targetShardId}`;
      const id = durableObjectNamespace.idFromName(shardName);
      const durableObject = durableObjectNamespace.get(id) as any;
      await durableObject.flush();

      return new Response(`Shard ${targetShardId} flushed successfully`, { status: 200 });
    }

    // Flush all shards
    const flushResults = await Promise.allSettled(
      Array.from({ length: SHARD_COUNT }, async (_, shardId) => {
        const shardName = `access-log-buffer-shard-${shardId}`;
        const id = durableObjectNamespace.idFromName(shardName);
        const durableObject = durableObjectNamespace.get(id) as any;
        await durableObject.flush();

        return { shardId, status: 'success' };
      }),
    );

    const successful = flushResults.filter((result) => result.status === 'fulfilled').length;
    const failed = flushResults.filter((result) => result.status === 'rejected').length;

    const summary = {
      totalShards: SHARD_COUNT,
      successful,
      failed,
      results: flushResults.map((result, index) => ({
        shardId: index,
        status: result.status,
        error: result.status === 'rejected' ? result.reason?.message : undefined,
      })),
    };

    return new Response(
      JSON.stringify({
        message: `Flush completed: ${successful} successful, ${failed} failed`,
        details: summary,
      }),
      {
        status: failed === 0 ? 200 : 207, // 207 = Multi-Status
        headers: { 'Content-Type': 'application/json' },
      },
    );
  } catch (error) {
    console.error('Manual flush failed:', error);

    return new Response('Flush failed', { status: 500 });
  }
};

// Export utility for buffer status (debugging/monitoring)
export const getLogBufferStatus = async (env: any): Promise<Response> => {
  try {
    const durableObjectNamespace = env?.ACCESS_LOG_BUFFER;

    if (!durableObjectNamespace) {
      throw new Error('ACCESS_LOG_BUFFER namespace not found');
    }

    // Get status from all shards
    const shardStatuses = await Promise.all(
      Array.from({ length: SHARD_COUNT }, async (_, shardId) => {
        try {
          const shardName = `access-log-buffer-shard-${shardId}`;
          const id = durableObjectNamespace.idFromName(shardName);
          const durableObject = durableObjectNamespace.get(id) as any;
          const status = await durableObject.getStatus();

          return {
            shardId,
            shardName,
            ...status,
          };
        } catch (error) {
          return {
            shardId,
            shardName: `access-log-buffer-shard-${shardId}`,
            error: error instanceof Error ? error.message : 'Unknown error',
          };
        }
      }),
    );

    // Calculate total statistics
    const totalBufferSize = shardStatuses.reduce((sum, shard) => sum + (shard.bufferSize || 0), 0);
    const currentShardId = getMillisecondShardId();

    const summary = {
      totalShards: SHARD_COUNT,
      currentShardId,
      totalBufferSize,
      distributionMethod: 'millisecond-based',
      shards: shardStatuses,
    };

    return new Response(JSON.stringify(summary), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Status check failed:', error);

    return new Response(JSON.stringify({ error: 'Status check failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

// Export utility for health check
export const checkLogHealth = async (env: any): Promise<Response> => {
  try {
    const durableObjectNamespace = env?.ACCESS_LOG_BUFFER;

    if (!durableObjectNamespace) {
      throw new Error('ACCESS_LOG_BUFFER namespace not found');
    }

    // Health check for all shards
    const healthChecks = await Promise.all(
      Array.from({ length: SHARD_COUNT }, async (_, shardId) => {
        try {
          const shardName = `access-log-buffer-shard-${shardId}`;
          const id = durableObjectNamespace.idFromName(shardName);
          const durableObject = durableObjectNamespace.get(id) as any;
          const status = await durableObject.getStatus();

          return {
            shardId,
            status: 'healthy',
            bufferSize: status.bufferSize || 0,
          };
        } catch (error) {
          return {
            shardId,
            status: 'unhealthy',
            error: error instanceof Error ? error.message : 'Unknown error',
          };
        }
      }),
    );

    const healthyShardsCount = healthChecks.filter((check) => check.status === 'healthy').length;
    const overallHealthy = healthyShardsCount >= Math.ceil(SHARD_COUNT * 0.5); // 50% threshold

    const result = {
      status: overallHealthy ? 'healthy' : 'degraded',
      totalShards: SHARD_COUNT,
      healthyShards: healthyShardsCount,
      currentShardId: getMillisecondShardId(),
      shards: healthChecks,
    };

    return new Response(JSON.stringify(result), {
      status: overallHealthy ? 200 : 503,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({
        status: 'unhealthy',
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }
};
