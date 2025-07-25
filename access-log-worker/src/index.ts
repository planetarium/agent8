/*
 * Access Log Worker - Hosts AccessLogBuffer Durable Object
 * Auto-flush is handled internally by the Durable Object, no cron needed
 */

// Import and export AccessLogBuffer for Durable Object binding
import { AccessLogBuffer } from './access-log-buffer';
export { AccessLogBuffer };

/*
 * No scheduled handler needed - auto-flush handles periodic flushing
 * This worker only hosts the Durable Object
 * All flushing is handled by the internal auto-schedule in AccessLogBuffer
 */
export default {
  // Empty worker - only hosts Durable Object
};
