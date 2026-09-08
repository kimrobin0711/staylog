-- Kennzeichnet Kategorien, deren Namen von einem Buchungsportal stammen.
ALTER TABLE room_types ADD COLUMN provisional INTEGER NOT NULL DEFAULT 0;
