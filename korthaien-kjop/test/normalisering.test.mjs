import test from "node:test";
import assert from "node:assert/strict";
process.env.DATABASE_URL = "file:/tmp/norm-test.db";
const { normaliser } = await import("../src/db.ts");

test("Æ blir ae, slik Scryfall skriver det", () => {
  // Butikken bruker den trykte skrivemåten, katalogen den moderne.
  assert.equal(normaliser("Æther Rift"), normaliser("Aether Rift"));
  assert.equal(normaliser("Æther Vial"), normaliser("Aether Vial"));
  assert.equal(normaliser("ÆTHERLING"), normaliser("Aetherling"));
});

test("norske tegn overlever", () => {
  assert.equal(normaliser("Blåbær"), "blabaer");
  assert.equal(normaliser("Sørøya"), "soroya");
});

test("aksenter faller bort som før", () => {
  assert.equal(normaliser("Jötun Grunt"), "jotungrunt");
  assert.equal(normaliser("Márton Stromgald"), "martonstromgald");
});

test("skilletegn og mellomrom fjernes", () => {
  assert.equal(normaliser("Ragavan, Nimble Pilferer"), "ragavannimblepilferer");
  assert.equal(normaliser("Jace, the Mind Sculptor"), "jacethemindsculptor");
});

test("tomt inn gir tomt ut", () => {
  assert.equal(normaliser(""), "");
  assert.equal(normaliser(null), "");
});
