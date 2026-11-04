// Kortkvoten: en adresse som har sett veldig mange kort, stoppes en stund.
// Innloggede kunder og adresser med ordre får fire ganger så mye.
import test from "node:test";
import assert from "node:assert/strict";

const rl = await import("../src/ratelimit.ts");

test("kvoten stopper etter timetaket, men ikke før", () => {
  rl.nullstill();
  const ip = "195.139.82.138";
  for (let i = 0; i < 29; i++) rl.brukKortkvote(ip, 100);
  assert.equal(rl.kortkvoteBrukt(ip, false), null);
  rl.brukKortkvote(ip, 100);
  const b = rl.kortkvoteBrukt(ip, false);
  assert.ok(b);
  assert.match(b.feil, /svært mange kort/);
  assert.match(b.feil, /Logger du inn/);
  // Andre adresser merker ingenting.
  assert.equal(rl.kortkvoteBrukt("10.0.0.1", false), null);
});

test("innlogget kunde får fire ganger så mye", () => {
  rl.nullstill();
  const ip = "84.1.2.3";
  rl.brukKortkvote(ip, rl.KORTKVOTE.perTime);
  assert.ok(rl.kortkvoteBrukt(ip, false));
  assert.equal(rl.kortkvoteBrukt(ip, true), null);
  rl.brukKortkvote(ip, rl.KORTKVOTE.perTime * 3);
  const b = rl.kortkvoteBrukt(ip, true);
  assert.ok(b);
  assert.doesNotMatch(b.feil, /Logger du inn/);
});

test("navnesøk med få treff bruker nesten ingenting", () => {
  rl.nullstill();
  const ip = "84.9.9.9";
  for (let i = 0; i < 500; i++) rl.brukKortkvote(ip, 3);
  assert.equal(rl.kortkvoteBrukt(ip, false), null);
});
