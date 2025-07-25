// Durable Object for batched BigQuery logging
import { DurableObject } from 'cloudflare:workers';
import * as jose from 'jose';

// Re-export types from original access-log.ts
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

interface BigQueryResponse {
  insertErrors?: Array<{
    index: number;
    errors: Array<{
      reason: string;
      message: string;
    }>;
  }>;
}

interface LogEntry extends AccessLogData {
  timestamp: string;
}

interface BufferStatus {
  bufferSize: number;
  maxBufferSize: number;
  batchSize: number;
  flushInterval: number;
}

// Configuration
const BATCH_SIZE = 100; // Maximum logs per batch
const MAX_BUFFER_SIZE = 1000; // Maximum logs in memory before forcing flush
const FLUSH_INTERVAL = 60 * 1000; // 1 minute in milliseconds

/**
 * Durable Object for collecting and batch-inserting access logs
 * Uses RPC methods for clean interface without dummy URLs
 */
export class AccessLogBuffer extends DurableObject {
  private _logs: LogEntry[] = [];
  private _flushTimer: number | null = null;

  constructor(ctx: DurableObjectState, env: any) {
    super(ctx, env);

    // Start flush timer
    this._scheduleFlush();
  }

  /**
   * Add a log entry to the buffer (RPC method)
   */
  async addLog(logData: AccessLogData): Promise<void> {
    const logEntry: LogEntry = {
      ...logData,
      timestamp: new Date().toISOString(),
    };

    this._logs.push(logEntry);

    // Force flush if buffer is getting too large
    if (this._logs.length >= MAX_BUFFER_SIZE) {
      await this._doFlush(false); // Manual flush, don't reschedule
    }
  }

  /**
   * Manual flush (called externally via RPC)
   * Used for manual API calls only
   */
  async flush(): Promise<void> {
    await this._doFlush(false);
  }

  /**
   * Internal flush implementation
   * @param reschedule - Whether to schedule next flush after completion
   */
  private async _doFlush(reschedule: boolean = true): Promise<void> {
    if (this._logs.length === 0) {
      console.log(`[${new Date().toISOString()}] Flush completed: 0 logs to process, buffer already empty`);

      if (reschedule) {
        this._scheduleFlush();
      }

      return;
    }

    const initialLogCount = this._logs.length;
    console.log(`[${new Date().toISOString()}] Starting flush: ${initialLogCount} logs queued`);

    // Process logs in batches
    const batches = this._createBatches(this._logs, BATCH_SIZE);
    let successCount = 0;
    let failureCount = 0;

    for (const batch of batches) {
      try {
        await this._sendBatchToBigQuery(batch);
        successCount += batch.length;
      } catch (error) {
        failureCount += batch.length;
        console.error(`Failed to send batch of ${batch.length} logs:`, error);
      }
    }

    // Clear successfully sent logs
    if (successCount > 0) {
      this._logs = [];
    }

    console.log(
      `[${new Date().toISOString()}] Flush completed: ${successCount} sent, ${failureCount} failed, buffer cleared`,
    );

    // Only reschedule if this was an automatic flush
    if (reschedule) {
      this._scheduleFlush();
    }
  }

  private _createBatches<T>(items: T[], batchSize: number): T[][] {
    const batches: T[][] = [];

    for (let i = 0; i < items.length; i += batchSize) {
      batches.push(items.slice(i, i + batchSize));
    }

    return batches;
  }

  private async _sendBatchToBigQuery(logs: LogEntry[]): Promise<void> {
    const credentials = (this.env as any)?.GCP_LOGGER_SERVICE_ACCOUNT_JSON;

    if (!credentials) {
      throw new Error('GCP credentials not available');
    }

    try {
      // Parse credentials for project info
      const parsedCredentials = JSON.parse(credentials);
      const projectId = parsedCredentials.project_id;

      // Generate JWT
      const jwt = await this._generateJWT(credentials);

      // Prepare BigQuery batch payload
      const endpoint = `https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/datasets/monitoring/tables/access_log/insertAll`;

      const payload = {
        rows: logs.map((log, index) => ({
          insertId: `${Date.now()}-${index}`, // Prevent duplicates
          json: {
            timestamp: log.timestamp,
            service_name: log.serviceName || 'agent8',
            method: log.method,
            path: log.path,
            status: log.statusCode,
            response_time: log.responseTime,
            client_ip: log.ip,
            ua: log.userAgent,
            query: log.query,
            request_id: log.requestId,
          },
        })),
      };

      // Call BigQuery API with timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout for batches

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
        const errorText = await response.text().catch(() => 'Unable to read error response');
        throw new Error(`BigQuery API error: ${response.status} ${response.statusText} - ${errorText}`);
      }

      // Check for insert errors
      const responseData = (await response.json().catch(() => null)) as BigQueryResponse | null;

      if (responseData?.insertErrors && responseData.insertErrors.length > 0) {
        console.warn(`BigQuery Insert Warnings: ${JSON.stringify(responseData.insertErrors, null, 2)}`);
      }

      // Free connection
      if (!response.bodyUsed) {
        response.body?.cancel();
      }
    } catch (error: any) {
      console.error(`BigQuery batch insert failed:`, error.message);
      throw error;
    }
  }

  private async _generateJWT(credentials: string): Promise<string> {
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

  private _scheduleFlush(): void {
    // Clear existing timer
    if (this._flushTimer) {
      clearTimeout(this._flushTimer);
    }

    // Schedule next flush
    this._flushTimer = setTimeout(() => {
      this._doFlush(true).catch((error) => {
        console.error('Scheduled flush failed:', error);
      });
    }, FLUSH_INTERVAL) as any;
  }

  /**
   * Get buffer status (RPC method)
   */
  async getStatus(): Promise<BufferStatus> {
    return {
      bufferSize: this._logs.length,
      maxBufferSize: MAX_BUFFER_SIZE,
      batchSize: BATCH_SIZE,
      flushInterval: FLUSH_INTERVAL,
    };
  }
}
