// Katalogsvar huskes et minutt, like spørringer deles, og tunge spørringer
// (hele katalogen) går én om gangen uten å stenge for navnesøk.
import test from "node:test";
import assert from "node:assert/strict";

const { katalogMedKø, glemKatalog, erTung } = await import("../src/katalogkø.ts");
const vent = (ms) => new Promise((r) => setTimeout(r, ms));

test("samme spørring innen et minutt regnes ut én gang; glemKatalog nullstiller", async () => {
  glemKatalog();
  let n = 0;
  const regn = async () => { n++; return { n }; };
  const f = { q: "bolt", side: 1 };
  const [a, b] = await Promise.all([katalogMedKø(f, regn), katalogMedKø({ side: 1, q: "bolt" }, regn)]);
  assert.equal(n, 1);
  assert.deepEqual(a, b);
  await katalogMedKø(f, regn, Date.now() + 61_000);
  assert.equal(n, 2, "utløpt etter et minutt");
  glemKatalog();
  await katalogMedKø(f, regn);
  assert.equal(n, 3);
});

test("feil huskes ikke", async () => {
  glemKatalog();
  let n = 0;
  await assert.rejects(katalogMedKø({ q: "x" }, async () => { n++; throw new Error("nei"); }));
  await vent(0);
  const r = await katalogMedKø({ q: "x" }, async () => { n++; return "ok"; });
  assert.equal(r, "ok");
  assert.equal(n, 2);
});

test("tunge går én om gangen; et navnesøk venter ikke på dem", async () => {
  glemKatalog();
  assert.equal(erTung({}), true);
  assert.equal(erTung({ q: "grim mon" }), false);
  assert.equal(erTung({ sett: "mh3" }), false);

  let samtidig = 0, maks = 0;
  const tung = async () => { samtidig++; maks = Math.max(maks, samtidig); await vent(60); samtidig--; return "tung"; };
  const t1 = katalogMedKø({ side: 1 }, tung);
  const t2 = katalogMedKø({ side: 2 }, tung);
  const t3 = katalogMedKø({ side: 3 }, tung);

  const start = Date.now();
  const lett = await katalogMedKø({ q: "grim mon" }, async () => "lett");
  assert.equal(lett, "lett");
  assert.ok(Date.now() - start < 40, "navnesøket gikk forbi køen");

  await Promise.all([t1, t2, t3]);
  assert.equal(maks, 1);
});
