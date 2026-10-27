// Etter overgangen regnes kvoten på kjøpslista mot lagerboken, ikke mot
// Mystore-speilet som står stille.
import test from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";

const DB = `/tmp/kvotebok-${process.pid}.db`;
rmSync(DB, { force: true });
process.env.DATABASE_URL = `file:${DB}`;
process.env.LAGERKILDE = "bok";

const { db, migrate } = await import("../src/db.ts");
const { hentKvoterBulk } = await import("../src/quota.ts");
await migrate();
process.on("exit", () => rmSync(DB, { force: true }));

test("kvoten leser lagerboken etter overgangen", async () => {
  await db().execute("INSERT INTO mystore_stock (card_id, finish, qty, synced_at) VALUES ('k1', 'nonfoil', 9, '2026-10-27')");
  await db().batch([
    { sql: "INSERT INTO lager_bevegelser (card_id, finish, condition, antall, grunn, created_at) VALUES ('k1','nonfoil','NM',5,'mystore','2026-10-27')", args: [] },
    { sql: "INSERT INTO lager_bevegelser (card_id, finish, condition, antall, grunn, created_at) VALUES ('k1','nonfoil','EX',2,'ordre','2026-10-27')", args: [] },
    { sql: "INSERT INTO lager_bevegelser (card_id, finish, condition, antall, grunn, created_at) VALUES ('k1','nonfoil','NM',-1,'salg','2026-10-27')", args: [] },
  ], "write");
  const k = await hentKvoterBulk([{ card_id: "k1", finish: "nonfoil" }]);
  assert.equal(k.get("k1:nonfoil").stock, 6);
});
