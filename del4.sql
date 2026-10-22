SELECT SUM(CASE WHEN ignored = 1 THEN 0 ELSE 1 END) AS koblet,
       SUM(ignored) AS ignorert
  FROM mystore_links WHERE kilde = 'manuell';
