import test from "node:test";
import assert from "node:assert/strict";
const { byggIndeks, finnSett, foreslå } = await import("../src/settnavn.ts");

// Et utvalg ekte Scryfall-navn, inkludert de som skapte problemer.
const SETT = [
  { code: "mh1", name: "Modern Horizons" },
  { code: "mh2", name: "Modern Horizons 2" },
  { code: "mh3", name: "Modern Horizons 3" },
  { code: "afr", name: "Adventures in the Forgotten Realms" },
  { code: "snc", name: "Streets of New Capenna" },
  { code: "ncc", name: "New Capenna Commander" },
  { code: "4ed", name: "Fourth Edition" },
  { code: "6ed", name: "Classic Sixth Edition" },
  { code: "lea", name: "Limited Edition Alpha" },
  { code: "leb", name: "Limited Edition Beta" },
  { code: "2ed", name: "Unlimited Edition" },
  { code: "neo", name: "Kamigawa: Neon Dynasty" },
  { code: "inv", name: "Invasion" },
  { code: "bro", name: "The Brothers' War" },
  { code: "blb", name: "Bloomburrow" },
];
const idx = byggIndeks(SETT);
const kode = (n) => finnSett(n, idx)?.code ?? null;

test("eksakte navn treffer", () => {
  assert.equal(kode("Invasion"), "inv");
  assert.equal(kode("Bloomburrow"), "blb");
});

test("entall mot flertall — «Modern Horizon 3»", () => {
  assert.equal(kode("Modern Horizon 3"), "mh3");
  assert.equal(kode("Modern Horizon 2"), "mh2");
});

test("kortnavn som er del av det offisielle — «Forgotten Realms»", () => {
  assert.equal(kode("Forgotten Realms"), "afr");
});

test("ordenstall — «4th Edition» og «6th Edition»", () => {
  assert.equal(kode("4th Edition"), "4ed");
  assert.equal(kode("6th Edition"), "6ed");
});

test("«Alpha» og «Beta» finner Limited Edition", () => {
  assert.equal(kode("Alpha"), "lea");
  assert.equal(kode("Beta"), "leb");
});

test("navn etter kolon — «Neon Dynasty»", () => {
  assert.equal(kode("Neon Dynasty"), "neo");
});

test("settkode som kategorinavn", () => {
  assert.equal(kode("INV"), "inv");
  assert.equal(kode("mh2"), "mh2");
});

test("tvetydig gir ingen match i stedet for et gjett", () => {
  // «New Capenna» finnes i to sett — da skal vi spørre, ikke gjette.
  assert.equal(kode("New Capenna"), null);
  // «Modern Horizons» alene ville truffet fire navn ved delvis match,
  // men eksaktregelen tar den først.
  assert.equal(kode("Modern Horizons"), "mh1");
});

test("søppel gir null", () => {
  assert.equal(kode("Ermer"), null);
  assert.equal(kode("Tilbehør"), null);
  assert.equal(kode(""), null);
});

test("forslag hjelper på de tvetydige", () => {
  const f = foreslå("New Capenna", idx).map((s) => s.code);
  assert.ok(f.includes("snc") && f.includes("ncc"), "begge Capenna-settene foreslås");
});
