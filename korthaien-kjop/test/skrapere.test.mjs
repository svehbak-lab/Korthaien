import test from "node:test";
import assert from "node:assert/strict";
const { hvilkenSkraper, stengSkrapere, SKRAPERMELDING } = await import("../src/skrapere.ts");

const req = (ip, agent) => ({ headers: { "x-forwarded-for": ip, "user-agent": agent }, path: "/katalog" });

test("MTGPriceTracker gjenkjennes på adresse eller navn; LagervarselBot og kunder slipper gjennom", () => {
  assert.equal(hvilkenSkraper(req("195.139.82.138", "Mozilla/5.0 Chrome/124.0")), "MTGPriceTracker");
  assert.equal(hvilkenSkraper(req("10.1.1.1", "Mozilla/5.0 Chrome/124.0 MTGPriceTracker/0.2")), "MTGPriceTracker");
  assert.equal(hvilkenSkraper(req("2.31.61.62", "LagervarselBot/0.1 (+https://lagervarsel.no/bot)")), null);
  assert.equal(hvilkenSkraper(req("84.1.2.3", "Mozilla/5.0 (iPhone) Safari/604.1")), null);
});

test("skraperen får 403 med meldingen, ikke kortene", () => {
  let status, body, videre = false;
  const res = { status(s) { status = s; return this; }, json(b) { body = b; } };
  const logg = console.log; console.log = () => {};
  stengSkrapere(req("195.139.82.138", "x"), res, () => { videre = true; });
  console.log = logg;
  assert.equal(videre, false);
  assert.equal(status, 403);
  assert.equal(body.feil, SKRAPERMELDING);
  assert.match(body.feil, /korthaien@gmail\.com/);
});
