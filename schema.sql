-- Borealis Software — D1 schema
CREATE TABLE IF NOT EXISTS sites (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  domain      TEXT NOT NULL,
  url         TEXT DEFAULT '',          -- public link (defaults to https://domain)
  description TEXT DEFAULT '',          -- shown on the public landing page
  tags        TEXT DEFAULT '',          -- comma-separated tech/labels
  public      INTEGER NOT NULL DEFAULT 0, -- 1 = show on public site
  color       TEXT NOT NULL DEFAULT '#34c8a3',
  created     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id TEXT NOT NULL,
  day     TEXT NOT NULL,            -- YYYY-MM-DD (UTC)
  path    TEXT NOT NULL DEFAULT '/',
  visitor TEXT NOT NULL,           -- daily per-visitor hash (ip+ua+day+site)
  country TEXT NOT NULL DEFAULT '', -- ISO 3166-1 alpha-2, from Cloudflare's request.cf
  ts      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_site_day ON events (site_id, day);

CREATE TABLE IF NOT EXISTS notes (
  id      TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  text    TEXT NOT NULL,
  ts      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notes_site ON notes (site_id);
