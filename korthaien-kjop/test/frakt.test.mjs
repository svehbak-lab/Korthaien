// Fraktalternativene kunden velger mellom i kassen.
//
// Prisene står i basen og ikke i koden, fordi Posten endrer dem. Det som er
// verdt å holde fast ved her er skillet mellom NULL og 0 i
// forsikringsgrensen, og at et alternativ slås av i stedet for å slettes.

import test from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";

const DB = `/tmp/frakt-${process.pid}.db`;
rmSync(DB, { force: true });
process.env.DATABASE_URL = `file:${DB}`;

const { migrate } = await import("../src/db.ts");
const { hentFrakt, leggTilFrakt, endreFrakt, slåAvFrakt } = await import("../src/frakt.ts");

await migrate();
process.on("exit", () => rmSync(DB, { force: true }));

test("alternativene du beskrev lar seg legge inn", async () => {
  await leggTilFrakt({ navn: "Brev", pris_ore: 5500, forsikret_ore: null, sortering: 1 });
  await leggTilFrakt({ navn: "Liten norgespakke", pris_ore: 8000, forsikret_ore: 250000, sortering: 2 });
  await leggTilFrakt({ navn: "Stor norgespakke", pris_ore: 15000, forsikret_ore: 1000000, sortering: 3 });

  const alle = await hentFrakt();
  assert.deepEqual(alle.map((f) => f.navn), ["Brev", "Liten norgespakke", "Stor norgespakke"]);
  assert.equal(alle[0].pris_ore, 5500);
});

test("uten forsikring er grensen NULL, ikke null kroner", async () => {
  // 0 ville betydd «forsikret for ingenting», som er noe annet enn «ikke
  // forsikret». Kassen må kunne skille dem for å si det riktig til kunden.
  const [brev, liten] = await hentFrakt();
  assert.equal(brev.forsikret_ore, null);
  assert.equal(liten.forsikret_ore, 250000);
});

test("sorteringen er din, ikke prisens", async () => {
  // Billigst først er ikke alltid rekkefølgen du vil at kunden skal lese dem
  // i, så sorteringsfeltet går foran prisen.
  const liten = (await hentFrakt()).find((f) => f.navn === "Liten norgespakke");
  await endreFrakt(liten.id, { ...liten, sortering: 0 });
  assert.deepEqual((await hentFrakt()).map((f) => f.navn), [
    "Liten norgespakke", "Brev", "Stor norgespakke",
  ]);
});

test("prisen kan rettes uten utrulling", async () => {
  const brev = (await hentFrakt()).find((f) => f.navn === "Brev");
  const ut = await endreFrakt(brev.id, { ...brev, pris_ore: 6000 });
  assert.equal(ut.pris_ore, 6000);
  assert.equal((await hentFrakt()).find((f) => f.navn === "Brev").pris_ore, 6000);
});

test("et alternativ slås av, det slettes ikke", async () => {
  // En ordre som er sendt med alternativet skal fortsatt kunne vise hva den
  // ble sendt med, også etter at du har sluttet å tilby det.
  const stor = (await hentFrakt()).find((f) => f.navn === "Stor norgespakke");
  await slåAvFrakt(stor.id);

  assert.equal((await hentFrakt()).length, 3);
  assert.equal((await hentFrakt()).find((f) => f.id === stor.id).aktiv, 0);
  // Men kunden ser den ikke.
  assert.deepEqual((await hentFrakt(true)).map((f) => f.navn), ["Liten norgespakke", "Brev"]);
});

test("tull avvises i stedet for å havne i kassen", async () => {
  await assert.rejects(() => leggTilFrakt({ navn: "", pris_ore: 100 }));
  await assert.rejects(() => leggTilFrakt({ navn: "Negativ", pris_ore: -1 }));
  await assert.rejects(() => leggTilFrakt({ navn: "Rar", pris_ore: 100, forsikret_ore: -5 }));
});

test("å endre noe som ikke finnes sier fra", async () => {
  await assert.rejects(() => endreFrakt(99999, { navn: "Spøkelse", pris_ore: 100 }));
});
