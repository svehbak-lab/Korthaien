import test from "node:test";
import assert from "node:assert/strict";
const { variantFraScryfall, variantFraNavn, skillUtNummer, skillUtBokstav } =
  await import("../src/varianter.ts");

test("Scryfall-felter gir riktig variant", () => {
  assert.equal(variantFraScryfall({ frame_effects: ["extendedart"] }), "extended");
  assert.equal(variantFraScryfall({ border_color: "borderless" }), "borderless");
  assert.equal(variantFraScryfall({ frame_effects: ["showcase"] }), "showcase");
  assert.equal(variantFraScryfall({ finishes: ["etched"] }), "etched");
  assert.equal(variantFraScryfall({ full_art: true }), "fullart");
  assert.equal(variantFraScryfall({ border_color: "black" }), "vanlig");
  assert.equal(variantFraScryfall({}), "vanlig");
});

test("butikkens tilleggsord gir samme variant", () => {
  assert.equal(variantFraNavn("Bold Plagiarist (Extended Art)"), "extended");
  assert.equal(variantFraNavn("Bold Plagiarist (extended art)"), "extended");
  assert.equal(variantFraNavn("Expedition Map (borderless)"), "borderless");
  assert.equal(variantFraNavn("Ragavan (Showcase)"), "showcase");
  assert.equal(variantFraNavn("Urza's Saga (Etched Foil)"), "etched");
  assert.equal(variantFraNavn("Lightning Bolt"), "vanlig");
  assert.equal(variantFraNavn("Lightning Bolt (foil)"), "vanlig");
});

test("samlernummer skilles ut av navnet", () => {
  assert.deepEqual(skillUtNummer("Island 267"), { navn: "Island", nummer: "267" });
  assert.deepEqual(skillUtNummer("Mountain 274"), { navn: "Mountain", nummer: "274" });
  assert.deepEqual(skillUtNummer("Beast Within 0075"), { navn: "Beast Within", nummer: "0075" });
  assert.deepEqual(skillUtNummer("Ragavan 138a"), { navn: "Ragavan", nummer: "138a" });
});

test("kortnavn uten nummer røres ikke", () => {
  assert.deepEqual(skillUtNummer("Lightning Bolt"), { navn: "Lightning Bolt", nummer: null });
  assert.deepEqual(skillUtNummer("Ajani's Pridemate"), { navn: "Ajani's Pridemate", nummer: null });
});

test("bokstavvarianter gjelder bare basic lands", () => {
  assert.deepEqual(skillUtBokstav("Swamp B"), { navn: "Swamp", posisjon: 1 });
  assert.deepEqual(skillUtBokstav("Forest A"), { navn: "Forest", posisjon: 0 });
  assert.deepEqual(skillUtBokstav("Island C"), { navn: "Island", posisjon: 2 });
  // Et vanlig kort som tilfeldigvis slutter på en bokstav skal ikke deles opp.
  assert.deepEqual(skillUtBokstav("Kird Ape"), { navn: "Kird Ape", posisjon: null });
  assert.deepEqual(skillUtBokstav("Ajani B"), { navn: "Ajani B", posisjon: null });
});

test("varianten fra navn og fra Scryfall møtes", () => {
  // Samme kort, sett fra hver sin side — de må gi samme etikett, ellers
  // matcher aldri butikkproduktet Scryfall-raden.
  assert.equal(
    variantFraNavn("Bold Plagiarist (Extended Art)"),
    variantFraScryfall({ frame_effects: ["extendedart"] })
  );
  assert.equal(
    variantFraNavn("Expedition Map (borderless)"),
    variantFraScryfall({ border_color: "borderless" })
  );
});
