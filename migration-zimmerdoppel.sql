-- Raeumt die Doppelung "... – Zimmer" auf, die entstand, weil "Zweibettzimmer"
-- durch "Zimmer" ersetzt wurde, auch wenn es als eigener Namensteil hinten
-- stand. Betrifft 176 von 7623 Eintraegen (10.9.2026).
--
-- Zuerst die Eintraege, deren bereinigter Name im selben Haus schon existiert.
-- Die wuerden den Primaerschluessel verletzen und sind ohnehin Dubletten.

DELETE FROM chain_rooms
 WHERE (name LIKE '% – Zimmer' OR name LIKE '% - Zimmer')
   AND EXISTS (
     SELECT 1 FROM chain_rooms x
      WHERE x.ctyhocn = chain_rooms.ctyhocn
        AND x.name = TRIM(SUBSTR(chain_rooms.name, 1, LENGTH(chain_rooms.name) - 9))
   );

-- Der Rest wird gekuerzt.
UPDATE chain_rooms
   SET name = TRIM(SUBSTR(name, 1, LENGTH(name) - 9))
 WHERE name LIKE '% – Zimmer' OR name LIKE '% - Zimmer';
