-- Raeumt Kategorien weg, deren Name noch eine Bettangabe enthaelt.
-- Die bereinigte Fassung derselben Kategorie ist bereits vorhanden.
DELETE FROM room_types
 WHERE confirmed = 0
   AND (
     name LIKE '% Kingsize-Bett,%' OR name LIKE '% Queensize-Bett,%'
     OR name LIKE '% Doppelbetten,%' OR name LIKE '% Einzelbetten,%'
     OR name LIKE '% Twinsize%,%'   OR name LIKE '%Schlafzimmer:%'
     OR name LIKE '1 %-Bett,%'      OR name LIKE '2 %-Bett,%'
   );
