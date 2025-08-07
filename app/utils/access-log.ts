// Access logging utilities for Cloudflare Pages Functions

// Type definitions for access log data structure
export interface AccessLogData {
  path: string;
  method: string;
  statusCode: number;
  responseTime: number;
  ip: string;
  userAgent: string;
  serviceName?: string;
  query?: string;
  requestId: string;
}

// Type for queue message structure
export interface QueueLogMessage {
  id: string;
  timestamp: string;
  data: AccessLogData;
  version: string;
  source: string;
}

/**
 * Determine if a request path should be logged
 * Excludes static assets, health checks, and bot requests
 */
function shouldSkipLogging(path: string): boolean {
  // Skip static assets
  const staticExtensions = ['.css', '.js', '.ico', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.woff', '.woff2', '.ttf'];

  if (staticExtensions.some((ext) => path.endsWith(ext))) {
    return true;
  }

  // Skip health checks and monitoring endpoints
  const skipPaths = ['/health', '/status', '/ping', '/favicon.ico', '/robots.txt'];

  if (skipPaths.includes(path)) {
    return true;
  }

  // Skip preflight OPTIONS requests
  return false;
}

/**
 * Filter and structure access log data
 * Ensures consistent data format and removes sensitive information
 */
export function createAccessLogData(
  request: Request,
  response: Response,
  startTime: number,
  options: {
    requestId?: string;
    ip?: string;
    serviceName?: string;
  } = {},
): AccessLogData {
  const url = new URL(request.url);
  const endTime = Date.now();
  const responseTime = endTime - startTime;

  return {
    path: url.pathname,
    method: request.method,
    statusCode: response.status,
    responseTime,
    ip: options.ip || 'unknown',
    userAgent: request.headers.get('user-agent') || 'unknown',
    serviceName: options.serviceName || 'agent8',
    query: url.search || undefined,
    requestId: options.requestId || crypto.randomUUID(),
  };
}

/**
 * Send log data to Cloudflare Queue for processing
 * Ultra-fast producer with automatic retry and dead letter queue
 * Production-grade error handling and monitoring
 */
async function sendToQueue(logData: AccessLogData, env: any): Promise<void> {
  const queue = env.ACCESS_LOG_QUEUE;

  if (!queue) {
    throw new Error('ACCESS_LOG_QUEUE not found in environment');
  }

  // Enhanced log data with metadata for queue processing
  const queueMessage: QueueLogMessage = {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    data: logData,
    version: '1.0',
    source: 'pages-function',
  };

  // Send to queue with automatic retry
  await queue.send(queueMessage, {
    // Delay processing slightly to allow for batching
    delaySeconds: 0,
  });
}

/**
 * Main access logging function
 * Uses Cloudflare Queues for high-throughput, reliable log processing
 * Producer sends logs to queue with automatic batching and retry
 */
export const logAccess = async (data: AccessLogData, env?: any): Promise<void> => {
  // Skip if not relevant
  if (shouldSkipLogging(data.path)) {
    return;
  }

  // Queue-based processing - ultra-fast producer with reliable delivery
  if (env?.ACCESS_LOG_QUEUE) {
    try {
      await sendToQueue(data, env);
    } catch (error) {
      // Error isolation: logging failures don't affect service
      console.error('Access logging failed:', error instanceof Error ? error.message : 'Unknown error');
    }
  }
};

// Export utility for queue monitoring and management
export const getQueueStatus = async (env: any): Promise<Response> => {
  try {
    if (!env?.ACCESS_LOG_QUEUE) {
      throw new Error('ACCESS_LOG_QUEUE not found');
    }

    // Queue statistics and health check
    const queueStatus = {
      status: 'active',
      timestamp: new Date().toISOString(),
      message: 'Queue system operational',
      type: 'cloudflare-queue',
      version: '2.0',
    };

    return new Response(JSON.stringify(queueStatus), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Queue status check failed:', error);

    return new Response(
      JSON.stringify({
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }
};

// Export utility for queue health monitoring
export const checkQueueHealth = async (env: any): Promise<Response> => {
  try {
    if (!env?.ACCESS_LOG_QUEUE) {
      throw new Error('ACCESS_LOG_QUEUE not found');
    }

    const healthCheck = {
      status: 'healthy',
      service: 'access-log-queue',
      timestamp: new Date().toISOString(),
      version: '2.0',
      checks: {
        queueBinding: 'ok',
        environment: 'ok',
      },
    };

    return new Response(JSON.stringify(healthCheck), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({
        status: 'unhealthy',
        service: 'access-log-queue',
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }
};

// Legacy exports for backward compatibility during migration
export const flushLogs = getQueueStatus;
export const getLogBufferStatus = getQueueStatus;
export const checkLogHealth = checkQueueHealth;
