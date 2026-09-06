-- Nachtraegliche Spalten fuer bestehende Datenbanken.
-- Steht eine Spalte schon da, meldet D1 "duplicate column name" – das ist harmlos.
ALTER TABLE hotels ADD COLUMN address TEXT;
ALTER TABLE hotels ADD COLUMN website TEXT;
ALTER TABLE hotels ADD COLUMN description TEXT;
