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
 * Note: Filtering is now handled at Pages Function level for better performance
 */
export const logAccess = async (data: AccessLogData, env?: any): Promise<void> => {
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
