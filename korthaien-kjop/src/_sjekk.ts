import { db, migrate, normaliser } from "./db.js";
await migrate();
const r = await db().execute(`
  SELECT c.set_code, s.name, COUNT(DISTINCT c.name_norm) AS treff
    FROM mystore_unmatched u
    JOIN cards c ON c.name_norm = normalisert(u.name)
    LEFT JOIN sets s ON s.code = c.set_code
   WHERE u.set_code = 'cmb1' GROUP BY c.set_code ORDER BY treff DESC LIMIT 8`);
console.log(r.rows);
process.exit(0);
