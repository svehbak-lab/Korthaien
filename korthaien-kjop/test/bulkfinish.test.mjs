import test from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";

// Kunden limte inn vanlige commons og fikk dem «løst» som foil: den vanlige
// utgaven ble ikke kjøpt (under minsteprisen / kvote 0), foilen ble det, og
// bulkoppløsningen falt tilbake på det som var igjen.
const DB = `/tmp/bulkfinish-${process.pid}.db`;
rmSync(DB, { force: true });
process.env.DATABASE_URL = `file:${DB}`;

const { db, migrate, normaliser } = await import("../src/db.ts");
const { parseBulk } = await import("../src/bulk.ts");
const { løsBulk } = await import("../src/catalog.ts");

await migrate();
process.on("exit", () => rmSync(DB, { force: true }));

// Settet kjøper bare foil.
await db().execute({
  sql: "INSERT INTO sets (code,name,released_at,card_count,parent_code) VALUES ('m10','Magic 2010','2009-07-17',300,NULL)",
});
await db().execute({
  sql: `INSERT INTO set_rules (set_code,enabled,wanted_default,wanted_foil,conditions,ladder,buy_pct,updated_at)
        VALUES ('m10',1,0,4,?,?,NULL,'2026-01-01')`,
  args: [JSON.stringify(["NM"]), JSON.stringify({ NM: 100 })],
});
async function kort(id, navn, nr, { nonfoil = 1, foil = 1 } = {}) {
  await db().execute({
    sql: `INSERT INTO cards (id,oracle_id,name,name_norm,front_norm,back_norm,variant,set_code,
                             collector_number,rarity,usd,usd_foil,has_nonfoil,has_foil,image_uri,released_at)
          VALUES (?,?,?,?,NULL,NULL,'vanlig','m10',?,'common',2,5,?,?,NULL,'2009-07-17')`,
    args: [id, navn, navn, normaliser(navn), nr, nonfoil, foil],
  });
}
await kort("elves", "Llanowar Elves", "190");
await kort("bare-foil", "Shiny Promo", "300", { nonfoil: 0, foil: 1 });

const én = async (t) => (await løsBulk(parseBulk(t)))[0];

test("vanlig linje med sett blir ikke foil når vanlig ikke kjøpes", async () => {
  const r = await én("4 Llanowar Elves (M10) 190");
  assert.equal(r.status, "ikke_ønsket");
  assert.equal(r.valg.length, 0);
  assert.match(r.melding, /Kjøpes ikke for øyeblikket/);
});

test("vanlig linje uten sett gir foil bare som forslag, aldri løst", async () => {
  const r = await én("4 Llanowar Elves");
  assert.equal(r.status, "velg");
  assert.equal(r.annenFinish, true);
  assert.equal(r.valg[0].finish, "foil");
});

test("foil-markert linje løses som foil", async () => {
  const r = await én("1 Llanowar Elves (M10) 190 *F*");
  assert.equal(r.status, "løst");
  assert.equal(r.valg[0].finish, "foil");
  assert.equal(r.annenFinish, undefined);
});

test("trykk som bare finnes i foil løses som foil uten markering", async () => {
  const r = await én("1 Shiny Promo (M10) 300");
  assert.equal(r.status, "løst");
  assert.equal(r.valg[0].finish, "foil");
});
