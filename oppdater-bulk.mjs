#!/usr/bin/env node
// Fikser to feil i bulk-parseren, og legger inn Archidekt-lista som
// regresjonstest. Kjøres fra repo-rota:
//
//   node oppdater.mjs
//
// Idempotent: kjør den om igjen uten at noe blir dobbelt. Backup tas som
// .bak.<tidsstempel>, slik at en eksisterende .bak ikke overskrives.

import { readFileSync, writeFileSync, existsSync, copyFileSync } from "node:fs";

const BULK = "korthaien-kjop/src/bulk.ts";
const TEST = "korthaien-kjop/test/archidekt.test.mjs";

if (!existsSync(BULK)) {
  console.error(`Fant ikke ${BULK}. Kjør scriptet fra /workspaces/Korthaien.`);
  process.exit(1);
}

const stempel = new Date().toISOString().replace(/[:.]/g, "-");
let kilde = readFileSync(BULK, "utf8");
const før = kilde;

// ── Feil 1 ───────────────────────────────────────────────────────────────────
// Nummergruppa krevde at samlernummeret startet med et siffer. The List
// bruker «EMA-232», så både nummeret gikk tapt og teksten ble liggende igjen
// i kortnavnet. Ny regel: nummeret må inneholde et siffer, men trenger ikke
// begynne med ett. Lookaheaden hindrer at «Near Mint» blir lest som nummer.
const GAMMEL_1 = String.raw`  const iKlamme = s.match(/[([]\s*([^\])]{1,40}?)\s*[)\]]\s*(\d{1,4}[a-z]?)?/);`;
const NY_1 = String.raw`  const iKlamme = s.match(
    /[([]\s*([^\])]{1,40}?)\s*[)\]]\s*((?=[^\s]*\d)[0-9A-Za-z][0-9A-Za-z-]{0,9})?/
  );`;

if (kilde.includes(NY_1.trim().split("\n")[1].trim())) {
  console.log("• Feil 1 allerede fikset — hopper over");
} else if (kilde.includes(GAMMEL_1)) {
  kilde = kilde.replace(GAMMEL_1, NY_1);
  console.log("• Feil 1 fikset: samlernummer kan inneholde bokstaver (EMA-232)");
} else {
  console.error("! Fant ikke iKlamme-linjen slik den var ventet. Avbryter.");
  process.exit(1);
}

// ── Feil 2 ───────────────────────────────────────────────────────────────────
// iKlamme kjører bare én gang per linje. Sto settkoden i vanlig parentes,
// ble Archidekts kategori bakerst aldri sett på, og endte som en del av
// kortnavnet: «Savai Triome [Land]».
const MARKØR = "// Archidekt legger en kategori bakerst";
const GAMMEL_2 = String.raw`    s = s.replace(iKlamme[0], " ");
  }

  if (!r.condHint) s = trekkUtCondition(s, r);`;
const NY_2 = String.raw`    s = s.replace(iKlamme[0], " ");
  }

  // Archidekt legger en kategori bakerst: «[Creature]», «[Land]». Tegnene er
  // de samme som for settnavn i klamme, men når linjen allerede har oppgitt
  // et sett, kan det ikke være et sett til — ingen eksportformat oppgir
  // settet to ganger. Da er det en kategori, og den skal ut av navnet.
  if (r.settHint || r.settNavnHint) {
    let kategori;
    while ((kategori = s.match(/\s*\[[^\]]{1,40}\]\s*$/))) {
      s = s.slice(0, kategori.index) + " ";
    }
  }

  if (!r.condHint) s = trekkUtCondition(s, r);`;

if (kilde.includes(MARKØR)) {
  console.log("• Feil 2 allerede fikset — hopper over");
} else if (kilde.includes(GAMMEL_2)) {
  kilde = kilde.replace(GAMMEL_2, NY_2);
  console.log("• Feil 2 fikset: kategori bakerst blir ikke lenger del av navnet");
} else {
  console.error("! Fant ikke innsettingspunktet for feil 2. Avbryter.");
  process.exit(1);
}

if (kilde !== før) {
  copyFileSync(BULK, `${BULK}.bak.${stempel}`);
  writeFileSync(BULK, kilde);
  console.log(`  backup: ${BULK}.bak.${stempel}`);
}

