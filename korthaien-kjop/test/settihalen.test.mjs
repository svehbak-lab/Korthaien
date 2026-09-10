import test from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";

const DB = `/tmp/hale-${process.pid}.db`;
rmSync(DB, { force: true });
process.env.DATABASE_URL = `file:${DB}`;

const { db, migrate, normaliser } = await import("../src/db.ts");
const { parseBulk } = await import("../src/bulk.ts");
const { løsBulk } = await import("../src/catalog.ts");

await migrate();
process.on("exit", () => rmSync(DB, { force: true }));

const SETT = [
  ["isd", "Innistrad"],
  ["mh1", "Modern Horizons"],
  ["mh3", "Modern Horizons 3"],
  ["leb", "Limited Edition Beta"],
  ["m10", "Magic 2010"],
  ["uma", "Ultimate Masters"],
];
for (const [kode, navn] of SETT) {
  await db().execute({
    sql: "INSERT INTO sets (code,name,released_at,card_count,parent_code) VALUES (?,?,?,300,NULL)",
    args: [kode, navn, "2011-09-30"],
  });
  await db().execute({
    sql: `INSERT INTO set_rules (set_code,enabled,wanted_default,wanted_foil,conditions,ladder,buy_pct,updated_at)
          VALUES (?,1,8,0,?,?,NULL,'2026-01-01')`,
    args: [kode, JSON.stringify(["NM"]), JSON.stringify({ NM: 100 })],
  });
}
async function kort(id, navn, sett, nr, usd) {
  await db().execute({
    sql: `INSERT INTO cards (id,oracle_id,name,name_norm,front_norm,back_norm,variant,set_code,
                             collector_number,rarity,usd,usd_foil,has_nonfoil,has_foil,image_uri,released_at)
          VALUES (?,?,?,?,NULL,NULL,'vanlig',?,?,'mythic',?,NULL,1,0,NULL,'2011-09-30')`,
    args: [id, navn, navn, normaliser(navn), sett, nr, usd],
  });
}
for (const s of ["isd", "mh1", "uma"]) await kort(`lil-${s}`, "Liliana of the Veil", s, "105", 70);
await kort("bolt-m10", "Lightning Bolt", "m10", "146", 5);
await kort("bolt-mh3", "Lightning Bolt", "mh3", "120", 4);
await kort("lotus-leb", "Black Lotus", "leb", "232", 30000);

const én = async (t) => (await løsBulk(parseBulk(t)))[0];

test("settnavn bakerst uten parentes løser linjen", async () => {
  const r = await én("liliana of the veil innistrad");
  assert.equal(r.status, "løst");
  assert.equal(r.valg[0].set_code, "isd");
  // Settnavnet skal ikke bli hengende igjen i kortnavnet.
  assert.equal(r.navn, "liliana of the veil");
});

test("settnavn på flere ord virker også", async () => {
  const r = await én("liliana of the veil ultimate masters");
  assert.equal(r.valg[0].set_code, "uma");
});

test("settnavn som slutter på tall forveksles ikke med samlernummer", async () => {
  // «3» ble lest som samlernummer. Da må «Modern Horizons 3» prøves på nytt
  // med tallet satt tilbake på navnet.
  const r = await én("lightning bolt modern horizons 3");
  assert.equal(r.status, "løst");
  assert.equal(r.valg[0].set_code, "mh3");
});

test("kort settkode i halen virker fortsatt", async () => {
  assert.equal((await én("black lotus beta")).valg[0].set_code, "leb");
  assert.equal((await én("2 lightning bolt magic 2010")).valg[0].set_code, "m10");
});

test("antall foran navnet overlever settnavn i halen", async () => {
  const r = await én("2 lightning bolt magic 2010");
  assert.equal(r.qty, 2);
});

test("uten settnavn får kunden fortsatt velge selv", async () => {
  const r = await én("liliana of the veil");
  assert.equal(r.status, "velg");
  assert.equal(r.valg.length, 3);
});

test("et hale-ord som ikke er et sett spiser ikke kortnavnet", async () => {
  // «veil» er ikke et sett. Linjen skal ikke bli til «liliana of the».
  const r = await én("liliana of the veil");
  assert.equal(r.navn, "liliana of the veil");
});

test("ukjent kort er fortsatt ukjent", async () => {
  const r = await én("finnes ikke innistrad");
  assert.equal(r.status, "ukjent");
});
