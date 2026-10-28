// Etterføringen: bare det som mangler foreslås; flyttede koblinger skjules.
import test from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";

const DB = `/tmp/etterforing-${process.pid}.db`;
rmSync(DB, { force: true });
process.env.DATABASE_URL = `file:${DB}`;
process.env.LAGERKILDE = "bok";
const { db, migrate } = await import("../src/db.ts");
const { etterføringsforslag, etterfør } = await import("../src/etterforing.ts");
await migrate();
process.on("exit", () => rmSync(DB, { force: true }));

const kort = (id, navn, sett, nr) => db().execute({
  sql: `INSERT INTO cards (id,oracle_id,name,name_norm,set_code,collector_number,rarity,has_nonfoil,has_foil) VALUES (?,?,?,?,?,?,'common',1,0)`,
  args: [id, id, navn, navn.toLowerCase(), sett, nr],
});
const speil = (id, qty, prod) => db().execute({
  sql: "INSERT INTO mystore_stock (card_id, finish, qty, product_id, product_name, synced_at) VALUES (?, 'nonfoil', ?, ?, ?, '2026-10-28')",
  args: [id, qty, prod, prod],
});
const åpning = (id, n) => db().execute({
  sql: "INSERT INTO lager_bevegelser (card_id, finish, condition, antall, grunn, notat, created_at) VALUES (?, 'nonfoil', 'NM', ?, 'mystore', 'Åpningsbeholdning fra Mystore', '2026-10-27T15:23:00Z')",
  args: [id, n],
});

test("flytting skjules, mangler foreslås, færre er ikke valgt", async () => {
  await db().execute("INSERT INTO sets (code,name,released_at,card_count) VALUES ('spm','Spider-Man','2025-01-01',10),('3ed','Revised Edition','1994-01-01',10)");
  await kort("p1", "Plains", "spm", "1");
  await kort("p2", "Plains", "spm", "2");
  await kort("r1", "Lord of Atlantis", "3ed", "5");
  await kort("r2", "Shivan Dragon", "3ed", "6");
  await åpning("p1", 17);          // ved overgangen: 17 på Plains #1
  await speil("p2", 17, "Plains"); // nå: produktet har tatt Plains #2
  await speil("r1", 4, "Lord");    // Revised: fantes ikke ved overgangen
  await åpning("r2", 3);           // færre i Mystore nå
  await speil("r2", 1, "Shivan");

  const f = await etterføringsforslag();
  assert.equal(f.skjult, 2);
  const lord = f.rader.find((r) => r.card_id === "r1");
  assert.equal(lord.endring, 4);
  assert.equal(lord.foreslått, true);
  const shivan = f.rader.find((r) => r.card_id === "r2");
  assert.equal(shivan.type, "færre");
  assert.equal(shivan.foreslått, false);

  const ut = await etterfør([{ card_id: "r1", finish: "nonfoil" }]);
  assert.equal(ut.pluss, 4);
  const igjen = await etterføringsforslag();
  assert.equal(igjen.rader.some((r) => r.card_id === "r1"), false);
});
