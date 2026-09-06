-- Selbstregistrierte Mitglieder. Adresse ist die Kennung, Name die Unterschrift.
CREATE TABLE IF NOT EXISTS members (
  email      TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  statuses   TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS members_name_idx ON members(name);
