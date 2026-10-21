import { test } from "node:test";
import assert from "node:assert/strict";
import { variantFraScryfall, variantFraNavn } from "../src/varianter.js";

// Retrorammen er den som manglet: typen listet den, produktnavnet leste den,
// men importen kunne aldri produsere den. Da kolliderte «X (Retro Frame)»
// med «X» hver eneste synk.
test("retroramme kjennes igjen på frame og utgivelsesår", () => {
  assert.equal(
    variantFraScryfall({ frame: "1997", released_at: "2022-11-18" }),
    "retro"
  );
  assert.equal(
    variantFraScryfall({ frame: "1997", released_at: "2021-06-18" }),
    "retro"
  );
});

// Det viktigste: et ekte gammelt kort er ikke en variant. Uten årstallet
// ville halve nittitallet blitt omklassifisert til retro.
test("gamle kort med 1997-ramme er ikke retro", () => {
  assert.equal(variantFraScryfall({ frame: "1997", released_at: "1999-02-15" }), "vanlig");
  assert.equal(variantFraScryfall({ frame: "1997", released_at: "2003-07-28" }), "vanlig");
  assert.equal(variantFraScryfall({ frame: "1997" }), "vanlig");
  assert.equal(variantFraScryfall({ frame: "1993", released_at: "2022-11-18" }), "vanlig");
});

// De fem andre variantene skal klassifiseres som før. Endringen skal bare
// kunne gjøre «vanlig» og «fullart» om til «retro», ikke røre resten.
test("de øvrige variantene er uendret", () => {
  assert.equal(variantFraScryfall({ frame_effects: ["etched"] }), "etched");
  assert.equal(variantFraScryfall({ finishes: ["etched"] }), "etched");
  assert.equal(variantFraScryfall({ border_color: "borderless" }), "borderless");
  assert.equal(variantFraScryfall({ frame_effects: ["showcase"] }), "showcase");
  assert.equal(variantFraScryfall({ frame_effects: ["extendedart"] }), "extended");
  assert.equal(variantFraScryfall({ frame_effects: ["shatteredglass"] }), "showcase");
  assert.equal(variantFraScryfall({ full_art: true }), "fullart");
  assert.equal(variantFraScryfall({}), "vanlig");
});

// Et kort kan ha flere kjennetegn. Etched og borderless skal fortsatt vinne
// over retro, slik produktnavnene også leser dem.
test("mer spesifikke kjennetegn vinner over retro", () => {
  assert.equal(
    variantFraScryfall({ frame: "1997", released_at: "2022-11-18", frame_effects: ["etched"] }),
    "etched"
  );
  assert.equal(
    variantFraScryfall({ frame: "1997", released_at: "2022-11-18", border_color: "borderless" }),
    "borderless"
  );
});

// Produktsiden, til sammenligning: disse navnene er hentet fra kollisjonene.
test("produktnavn gir samme variantnavn som importen", () => {
  assert.equal(variantFraNavn("Timeless Dragon (Retro Frame)"), "retro");
  assert.equal(variantFraNavn("Shao Jun (Showcase)"), "showcase");
  assert.equal(variantFraNavn("Kellan, Daring Traveler (Extended Art)"), "extended");
  assert.equal(variantFraNavn("Timeless Dragon"), "vanlig");
});
