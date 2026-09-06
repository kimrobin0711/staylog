-- Nur die Place-ID wird dauerhaft gespeichert. Bewertung und Bilder holt die App
-- bei jedem Aufruf frisch, so wie es Googles Nutzungsbedingungen verlangen.
ALTER TABLE hotels ADD COLUMN google_place_id TEXT;
