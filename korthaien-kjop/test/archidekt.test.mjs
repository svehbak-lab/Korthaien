import test from "node:test";
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
  ].join("\n");
  const r = parseBulk(liste);
  assert.equal(r.length, 7);
  for (const l of r) {
    assert.equal(l.feil, undefined, l.rå);
    assert.ok(!/[[\]]/.test(l.navn), `klammer igjen i navnet: ${l.navn}`);
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
