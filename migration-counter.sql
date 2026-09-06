-- Zaehler fuer kostenpflichtige Fremdaufrufe, je Dienst und Monat.
CREATE TABLE IF NOT EXISTS usage_counter (
  dienst     TEXT NOT NULL,
  monat      TEXT NOT NULL,        -- JJJJ-MM
  anzahl     INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (dienst, monat)
);
