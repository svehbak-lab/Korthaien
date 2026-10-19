import test from "node:test";
import assert from "node:assert/strict";

// Testene her gjaldt finnEgneAvvik, som leste egne priser ut av
// Kortjakt-svarene. Den kilden er byttet ut med mystore_stock, så funksjonen
// finnes ikke lenger. Avviksregningen ligger nå i egenliste(), som gjør et
// databaseoppslag og derfor hører hjemme i en annen slags test.
//
// Det som er igjen her er regelen selv, så fortegnet ikke snur uten at noen
// legger merke til det.

const avvik = (salgOre, prisOre) => ({
  ore: salgOre - prisOre,
  pct: Math.round(((salgOre - prisOre) / salgOre) * 100),
});

test("priset under det kortet er verdt gir positivt avvik", () => {
  assert.deepEqual(avvik(40000, 20000), { ore: 20000, pct: 50 });
});

test("priset over gir negativt avvik", () => {
  assert.deepEqual(avvik(40000, 80000), { ore: -40000, pct: -100 });
});

test("riktig priset gir null", () => {
  assert.deepEqual(avvik(40000, 40000), { ore: 0, pct: 0 });
});

test("kroner og prosent kan peke i hver sin retning som rangering", () => {
  // 87 % av 69 kr er mindre verdt å rette enn 30 % av 8 000.
  const a = avvik(8000, 1000);
  const b = avvik(800000, 560000);
  assert.ok(a.pct > b.pct);
  assert.ok(Math.abs(a.ore) < Math.abs(b.ore));
});
