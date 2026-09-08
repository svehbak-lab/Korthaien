import test from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
const DB = `/tmp/fam-${process.pid}.db`;
rmSync(DB, { force: true });
process.env.DATABASE_URL = `file:${DB}`;
process.env.MYSTORE_URL = "https://eksempel.test/api";
process.env.MYSTORE_KEY = "test";
const { db, migrate, normaliser } = await import("../src/db.ts");
await migrate();
process.on("exit", () => rmSync(DB, { force: true }));

// Ekte struktur: Strixhaven med Mystical Archive og Art Series som barn,
// pluss The List som ikke er i familien.
const sett = [
  ["stx", "Strixhaven: School of Mages", "2021-04-23", null],
  ["sta", "Strixhaven Mystical Archive", "2021-04-23", "stx"],
  ["astx", "Strixhaven Art Series", "2021-04-23", "stx"],
  ["plst", "The List", "2020-11-01", null],
];
for (const [c, n, d, p] of sett) {
  await db().execute({
    sql: "INSERT INTO sets (code,name,released_at,card_count,parent_code) VALUES (?,?,?,100,?)",
    args: [c, n, d, p],
  });
}
async function kort(id, navn, s) {
  await db().execute({
    sql: `INSERT INTO cards (id,oracle_id,name,name_norm,set_code,collector_number,rarity,usd,usd_foil,has_nonfoil,has_foil,image_uri,released_at)
          VALUES (?,?,?,?,?,'1','rare',1,NULL,1,1,NULL,NULL)`,
    args: [id, id, navn, normaliser(navn), s],
  });
}
await kort("sta-brainstorm", "Brainstorm", "sta");
await kort("plst-brainstorm", "Brainstorm", "plst");
await kort("stx-mascot", "Academic Probation", "stx");
await kort("sta-counter", "Counterspell", "sta");

// Samme spørring som synken bruker
async function slåOpp(setCode, navn) {
  const r = await db().execute("SELECT code, parent_code FROM sets");
  const fam = new Map();
  for (const x of r.rows) {
    const k = String(x.code);
    if (!fam.has(k)) fam.set(k, [k]);
    const f = x.parent_code ? String(x.parent_code) : null;
    if (f && f !== k) {
      if (!fam.has(f)) fam.set(f, [f]);
      fam.get(f).push(k);
    }
  }
  const s = fam.get(setCode) || [setCode];
  const n = normaliser(navn);
  const plass = s.map(() => "?").join(",");
  const t = await db().execute({
    sql: `SELECT c.id FROM cards c LEFT JOIN sets s ON s.code = c.set_code
           WHERE c.set_code IN (${plass}) AND c.name_norm = ?
           ORDER BY (c.set_code = ?) DESC, s.released_at ASC LIMIT 1`,
    args: [...s, n, setCode],
  });
  return t.rows[0]?.id ?? null;
}

test("kort fra bonusark finnes under hovedsettet", async () => {
  assert.equal(await slåOpp("stx", "Counterspell"), "sta-counter");
});

test("hovedsettets egne kort finnes fortsatt", async () => {
  assert.equal(await slåOpp("stx", "Academic Probation"), "stx-mascot");
});

test("The List er ikke i familien og forstyrrer ikke", async () => {
  // Brainstorm finnes i både sta og plst. Fra en Strixhaven-kategori skal
  // sta velges, siden plst ikke er barn av stx.
  assert.equal(await slåOpp("stx", "Brainstorm"), "sta-brainstorm");
});

test("kort som ikke finnes i familien gir ingen treff", async () => {
  assert.equal(await slåOpp("stx", "Lightning Bolt"), null);
});

test("et sett uten barn oppfører seg som før", async () => {
  assert.equal(await slåOpp("plst", "Brainstorm"), "plst-brainstorm");
});
