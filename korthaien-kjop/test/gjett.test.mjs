import test from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
const DB = `/tmp/gjett-test-${process.pid}.db`;
rmSync(DB, { force: true });
process.env.DATABASE_URL = `file:${DB}`;
const { db, migrate, normaliser } = await import("../src/db.ts");
const { gjettSett } = await import("../src/gjett.ts");
await migrate();
process.on("exit", () => rmSync(DB, { force: true }));

// Invasion har 12 egne kort. Lightning Bolt finnes overalt, som i virkeligheten.
const inv = ["Void","Blazing Specter","Fires of Yavimaya","Rith the Awakener","Urborg Volcano",
  "Tsabo's Web","Coalition Victory","Recoil","Tsabo Tavoc","Sterling Grove","Aura Shards","Cauldron Dance"];
const mh2 = ["Ragavan, Nimble Pilferer","Urza's Saga","Grief","Solitude"];
let n = 0;
async function leggInn(navn, sett) {
  await db().execute({ sql: `INSERT INTO cards (id,oracle_id,name,name_norm,set_code,collector_number,rarity,usd,usd_foil,has_nonfoil,has_foil,image_uri,released_at)
    VALUES (?,?,?,?,?,'1','rare',1,NULL,1,0,NULL,NULL)`, args: [`k${++n}`, `o${n}`, navn, normaliser(navn), sett] });
}
for (const k of inv) await leggInn(k, "inv");
for (const k of mh2) await leggInn(k, "mh2");
for (const s of ["inv","mh2","lea","2ed"]) await leggInn("Lightning Bolt", s);
await db().batch([
  { sql: "INSERT INTO sets (code,name,released_at,card_count) VALUES ('inv','Invasion','2000-10-02',350)", args: [] },
  { sql: "INSERT INTO sets (code,name,released_at,card_count) VALUES ('mh2','Modern Horizons 2','2021-06-18',303)", args: [] },
], "write");

test("en kategori full av Invasion-kort peker på Invasion", async () => {
  const g = await gjettSett([...inv, "Lightning Bolt"]);
  assert.equal(g.sikker?.set_code, "inv");
  assert.ok(g.sikker.andel > 0.9);
});

test("butikknavn med foil og parentes tolkes riktig", async () => {
  const g = await gjettSett(inv.map((k) => `${k} (Invasion) Foil`));
  assert.equal(g.sikker?.set_code, "inv");
});

test("for få kort gir ingen konklusjon", async () => {
  const g = await gjettSett(inv.slice(0, 4));
  assert.equal(g.sikker, null);
  assert.ok(g.kandidater[0].set_code === "inv", "men kandidaten vises likevel");
});

test("blandet innhold gir ingen konklusjon", async () => {
  const g = await gjettSett([...inv.slice(0, 6), ...mh2, "Lightning Bolt", "Ukjent kort", "Enda et ukjent"]);
  assert.equal(g.sikker, null, "for lav andel og for jevnt mellom to sett");
});

test("bare ukjente navn gir ingen kandidater", async () => {
  const g = await gjettSett(["Zzz En", "Zzz To", "Zzz Tre", "Zzz Fire", "Zzz Fem",
                             "Zzz Seks", "Zzz Sju", "Zzz Atte", "Zzz Ni"]);
  assert.equal(g.sikker, null);
  assert.equal(g.kandidater.length, 0);
});

test("tom liste krasjer ikke", async () => {
  const g = await gjettSett([]);
  assert.equal(g.antallKort, 0);
  assert.equal(g.sikker, null);
});
