import test from "node:test"; import assert from "node:assert/strict"; import { rmSync } from "node:fs";
const DB = `/tmp/navn-${process.pid}.db`; rmSync(DB, { force: true }); process.env.DATABASE_URL = `file:${DB}`;
const { db, migrate, kortSettnavn } = await import("../src/db.ts"); await migrate();
test("navn", async () => {
  for (const [c, n, v] of [["trk","Magic: The Gathering | Star Trek",null],["ttrk","Magic: The Gathering | Star Trek Tokens",null],["fin","Magic: The Gathering—FINAL FANTASY",null],["xyz","Magic: The Gathering | Egen","Mitt navn"],["dom","Dominaria",null]])
    await db().execute({ sql: "INSERT INTO sets (code,name,released_at,card_count,parent_code,visningsnavn) VALUES (?,?,'2026-01-01',1,NULL,?)", args: [c,n,v] });
  await kortSettnavn();
  const r = Object.fromEntries((await db().execute("SELECT code, visningsnavn FROM sets")).rows.map(x => [x.code, x.visningsnavn]));
  assert.deepEqual(r, { trk: "Star Trek", ttrk: "Star Trek Tokens", fin: "FINAL FANTASY", xyz: "Mitt navn", dom: null });
});
process.on("exit", () => rmSync(DB, { force: true }));
