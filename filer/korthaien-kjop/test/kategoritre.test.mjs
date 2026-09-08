import test from "node:test";
import assert from "node:assert/strict";

// Speiler strukturen i butikken: settkategori på toppen, raritet under.
// Noen sett har bare én kategori uten barn, og noen grener har ingen sett.
const kategorier = [
  { id: "10", navn: "Invasion", forelder: null },
  { id: "11", navn: "Rare", forelder: "10" },
  { id: "12", navn: "Common", forelder: "10" },
  { id: "20", navn: "Modern Horizons 2", forelder: null },
  { id: "21", navn: "Mythic Rare", forelder: "20" },
  { id: "22", navn: "Foil", forelder: "21" },
  { id: "30", navn: "Tilbehør", forelder: null },
  { id: "31", navn: "Ermer", forelder: "30" },
  { id: "40", navn: "Bloomburrow", forelder: null },
];
const settNavn = new Map([
  ["invasion", "inv"],
  ["modernhorizons2", "mh2"],
  ["bloomburrow", "blb"],
]);

function normaliser(s) {
  return (s||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]/g,"");
}
function knyttTilSett(kategorier, settNavn, overstyringer = new Map()) {
  const etterId = new Map(kategorier.map(k => [k.id, k]));
  const res = new Map();
  for (const k of kategorier) {
    if (overstyringer.has(k.id)) { res.set(k.id, { set_code: overstyringer.get(k.id) ?? null }); continue; }
    let node = k, hopp = 0, funnet = null;
    while (node && hopp < 8) {
      const kode = settNavn.get(normaliser(node.navn));
      if (kode) { funnet = kode; break; }
      node = node.forelder ? etterId.get(node.forelder) : undefined;
      hopp++;
    }
    res.set(k.id, { set_code: funnet });
  }
  return res;
}

test("raritetskategori arver settet fra forelderen", () => {
  const k = knyttTilSett(kategorier, settNavn);
  assert.equal(k.get("11").set_code, "inv");
  assert.equal(k.get("12").set_code, "inv");
});

test("klatrer flere nivåer for foil under raritet", () => {
  const k = knyttTilSett(kategorier, settNavn);
  assert.equal(k.get("22").set_code, "mh2");
});

test("settkategorien matcher på eget navn", () => {
  const k = knyttTilSett(kategorier, settNavn);
  assert.equal(k.get("10").set_code, "inv");
  assert.equal(k.get("40").set_code, "blb");
});

test("grener uten sett gir null, ikke et gjett", () => {
  const k = knyttTilSett(kategorier, settNavn);
  assert.equal(k.get("30").set_code, null);
  assert.equal(k.get("31").set_code, null);
});

test("manuell overstyring slår automatikken", () => {
  const k = knyttTilSett(kategorier, settNavn, new Map([["31", "blb"], ["11", null]]));
  assert.equal(k.get("31").set_code, "blb");
  assert.equal(k.get("11").set_code, null);
});

test("løvnoder er der produktene ligger", () => {
  const harBarn = new Set(kategorier.filter(k => k.forelder).map(k => k.forelder));
  const løv = kategorier.filter(k => !harBarn.has(k.id)).map(k => k.id);
  // 10 og 20 har barn; 21 har barnet 22; 30 har 31
  assert.deepEqual(løv.sort(), ["11","12","22","31","40"].sort());
});
