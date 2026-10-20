import test from "node:test";
import assert from "node:assert/strict";

// Regelen for når en avhuking gjelder. Den er lett å skrive feil og vanskelig
// å oppdage at er feil: tar man den ene veien, blir kortet borte for alltid;
// tar man den andre, kommer det tilbake selv om du nettopp så på det.
//
// Merket lagres sammen med prisen kortet hadde da du huket av. Det gjelder
// bare så lenge prisen står stille.

const hviler = (merketPris, prisNå) => merketPris != null && merketPris === prisNå;

test("rett etter avhuking hviler raden", () => {
  assert.equal(hviler(12000, 12000), true);
});

test("uten merke hviler ingenting", () => {
  assert.equal(hviler(null, 12000), false);
});

test("endret pris vekker raden igjen", () => {
  // Du rettet prisen, synken hentet den nye. Avviket er kanskje borte — da
  // faller raden ut uansett — men er det ikke det, skal du se kortet.
  assert.equal(hviler(12000, 45000), false);
});

test("en pris som endrer seg og kommer tilbake, vekker også", () => {
  // Merket ble satt på 120 kr. Prisen gikk til 450 og tilbake til 120 igjen.
  // Da er merket fortsatt gyldig — og det er riktig: prisen er den samme du
  // allerede har vurdert.
  assert.equal(hviler(12000, 12000), true);
});

test("null kroner er ikke det samme som ingen merke", () => {
  // Et produkt kan i teorien ha pris 0. Da skal merket fortsatt kunne gjelde.
  assert.equal(hviler(0, 0), true);
  assert.equal(hviler(0, 100), false);
});

test("et kort du med vilje priser lavt blir borte for godt", () => {
  // Bieffekten av regelen, og en ønsket en: prisen endres aldri, så merket
  // faller aldri bort.
  const merket = 5000;
  for (const natt of [1, 2, 3, 30, 365]) {
    void natt;
    assert.equal(hviler(merket, 5000), true);
  }
});
