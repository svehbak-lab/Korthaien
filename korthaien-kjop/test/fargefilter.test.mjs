// Fargefilteret i butikken.
//
// Som standard betyr flere farger «minst én av dem» — det er det folk mener
// når de huker av hvit og blå. Men noen ganger er spørsmålet «svarte kort»,
// ikke «kort som har svart i seg». Da huker man av «Bare disse fargene».
//
// Logikken er lett å få subtilt feil: den må kreve at hver valgt farge er
// der OG at ingen av de andre er det. Glemmer man den andre halvdelen, får
// man tilbake «minst én av dem» uten at noe sier fra.

import test from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";

const DB = `/tmp/fargefilter-${process.pid}.db`;
rmSync(DB, { force: true });
process.env.DATABASE_URL = `file:${DB}`;

const { db, migrate, normaliser, settSetting } = await import("../src/db.ts");
const { lagreIntervaller, butikkvisning } = await import("../src/salgspris.ts");

await migrate();
process.on("exit", () => rmSync(DB, { force: true }));
await settSetting("usd_nok", 10);
await lagreIntervaller([{ rarity: "alle", usd_fra: 0, usd_til: 1000, pris_ore: 5000 }]);

await db().execute(
  "INSERT INTO sets (code,name,released_at,card_count,parent_code) VALUES ('tst','Testsett','2020-01-01',6,NULL)"
);

// Fargene lagres som JSON-lista Scryfall sender. Den tomme lista og NULL
// betyr begge «fargeløs» — begge finnes i basen, så begge må testes.
const KORT = [
  ["mono-svart", '["B"]'],
  ["svart-rod", '["B","R"]'],
  ["mono-rod", '["R"]'],
  ["tre-farger", '["W","U","B"]'],
  ["fargelos-tom", "[]"],
  ["fargelos-null", null],
];
for (const [id, colors] of KORT) {
  await db().execute({
    sql: `INSERT INTO cards (id,oracle_id,name,name_norm,front_norm,back_norm,variant,set_code,
                             collector_number,rarity,usd,usd_foil,has_nonfoil,has_foil,colors,released_at)
          VALUES (?,?,?,?,NULL,NULL,'vanlig','tst','1','rare',2,4,1,0,?,'2020-01-01')`,
    args: [id, "o-" + id, id, normaliser(id), colors],
  });
}

const treff = async (farge, fargeEksakt) =>
  (await butikkvisning({ sett: "tst", farge, fargeEksakt, baresalg: false, perSide: 50 })).kort
    .map((k) => k.id)
    .sort();

test("uten avhukingen betyr svart «har svart i seg»", async () => {
  assert.deepEqual(await treff("B", false), ["mono-svart", "svart-rod", "tre-farger"]);
});

test("med avhukingen betyr svart «bare svart»", async () => {
  // Dette var spørsmålet: monofarget svart, ikke svart og rød.
  assert.deepEqual(await treff("B", true), ["mono-svart"]);
});

test("to farger eksakt gir kort som er nøyaktig de to", async () => {
  assert.deepEqual(await treff("B,R", true), ["svart-rod"]);
  // Og ikke det samme som «minst én av dem».
  assert.deepEqual(await treff("B,R", false), [
    "mono-rod", "mono-svart", "svart-rod", "tre-farger",
  ]);
});

test("en farge som ikke finnes alene gir ingenting", async () => {
  assert.deepEqual(await treff("W", true), []);
});

test("fargeløs tar med både tom liste og NULL", async () => {
  assert.deepEqual(await treff("C", false), ["fargelos-null", "fargelos-tom"]);
  assert.deepEqual(await treff("C", true), ["fargelos-null", "fargelos-tom"]);
});

test("fargeløs sammen med en farge lar fargen gjelde", async () => {
  // Et kort er enten uten farge eller ikke; «bare disse fargene» kan ikke
  // være begge. Da er det fargene som gjelder.
  assert.deepEqual(await treff("C,B", true), ["mono-svart"]);
});

test("eksakt er alltid en delmengde av minst-én", async () => {
  // Regelen i én setning. Brytes den, slipper noe gjennom som ikke har
  // fargen i det hele tatt.
  for (const valg of ["B", "R", "B,R", "W,U,B", "C"]) {
    const vide = new Set(await treff(valg, false));
    for (const id of await treff(valg, true)) {
      assert.ok(vide.has(id), `${id} er med i «bare ${valg}», men ikke i «minst én av ${valg}»`);
    }
  }
});
