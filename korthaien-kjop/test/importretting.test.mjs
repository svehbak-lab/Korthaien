import test from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";

const DB = `/tmp/importretting-${process.pid}.db`;
rmSync(DB, { force: true });
process.env.DATABASE_URL = `file:${DB}`;

const { db, migrate } = await import("../src/db.ts");
const { skrivBolk } = await import("../src/import-scryfall.ts");
await migrate();
process.on("exit", () => rmSync(DB, { force: true }));

const kort = (felt) => ({
  id: "fra154", oracle_id: "o1", set: "fra", rarity: "rare", finishes: ["nonfoil", "foil"],
  released_at: "2026-10-02", prices: { usd: "0.50" }, type_line: "Creature", layout: "normal", ...felt,
});

test("Scryfalls retting av navn og nummer slår gjennom ved neste import", async () => {
  // Forhåndsvisningen: plassholdernavn og foreløpig nummer.
  await skrivBolk([kort({ name: "Tenured Tethermage Preview", collector_number: "999" })]);
  await skrivBolk([kort({ name: "Tenured Tethermage", collector_number: "154" })]);
  const r = (await db().execute("SELECT name, name_norm, collector_number, set_code FROM cards WHERE id = 'fra154'")).rows[0];
  assert.equal(r.name, "Tenured Tethermage");
  assert.equal(r.collector_number, "154");
  assert.match(String(r.name_norm), /tenuredtethermage/);
  assert.doesNotMatch(String(r.name_norm), /preview/);
});
