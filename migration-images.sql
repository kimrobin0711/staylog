-- Ein Bild je Hotel wird dauerhaft gespeichert, statt es bei jedem Aufruf neu zu holen.
ALTER TABLE hotels ADD COLUMN image_url TEXT;
ALTER TABLE hotels ADD COLUMN rating REAL;
ALTER TABLE hotels ADD COLUMN rating_count INTEGER;
ALTER TABLE hotels ADD COLUMN rating_at TEXT;
