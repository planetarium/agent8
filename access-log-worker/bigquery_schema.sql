-- BigQuery Table Schema for Access Logs
-- Dataset: monitoring
-- Table: access_log

CREATE TABLE `your-project-id.monitoring.access_log` (
  timestamp TIMESTAMP NOT NULL,
  service_name STRING NOT NULL,
  method STRING NOT NULL,
  path STRING NOT NULL,
  status INTEGER NOT NULL,
  response_time INTEGER NOT NULL,
  client_ip STRING,
  ua STRING,
  query STRING
)
PARTITION BY DATE(timestamp)
CLUSTER BY service_name, method, status
OPTIONS(
  description="HTTP access logs with request/response details",
);
