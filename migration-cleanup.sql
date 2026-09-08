-- Entfernt Zitatmarkierungen, die aus der Websuche in die Texte gerutscht sind.
UPDATE hotels
   SET description = TRIM(REPLACE(REPLACE(description, '</cite>', ''), '<cite', ''))
 WHERE description LIKE '%cite%';

UPDATE hotels
   SET breakfast_note = TRIM(REPLACE(REPLACE(breakfast_note, '</cite>', ''), '<cite', ''))
 WHERE breakfast_note LIKE '%cite%';
