import test from "node:test";
import assert from "node:assert/strict";
import { rmSync, readFileSync } from "node:fs";
const DB = `/tmp/rydd-${process.pid}.db`;
const CSV = `/tmp/rydd-${process.pid}.csv`;
rmSync(DB, { force: true });
process.env.DATABASE_URL = `file:${DB}`;
const { db, migrate, normaliser } = await import("../src/db.ts");
const { ryddOpp, angreOpprydding } = await import("../src/rydd.ts");
await migrate();
process.on("exit", () => { rmSync(DB, { force: true }); rmSync(CSV, { force: true }); });

async function kort(id, navn, sett = "bfz") {
  await db().execute({
    sql: `INSERT INTO cards (id,oracle_id,name,name_norm,set_code,collector_number,rarity,usd,usd_foil,has_nonfoil,has_foil,image_uri,released_at)
          VALUES (?,?,?,?,?,'1','rare',1,NULL,1,1,NULL,NULL)`,
    args: [id, id, navn, normaliser(navn), sett],
  });
}
async function produkt(id, navn, lager) {
  await db().execute({
    sql: `INSERT INTO mystore_unmatched (product_id,sku,name,stock,category,set_code,seen_at)
          VALUES (?,?,?,?,'Rare','bfz','2026-01-01')`,
    args: [id, id, navn, lager],
  });
}

await kort("c1", "Horribly Awry");
await kort("c2", "Ruinous Path");
// To kort like nær «Fires» — skal ikke godtas automatisk
await kort("c3", "Fire");
await kort("c4", "Fixes");

await produkt("p1", "Horrible Awry", 3);
await produkt("p2", "Ruinous Path Foil", 2);
await produkt("p3", "Dragon Token", 12);
await produkt("p4", "Fires", 1);
await produkt("p5", "Helt Ukjent Sak Uten Match", 4);

const res = await ryddOpp({ rapportSti: CSV }, () => {});

test("entydige skrivefeil kobles", async () => {
  const r = await db().execute("SELECT card_id, finish, kilde FROM mystore_links WHERE product_id='p1'");
  assert.equal(r.rows[0].card_id, "c1");
  assert.equal(r.rows[0].kilde, "auto-skrivefeil");
});

test("foil i produktnavnet gir foil-kobling", async () => {
  const r = await db().execute("SELECT card_id, finish FROM mystore_links WHERE product_id='p2'");
  assert.equal(r.rows[0].card_id, "c2");
  assert.equal(r.rows[0].finish, "foil");
});

test("beholdningen skrives med én gang", async () => {
  const r = await db().execute("SELECT qty FROM mystore_stock WHERE card_id='c1' AND finish='nonfoil'");
  assert.equal(Number(r.rows[0].qty), 3);
});

test("tokens merkes som ikke-kort", async () => {
  const r = await db().execute("SELECT ignored, kilde FROM mystore_links WHERE product_id='p3'");
  assert.equal(Number(r.rows[0].ignored), 1);
  assert.equal(r.rows[0].kilde, "auto-token");
});

test("tvetydige treff kobles ikke", async () => {
  const r = await db().execute("SELECT COUNT(*) AS n FROM mystore_links WHERE product_id='p4'");
  assert.equal(Number(r.rows[0].n), 0, "to kort like nær er et gjett, ikke en rettelse");
});

test("ryddede produkter forsvinner fra lista", async () => {
  const r = await db().execute("SELECT product_id FROM mystore_unmatched ORDER BY product_id");
  assert.deepEqual(r.rows.map((x) => x.product_id), ["p4", "p5"]);
  assert.equal(res.igjen, 2);
});

test("rapporten grupperer det som står igjen", () => {
  const csv = readFileSync(CSV, "utf8");
  assert.ok(csv.includes("Helt Ukjent Sak Uten Match"));
  assert.ok(csv.includes("BFZ"));
});

test("angre fjerner bare automatiske koblinger", async () => {
  await db().execute(`INSERT INTO mystore_links (product_id,card_id,finish,ignored,kilde,updated_at)
                      VALUES ('manuelt','c2','nonfoil',0,'manuell','2026-01-01')`);
  const n = await angreOpprydding(() => {});
  assert.equal(n, 3, "to skrivefeil og én token");
  const r = await db().execute("SELECT product_id FROM mystore_links");
  assert.deepEqual(r.rows.map((x) => x.product_id), ["manuelt"], "manuelle koblinger står");
});
