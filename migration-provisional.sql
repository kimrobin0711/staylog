-- Vorlaeufige Kategorien: stammen von Buchungsportalen, bis jemand sie prueft.
ALTER TABLE room_types ADD COLUMN provisional INTEGER NOT NULL DEFAULT 0;
