/**
 * Queue Consumer for Access Log Processing
 * Fast and efficient processing with fail-fast approach
 */

import type { QueueLogMessage } from '~/utils/access-log';
import * as jose from 'jose';

// BigQuery log entry structure
interface LogEntry {
  id: string;
  timestamp: string;
  service_name: string;
  path: string;
  method: string;
  status: number;
  response_time: number;
  client_ip: string;
  ua: string;
  query?: string;
  request_id: string;
}

interface BatchProcessingResult {
  totalMessages: number;
  successfullyProcessed: number;
  failed: number;
  errors: string[];
}

// Processing configuration
const BATCH_SIZE = 100;
const BIGQUERY_TIMEOUT = 8000; // 8 seconds
const PROCESSING_TIMEOUT = 12000; // 12 seconds total

/**
 * Main queue consumer handler
 */
export default {
  async queue(batch: MessageBatch<QueueLogMessage>, env: any, _ctx: ExecutionContext): Promise<void> {
    const startTime = Date.now();

    // Set processing timeout
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Batch processing timeout')), PROCESSING_TIMEOUT);
    });

    try {
      const result = (await Promise.race([processBatch(batch, env), timeoutPromise])) as BatchProcessingResult;
      const processingTime = Date.now() - startTime;

      console.log(
        `[${new Date().toISOString()}] Access Log Batch: ${result.successfullyProcessed}/${result.totalMessages} processed in ${processingTime}ms`,
      );

      batch.ackAll();
    } catch (error) {
      console.error(error);

      const processingTime = Date.now() - startTime;
      console.warn(
        `[${new Date().toISOString()}] Access Log Batch failed: ${batch.messages.length} messages skipped in ${processingTime}ms`,
      );

      batch.ackAll();
    }
  },
};

/**
 * Process batch of queue messages
 */
async function processBatch(batch: MessageBatch<QueueLogMessage>, env: any): Promise<BatchProcessingResult> {
  const result: BatchProcessingResult = {
    totalMessages: batch.messages.length,
    successfullyProcessed: 0,
    failed: 0,
    errors: [],
  };

  try {
    // Convert messages to log entries, skip invalid ones
    const logEntries: LogEntry[] = [];

    for (const message of batch.messages) {
      try {
        const logEntry = convertToLogEntry(message.body);
        logEntries.push(logEntry);
      } catch {
        result.failed++;
      }
    }

    // Send to BigQuery in batches
    if (logEntries.length > 0) {
      const batches = createBatches(logEntries, BATCH_SIZE);

      const batchPromises = batches.map(async (logBatch) => {
        try {
          await sendToBigQuery(logBatch, env);
          return logBatch.length;
        } catch {
          return 0;
        }
      });

      const results = await Promise.allSettled(batchPromises);

      results.forEach((promiseResult) => {
        if (promiseResult.status === 'fulfilled') {
          result.successfullyProcessed += promiseResult.value;
        } else {
          result.failed += BATCH_SIZE;
        }
      });
    }
  } catch (error) {
    result.errors.push(`Processing error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    result.failed = result.totalMessages;
  }

  return result;
}

/**
 * Convert queue message to BigQuery format
 */
function convertToLogEntry(queueMessage: QueueLogMessage): LogEntry {
  if (!queueMessage.data || !queueMessage.id) {
    throw new Error('Invalid message');
  }

  const { data } = queueMessage;

  return {
    id: queueMessage.id,
    timestamp: queueMessage.timestamp || new Date().toISOString(),
    service_name: data.serviceName || 'agent8',
    path: data.path,
    method: data.method,
    status: data.statusCode,
    response_time: data.responseTime,
    client_ip: data.ip,
    ua: data.userAgent,
    query: data.query,
    request_id: data.requestId,
  };
}

/**
 * Split array into smaller batches
 */
function createBatches<T>(items: T[], batchSize: number): T[][] {
  const batches: T[][] = [];

  for (let i = 0; i < items.length; i += batchSize) {
    batches.push(items.slice(i, i + batchSize));
  }

  return batches;
}

/**
 * Send logs to BigQuery
 */
async function sendToBigQuery(logs: LogEntry[], env: any): Promise<void> {
  const credentials = JSON.parse(env.GOOGLE_CLOUD_CREDENTIALS);

  if (!credentials.project_id || !credentials.private_key || !credentials.client_email) {
    throw new Error('Missing BigQuery credentials');
  }

  const jwt = await generateJWT(credentials.private_key, credentials.client_email);
  const endpoint = `https://bigquery.googleapis.com/bigquery/v2/projects/${credentials.project_id}/datasets/monitoring/tables/access_log/insertAll`;

  const payload = {
    kind: 'bigquery#tableDataInsertAllRequest',
    rows: logs.map((log) => ({
      insertId: log.id,
      json: {
        timestamp: log.timestamp,
        service_name: log.service_name,
        path: log.path,
        method: log.method,
        status: log.status,
        response_time: log.response_time,
        client_ip: log.client_ip,
        ua: log.ua,
        query: log.query,
        request_id: log.request_id,
      },
    })),
  };
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), BIGQUERY_TIMEOUT);

  try {
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

    if (!response.ok) {
      throw new Error(`BigQuery API error: ${response.status}`);
    }
  } catch (error) {
    clearTimeout(timeoutId);

    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('BigQuery timeout');
    }

    throw error;
  }
}

/**
 * Generate JWT for BigQuery authentication
 */
async function generateJWT(privateKey: string, clientEmail: string): Promise<string> {
  const algorithm = 'RS256';
  const audience = 'https://bigquery.googleapis.com/';

  const cryptoKey = await jose.importPKCS8(privateKey, algorithm);

  return await new jose.SignJWT()
    .setProtectedHeader({
      typ: 'JWT',
      alg: algorithm,
    })
    .setIssuer(clientEmail)
    .setSubject(clientEmail)
    .setAudience(audience)
    .setExpirationTime('30m')
    .setIssuedAt()
    .sign(cryptoKey);
}
