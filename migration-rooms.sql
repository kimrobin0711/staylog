-- Mehr Details je Zimmerkategorie und ein Vermerk zur Verlaesslichkeit der Reihenfolge.
ALTER TABLE room_types ADD COLUMN type TEXT;            -- room | suite
ALTER TABLE room_types ADD COLUMN size_sqm INTEGER;
ALTER TABLE room_types ADD COLUMN bed_type TEXT;
ALTER TABLE room_types ADD COLUMN max_occupancy INTEGER;
ALTER TABLE room_types ADD COLUMN description TEXT;
ALTER TABLE room_types ADD COLUMN researched_at TEXT;
ALTER TABLE hotels ADD COLUMN rank_reliable INTEGER;    -- 1 sicher, 0 unsicher
