// HTTP Access Log Utility
export interface AccessLogData {
  method: string;
  path: string;
  statusCode: number;
  responseTime: number;
  ip: string;
  userAgent: string;
}

// Filter out static assets and development tools
export const shouldSkipLogging = (path: string): boolean => {
  return (
    /\.(js|css|map|ico|png|jpg|jpeg|gif|svg|woff|woff2|ttf|eot)(\?.*)?$/.test(path) ||
    path.includes('/node_modules/.vite/') ||
    path.includes('/@vite/') ||
    path.includes('/__vite_ping') ||
    path.includes('/favicon') ||
    path.includes('/icons/') ||
    path.includes('/public/')
  );
};

// Determine log level based on status code
export const getLogLevel = (statusCode: number): 'info' | 'warn' | 'error' => {
  if (statusCode >= 500) {
    return 'error';
  }

  if (statusCode >= 400) {
    return 'warn';
  }

  return 'info';
};

// Format access log message
export const formatLogMessage = (data: AccessLogData): string => {
  const { method, path, statusCode, responseTime, ip, userAgent } = data;
  return `${method} ${path} ${statusCode} ${responseTime}ms - ${ip} - "${userAgent}"`;
};

// Simple logger
export const logger = {
  info: (message: string) => console.log(`[${new Date().toISOString()}] INFO access-log [PROD] ${message}`),
  warn: (message: string) => console.log(`[${new Date().toISOString()}] WARN access-log [PROD] ${message}`),
  error: (message: string) => console.log(`[${new Date().toISOString()}] ERROR access-log [PROD] ${message}`),
};

// Log access request
export const logAccess = (data: AccessLogData): void => {
  if (shouldSkipLogging(data.path)) {
    return;
  }

  const level = getLogLevel(data.statusCode);
  const message = formatLogMessage(data);
  logger[level](message);

  // TODO: Implement BigQuery storage functionality
};
