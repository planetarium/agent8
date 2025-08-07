/**
 * Access Log Queue Consumer Worker
 * Processes access logs from Cloudflare Queue and sends to BigQuery
 */

import queueConsumer from './queue-consumer';

export default queueConsumer;
