import { test } from "node:test";
import assert from "node:assert/strict";
import { nummerFraParentes, oppgirBehandling } from "../src/varianter.js";

// Alternative navn skrives «(#NNN Det andre navnet)». Hele Godzilla-serien i
// Ikoria er på den formen, og uten dette mistet de nummeret sitt.
test("nummer fulgt av et alternativt navn", () => {
  const f = [
    ["Luminous Broodmoth (#371 Mothra, Supersonic Queen) (Foil)", "371"],
    ["Cloudstone Curio (0349 - Elessar, the Elfstone)", "349"],
    ["Mouth of Ronom (0370 Redhorn Pass)", "370"],
    ["Beast Within (0075 - Grimm Fate)", "75"],
    ["Aerid Konstrari (0417 - Japan Showcase Fracture Foil)", "417"],
  ];
  for (const [navn, ventet] of f) assert.equal(nummerFraParentes(navn), ventet, navn);
});

// Enkeltbokstaven er fortsatt en del av nummeret, ikke en beskrivelse.
test("tall og enkeltbokstav er ett samlernummer", () => {
  assert.equal(nummerFraParentes("Plains (250 A)"), "250a");
  assert.equal(nummerFraParentes("Island (255a)"), "255a");
  assert.equal(nummerFraParentes("Swamp (0260 B)"), "260b");
});

// Og den farlige retningen består: en parentes uten tall er fortsatt ingen
// nummerparentes, uansett hvor mange ord den inneholder.
test("parenteser uten tall gir fortsatt ingenting", () => {
  for (const navn of [
    "Force of Will (borderless)",
    "Lich (Not Tournament Legal)",
    "Determined (Bound/Determined)",
    "Checklist (Nicol Bolas)",
    "Plains (FOIL)",
  ]) {
    assert.equal(nummerFraParentes(navn), null, navn);
  }
});

// Når nummeret står i parentesen, er det nummeret som gjelder — ikke ordene
// etter det. Ellers ville matcheren både lett etter et nummer og flyttet
// produktet bort fra grunnutgaven samtidig.
test("et nummer med beskrivelse er ikke en behandling", () => {
  assert.equal(oppgirBehandling("Luminous Broodmoth (#371 Mothra, Supersonic Queen)"), false);
  assert.equal(oppgirBehandling("Shao Jun (Showcase)"), true);
});
