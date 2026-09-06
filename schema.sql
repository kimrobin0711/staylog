-- stayLOG – Datenbankschema (Cloudflare D1)
-- Anwenden:  npx wrangler d1 execute staylog --remote --file=./schema.sql

CREATE TABLE IF NOT EXISTS hotels (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  source         TEXT NOT NULL DEFAULT 'manual',   -- osm | manual
  source_id      TEXT,
  name           TEXT NOT NULL,
  brand          TEXT,
  chain          TEXT,
  program        TEXT,                             -- Marriott Bonvoy, Hilton Honors, ...
  country        TEXT,
  country_code   TEXT,
  city           TEXT,
  lat            REAL,
  lon            REAL,
  lounge         INTEGER,                          -- 0 nein, 1 ja, NULL unbekannt
  breakfast_note TEXT,
  address        TEXT,
  website        TEXT,
  description    TEXT,
  enrich_status  TEXT NOT NULL DEFAULT 'pending',  -- pending | running | ready | failed
  enrich_error   TEXT,
  enriched_at    TEXT,
  created_at     TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS hotels_source_idx ON hotels(source, source_id);
CREATE INDEX IF NOT EXISTS hotels_country_idx ON hotels(country_code, city);

-- Zimmerkategorien je Hotel. rank bildet die Leiter: klein = einfach, gross = besser.
CREATE TABLE IF NOT EXISTS room_types (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  hotel_id    INTEGER NOT NULL,
  name        TEXT NOT NULL,
  rank        INTEGER NOT NULL DEFAULT 0,
  confirmed   INTEGER NOT NULL DEFAULT 0,          -- 0 = Vorschlag, 1 = bestaetigt
  source      TEXT,                                -- llm | user
  source_url  TEXT,
  created_at  TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS room_types_uniq ON room_types(hotel_id, name);

CREATE TABLE IF NOT EXISTS stays (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  hotel_id       INTEGER NOT NULL,
  author         TEXT NOT NULL,
  program        TEXT,
  status_level   TEXT,
  checkin        TEXT,
  checkout       TEXT,
  nights         INTEGER,
  booked_room    TEXT,
  booked_rank    INTEGER,
  received_room  TEXT,
  received_rank  INTEGER,
  upgrade_steps  INTEGER,
  price          REAL,
  currency       TEXT NOT NULL DEFAULT 'EUR',
  benefits       TEXT,                             -- JSON-Array
  notes          TEXT,
  created_at     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS stays_hotel_idx  ON stays(hotel_id);
CREATE INDEX IF NOT EXISTS stays_author_idx ON stays(author);
CREATE INDEX IF NOT EXISTS stays_date_idx   ON stays(checkin);

CREATE TABLE IF NOT EXISTS photos (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  stay_id    INTEGER NOT NULL,
  key        TEXT NOT NULL,
  caption    TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS photos_stay_idx ON photos(stay_id);

-- Zugriffsprotokoll. Wird automatisch nach 30 Tagen aufgeraeumt.
CREATE TABLE IF NOT EXISTS access_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ts         TEXT NOT NULL,
  event      TEXT NOT NULL,          -- login_ok | login_fail | login_blocked | stay_create | stay_delete | hotel_create | photo_upload
  name       TEXT,
  ip         TEXT,
  country    TEXT,
  city       TEXT,
  network    TEXT,
  user_agent TEXT,
  detail     TEXT
);

-- Mitglieder. Legen sich beim ersten Anmelden selbst an.
CREATE TABLE IF NOT EXISTS members (
  email      TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  statuses   TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS members_name_idx ON members(name);

CREATE INDEX IF NOT EXISTS access_log_ts_idx ON access_log(ts);
CREATE INDEX IF NOT EXISTS access_log_ip_idx ON access_log(ip, event, ts);

-- Nachtraeglich fuer bestehende Datenbanken (Fehler "duplicate column" ist hier harmlos):
-- ALTER TABLE hotels ADD COLUMN address TEXT;
-- ALTER TABLE hotels ADD COLUMN website TEXT;
-- ALTER TABLE hotels ADD COLUMN description TEXT;
