CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY,
  email_hmac bytea NOT NULL UNIQUE,
  email_payload bytea NOT NULL,
  email_nonce bytea NOT NULL,
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

ALTER TABLE users ADD COLUMN IF NOT EXISTS born_payload bytea;
ALTER TABLE users ADD COLUMN IF NOT EXISTS born_nonce bytea;
ALTER TABLE users ADD COLUMN IF NOT EXISTS tos_version text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS tos_accepted_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS privacy_version text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS privacy_accepted_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS owned_addresses boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS owned_details boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS device_profiles (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  payload bytea NOT NULL,
  nonce bytea NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lan_hosts (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  host_hmac bytea NOT NULL,
  payload bytea NOT NULL,
  nonce bytea NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, host_hmac)
);

CREATE TABLE IF NOT EXISTS dns_queries (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  observed_at timestamptz NOT NULL,
  payload bytea NOT NULL,
  nonce bytea NOT NULL
);

CREATE INDEX IF NOT EXISTS dns_queries_user_time
  ON dns_queries (user_id, observed_at);

CREATE TABLE IF NOT EXISTS wifi_places (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bssid_hmac bytea NOT NULL,
  payload bytea NOT NULL,
  nonce bytea NOT NULL,
  first_seen timestamptz NOT NULL,
  last_seen timestamptz NOT NULL,
  PRIMARY KEY (user_id, bssid_hmac)
);

CREATE TABLE IF NOT EXISTS bluetooth_places (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  address_hmac bytea NOT NULL,
  payload bytea NOT NULL,
  nonce bytea NOT NULL,
  first_seen timestamptz NOT NULL,
  last_seen timestamptz NOT NULL,
  PRIMARY KEY (user_id, address_hmac)
);

CREATE TABLE IF NOT EXISTS bookmarks (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  url_hmac bytea NOT NULL,
  payload bytea NOT NULL,
  nonce bytea NOT NULL,
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, url_hmac)
);

CREATE TABLE IF NOT EXISTS search_queries (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  payload bytea NOT NULL,
  nonce bytea NOT NULL,
  queried_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS search_queries_user_time
  ON search_queries (user_id, queried_at);

CREATE TABLE IF NOT EXISTS page_visits (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  payload bytea NOT NULL,
  nonce bytea NOT NULL,
  visited_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS page_visits_user_time
  ON page_visits (user_id, visited_at);
