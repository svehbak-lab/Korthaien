import test, { after } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";

const DB = `/tmp/totp-${process.pid}.db`;
rmSync(DB, { force: true });
process.env.DATABASE_URL = `file:${DB}`;
process.env.ADMIN_PASSWORD = "riktig-passord";
process.env.SESSION_SECRET = "test";
process.env.PORT = "3221";

const { migrate } = await import("../src/db.ts");
const { kodeFor } = await import("../src/totp.ts");
await migrate();
process.on("exit", () => rmSync(DB, { force: true }));

const { stopp } = await import("../src/server.ts");
await new Promise((r) => setTimeout(r, 800));
after(() => stopp());

const BASE = "http://localhost:3221";
let cookie = "";

// Innlogging er begrenset til fem forsøk i minuttet per adresse — med god
// grunn. Testen bruker derfor en ny adresse per kall, slik at vi tester
// innloggingen og ikke grensen. At grensen virker, dekkes i ratelimit-testen.
let teller = 0;
const nyAdresse = () => `203.0.113.${(teller++ % 250) + 1}`;

async function kall(sti, opts = {}) {
  const r = await fetch(BASE + sti, {
    ...opts,
    headers: {
      ...(opts.body ? { "Content-Type": "application/json" } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      "X-Forwarded-For": nyAdresse(),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const satt = r.headers.get("set-cookie");
  if (satt) cookie = satt.split(";")[0];
  const tekst = await r.text();
  return { status: r.status, data: tekst ? JSON.parse(tekst) : null };
}

let hemmelighet = "";
let reservekoder = [];

test("feil passord slipper ikke inn", async () => {
  const r = await kall("/api/admin/login", { method: "POST", body: { password: "feil" } });
  assert.equal(r.status, 401);
});

test("uten engangskode holder passordet alene", async () => {
  const r = await kall("/api/admin/login", { method: "POST", body: { password: "riktig-passord" } });
  assert.equal(r.status, 200);
  const meg = await kall("/api/admin/me");
  assert.equal(meg.status, 200);
});

test("oppsettet krever at du er logget inn", async () => {
  const uten = await fetch(BASE + "/api/admin/totp/start", { method: "POST" });
  assert.equal(uten.status, 401);
});

test("hemmeligheten kommer med en adresse appen kan skanne", async () => {
  const r = await kall("/api/admin/totp/start", { method: "POST" });
  assert.equal(r.status, 200);
  hemmelighet = r.data.hemmelighet;
  assert.match(hemmelighet, /^[A-Z2-7]{32}$/);
  assert.match(r.data.uri, /^otpauth:\/\/totp\//);
  assert.ok(r.data.uri.includes(hemmelighet));
});

test("en hemmelighet som ikke er bekreftet, låser ingen ute", async () => {
  // Halvferdig skanning skal ikke stenge deg ute ved neste innlogging.
  const status = await kall("/api/admin/totp");
  assert.equal(status.data.påslått, false);
  assert.equal(status.data.venter, true);

  const r = await kall("/api/admin/login", { method: "POST", body: { password: "riktig-passord" } });
  assert.equal(r.status, 200);
});

test("feil kode slår ikke på engangskode", async () => {
  const r = await kall("/api/admin/totp/bekreft", { method: "POST", body: { kode: "000000" } });
  assert.equal(r.status, 400);
  assert.equal((await kall("/api/admin/totp")).data.påslått, false);
});

test("riktig kode slår den på og gir ti reservekoder", async () => {
  const r = await kall("/api/admin/totp/bekreft", {
    method: "POST",
    body: { kode: kodeFor(hemmelighet) },
  });
  assert.equal(r.status, 200);
  reservekoder = r.data.reservekoder;
  assert.equal(reservekoder.length, 10);
  assert.equal(new Set(reservekoder).size, 10, "kodene skal være ulike");

  const status = await kall("/api/admin/totp");
  assert.equal(status.data.påslått, true);
  assert.equal(status.data.reservekoder, 10);
});

test("passordet alene holder ikke lenger", async () => {
  cookie = "";
  const r = await kall("/api/admin/login", { method: "POST", body: { password: "riktig-passord" } });
  assert.equal(r.status, 401);
  assert.equal(r.data.trengerKode, true, "klienten må få vite at den skal spørre om kode");
  assert.equal((await kall("/api/admin/me")).status, 401);
});

test("feil engangskode slipper ikke inn", async () => {
  cookie = "";
  const r = await kall("/api/admin/login", {
    method: "POST",
    body: { password: "riktig-passord", kode: "000000" },
  });
  assert.equal(r.status, 401);
});

test("passord og riktig kode slipper inn", async () => {
  cookie = "";
  const r = await kall("/api/admin/login", {
    method: "POST",
    body: { password: "riktig-passord", kode: kodeFor(hemmelighet) },
  });
  assert.equal(r.status, 200);
  assert.equal((await kall("/api/admin/me")).status, 200);
});

test("riktig kode med feil passord slipper ikke inn", async () => {
  cookie = "";
  const r = await kall("/api/admin/login", {
    method: "POST",
    body: { password: "feil", kode: kodeFor(hemmelighet) },
  });
  assert.equal(r.status, 401);
});

test("en reservekode virker, men bare én gang", async () => {
  cookie = "";
  const kode = reservekoder[0];
  assert.equal(
    (await kall("/api/admin/login", { method: "POST", body: { password: "riktig-passord", kode } })).status,
    200
  );
  assert.equal((await kall("/api/admin/totp")).data.reservekoder, 9);

  cookie = "";
  const igjen = await kall("/api/admin/login", {
    method: "POST",
    body: { password: "riktig-passord", kode },
  });
  assert.equal(igjen.status, 401, "brukt reservekode skal være verdiløs");
});

test("reservekoder tåler mellomrom og små bokstaver", async () => {
  cookie = "";
  const rotete = reservekoder[1].toLowerCase().replace("-", " ");
  const r = await kall("/api/admin/login", {
    method: "POST",
    body: { password: "riktig-passord", kode: rotete },
  });
  assert.equal(r.status, 200);
});

test("å slå av krever passordet på nytt", async () => {
  cookie = "";
  await kall("/api/admin/login", {
    method: "POST",
    body: { password: "riktig-passord", kode: kodeFor(hemmelighet) },
  });

  const feil = await kall("/api/admin/totp", { method: "DELETE", body: { password: "feil" } });
  assert.equal(feil.status, 401);
  assert.equal((await kall("/api/admin/totp")).data.påslått, true);

  const ok = await kall("/api/admin/totp", { method: "DELETE", body: { password: "riktig-passord" } });
  assert.equal(ok.status, 200);
  const status = await kall("/api/admin/totp");
  assert.equal(status.data.påslått, false);
  assert.equal(status.data.reservekoder, 0, "gamle reservekoder skal ikke overleve");
});
