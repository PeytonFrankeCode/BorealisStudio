-- Borealis Studios traffic tracker — D1 schema
CREATE TABLE IF NOT EXISTS sites (
  id      TEXT PRIMARY KEY,
  name    TEXT NOT NULL,
  domain  TEXT NOT NULL,
  color   TEXT NOT NULL DEFAULT '#2bd4a8',
  created INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id TEXT NOT NULL,
  day     TEXT NOT NULL,            -- YYYY-MM-DD (UTC)
  path    TEXT NOT NULL DEFAULT '/',
  visitor TEXT NOT NULL,           -- daily per-visitor hash (ip+ua+day+site)
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
