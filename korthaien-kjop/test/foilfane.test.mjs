// Fanene i butikken: «Alle treff», «Vanlig», «Foil».
//
// Bakgrunnen: Sol Ring fra Kaladesh Inventions lå øverst på forsiden som
// dyreste kort på lager, og var likevel ikke å finne når man søkte «Sol
// Ring». Inventions finnes bare i foil, og fanen man landet i krevde at
// kortet fantes i vanlig utgave.
//
// Regelen fanene følger nå:
//
//   Alle treff  alt søket fant. Ingen avgrensning, og derfor den eneste
//               fanen et kort aldri kan falle ut av. Den er standard.
//   Vanlig      kort du har i vanlig utgave.
//   Foil        kort du har i foil.
//
// De to siste er avgrensninger av den første, ikke to halvdeler av
// katalogen. Og tallet i fanen skal stemme med radene fanen viser — står de
// i utakt, lyver det ene, og det er den slags feil ingen oppdager før en
// kunde ikke finner et kort.

import test from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";

const DB = `/tmp/foilfane-${process.pid}.db`;
rmSync(DB, { force: true });
process.env.DATABASE_URL = `file:${DB}`;
// Disse testene legger kort i lagerboken; butikken skal lese derfra.
process.env.LAGERKILDE = "bok";

const { db, migrate, normaliser, settSetting } = await import("../src/db.ts");
const { lagreIntervaller, butikkvisning } = await import("../src/salgspris.ts");

await migrate();
process.on("exit", () => rmSync(DB, { force: true }));
await settSetting("usd_nok", 10);
await lagreIntervaller([{ rarity: "alle", usd_fra: 0, usd_til: 1000, pris_ore: 5000 }]);

await db().execute(
  "INSERT INTO sets (code,name,released_at,card_count,parent_code) VALUES ('tst','Testsett','2020-01-01',3,NULL)"
);

// Tre kort som dekker de tre tilfellene. Navnet er likt med vilje: det er
// nettopp når man søker på et navn med flere utgaver at feilen viste seg.
const KORT = [
  ["bare-vanlig", "1", 1, 0],
  ["bare-foil", "2", 0, 1],
  ["begge", "3", 1, 1],
];
for (const [id, nr, nonfoil, foil] of KORT) {
  await db().execute({
    sql: `INSERT INTO cards (id,oracle_id,name,name_norm,front_norm,back_norm,variant,set_code,
                             collector_number,rarity,usd,usd_foil,has_nonfoil,has_foil,image_uri,released_at)
          VALUES (?,?,'Sol Ring',?,NULL,NULL,'vanlig','tst',?,'rare',2,4,?,?,NULL,'2020-01-01')`,
    args: [id, "o-" + id, normaliser("Sol Ring"), nr, nonfoil, foil],
  });
}

// Beholdning: det foil-bare kortet har bare foil, de to andre bare vanlig.
// «begge» er tilfellet som avslørte den andre feilen — kortet kan trykkes i
// foil, men ingen foil ligger i hylla, så det hører ikke hjemme i foil-fanen.
for (const [id, finish] of [
  ["bare-vanlig", "nonfoil"],
  ["bare-foil", "foil"],
  ["begge", "nonfoil"],
]) {
  await db().execute({
    sql: `INSERT INTO lager_bevegelser (card_id,finish,condition,antall,grunn,created_at)
          VALUES (?,?,'NM',2,'manuell','2026-01-01T00:00:00Z')`,
    args: [id, finish],
  });
}

const ider = (d) => d.kort.map((k) => k.id).sort();
const fane = (finish) => butikkvisning({ finish, baresalg: true, perSide: 50 });

test("Alle treff viser alt, også det som bare finnes i foil", async () => {
  // Dette er fanen man lander i, og den som gjorde feilen mulig da den ikke
  // fantes: Kaladesh Inventions falt ut fordi fanen krevde vanlig utgave.
  assert.deepEqual(ider(await fane("alle")), ["bare-foil", "bare-vanlig", "begge"]);
});

test("Vanlig viser bare det du har i vanlig utgave", async () => {
  assert.deepEqual(ider(await fane("nonfoil")), ["bare-vanlig", "begge"]);
});

test("Foil viser bare det du har foil av", async () => {
  // «begge» kan trykkes i foil, men ingen foil ligger på lager. Står den
  // her, møter kunden et kort uten foilmerke i foil-fanen.
  assert.deepEqual(ider(await fane("foil")), ["bare-foil"]);
});

test("fanetallene stemmer med radene, og er like fra alle tre fanene", async () => {
  const [alle, vanlig, foil] = await Promise.all([fane("alle"), fane("nonfoil"), fane("foil")]);

  assert.deepEqual(alle.antall, { alle: 3, nonfoil: 2, foil: 1 });
  // Tallene skal ikke endre seg av hvilken fane man står i. Før ble de talt
  // inni hverandre, så hver fane viste hvor mange den hadde til felles med
  // den du sto i.
  assert.deepEqual(vanlig.antall, alle.antall);
  assert.deepEqual(foil.antall, alle.antall);

  assert.equal(alle.totalt, alle.kort.length);
  assert.equal(vanlig.totalt, vanlig.kort.length);
  assert.equal(foil.totalt, foil.kort.length);
});

test("de to smale fanene er delmengder av Alle treff", async () => {
  // Regelen i én setning: ingenting kan finnes i Vanlig eller Foil uten å
  // finnes i Alle treff. Brytes den, kan et kort bli borte igjen.
  const alle = new Set(ider(await fane("alle")));
  for (const id of [...ider(await fane("nonfoil")), ...ider(await fane("foil"))]) {
    assert.ok(alle.has(id), `${id} finnes i en smal fane, men ikke i Alle treff`);
  }
});

test("søk på navnet finner alle tre utgavene", async () => {
  // Selve symptomet: «Sol Ring» ga alle utgavene unntatt den dyreste.
  const d = await butikkvisning({ q: "Sol Ring", finish: "alle", baresalg: true, perSide: 50 });
  assert.deepEqual(ider(d), ["bare-foil", "bare-vanlig", "begge"]);
});

test("det foil-bare kortet kommer med sin foilpris, ikke uten pris", async () => {
  const k = (await fane("alle")).kort.find((x) => x.id === "bare-foil");
  assert.equal(k.varianter.length, 1);
  assert.equal(k.varianter[0].finish, "foil");
  assert.ok(k.varianter[0].tilstander.length > 0);
});
