import test from "node:test";
import assert from "node:assert/strict";
// Egen database per kjøring. Et fast filnavn gjør at testen arver tilstand
// fra forrige kjøring og feiler av feil grunn.
import { rmSync } from "node:fs";
const DB = `/tmp/front-test-${process.pid}.db`;
rmSync(DB, { force: true });
process.env.DATABASE_URL = `file:${DB}`;
const { db, migrate, fyllForsidenavn, normaliser } = await import("../src/db.ts");
await migrate();
process.on("exit", () => rmSync(DB, { force: true }));

const kort = [
  ["f1", "Akki Lavarunner // Tok-Tok, Volcano Born", "chk"],
  ["f2", "Bonecrusher Giant // Stomp", "eld"],
  ["f3", "Fire // Ice", "apc"],
  ["f4", "Lightning Bolt", "lea"],
];
for (const [id, navn, sett] of kort) {
  await db().execute({
    sql: `INSERT INTO cards (id,oracle_id,name,name_norm,set_code,collector_number,rarity,usd,usd_foil,has_nonfoil,has_foil,image_uri,released_at)
          VALUES (?,?,?,?,?,'1','rare',1.0,NULL,1,0,NULL,NULL) ON CONFLICT(id) DO NOTHING`,
    args: [id, id, navn, normaliser(navn), sett],
  });
}

test("bare dobbeltsidige kort får navn på halvdelene", async () => {
  const n = await fyllForsidenavn();
  assert.equal(n, 3);
});

test("splittkort er søkbare på begge halvdeler", async () => {
  // Butikken lister dem én gang per halvdel: «Determined (Bound/Determined)».
  const bak = await db().execute({
    sql: "SELECT id FROM cards WHERE back_norm = ?",
    args: [normaliser("Stomp")],
  });
  assert.equal(bak.rows[0]?.id, "f2", "baksiden finner Bonecrusher Giant // Stomp");
  const ice = await db().execute({
    sql: "SELECT id FROM cards WHERE back_norm = ?",
    args: [normaliser("Ice")],
  });
  assert.equal(ice.rows[0]?.id, "f3");
});

test("parentesformen normaliseres likt som Scryfalls navn", () => {
  // «Bound/Determined» i butikken mot «Bound // Determined» hos Scryfall.
  assert.equal(normaliser("Bound/Determined"), normaliser("Bound // Determined"));
});

test("forsidenavnet er søkbart", async () => {
  const r = await db().execute({
    sql: "SELECT id FROM cards WHERE front_norm = ?",
    args: [normaliser("Bonecrusher Giant")],
  });
  assert.equal(r.rows[0]?.id, "f2");
});

test("enkeltsidige kort er urørt", async () => {
  const r = await db().execute("SELECT front_norm, back_norm FROM cards WHERE id = 'f4'");
  assert.equal(r.rows[0].front_norm, null);
  assert.equal(r.rows[0].back_norm, null);
});

test("hele navnet virker fortsatt", async () => {
  const n = normaliser("Fire // Ice");
  const r = await db().execute({ sql: "SELECT id FROM cards WHERE name_norm = ?", args: [n] });
  assert.equal(r.rows[0]?.id, "f3");
});

test("kjøres den to ganger, gjør den ingenting andre gang", async () => {
  assert.equal(await fyllForsidenavn(), 0);
});
