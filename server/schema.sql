CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY,
  email text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_alert_at timestamptz
);

CREATE TABLE IF NOT EXISTS login_tokens (
  token_hmac bytea PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);

CREATE TABLE IF NOT EXISTS subscriptions (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  stripe_customer_id text UNIQUE,
  stripe_subscription_id text UNIQUE,
  status text NOT NULL DEFAULT 'none',
  current_period_end timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS networks (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bssid_hmac bytea NOT NULL,
  payload bytea NOT NULL,
  nonce bytea NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, bssid_hmac)
);

CREATE TABLE IF NOT EXISTS applied_scans (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scan_id uuid NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, scan_id)
);

CREATE TABLE IF NOT EXISTS range_snapshot (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  payload bytea NOT NULL,
  nonce bytea NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS devices (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  address_hmac bytea NOT NULL,
  payload bytea NOT NULL,
  nonce bytea NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, address_hmac)
);

CREATE TABLE IF NOT EXISTS cells (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  cell_hmac bytea NOT NULL,
  payload bytea NOT NULL,
  nonce bytea NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, cell_hmac)
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
