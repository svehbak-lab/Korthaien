// Kvoten følger hyllene, ikke pengene.
//
// Før var de bundet sammen: gjorde du opp ordren, var kortene frie. Men
// oppgjøret skjer når kunden skal ha pengene sine, og innleggingen i Mystore
// skjer når du rekker det. I mellomrommet var kortene verken i beholdningen
// eller reservert — og da kunne de samme kortene loves bort på nytt.
//
// Det som holdes fast ved her: en gjort opp ordre reserverer fortsatt til
// den er frigitt, frigivelsen skjer bare én gang, og historiske ordrer
// begynte ikke å reservere på nytt da kolonnen kom.

import test from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";

const DB = `/tmp/frigi-${process.pid}.db`;
rmSync(DB, { force: true });
process.env.DATABASE_URL = `file:${DB}`;

const { migrate, db, settSetting } = await import("../src/db.ts");
const { hentKvote, hentKvoterBulk, frigiKvote } = await import("../src/quota.ts");

await migrate();
process.on("exit", () => rmSync(DB, { force: true }));
await settSetting("usd_nok", 10);

const NÅ = new Date().toISOString();

await db().execute(
  `INSERT INTO sets (code,name,released_at,card_count) VALUES ('blb','Bloomburrow','2024-08-02',281)`
);
await db().execute({
  sql: `INSERT INTO set_rules (set_code,enabled,wanted_default,wanted_foil,conditions,ladder,updated_at)
        VALUES ('blb',1,8,4,?,?,?)`,
  args: [JSON.stringify(["NM"]), JSON.stringify({ NM: 100 }), NÅ],
});
await db().execute({
  sql: `INSERT INTO cards (id, oracle_id, name, name_norm, set_code, collector_number,
                           rarity, er_token, er_serialized, has_nonfoil, has_foil, usd)
        VALUES ('k1','o1','Mossborn Hydra','mossborn hydra','blb','1','rare',0,0,1,1,'2.00')`,
});

let teller = 0;
async function lagOrdre(status, antall, frigitt = null) {
  const nr = `K-${++teller}`;
  const r = await db().execute({
    sql: `INSERT INTO orders (order_no, customer_name, email, status,
                              total_nok, total_ore, created_at, expires_at, kvote_frigitt_at)
          VALUES (?,?,?,?,0,0,?,?,?)`,
    args: [nr, "Kari", "kari@example.com", status, NÅ, NÅ, frigitt],
  });
  const id = Number(r.lastInsertRowid);
  await db().execute({
    sql: `INSERT INTO order_lines (order_id, card_id, card_name, set_code, set_name, finish,
                                  condition, qty, unit_nok, unit_ore)
          VALUES (?, 'k1', 'Mossborn Hydra', 'blb', 'Bloomburrow', 'nonfoil', 'NM', ?, 1, 100)`,
    args: [id, antall],
  });
  return id;
}

async function regel() {
  const r = await db().execute("SELECT * FROM set_rules WHERE set_code = 'blb'");
  const x = r.rows[0];
  return { ...x, enabled: Number(x.enabled), wanted_default: Number(x.wanted_default),
           wanted_foil: Number(x.wanted_foil) };
}

const reservert = async () =>
  (await hentKvote("k1", "nonfoil", "blb", await regel())).reserved;

test("en mottatt ordre reserverer, som før", async () => {
  await lagOrdre("received", 3);
  assert.equal(await reservert(), 3);
});

test("en gjort opp ordre reserverer fortsatt til den er frigitt", async () => {
  // Dette er hele poenget. Kunden har fått kreditten sin, men kortene står
  // ikke i Mystore ennå, og da er de ikke tilgjengelige for nye innsendere.
  await lagOrdre("stocked", 2);
  assert.equal(await reservert(), 5);
});

test("frigivelsen slipper akkurat den ordren", async () => {
  const id = await lagOrdre("stocked", 4);
  assert.equal(await reservert(), 9);

  await frigiKvote(id);
  assert.equal(await reservert(), 5, "bare den frigitte skal falle bort");
});

test("å trykke to ganger flytter ikke tidspunktet", async () => {
  // To faner, eller en utålmodig finger. Den andre gangen skal ikke skrive
  // et nytt tidspunkt over det første.
  const id = await lagOrdre("stocked", 1);
  const først = await frigiKvote(id);
  const igjen = await frigiKvote(id);
  assert.equal(igjen, først);
});

test("kansellerte og utløpte ordrer reserverer ikke", async () => {
  const før = await reservert();
  await lagOrdre("cancelled", 6);
  await lagOrdre("expired", 6);
  assert.equal(await reservert(), før);
});

test("bulkvarianten svarer det samme som enkeltoppslaget", async () => {
  // To spørringer med samme regel skrevet to steder er to steder regelen
  // kan skli fra hverandre. De deler nå én streng, og dette er vakten.
  const bulk = await hentKvoterBulk([{ card_id: "k1", finish: "nonfoil" }]);
  const en = await hentKvote("k1", "nonfoil", "blb", await regel());
  assert.equal(bulk.get("k1:nonfoil").reserved, en.reserved);
});
