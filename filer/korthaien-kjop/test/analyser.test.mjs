import test from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
const DB = `/tmp/analyser-${process.pid}.db`;
rmSync(DB, { force: true });
process.env.DATABASE_URL = `file:${DB}`;
const { db, migrate, normaliser } = await import("../src/db.ts");
const { analyserGruppe } = await import("../src/analyser.ts");
await migrate();
process.on("exit", () => rmSync(DB, { force: true }));

async function sett(kode, navn) {
  await db().execute({ sql: "INSERT INTO sets (code,name,released_at,card_count) VALUES (?,?,'2020-01-01',100)", args: [kode, navn] });
}
async function kort(navn, s) {
  await db().execute({
    sql: `INSERT INTO cards (id,oracle_id,name,name_norm,set_code,collector_number,rarity,usd,usd_foil,has_nonfoil,has_foil,image_uri,released_at)
          VALUES (?,?,?,?,?,'1','rare',1,NULL,1,0,NULL,NULL)`,
    args: [`${s}-${navn}`, navn, navn, normaliser(navn), s],
  });
}
async function ukoblet(navn, s = "cmb1") {
  await db().execute({
    sql: `INSERT INTO mystore_unmatched (product_id,sku,name,stock,category,set_code,seen_at)
          VALUES (?,?,?,1,'Rare',?,'2026-01-01')`,
    args: [`${s}-${navn}`, "1", navn, s],
  });
}

await sett("mb1", "Mystery Booster");
await sett("cmb1", "Mystery Booster Playtest Cards");
await sett("plst", "The List");

// Åtte kort i mb1, to i cmb1, ingen overlapp
const iMb1 = ["Alesha Who Smiles at Death", "Mulldrifter", "Deduce", "Tatyova Benthic Druid",
              "Planar Outburst", "Court of Ardenvale", "Hour of Eternity", "Cultivator of Blades"];
for (const n of iMb1) await kort(n, "mb1");
for (const n of ["Rukh Egg Playtest", "Bear With Set's Mechanic"]) await kort(n, "cmb1");
for (const n of [...iMb1, "Rukh Egg Playtest", "Bear With Set's Mechanic", "Forseglet Boosterboks"]) await ukoblet(n);

test("fordelingen viser hvor kortene faktisk hører hjemme", async () => {
  const a = await analyserGruppe("cmb1");
  assert.equal(a.produkter, 11);
  assert.equal(a.fordeling[0].set_code, "mb1");
  assert.equal(a.fordeling[0].treff, 8);
  assert.equal(a.fordeling[1].set_code, "cmb1");
  assert.equal(a.fordeling[1].treff, 2);
});

test("navn uten treff listes for seg", async () => {
  const a = await analyserGruppe("cmb1");
  assert.ok(a.utenTreff.includes("Forseglet Boosterboks"));
});

test("uten overlapp kan kategorien peke på flere sett", async () => {
  const a = await analyserGruppe("cmb1");
  assert.equal(a.iFlereSett.length, 0);
});

test("overlapp oppdages når det finnes", async () => {
  // Samme kort i to sett — da er oppslaget ikke entydig lenger.
  await kort("Mulldrifter", "plst");
  await ukoblet("Mulldrifter", "annen");
  await db().execute("UPDATE mystore_unmatched SET set_code='cmb1' WHERE product_id='annen-Mulldrifter'");
  const a = await analyserGruppe("cmb1");
  const m = a.iFlereSett.find((x) => x.navn === "Mulldrifter");
  assert.ok(m, "Mulldrifter skal flagges");
  assert.deepEqual(m.sett.sort(), ["mb1", "plst"]);
});

test("foil og parenteser påvirker ikke oppslaget", async () => {
  await ukoblet("Deduce (foil)", "vis");
  await db().execute("UPDATE mystore_unmatched SET set_code='vis' WHERE product_id='vis-Deduce (foil)'");
  const a = await analyserGruppe("vis");
  assert.equal(a.fordeling[0].set_code, "mb1");
});

test("tom gruppe krasjer ikke", async () => {
  const a = await analyserGruppe("finnesikke");
  assert.equal(a.produkter, 0);
  assert.deepEqual(a.fordeling, []);
});
