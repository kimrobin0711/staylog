-- Nullen aus der ersten Fassung in leere Werte umwandeln.
UPDATE room_types SET size_sqm = NULL WHERE size_sqm = 0;
UPDATE room_types SET max_occupancy = NULL WHERE max_occupancy = 0;
