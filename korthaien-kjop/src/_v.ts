import { db, migrate } from "./db.js";
await migrate();
const r = await db().execute("SELECT variant, COUNT(*) AS n FROM cards GROUP BY variant ORDER BY n DESC");
console.log(r.rows);
const b = await db().execute("SELECT id,collector_number,variant,usd FROM cards WHERE set_code='cmr' AND name_norm='boldplagiarist'");
console.log(b.rows);
process.exit(0);
