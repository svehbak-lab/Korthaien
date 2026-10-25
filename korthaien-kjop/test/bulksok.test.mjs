// Bulksøk i butikken: lim inn en liste, få det som er på lager, billigst først.
import test from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";

const DB = `/tmp/bulksok-${process.pid}.db`;
rmSync(DB, { force: true });
process.env.DATABASE_URL = `file:${DB}`;
process.env.LAGERKILDE = "bok";
const { db, migrate, normaliser } = await import("../src/db.ts");
const { bulkSøk } = await import("../src/bulksok.ts");
const salg = await import("../src/salg.ts");
const { settManuellSalg } = await import("../src/salgspris.ts");
await migrate();
process.on("exit", () => rmSync(DB, { force: true }));

await db().execute("INSERT INTO sets (code,name,released_at,card_count,parent_code) VALUES ('m10','Magic 2010','2009-07-17',249,NULL),('a25','Masters 25','2018-03-16',249,NULL)");
async function kort(id, navn, sett, nr, { front = null, foilPris = null, pris = 1000, lager = {} } = {}) {
  await db().execute({
    sql: `INSERT INTO cards (id,oracle_id,name,name_norm,front_norm,variant,set_code,collector_number,rarity,usd,has_nonfoil,has_foil,released_at)
          VALUES (?,?,?,?,?,'vanlig',?,?,'common',1,1,1,'2020-01-01')`,
    args: [id, "o-" + navn, navn, normaliser(navn), front ? normaliser(front) : null, sett, nr],
  });
  await settManuellSalg(id, "nonfoil", pris);
  if (foilPris) await settManuellSalg(id, "foil", foilPris);
  for (const [k, n] of Object.entries(lager)) {
    const [finish, cond] = k.split(":");
    await db().execute({ sql: "INSERT INTO lager_bevegelser (card_id,finish,condition,antall,grunn,created_at) VALUES (?,?,?,?,'manuell','2026-01-01')", args: [id, finish, cond, n] });
  }
}
await kort("bolt-m10", "Lightning Bolt", "m10", "146", { pris: 1500, lager: { "nonfoil:NM": 3 } });
await kort("bolt-a25", "Lightning Bolt", "a25", "141", { pris: 900, foilPris: 4000, lager: { "nonfoil:NM": 1, "foil:NM": 2 } });
await kort("delver", "Delver of Secrets // Insectile Aberration", "m10", "51", { front: "Delver of Secrets", pris: 500, lager: { "nonfoil:EX": 2 } });
await kort("tom", "Counterspell", "a25", "50", { pris: 500 });

test("billigst først, alle utgaver på lager, settet i lista betyr ingenting", async () => {
  const r = await bulkSøk("4 Lightning Bolt (M10) 146\n2x Delver of Secrets\n1 Counterspell\n1 Finnes Ikke\n");
  assert.equal(r.treff.length, 4);
  const bolt = r.treff[0];
  assert.equal(bolt.antall, 4);
  assert.deepEqual(bolt.alternativer.map((a) => [a.card_id, a.finish, a.enhet_ore]), [
    ["bolt-a25", "nonfoil", 900], ["bolt-m10", "nonfoil", 1500], ["bolt-a25", "foil", 4000],
  ]);
  assert.equal(r.treff[1].navn, "Delver of Secrets // Insectile Aberration");
  assert.equal(r.treff[1].alternativer[0].condition, "EX");
  assert.equal(r.treff[2].status, "ikke_på_lager");
  assert.equal(r.treff[3].status, "ukjent");
});

test("kun foils, og samme navn på flere linjer slås sammen", async () => {
  const r = await bulkSøk("Deck\n1 Lightning Bolt\n// Sideboard\nSideboard:\n2 Lightning Bolt", true);
  assert.equal(r.treff.length, 1);
  assert.equal(r.treff[0].antall, 3);
  assert.deepEqual(r.treff[0].alternativer.map((a) => a.finish), ["foil"]);
});

test("handlekurven sorteres som salgsordrene: sett, raritet, navn", async () => {
  const l = await salg.prisKurv([
    { card_id: "bolt-m10", finish: "nonfoil", condition: "NM", antall: 1 },
    { card_id: "bolt-a25", finish: "nonfoil", condition: "NM", antall: 1 },
  ]);
  assert.deepEqual(l.map((x) => x.set_name), ["Magic 2010", "Masters 25"]);
});
