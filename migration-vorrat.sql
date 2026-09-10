-- Vorrat an Zimmerkategorien, geschluesselt nach der Kennung der Kette.
-- Unabhaengig von der Hotelliste: hier stehen auch Haeuser, in denen niemand war.

CREATE TABLE IF NOT EXISTS chain_hotels (
  ctyhocn    TEXT PRIMARY KEY,
  kette      TEXT NOT NULL,
  name       TEXT NOT NULL,
  brand      TEXT,
  city       TEXT,
  country    TEXT,
  website    TEXT,
  lat        REAL,
  lon        REAL,
  fetched_at TEXT
);

CREATE TABLE IF NOT EXISTS chain_rooms (
  ctyhocn       TEXT NOT NULL,
  name          TEXT NOT NULL,
  rank          INTEGER NOT NULL DEFAULT 0,
  type          TEXT,
  size_sqm      INTEGER,
  bed_type      TEXT,
  max_occupancy INTEGER,
  description   TEXT,
  code          TEXT,
  gruppe        TEXT,
  source_url    TEXT,
  fetched_at    TEXT,
  PRIMARY KEY (ctyhocn, name)
);

CREATE INDEX IF NOT EXISTS chain_rooms_ctyhocn ON chain_rooms(ctyhocn);
CREATE INDEX IF NOT EXISTS chain_hotels_land ON chain_hotels(kette, country);
