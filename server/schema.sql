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
