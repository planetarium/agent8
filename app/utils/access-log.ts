// BigQuery REST API integration for Cloudflare Pages Functions
import * as jose from 'jose';

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

interface BigQueryResponse {
  insertErrors?: Array<{
    index: number;
    errors: Array<{
      reason: string;
      message: string;
    }>;
  }>;
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

// Simple logger
export const logger = {
  info: (message: string) => console.log(`[${new Date().toISOString()}] INFO access-log [PROD] ${message}`),
  warn: (message: string) => console.log(`[${new Date().toISOString()}] WARN access-log [PROD] ${message}`),
  error: (message: string) => console.log(`[${new Date().toISOString()}] ERROR access-log [PROD] ${message}`),
};

/**
 * Generate JWT token for BigQuery API authentication
 * @param credentials - GCP service account JSON string
 * @returns Promise<string> - JWT token for API authorization
 */
async function generateJWT(credentials: string): Promise<string> {
  const parsedCredentials = JSON.parse(credentials);
  const algorithm = 'RS256';

  const privateKey = await jose.importPKCS8(parsedCredentials.private_key, algorithm);

  const jwt = await new jose.SignJWT()
    .setProtectedHeader({
      typ: 'JWT',
      alg: algorithm,
      kid: parsedCredentials.private_key_id,
    })
    .setIssuer(parsedCredentials.client_email)
    .setSubject(parsedCredentials.client_email)
    .setAudience('https://bigquery.googleapis.com/')
    .setExpirationTime(Math.floor(Date.now() / 1000) + 3600)
    .setIssuedAt()
    .sign(privateKey);

  return jwt;
}

/**
 * Log to BigQuery asynchronously
 * Single responsibility: BigQuery logging only
 */
async function logToBigQuery(logData: AccessLogData, env: any): Promise<void> {
  // Get credentials (single source of truth)
  const credentials = env?.GCP_LOGGER_SERVICE_ACCOUNT_JSON || process.env.GCP_LOGGER_SERVICE_ACCOUNT_JSON;

  if (!credentials) {
    return;
  }

  try {
    // Parse credentials for project info
    const parsedCredentials = JSON.parse(credentials);
    const projectId = parsedCredentials.project_id;

    // Generate JWT
    const jwt = await generateJWT(credentials);

    // Prepare BigQuery payload
    const endpoint = `https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/datasets/monitoring/tables/access_log/insertAll`;
    const payload = {
      rows: [
        {
          json: {
            timestamp: new Date().toISOString(),
            service_name: logData.serviceName || 'agent8',
            method: logData.method,
            path: logData.path,
            status: logData.statusCode,
            response_time: logData.responseTime,
            client_ip: logData.ip,
            ua: logData.userAgent,
            query: logData.query,
          },
        },
      ],
    };

    // Call BigQuery API with timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwt}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    // Log API response details
    console.log(`📊 BigQuery API Response: ${response.status} ${response.statusText}`);

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unable to read error response');
      console.error(`❌ BigQuery API Error Details: ${response.status} - ${errorText}`);
      throw new Error(`BigQuery API error: ${response.status} ${response.statusText}`);
    }

    // Log successful response details
    const responseData = (await response.json().catch(() => null)) as BigQueryResponse | null;

    if (responseData?.insertErrors && responseData.insertErrors.length > 0) {
      console.warn(`⚠️ BigQuery Insert Warnings: ${JSON.stringify(responseData.insertErrors, null, 2)}`);
    } else {
      console.log(`✅ BigQuery Insert Success: ${payload.rows.length} row(s) inserted`);
    }

    // Free connection immediately
    if (!response.bodyUsed) {
      response.body?.cancel();
    }
  } catch (error: any) {
    throw error; // Re-throw to be handled by logAccess
  }
}

/**
 * Main access logging function
 * Handles console logging and triggers BigQuery logging
 * Now async to execute within Request Context
 */
export const logAccess = async (data: AccessLogData, env?: any): Promise<void> => {
  // Skip if not relevant
  if (shouldSkipLogging(data.path)) {
    return;
  }

  // Console log (always, immediate)
  const { method, path, statusCode, responseTime, ip, userAgent } = data;
  logger.info(`${method} ${path} ${statusCode} ${responseTime}ms - ${ip} - "${userAgent}"`);

  // BigQuery log (within Request Context)
  try {
    await logToBigQuery(data, env);
  } catch (error) {
    console.error('❌ BigQuery logging failed:', error instanceof Error ? error.message : 'Unknown error');
  }
};
