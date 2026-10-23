// Kredittboka.
//
// Kreditt er en bok, ikke et tall. Forskjellen er at man kan svare på hvor en
// saldo kom fra — og at en retting ikke sletter det som sto der før.
//
// Nøkkelen er e-postadressen i små bokstaver. Uten den normaliseringen ville
// «Ola@x.no» og «ola@x.no» vært to kunder med hver sin saldo, og feilen
// oppdages først når noen klager.

import test from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";

const DB = `/tmp/kreditt-${process.pid}.db`;
rmSync(DB, { force: true });
process.env.DATABASE_URL = `file:${DB}`;

const { migrate } = await import("../src/db.ts");
const { saldo, bevegelser, kontoer, leggTil, settSaldo, normaliserEpost } =
  await import("../src/kreditt.ts");

await migrate();
process.on("exit", () => rmSync(DB, { force: true }));

test("tom konto har saldo null", async () => {
  assert.equal(await saldo("ingen@eksempel.no"), 0);
});

test("saldoen er summen av linjene", async () => {
  await leggTil({ email: "ola@eksempel.no", ore: 124000, grunn: "kjopsordre", order_no: "K-1043" });
  await leggTil({ email: "ola@eksempel.no", ore: -40000, grunn: "kjop" });
  assert.equal(await saldo("ola@eksempel.no"), 84000);
  assert.equal((await bevegelser("ola@eksempel.no")).length, 2);
});

test("store og små bokstaver er samme kunde", async () => {
  // «Ola@x.no» og «ola@x.no» skal ikke bli to kunder med hver sin saldo.
  await leggTil({ email: "  OLA@Eksempel.NO ", ore: 1000 });
  assert.equal(await saldo("ola@eksempel.no"), 85000);
  assert.equal(normaliserEpost(" Ola@X.no "), "ola@x.no");
});

test("null er ikke en bevegelse", async () => {
  // En linje uten beløp sier ingenting og ville bare gjort boka lengre.
  await assert.rejects(() => leggTil({ email: "ola@eksempel.no", ore: 0 }));
});

test("en adresse uten alfakrøll er ikke en kunde", async () => {
  await assert.rejects(() => leggTil({ email: "ola", ore: 100 }));
});

test("å sette saldoen bokfører differansen, den overskriver ikke", async () => {
  // Dette er hele poenget. Skriver man over 85 000 med 50 000, er de 35 000
  // borte uten spor. Her blir det en linje på -35 000, og begge tallene står
  // igjen.
  const før = await bevegelser("ola@eksempel.no");
  const b = await settSaldo("ola@eksempel.no", 50000, "Talt opp på nytt");
  assert.equal(b.ore, -35000);
  assert.equal(b.grunn, "retting");
  assert.equal(await saldo("ola@eksempel.no"), 50000);

  const etter = await bevegelser("ola@eksempel.no");
  assert.equal(etter.length, før.length + 1);
  // Den gamle linjen står fortsatt der, uendret.
  assert.deepEqual(etter.at(-1), før.at(-1));
});

test("å sette saldoen til det den allerede er gir ingen linje", async () => {
  const før = (await bevegelser("ola@eksempel.no")).length;
  assert.equal(await settSaldo("ola@eksempel.no", 50000), null);
  assert.equal((await bevegelser("ola@eksempel.no")).length, før);
});

test("kontolista viser saldo og antall linjer", async () => {
  await leggTil({ email: "kari@eksempel.no", ore: 9900 });
  const alle = await kontoer();
  const ola = alle.find((k) => k.email === "ola@eksempel.no");
  const kari = alle.find((k) => k.email === "kari@eksempel.no");
  assert.equal(ola.saldo_ore, 50000);
  assert.equal(kari.saldo_ore, 9900);
  assert.ok(ola.linjer >= 4);
});

test("kontolista kan søkes i", async () => {
  assert.deepEqual((await kontoer("kari")).map((k) => k.email), ["kari@eksempel.no"]);
  assert.equal((await kontoer("finnesikke")).length, 0);
});

test("en konto med saldo null blir stående i lista", async () => {
  // Den som har brukt opp kreditten sin er fortsatt en kunde, og
  // historikken skal kunne finnes fram.
  await leggTil({ email: "tom@eksempel.no", ore: 5000 });
  await leggTil({ email: "tom@eksempel.no", ore: -5000, grunn: "kjop" });
  const konto = (await kontoer("tom@")).find((k) => k.email === "tom@eksempel.no");
  assert.equal(konto.saldo_ore, 0);
  assert.equal(konto.linjer, 2);
});
