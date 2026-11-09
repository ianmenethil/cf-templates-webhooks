-- A named address that receives webhooks. `token` is the secret part of its URL: /hooks/<token>.
-- `secret` is the sender's signing secret, kept to check signatures; it is null when `format` is 'none'.
CREATE TABLE endpoints (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  token      TEXT NOT NULL UNIQUE,
  format     TEXT NOT NULL CHECK (format IN ('none', 'standard', 'stripe', 'github')),
  secret     TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL
);

-- One row per sender event. A retry of the same event adds to `deliveries` instead of adding a row.
CREATE TABLE webhooks (
  id               TEXT PRIMARY KEY,
  endpoint_id      TEXT NOT NULL REFERENCES endpoints (id) ON DELETE CASCADE,
  event_id         TEXT,
  received_at      TEXT NOT NULL,
  last_received_at TEXT NOT NULL,
  deliveries       INTEGER NOT NULL DEFAULT 1,
  content_type     TEXT,
  size             INTEGER NOT NULL,
  verified         INTEGER NOT NULL,
  headers          TEXT NOT NULL,
  body             TEXT NOT NULL
);

-- The same event ID on the same endpoint is one webhook. SQLite treats every NULL as different,
-- so deliveries that carry no event ID are all stored.
CREATE UNIQUE INDEX webhooks_endpoint_event ON webhooks (endpoint_id, event_id);

-- Lists an endpoint's webhooks newest first.
CREATE INDEX webhooks_endpoint_received ON webhooks (endpoint_id, received_at DESC, id DESC);

-- Lists every endpoint's webhooks newest first, a page at a time.
CREATE INDEX webhooks_received ON webhooks (received_at DESC, id DESC);

-- Lets the endpoint list count an endpoint's webhooks and find its latest delivery without reading the rows.
CREATE INDEX webhooks_endpoint_last_received ON webhooks (endpoint_id, last_received_at);

-- Lets the daily clean-up find old webhooks without reading every row.
CREATE INDEX webhooks_last_received ON webhooks (last_received_at);
