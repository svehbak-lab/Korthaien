// Salgsrapporten og oppsummeringen. Oppsummeringen er bilaget i regnskapet,
// så det som testes her er det en revisor ville sjekket: at hvert salg havner
// i riktig periode, at bare betalte salg teller, og at summene går opp.

import test from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";

const DB = `/tmp/rapporter-${process.pid}.db`;
rmSync(DB, { force: true });
process.env.DATABASE_URL = `file:${DB}`;

const { db, migrate } = await import("../src/db.ts");
const { salgsrapport, salgslistePdf, oppsummeringPdf, sjekkPeriode } = await import("../src/rapporter.ts");

await migrate();
process.on("exit", () => rmSync(DB, { force: true }));

let nr = 1;
async function salg(betalt_at, uten, med, status = "betalt") {
  const ordrenr = `S-${nr++}`;
  await db().execute({
    sql: `INSERT INTO salgsordrer (ordrenr, kunde_navn, uten_mva_ore, med_mva_ore, status, betalt_at, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [ordrenr, "Kari Ås", uten, med, status, betalt_at, betalt_at || "2026-01-01T00:00:00Z"],
  });
  return ordrenr;
}

// Sommertid: 30. sept 22:30 UTC er 1. okt 00:30 i Norge.
const okt1 = await salg("2026-09-30T22:30:00.000Z", 10000, 5500);
// Vintertid: 31. okt 23:30 UTC er 1. nov 00:30 i Norge.
const nov1 = await salg("2026-10-31T23:30:00.000Z", 20000, 5500);
// 30. sept 21:30 UTC er fortsatt 30. sept i Norge.
const sep30 = await salg("2026-09-30T21:30:00.000Z", 30000, 0);
const midt = await salg("2026-10-15T12:00:00.000Z", 4000, 15000);
const kansellert = await salg("2026-10-16T12:00:00.000Z", 99900, 0, "kansellert");
const åpen = await salg(null, 88800, 0, "apen");

test("salg havner på norsk dato, ikke UTC-dato", async () => {
  const r = await salgsrapport("2026-10-01", "2026-10-31");
  const nr = r.rader.map((x) => x.ordrenr);
  assert.ok(nr.includes(okt1), "salget 00:30 norsk tid 1. oktober skal med i oktober");
  assert.ok(!nr.includes(nov1), "salget 00:30 norsk tid 1. november skal ikke med i oktober");
  assert.ok(!nr.includes(sep30), "salget 23:30 norsk tid 30. september skal ikke med i oktober");
  assert.equal(r.rader.find((x) => x.ordrenr === okt1).dato, "2026-10-01");

  const sept = await salgsrapport("2026-09-01", "2026-09-30");
  assert.deepEqual(sept.rader.map((x) => x.ordrenr), [sep30]);
  const nov = await salgsrapport("2026-11-01", "2026-11-30");
  assert.deepEqual(nov.rader.map((x) => x.ordrenr), [nov1]);
});

test("bare betalte salg teller", async () => {
  const r = await salgsrapport("2026-01-01", "2026-12-31");
  const nr = r.rader.map((x) => x.ordrenr);
  assert.ok(!nr.includes(kansellert));
  assert.ok(!nr.includes(åpen));
  assert.equal(r.rader.length, 4);
});

test("summene går opp, og momsen er en femtedel av beløpet med mva", async () => {
  const r = await salgsrapport("2026-10-01", "2026-10-31");
  assert.deepEqual(r.rader.map((x) => x.ordrenr), [okt1, midt]);
  assert.equal(r.sum.uten_mva_ore, 14000);
  assert.equal(r.sum.med_mva_ore, 20500);
  assert.equal(r.sum.herav_mva_ore, 4100);
  assert.equal(r.sum.totalt_ore, 34500);
});

test("ugyldige perioder avvises", () => {
  assert.throws(() => sjekkPeriode("2026-10-31", "2026-10-01"));
  assert.throws(() => sjekkPeriode("31.10.2026", "2026-11-01"));
  assert.throws(() => sjekkPeriode("", ""));
  assert.doesNotThrow(() => sjekkPeriode("2026-10-01", "2026-10-01"));
});

test("PDF-ene lages, også for en tom periode", async () => {
  for (const [fra, til] of [["2026-10-01", "2026-10-31"], ["2020-01-01", "2020-01-31"]]) {
    const r = await salgsrapport(fra, til);
    for (const pdf of [await salgslistePdf(r), await oppsummeringPdf(r)]) {
      assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
      assert.ok(pdf.length > 1000);
    }
  }
});
