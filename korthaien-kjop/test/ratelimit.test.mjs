import test from "node:test";
import assert from "node:assert/strict";
const { grense, hentIp, nullstill, status } = await import("../src/ratelimit.ts");

function kjør(mw, ip, headers = {}) {
  const req = { headers: { "x-forwarded-for": ip, ...headers }, ip, socket: {} };
  let status = 200, body = null;
  const res = {
    setHeader() {},
    status(k) { status = k; return this; },
    json(b) { body = b; return this; },
  };
  let neste = false;
  mw(req, res, () => { neste = true; });
  return { status, body, neste };
}

test("vanlig bruk slipper gjennom", () => {
  nullstill();
  const mw = grense({ navn: "test1", perMinutt: 5, perDøgn: 100 });
  for (let i = 0; i < 5; i++) {
    assert.equal(kjør(mw, "1.1.1.1").neste, true, `forespørsel ${i + 1}`);
  }
});

test("minuttgrensen stopper støt", () => {
  nullstill();
  const mw = grense({ navn: "test2", perMinutt: 3, perDøgn: 100 });
  for (let i = 0; i < 3; i++) kjør(mw, "2.2.2.2");
  const r = kjør(mw, "2.2.2.2");
  assert.equal(r.neste, false);
  assert.equal(r.status, 429);
  assert.match(r.body.feil, /Vent et minutt/);
});

test("døgngrensen stopper jevn tapping", () => {
  nullstill();
  // Under minuttgrensen hele veien, men over døgngrensen. Det er slik en
  // tålmodig skraper ville gått fram.
  const mw = grense({ navn: "test3", perMinutt: 1000, perDøgn: 10 });
  for (let i = 0; i < 10; i++) assert.equal(kjør(mw, "3.3.3.3").neste, true);
  const r = kjør(mw, "3.3.3.3");
  assert.equal(r.status, 429);
  assert.match(r.body.feil, /dagens grense/);
});

test("én brukers grense rammer ikke andre", () => {
  nullstill();
  const mw = grense({ navn: "test4", perMinutt: 2, perDøgn: 100 });
  kjør(mw, "4.4.4.4"); kjør(mw, "4.4.4.4");
  assert.equal(kjør(mw, "4.4.4.4").status, 429);
  assert.equal(kjør(mw, "5.5.5.5").neste, true, "en annen kunde er upåvirket");
});

test("regler telles hver for seg", () => {
  nullstill();
  const søk = grense({ navn: "søk", perMinutt: 2, perDøgn: 100 });
  const ordre = grense({ navn: "ordre", perMinutt: 2, perDøgn: 100 });
  kjør(søk, "6.6.6.6"); kjør(søk, "6.6.6.6");
  assert.equal(kjør(søk, "6.6.6.6").status, 429);
  assert.equal(kjør(ordre, "6.6.6.6").neste, true, "ordre er en egen kvote");
});

test("ekte adresse leses fra X-Forwarded-For", () => {
  // Bak Render ser alle forespørsler ut til å komme fra proxyen. Uten dette
  // ville grensen rammet alle kunder samtidig.
  assert.equal(hentIp({ headers: { "x-forwarded-for": "9.9.9.9, 10.0.0.1" }, ip: "10.0.0.1" }), "9.9.9.9");
  assert.equal(hentIp({ headers: {}, ip: "8.8.8.8" }), "8.8.8.8");
  assert.equal(hentIp({ headers: {}, socket: { remoteAddress: "7.7.7.7" } }), "7.7.7.7");
});

test("minnebruken har tak", () => {
  nullstill();
  const mw = grense({ navn: "test7", perMinutt: 100, perDøgn: 1000 });
  for (let i = 0; i < 25000; i++) kjør(mw, `10.0.${Math.floor(i / 256)}.${i % 256}`);
  const s = status();
  assert.ok(s.korteNøkler <= 20000, `holdt seg under taket: ${s.korteNøkler}`);
});
