import test from "node:test";
import assert from "node:assert/strict";
import { rmSync, readFileSync } from "node:fs";
const DB = `/tmp/skrivefeil-${process.pid}.db`;
const CSV = `/tmp/skrivefeil-${process.pid}.csv`;
rmSync(DB, { force: true });
process.env.DATABASE_URL = `file:${DB}`;
const { db, migrate, normaliser } = await import("../src/db.ts");
const { lagSkrivefeilrapport } = await import("../src/skrivefeil.ts");
await migrate();
process.on("exit", () => { rmSync(DB, { force: true }); rmSync(CSV, { force: true }); });

for (const navn of ["Horribly Awry", "Lightning Bolt", "Ragavan, Nimble Pilferer"]) {
  await db().execute({
    sql: `INSERT INTO cards (id,oracle_id,name,name_norm,set_code,collector_number,rarity,usd,usd_foil,has_nonfoil,has_foil,image_uri,released_at)
          VALUES (?,?,?,?,'bfz','1','rare',1,NULL,1,0,NULL,NULL)`,
    args: [navn, navn, navn, normaliser(navn), ],
  });
}
const nå = "2026-01-01";
const ukoblet = [
  ["p1", "Horrible Awry", 3],        // én bokstav feil
  ["p2", "Lightnig Bolt", 5],        // manglende bokstav
  ["p3", "Dragon Token", 12],        // token
  ["p4", "Eldrazi Scion Token (2 A)", 8],
  ["p5", "Helt Ukjent Kort Uten Match", 1],
];
for (const [id, navn, lager] of ukoblet) {
  await db().execute({
    sql: `INSERT INTO mystore_unmatched (product_id,sku,name,stock,category,set_code,seen_at)
          VALUES (?,?,?,?,'Rare','bfz',?)`,
    args: [id, id, navn, lager, nå],
  });
}

const rader = await lagSkrivefeilrapport(CSV, () => {});

test("skrivefeil får riktig forslag", () => {
  const a = rader.find((r) => r.produkt === "Horrible Awry");
  assert.equal(a.gruppe, "skrivefeil");
  assert.equal(a.forslag, "Horribly Awry");
  const b = rader.find((r) => r.produkt === "Lightnig Bolt");
  assert.equal(b.forslag, "Lightning Bolt");
});

test("tokens skilles ut for seg", () => {
  assert.equal(rader.find((r) => r.produkt === "Dragon Token").gruppe, "token");
  assert.equal(rader.find((r) => r.produkt.startsWith("Eldrazi")).gruppe, "token");
});

test("kort uten nær match gjettes ikke på", () => {
  const r = rader.find((r) => r.produkt.startsWith("Helt Ukjent"));
  assert.equal(r.gruppe, "ukjent");
  assert.equal(r.forslag, "");
});

test("CSV-en kan åpnes i Excel", () => {
  const csv = readFileSync(CSV, "utf8");
  assert.ok(csv.startsWith("\uFEFF"), "BOM så æøå vises riktig");
  assert.ok(csv.includes(";"), "semikolon som skilletegn");
  assert.ok(csv.includes("Horribly Awry"));
  assert.equal(csv.split("\r\n").length, rader.length + 1, "én linje per produkt pluss overskrift");
});

test("lager brukes til å prioritere", () => {
  const skrivefeil = rader.filter((r) => r.gruppe === "skrivefeil");
  // Begge har avstand 1, så den med mest på lager skal komme først.
  assert.equal(skrivefeil[0].produkt, "Lightnig Bolt");
});
