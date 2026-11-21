CREATE TABLE IF NOT EXISTS networks (
  bssid_hmac bytea PRIMARY KEY,
  payload bytea NOT NULL,
  nonce bytea NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS applied_scans (
  scan_id uuid PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS range_snapshot (
  id int PRIMARY KEY CHECK (id = 1),
  payload bytea NOT NULL,
  nonce bytea NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS devices (
  address_hmac bytea PRIMARY KEY,
  payload bytea NOT NULL,
  nonce bytea NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cells (
  cell_hmac bytea PRIMARY KEY,
  payload bytea NOT NULL,
  nonce bytea NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS enrichment_jobs (
  lookup_hmac bytea PRIMARY KEY,
  payload bytea NOT NULL,
  nonce bytea NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'failed')),
  attempts int NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS enrichment_jobs_ready
  ON enrichment_jobs (status, available_at, created_at);

CREATE TABLE IF NOT EXISTS enrichment_results (
  lookup_hmac bytea PRIMARY KEY,
  payload bytea NOT NULL,
  nonce bytea NOT NULL,
  refreshed_at timestamptz NOT NULL DEFAULT now(),
  refresh_after timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS enrichment_results_refresh
  ON enrichment_results (refresh_after);
