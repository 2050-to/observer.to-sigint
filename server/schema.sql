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

DROP TABLE IF EXISTS search_queries;
DROP TABLE IF EXISTS page_visits;

CREATE TABLE IF NOT EXISTS sites (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  site_id uuid NOT NULL,
  payload bytea NOT NULL,
  nonce bytea NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, site_id)
);

CREATE TABLE IF NOT EXISTS dispositions (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject_hmac bytea NOT NULL,
  payload bytea NOT NULL,
  nonce bytea NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, subject_hmac)
);

CREATE TABLE IF NOT EXISTS reviews (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  payload bytea NOT NULL,
  nonce bytea NOT NULL,
  built_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS last_review_at timestamptz;

CREATE TABLE IF NOT EXISTS lan_saved (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  saved_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lan_previous (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  payload bytea NOT NULL,
  nonce bytea NOT NULL,
  saved_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lan_changes (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  payload bytea NOT NULL,
  nonce bytea NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS critical_alerts (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  finding_hmac bytea NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, finding_hmac)
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS sessions_valid_after timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS observation_retention_days int NOT NULL DEFAULT 90;
ALTER TABLE users ADD COLUMN IF NOT EXISTS review_retention_days int NOT NULL DEFAULT 365;

DO $$
DECLARE
  pk_cols text;
BEGIN
  SELECT string_agg(a.attname, ',' ORDER BY u.ord)
    INTO pk_cols
  FROM pg_constraint c
  JOIN unnest(c.conkey) WITH ORDINALITY AS u(attnum, ord) ON true
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = u.attnum
  WHERE c.conrelid = 'public.reviews'::regclass AND c.contype = 'p';
  IF pk_cols = 'user_id' THEN
    ALTER TABLE reviews DROP CONSTRAINT reviews_pkey;
    ALTER TABLE reviews ADD COLUMN review_id uuid;
    UPDATE reviews SET review_id = gen_random_uuid() WHERE review_id IS NULL;
    ALTER TABLE reviews ALTER COLUMN review_id SET NOT NULL;
    ALTER TABLE reviews ADD PRIMARY KEY (review_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS reviews_user_built ON reviews (user_id, built_at DESC);

CREATE TABLE IF NOT EXISTS sessions (
  session_id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client text NOT NULL,
  label text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

CREATE INDEX IF NOT EXISTS sessions_user ON sessions (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS scanners (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scanner_id uuid NOT NULL,
  payload bytea NOT NULL,
  nonce bytea NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, scanner_id)
);

CREATE TABLE IF NOT EXISTS scans (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scan_id uuid NOT NULL,
  drive_id uuid,
  scanner_id uuid,
  observed_at timestamptz NOT NULL,
  payload bytea NOT NULL,
  nonce bytea NOT NULL,
  PRIMARY KEY (user_id, scan_id)
);

CREATE INDEX IF NOT EXISTS scans_user_time ON scans (user_id, observed_at);
CREATE INDEX IF NOT EXISTS scans_user_drive ON scans (user_id, drive_id);

CREATE TABLE IF NOT EXISTS tombstones (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject_hmac bytea NOT NULL,
  kind text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, subject_hmac)
);

CREATE TABLE IF NOT EXISTS site_walks (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  site_id uuid NOT NULL,
  started_at timestamptz NOT NULL,
  walked_at timestamptz NOT NULL,
  payload bytea NOT NULL,
  nonce bytea NOT NULL,
  PRIMARY KEY (user_id, site_id, started_at)
);

CREATE INDEX IF NOT EXISTS site_walks_recent ON site_walks (user_id, site_id, walked_at DESC);

CREATE TABLE IF NOT EXISTS lan_inventories (
  inventory_id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  site_id uuid,
  observed_at timestamptz NOT NULL DEFAULT now(),
  payload bytea NOT NULL,
  nonce bytea NOT NULL
);

CREATE INDEX IF NOT EXISTS lan_inventories_site ON lan_inventories (user_id, site_id, observed_at DESC);

CREATE TABLE IF NOT EXISTS labels (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject_hmac bytea NOT NULL,
  payload bytea NOT NULL,
  nonce bytea NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, subject_hmac)
);

CREATE TABLE IF NOT EXISTS questions (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question_id uuid NOT NULL,
  asked_at timestamptz NOT NULL DEFAULT now(),
  payload bytea NOT NULL,
  nonce bytea NOT NULL,
  PRIMARY KEY (user_id, question_id)
);

CREATE INDEX IF NOT EXISTS questions_recent ON questions (user_id, asked_at DESC);
