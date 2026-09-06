-- Aliase je Zimmerkategorie. Noch ohne eigene Oberflaeche, aber die Struktur steht:
-- interner Name "Executive Room" kann spaeter "Executive King Room",
-- "Executive Guest Room" usw. zugeordnet bekommen.
ALTER TABLE room_types ADD COLUMN aliases TEXT;   -- JSON-Array mit Zeichenketten
