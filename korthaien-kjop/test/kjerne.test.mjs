import test from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL = "file:./test-korthaien.db";

const { migrate, db } = await import("../src/db.ts");
const { beregnPris } = await import("../src/pricing.ts");
const { parseBulk } = await import("../src/bulk.ts");
const { regnLedig } = await import("../src/quota.ts");

await migrate();

const s = { usd_nok: 10.6, buy_pct: 70, min_buy_nok: 1 };
const trapp = { ladder: { NM: 100, EX: 85, VG: 70, G: 55 } };

test("pris er 70 % av Scryfall-prisen omregnet til NOK", () => {
  // $5 × 10,6 = 53 kr → 70 % = 37,1 → 37
  assert.equal(beregnPris(5, "NM", trapp, s), 37);
});

test("condition-trappen trekker fra riktig", () => {
  assert.equal(beregnPris(5, "EX", trapp, s), 32); // 37,1 × 0,85 = 31,5
  assert.equal(beregnPris(5, "VG", trapp, s), 26);
  assert.equal(beregnPris(5, "G", trapp, s), 20);
});

test("condition uten sats i trappen kjøpes ikke", () => {
  // Beta tar NM og EX, men ikke VG og G. Uten sats skal prisen bli 0,
  // ikke falle tilbake på full pris.
  const beta = { ladder: { NM: 100, EX: 80 } };
  assert.equal(beregnPris(100, "NM", beta, s), 742);
  assert.equal(beregnPris(100, "VG", beta, s), 0);
  assert.equal(beregnPris(100, "G", beta, s), 0);
});

test("kort uten pris gir null, ikke NaN", () => {
  assert.equal(beregnPris(0, "NM", trapp, s), 0);
  assert.equal(beregnPris(NaN, "NM", trapp, s), 0);
});

test("linjer under minstebeløpet kjøpes ikke", () => {
  // $0,01 → 0,07 kr → under grensen
  assert.equal(beregnPris(0.01, "NM", trapp, s), 0);
});

test("kvoten trekker fra både beholdning og aktive ordrer", () => {
  const regel = { enabled: true, wanted_default: 8, conditions: ["NM"], ladder: {} };
  // Vil ha 8, har 2 på lager → kunden kan selge 6
  assert.equal(regnLedig({ stock: 2, reserved: 0, want: null }, "nonfoil", regel).available, 6);
  // En annen kunde har allerede reservert 4 → bare 2 igjen
  assert.equal(regnLedig({ stock: 2, reserved: 4, want: null }, "nonfoil", regel).available, 2);
  // Overtegning skal aldri gi negativt tall
  assert.equal(regnLedig({ stock: 9, reserved: 3, want: null }, "nonfoil", regel).available, 0);
});

test("overstyring på kortnivå slår settregelen, også når den er 0", () => {
  const regel = { enabled: true, wanted_default: 8, conditions: ["NM"], ladder: {} };
  assert.equal(regnLedig({ stock: 0, reserved: 0, want: 0 }, "nonfoil", regel).available, 0);
  assert.equal(regnLedig({ stock: 0, reserved: 0, want: 20 }, "nonfoil", regel).available, 20);
});

test("foil arves ikke fra settets standardantall", () => {
  const regel = { enabled: true, wanted_default: 8, conditions: ["NM"], ladder: {} };
  assert.equal(regnLedig(undefined, "foil", regel).available, 0);
  assert.equal(regnLedig({ stock: 0, reserved: 0, want: 3 }, "foil", regel).available, 3);
});

test("avslåtte sett kjøper ingenting", () => {
  const regel = { enabled: false, wanted_default: 8, conditions: ["NM"], ladder: {} };
  assert.equal(regnLedig(undefined, "nonfoil", regel).available, 0);
});

test("bulkparser takler formatene folk faktisk skriver", () => {
  const l = parseBulk(
    [
      "4 Lightning Bolt",
      "4x Lightning Bolt",
      "Lightning Bolt x4",
      "2 Ragavan, Nimble Pilferer (MH2) 138",
      "1 Void [INV]",
      "3 Lightning Bolt foil",
      "Ancestral Recall",
    ].join("\n")
  );
  assert.equal(l[0].qty, 4);
  assert.equal(l[0].navn, "Lightning Bolt");
  assert.equal(l[1].qty, 4);
  assert.equal(l[2].qty, 4);
  assert.equal(l[2].navn, "Lightning Bolt");
  assert.equal(l[3].qty, 2);
  assert.equal(l[3].navn, "Ragavan, Nimble Pilferer");
  assert.equal(l[3].settHint, "mh2");
  assert.equal(l[3].nummerHint, "138");
  assert.equal(l[4].settHint, "inv");
  assert.equal(l[5].foil, true);
  assert.equal(l[5].navn, "Lightning Bolt");
  assert.equal(l[6].qty, 1); // uten antall er det ett kort
});

test("bulklista stopper på 50 linjer", () => {
  const mange = Array.from({ length: 80 }, (_, i) => `1 Kort ${i}`).join("\n");
  assert.equal(parseBulk(mange).length, 50);
});

test("tomme og ugyldige linjer merkes i stedet for å krasje", () => {
  const l = parseBulk("\n\n   \n0 Lightning Bolt\n");
  assert.equal(l.length, 1);
  assert.ok(l[0].feil);
});
