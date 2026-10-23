// Foretaksopplysningene som returssiden i butikken er skrevet av.
//
// Loven krever at kunden ser hvem selgeren er, hvor varen skal returneres, og
// — hvis kunden skal betale returfrakten — at det står før kjøpet. Står noe av
// dette i koden, er det ikke mulig å rette uten en utrulling, og da blir det
// stående galt. Derfor ligger det i innstillingene, og derfor er det verdt å
// holde fast ved at feltene faktisk overlever en lagring.

import test from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";

const DB = `/tmp/foretak-${process.pid}.db`;
rmSync(DB, { force: true });
process.env.DATABASE_URL = `file:${DB}`;

const { migrate, hentSettings, settSetting } = await import("../src/db.ts");

await migrate();
process.on("exit", () => rmSync(DB, { force: true }));

test("et nytt oppsett har foretaket på plass", async () => {
  const s = await hentSettings();
  assert.equal(s.org_nr, "914503493");
  assert.ok(s.firmanavn.length > 0, "foretaksnavnet kan ikke være tomt");
});

test("returfrakten betales av kunden til noe annet er valgt", async () => {
  const s = await hentSettings();
  // Loven lar deg velge, men bare hvis valget står på returssiden. Standarden
  // må derfor være den teksten faktisk sier, ikke det motsatte.
  assert.equal(s.retur_frakt, "kunde");
});

test("feltene kan rettes, og retting overlever", async () => {
  await settSetting("firmanavn", "KORTHAIEN AS");
  await settSetting("org_nr", "999888777");
  await settSetting("retur_frakt", "butikk");

  const s = await hentSettings();
  assert.equal(s.firmanavn, "KORTHAIEN AS");
  assert.equal(s.org_nr, "999888777");
  assert.equal(s.retur_frakt, "butikk");
});

test("returadressen er den samme som kunden sender salgskort til", async () => {
  // Én adresse å holde oppdatert. To felt blir før eller senere to adresser,
  // og da er én av dem gal.
  await settSetting("ship_to", "Korthaien\nPostboks 1\n0585 Oslo");
  const s = await hentSettings();
  assert.match(s.ship_to, /0585 Oslo/);
  assert.equal(Object.keys(s).includes("retur_adresse"), false);
});
