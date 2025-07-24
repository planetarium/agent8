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
  query: Record<string, any> | null;
  statusCode: number;
  responseTime: number;
  ip: string;
  userAgent: string;
  serviceName?: string;
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

/**
 * Get Durable Object stub for access log buffer
 */
function getAccessLogBuffer(env: any): DurableObjectStub {
  // Get the Durable Object namespace from environment
  const durableObjectNamespace = env?.ACCESS_LOG_BUFFER;

  if (!durableObjectNamespace) {
    throw new Error('ACCESS_LOG_BUFFER Durable Object namespace not found in environment');
  }

  // Use a consistent ID for the log buffer (single global instance)
  const id = durableObjectNamespace.idFromName('access-log-buffer');

  return durableObjectNamespace.get(id);
}

/**
 * Send log data to Durable Object buffer
 * Uses RPC method for clean interface
 */
async function sendToDurableObject(logData: AccessLogData, env: any): Promise<void> {
  const durableObject = getAccessLogBuffer(env) as any;

  // Send log to Durable Object using RPC method
  await durableObject.addLog(logData);
}

/**
 * Main access logging function
 * Now uses Durable Object for async batched processing
 */
export const logAccess = async (data: AccessLogData, env?: any): Promise<void> => {
  // Skip if not relevant
  if (shouldSkipLogging(data.path)) {
    return;
  }

  // Send to Durable Object (fire-and-forget for performance)
  if (env?.ACCESS_LOG_BUFFER) {
    await sendToDurableObject(data, env).catch((error) => {
      console.error('Failed to send log to Durable Object:', error instanceof Error ? error.message : 'Unknown error');
    });
  }
};

// Export utility for manual flush (debugging/monitoring)
export const flushLogs = async (env: any): Promise<Response> => {
  try {
    const durableObject = getAccessLogBuffer(env) as any;
    await durableObject.flush();

    return new Response('Logs flushed successfully', { status: 200 });
  } catch (error) {
    console.error('Manual flush failed:', error);

    return new Response('Flush failed', { status: 500 });
  }
};

// Export utility for buffer status (debugging/monitoring)
export const getLogBufferStatus = async (env: any): Promise<Response> => {
  try {
    const durableObject = getAccessLogBuffer(env) as any;
    const status = await durableObject.getStatus();

    return new Response(JSON.stringify(status), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Status check failed:', error);
    return new Response('Status check failed', { status: 500 });
  }
};
