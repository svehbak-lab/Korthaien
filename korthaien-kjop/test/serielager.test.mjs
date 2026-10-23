// Varselet om beholdning på serienummererte utgaver.
//
// Serieutgaver er holdt utenfor kjøpslista, prisingen og kupplista. Det gjør
// at en feilkobling blir usynlig overalt — bortsett fra i butikken, der
// kortet står til serieutgavens pris. Uten dette tallet oppdages det den
// dagen noen kjøper det.
//
// Kobleren gjetter ikke lenger på serieutgaver, men det som allerede er ført
// står der til noen ser det. Dette er den som ser.

import test from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";

const DB = `/tmp/serielager-${process.pid}.db`;
rmSync(DB, { force: true });
process.env.DATABASE_URL = `file:${DB}`;

const { migrate, db, settSetting } = await import("../src/db.ts");
const { lagerrapport } = await import("../src/statistikk.ts");

await migrate();
process.on("exit", () => rmSync(DB, { force: true }));
await settSetting("usd_nok", 10);

await db().execute(
  `INSERT INTO sets (code,name,released_at,card_count) VALUES ('acr','Assassins Creed','2024-07-05',100)`
);

async function leggKort(id, nummer, serie) {
  await db().execute({
    sql: `INSERT INTO cards (id, oracle_id, name, name_norm, set_code,
                             collector_number, rarity, er_token, er_serialized,
                             has_nonfoil, has_foil, usd, usd_foil)
          VALUES (?,?,?,?,'acr',?,'rare',0,?,1,1,'1.00','2.00')`,
    args: [id, "o-mary", "Mary Read and Anne Bonny", "mary read and anne bonny", nummer, serie],
  });
}

async function leggLager(card_id, qty) {
  await db().execute({
    sql: `INSERT INTO mystore_stock (card_id, finish, qty, pris_ore, synced_at)
          VALUES (?, 'foil', ?, 100000, ?)`,
    args: [card_id, qty, new Date().toISOString()],
  });
}

await leggKort("vanlig", "120", 0);
await leggKort("serial", "120z", 1);

test("uten feilkoblinger står varselet på null", async () => {
  await leggLager("vanlig", 3);
  const r = await lagerrapport();
  assert.equal(r.serienummererte.kort, 0);
  assert.equal(r.serienummererte.eksemplarer, 0);
  assert.deepEqual(r.serienummererte.navn, []);
});

test("beholdning på en serieutgave blir sett", async () => {
  await leggLager("serial", 2);
  const r = await lagerrapport();
  assert.equal(r.serienummererte.kort, 1);
  assert.equal(r.serienummererte.eksemplarer, 2);
  assert.deepEqual(r.serienummererte.navn, ["Mary Read and Anne Bonny"]);
});

test("det vanlige trykket teller ikke med", async () => {
  // Tre eksemplarer av det vanlige står fortsatt inne. Varselet skal bare
  // gjelde serieutgaven, ellers sier det ifra om noe som er helt i orden.
  const r = await lagerrapport();
  assert.equal(r.serienummererte.eksemplarer, 2, "ikke 5");
});

test("et utsolgt feilkoblet kort gir ikke varsel", async () => {
  // Null på lager er ingenting å gjøre noe med, og et varsel som aldri kan
  // slås av blir et varsel ingen leser.
  await db().execute("UPDATE mystore_stock SET qty = 0 WHERE card_id = 'serial'");
  const r = await lagerrapport();
  assert.equal(r.serienummererte.kort, 0);
});
