// Fanene «Enkeltkort» og «Foils» i butikken.
//
// Bakgrunnen: Sol Ring fra Kaladesh Inventions lå øverst på forsiden som
// dyreste kort på lager, og var likevel ikke å finne når man søkte «Sol
// Ring». Inventions finnes bare i foil, og Enkeltkort krevde has_nonfoil.
//
// Regelen fanene skal følge:
//
//   Enkeltkort  alt du selger. Finnes kortet ikke i vanlig utgave, er foil
//               den eneste måten å kjøpe det på, og da hører det hjemme her.
//   Foils       bare foil. Fallet tilbake går ikke andre veien — et kort du
//               bare har vanlig skal ikke stå i foil-fanen.
//
// Og tallet i fanen skal stemme med radene fanen viser. Står de i utakt,
// lyver det ene, og det er den slags feil ingen oppdager før en kunde ikke
// finner et kort.

import test from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";

const DB = `/tmp/foilfane-${process.pid}.db`;
rmSync(DB, { force: true });
process.env.DATABASE_URL = `file:${DB}`;

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
  ["bare-vanlig", "Sol Ring", "1", 1, 0],
  ["bare-foil", "Sol Ring", "2", 0, 1],
  ["begge", "Sol Ring", "3", 1, 1],
];
for (const [id, navn, nr, nonfoil, foil] of KORT) {
  await db().execute({
    sql: `INSERT INTO cards (id,oracle_id,name,name_norm,front_norm,back_norm,variant,set_code,
                             collector_number,rarity,usd,usd_foil,has_nonfoil,has_foil,image_uri,released_at)
          VALUES (?,?,?,?,NULL,NULL,'vanlig','tst',?,'rare',2,4,?,?,NULL,'2020-01-01')`,
    args: [id, "o-" + id, navn, normaliser(navn), nr, nonfoil, foil],
  });
}

// Beholdning: det foil-bare kortet har bare foil, de to andre bare vanlig.
// «begge» er tilfellet som avslørte den andre feilen — kortet kan trykkes i
// foil, men ingen foil ligger i hylla.
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

test("Enkeltkort viser også kort som bare finnes i foil", async () => {
  const d = await butikkvisning({ finish: "nonfoil", baresalg: true, perSide: 50 });
  assert.deepEqual(ider(d), ["bare-foil", "bare-vanlig", "begge"]);
});

test("Foils viser bare det du har foil av", async () => {
  const d = await butikkvisning({ finish: "foil", baresalg: true, perSide: 50 });
  // «begge» kan trykkes i foil, men ingen foil ligger på lager. Står den her,
  // møter kunden et kort uten foilmerke i foil-fanen.
  assert.deepEqual(ider(d), ["bare-foil"]);
});

test("fanetallene stemmer med radene fanen viser", async () => {
  const enk = await butikkvisning({ finish: "nonfoil", baresalg: true, perSide: 50 });
  const foi = await butikkvisning({ finish: "foil", baresalg: true, perSide: 50 });

  // Tallene skal være de samme uansett hvilken fane man står i — før ble de
  // talt inni hverandre, så «Enkeltkort» viste hvor mange enkeltkort det var
  // blant foilene.
  assert.equal(enk.antall.nonfoil, 3);
  assert.equal(enk.antall.foil, 1);
  assert.deepEqual(foi.antall, enk.antall);

  assert.equal(enk.antall.nonfoil, enk.kort.length);
  assert.equal(foi.antall.foil, foi.kort.length);
  assert.equal(enk.totalt, enk.kort.length);
  assert.equal(foi.totalt, foi.kort.length);
});

test("søk på navnet finner alle tre utgavene", async () => {
  // Selve symptomet: «Sol Ring» ga alle utgavene unntatt den dyreste.
  const d = await butikkvisning({ q: "Sol Ring", finish: "nonfoil", baresalg: true, perSide: 50 });
  assert.deepEqual(ider(d), ["bare-foil", "bare-vanlig", "begge"]);
});

test("det foil-bare kortet kommer med sin foilpris, ikke uten pris", async () => {
  const d = await butikkvisning({ finish: "nonfoil", baresalg: true, perSide: 50 });
  const k = d.kort.find((x) => x.id === "bare-foil");
  assert.equal(k.varianter.length, 1);
  assert.equal(k.varianter[0].finish, "foil");
  assert.ok(k.varianter[0].tilstander.length > 0);
});
