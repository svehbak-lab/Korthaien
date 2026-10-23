// Sealed og komplette sett — det du selger som ikke er et enkeltkort.
//
// Det som er verdt å holde fast ved her: produktene lever ved siden av
// kortene og ikke inni dem, de slås av i stedet for å slettes, og det siste
// eksemplaret kan ikke selges to ganger.

import test from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";

const DB = `/tmp/produkter-${process.pid}.db`;
rmSync(DB, { force: true });
process.env.DATABASE_URL = `file:${DB}`;

const { migrate, db } = await import("../src/db.ts");
const {
  hentProdukter, hentProdukt, leggTilProdukt, endreProdukt, slåAvProdukt,
  antallPerType, trekkFraLager, erType,
} = await import("../src/produkter.ts");

await migrate();
process.on("exit", () => rmSync(DB, { force: true }));

test("et produkt lar seg legge inn og hente igjen", async () => {
  const id = await leggTilProdukt({
    type: "sealed",
    navn: "Bloomburrow samlerboosterboks",
    pris_ore: 349000,
    antall: 2,
    beskrivelse: "Forseglet.",
  });
  const p = await hentProdukt(id);
  assert.equal(p.navn, "Bloomburrow samlerboosterboks");
  assert.equal(p.pris_ore, 349000);
  assert.equal(p.antall, 2);
  assert.equal(p.aktiv, 1);
});

test("et produkt uten navn blir avvist", async () => {
  await assert.rejects(
    () => leggTilProdukt({ type: "sealed", navn: "   ", pris_ore: 100 }),
    /navn/i
  );
});

test("en ukjent type blir avvist", async () => {
  // Typene er to, og de er faste. En skrivefeil skal stoppe her og ikke
  // bli en kategori ingen finner igjen.
  assert.equal(erType("sealed"), true);
  assert.equal(erType("komplettsett"), true);
  assert.equal(erType("Sealed"), false);
  await assert.rejects(
    () => leggTilProdukt({ type: "tilbehor", navn: "Sleeves", pris_ore: 100 }),
    /type/i
  );
});

test("lista kan begrenses til én type", async () => {
  await leggTilProdukt({ type: "komplettsett", navn: "Komplett Innistrad", pris_ore: 890000, antall: 1 });
  const sealed = await hentProdukter({ type: "sealed" });
  const komplett = await hentProdukter({ type: "komplettsett" });
  assert.ok(sealed.every((p) => p.type === "sealed"));
  assert.equal(komplett.length, 1);
  assert.equal(komplett[0].navn, "Komplett Innistrad");
});

test("butikken ser bare det som finnes, admin ser alt", async () => {
  await leggTilProdukt({ type: "sealed", navn: "Utsolgt boks", pris_ore: 100000, antall: 0 });
  const alle = await hentProdukter({ type: "sealed" });
  const påLager = await hentProdukter({ type: "sealed", barePåLager: true });
  assert.ok(alle.some((p) => p.navn === "Utsolgt boks"));
  assert.ok(!påLager.some((p) => p.navn === "Utsolgt boks"));
});

test("antallet per type teller bare det kunden kan kjøpe", async () => {
  const n = await antallPerType();
  // «Utsolgt boks» har null på lager og skal ikke få en seksjon til å se
  // full ut. Menyen skal ikke lenke til en tom side.
  assert.equal(n.sealed, 1);
  assert.equal(n.komplettsett, 1);
});

test("et produkt slås av, det slettes ikke", async () => {
  const id = await leggTilProdukt({ type: "sealed", navn: "Feilført", pris_ore: 500 });
  await slåAvProdukt(id);

  const fortsatt = await hentProdukt(id);
  assert.ok(fortsatt, "raden skal stå igjen");
  assert.equal(fortsatt.aktiv, 0);

  const synlige = await hentProdukter({ type: "sealed" });
  assert.ok(!synlige.some((p) => p.id === id), "men den skal ikke være med i lista");
});

test("endring rører bare feltene du sender", async () => {
  const id = await leggTilProdukt({
    type: "sealed", navn: "Prøveboks", pris_ore: 100000, antall: 3,
    beskrivelse: "Står på hylla",
  });
  await endreProdukt(id, { pris_ore: 120000 });
  const p = await hentProdukt(id);
  assert.equal(p.pris_ore, 120000);
  assert.equal(p.antall, 3, "antallet skulle ikke nullstilles");
  assert.equal(p.beskrivelse, "Står på hylla");
  assert.equal(p.navn, "Prøveboks");
});

test("settkoden lagres i små bokstaver", async () => {
  // Kortene har settkoden i små bokstaver. Står den ulikt her, finner
  // settsiden aldri produktet sitt.
  const id = await leggTilProdukt({
    type: "komplettsett", navn: "Komplett BLB", pris_ore: 500000, set_code: "BLB",
  });
  assert.equal((await hentProdukt(id)).set_code, "blb");
});

test("det siste eksemplaret kan ikke selges to ganger", async () => {
  const id = await leggTilProdukt({ type: "sealed", navn: "Siste boks", pris_ore: 100000, antall: 1 });
  assert.equal(await trekkFraLager(id, 1), true);
  assert.equal(await trekkFraLager(id, 1), false, "det andre salget skal ikke gå gjennom");
  assert.equal((await hentProdukt(id)).antall, 0, "og lageret skal ikke bli negativt");
});

test("produktene ligger ikke i cards", async () => {
  // Hele poenget med skillet: prisimporten og kjøpslista slipper å kjenne
  // til boosterbokser.
  const r = await db().execute("SELECT COUNT(*) AS n FROM cards");
  assert.equal(Number(r.rows[0].n), 0);
});
