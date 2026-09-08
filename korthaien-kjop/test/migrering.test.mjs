import test from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
const DB = `/tmp/migr-test-${process.pid}.db`;
rmSync(DB, { force: true });
process.env.DATABASE_URL = `file:${DB}`;
const { db, migrate } = await import("../src/db.ts");
process.on("exit", () => rmSync(DB, { force: true }));

// Bygger en database med den gamle strukturen — uten front_norm, gjettet og
// forslag — og sjekker at migreringen tar den videre uten å miste data.
test("gammel database oppgraderes uten datatap", async () => {
  await db().execute(`CREATE TABLE cards (
    id TEXT PRIMARY KEY, oracle_id TEXT NOT NULL, name TEXT NOT NULL,
    name_norm TEXT NOT NULL, set_code TEXT NOT NULL, collector_number TEXT,
    rarity TEXT, usd REAL, usd_foil REAL, has_nonfoil INTEGER NOT NULL DEFAULT 1,
    has_foil INTEGER NOT NULL DEFAULT 0, image_uri TEXT, released_at TEXT)`);
  await db().execute(`CREATE TABLE mystore_categories (
    category_id TEXT PRIMARY KEY, name TEXT, parent_id TEXT, set_code TEXT,
    manuell INTEGER NOT NULL DEFAULT 0, seen_at TEXT NOT NULL)`);
  await db().execute(`CREATE TABLE mystore_unmatched (
    product_id TEXT PRIMARY KEY, sku TEXT, name TEXT,
    stock INTEGER NOT NULL DEFAULT 0, seen_at TEXT NOT NULL)`);
  await db().execute(`INSERT INTO cards (id,oracle_id,name,name_norm,set_code)
    VALUES ('x','o','Lightning Bolt','lightningbolt','lea')`);
  await db().execute(`INSERT INTO mystore_categories (category_id,name,set_code,manuell,seen_at)
    VALUES ('7','Rare','inv',1,'2026-01-01')`);

  await migrate();

  const k = await db().execute("PRAGMA table_info(cards)");
  const navn = new Set(k.rows.map((r) => String(r.name)));
  assert.ok(navn.has("front_norm"), "front_norm er lagt til");

  const kat = await db().execute("PRAGMA table_info(mystore_categories)");
  const katNavn = new Set(kat.rows.map((r) => String(r.name)));
  assert.ok(katNavn.has("gjettet") && katNavn.has("forslag"), "nye kategorikolonner");

  const um = await db().execute("PRAGMA table_info(mystore_unmatched)");
  const umNavn = new Set(um.rows.map((r) => String(r.name)));
  assert.ok(umNavn.has("category") && umNavn.has("set_code"), "nye produktkolonner");

  const kort = await db().execute("SELECT name FROM cards WHERE id = 'x'");
  assert.equal(kort.rows[0].name, "Lightning Bolt", "kortet er urørt");
  const manuell = await db().execute("SELECT set_code, manuell FROM mystore_categories WHERE category_id='7'");
  assert.equal(manuell.rows[0].set_code, "inv", "manuell kobling beholdt");
  assert.equal(Number(manuell.rows[0].manuell), 1);
});

test("migreringen fyller forsidenavn, ikke bare lager kolonnen", async () => {
  // Kolonnen alene er verdiløs. Feilen er usynlig hvis den bare opprettes.
  await db().execute(`INSERT INTO cards (id,oracle_id,name,name_norm,set_code)
    VALUES ('dfc','o2','Akki Lavarunner // Tok-Tok, Volcano Born','akkilavarunnertoktokvolcanoborn','chk')`);
  await migrate();
  const r = await db().execute("SELECT front_norm FROM cards WHERE id = 'dfc'");
  assert.equal(r.rows[0].front_norm, "akkilavarunner");
});

test("migreringen tåler å kjøres flere ganger", async () => {
  const før = await db().execute("SELECT COUNT(*) AS n FROM cards");
  await migrate();
  await migrate();
  const etter = await db().execute("SELECT COUNT(*) AS n FROM cards");
  assert.equal(Number(etter.rows[0].n), Number(før.rows[0].n), "ingen kort duplisert eller tapt");
  const dfc = await db().execute("SELECT front_norm FROM cards WHERE id = 'dfc'");
  assert.equal(dfc.rows[0].front_norm, "akkilavarunner", "forsidenavnet står støtt");
});