// ── Regresjonstest ───────────────────────────────────────────────────────────
const TESTFIL = `import test from "node:test";
import assert from "node:assert/strict";

const { parseBulk } = await import("../src/bulk.ts");

const én = (s) => parseBulk(s)[0];

// Denne lista kom inn fra en kunde og ga null treff på samtlige linjer.
// To feil i parseren: kategorien bakerst ble en del av kortnavnet, og
// The List-nummer som «EMA-232» ble verken fanget eller fjernet.

test("Archidekt: kategori bakerst er ikke del av kortnavnet", () => {
  const r = én("1x Savai Triome (iko) 253 [Land]");
  assert.equal(r.navn, "Savai Triome");
  assert.equal(r.settHint, "iko");
  assert.equal(r.nummerHint, "253");
  assert.equal(r.qty, 1);
});

test("Archidekt: antall med x-suffiks", () => {
  const r = én("2x Scute Swarm (znr) 203 [Creature]");
  assert.equal(r.qty, 2);
  assert.equal(r.navn, "Scute Swarm");
});

test("The List: samlernummer med bokstaver og bindestrek", () => {
  const r = én("1x Sensei's Divining Top (plst) EMA-232 [Artifact]");
  assert.equal(r.navn, "Sensei's Divining Top");
  assert.equal(r.settHint, "plst");
  assert.equal(r.nummerHint, "ema-232");
});

test("The List: komma i navnet overlever", () => {
  const r = én("1x Sidisi, Undead Vizier (plst) DTK-120 [Creature]");
  assert.equal(r.navn, "Sidisi, Undead Vizier");
  assert.equal(r.nummerHint, "dtk-120");
});

test("foilmarkør klistret til nummeret, med kategori etter", () => {
  const r = én("1x Sigarda, Font of Blessings (mat) 47*F* [Creature]");
  assert.equal(r.navn, "Sigarda, Font of Blessings");
  assert.equal(r.nummerHint, "47");
  assert.equal(r.foil, true);
});

test("ensifret samlernummer med foilmarkør", () => {
  const r = én("1x Siren of Seven Deaths (fdn) 1*F* [Creature]");
  assert.equal(r.navn, "Siren of Seven Deaths");
  assert.equal(r.nummerHint, "1");
  assert.equal(r.foil, true);
});

test("hele lista går gjennom uten feil", () => {
  const liste = [
    "1x Savai Triome (iko) 253 [Land]",
    "2x Scute Swarm (znr) 203 [Creature]",
    "2x Sedgemoor Witch (stx) 86 [Creature]",
    "1x Sensei's Divining Top (plst) EMA-232 [Artifact]",
    "1x Sidisi, Undead Vizier (plst) DTK-120 [Creature]",
    "1x Sigarda, Font of Blessings (mat) 47*F* [Creature]",
    "1x Siren of Seven Deaths (fdn) 1*F* [Creature]",
  ].join("\\n");
  const r = parseBulk(liste);
  assert.equal(r.length, 7);
  for (const l of r) {
    assert.equal(l.feil, undefined, l.rå);
    assert.ok(!/[[\\]]/.test(l.navn), \`klammer igjen i navnet: \${l.navn}\`);
    assert.ok(l.settHint, l.rå);
  }
});

// Et nummerfelt må inneholde et siffer, ellers ville tilstanden blitt spist.
test("tilstand etter settkode leses ikke som samlernummer", () => {
  const r = én("1 Lightning Bolt (M10) Near Mint");
  assert.equal(r.navn, "Lightning Bolt");
  assert.equal(r.condHint, "NM");
  assert.equal(r.nummerHint, null);
});
`;

if (existsSync(TEST)) {
  console.log("• Testfila finnes allerede — hopper over");
} else {
  writeFileSync(TEST, TESTFIL);
  console.log(`• Regresjonstest lagt inn: ${TEST}`);
}

console.log("\nFerdig. Kjør testene, og push:");
console.log("  npm test");
console.log("  git add -A && git commit -m 'Fiks: Archidekt-kategori og The List-nummer i bulk-parser' && git push");
