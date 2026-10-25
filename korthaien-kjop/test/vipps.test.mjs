// Vipps med egen avtale: kassen sender kunden til Vipps, statusen hentes
// derfra, beløpet trekkes og ordren fullføres. Avbrutt frigir kortene.
// Kansellering refunderer til Vipps. HTTP-kallene til Vipps byttes ut.

import test from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";

const DB = `/tmp/vipps-${process.pid}.db`;
rmSync(DB, { force: true });
process.env.DATABASE_URL = `file:${DB}`;
process.env.LAGERKILDE = "bok";
delete process.env.STRIPE_SECRET_KEY;
delete process.env.RESEND_KEY;
Object.assign(process.env, { VIPPS_CLIENT_ID: "id", VIPPS_CLIENT_SECRET: "s", VIPPS_SUBSCRIPTION_KEY: "k", VIPPS_MSN: "123456", VIPPS_TEST: "1" });

const { db, migrate, normaliser } = await import("../src/db.ts");
const salg = await import("../src/salg.ts");
const vipps = await import("../src/vipps.ts");
const { settManuellSalg } = await import("../src/salgspris.ts");

await migrate();
process.on("exit", () => rmSync(DB, { force: true }));

// En liten falsk Vipps.
const betalinger = new Map();
const kall = [];
vipps._brukFetch(async (url, opts = {}) => {
  const u = new URL(String(url));
  const svar = (d, status = 200) => new Response(JSON.stringify(d), { status, headers: { "Content-Type": "application/json" } });
  kall.push({ metode: opts.method || "GET", sti: u.pathname, hoder: opts.headers, kropp: opts.body ? JSON.parse(opts.body) : null });
  assert.equal(u.host, "apitest.vipps.no");
  if (u.pathname === "/accesstoken/get") return svar({ access_token: "tok", expires_in: "3600" });
  const m = u.pathname.match(/^\/epayment\/v1\/payments(?:\/([^/]+))?(?:\/(capture|refund|cancel))?$/);
  if (!m) return svar({ title: "ukjent" }, 404);
  const [, ref, handling] = m;
  if (!ref) {
    const b = JSON.parse(opts.body);
    betalinger.set(b.reference, { reference: b.reference, state: "CREATED", amount: b.amount,
      aggregate: { authorizedAmount: { value: 0 }, capturedAmount: { value: 0 }, refundedAmount: { value: 0 }, cancelledAmount: { value: 0 } } });
    return svar({ reference: b.reference, redirectUrl: `https://vipps.test/${b.reference}` });
  }
  const b = betalinger.get(decodeURIComponent(ref));
  if (!handling) return svar(b);
  const beløp = handling === "cancel" ? 0 : JSON.parse(opts.body).modificationAmount.value;
  if (handling === "capture") b.aggregate.capturedAmount.value += beløp;
  if (handling === "refund") b.aggregate.refundedAmount.value += beløp;
  if (handling === "cancel" && b.state === "CREATED") b.state = "ABORTED";
  return svar(b);
});

await db().execute("INSERT INTO sets (code,name,released_at,card_count,parent_code) VALUES ('aaa','Alfa','2020-01-01',10,NULL)");
await db().execute({
  sql: `INSERT INTO cards (id,oracle_id,name,name_norm,front_norm,back_norm,variant,set_code,collector_number,rarity,usd,usd_foil,has_nonfoil,has_foil,image_uri,released_at)
        VALUES ('k1','o1','Testkort',?,NULL,NULL,'vanlig','aaa','1','rare',1,NULL,1,0,NULL,'2020-01-01')`,
  args: [normaliser("Testkort")],
});
await settManuellSalg("k1", "nonfoil", 2000);
await db().execute("INSERT INTO lager_bevegelser (card_id,finish,condition,antall,grunn,created_at) VALUES ('k1','nonfoil','NM',5,'manuell','2026-01-01T00:00:00Z')");
const frakt = await db().execute({
  sql: "INSERT INTO frakt_alternativer (navn,pris_ore,forsikret_ore,sortering,aktiv,created_at) VALUES ('Brev',5500,NULL,0,1,?) RETURNING id",
  args: [new Date().toISOString()],
});
const kasse = (telefon = "") => salg.åpneKasse({
  navn: "Kari", email: "kari@eksempel.no", adresse: "Gata 1", postnr: "0150", poststed: "Oslo", telefon,
  frakt_id: Number(frakt.rows[0].id), vilkar: true, betaling: "vipps",
  linjer: [{ card_id: "k1", finish: "nonfoil", condition: "NM", antall: 2 }],
}, null);
const lager = async () => Number((await db().execute("SELECT SUM(antall) AS n FROM lager_bevegelser WHERE card_id = 'k1'")).rows[0].n);

test("kassen lager en Vipps-betaling og sender kunden dit", async () => {
  const r = await kasse("412 34 567");
  assert.match(r.url, /^https:\/\/vipps\.test\/korthaien-S-/);
  const opprett = kall.find((k) => k.metode === "POST" && k.sti === "/epayment/v1/payments");
  assert.equal(opprett.kropp.amount.value, 2 * 2000 + 5500);
  assert.equal(opprett.kropp.customer.phoneNumber, "4741234567");
  assert.equal(opprett.kropp.userFlow, "WEB_REDIRECT");
  assert.ok(opprett.hoder["Idempotency-Key"]);
  const o = await salg.hentOrdre(r.ordrenr);
  assert.equal(o.status, "apen");
  assert.equal(o.betalingsmate, "vipps");
});

test("godkjent i Vipps: beløpet trekkes og ordren blir betalt", async () => {
  const r = await kasse();
  const o = await salg.hentOrdre(r.ordrenr);
  await salg.oppdaterVippsOrdre(r.ordrenr);
  assert.equal((await salg.hentOrdre(r.ordrenr)).status, "apen"); // ikke godkjent ennå
  betalinger.get(o.vipps_ref).state = "AUTHORIZED";
  const før = await lager();
  await salg.oppdaterVippsOrdre(r.ordrenr);
  const etter = await salg.hentOrdre(r.ordrenr);
  assert.equal(etter.status, "betalt");
  assert.equal(betalinger.get(o.vipps_ref).aggregate.capturedAmount.value, 9500);
  assert.equal(await lager(), før - 2);
  // En gang til trekker ikke på nytt.
  await salg.oppdaterVippsOrdre(r.ordrenr);
  assert.equal(betalinger.get(o.vipps_ref).aggregate.capturedAmount.value, 9500);

  // Kansellering refunderer til Vipps.
  await salg.kanseller(r.ordrenr, "test");
  assert.equal(betalinger.get(o.vipps_ref).aggregate.refundedAmount.value, 9500);
  assert.equal((await salg.hentOrdre(r.ordrenr)).status, "kansellert");
  assert.equal(await lager(), før);
});

test("avbrutt i Vipps frigir kortene", async () => {
  const r = await kasse();
  const o = await salg.hentOrdre(r.ordrenr);
  betalinger.get(o.vipps_ref).state = "ABORTED";
  await salg.oppdaterVippsOrdre(r.ordrenr);
  assert.equal((await salg.hentOrdre(r.ordrenr)).status, "utlopt");
});

test("utløpt kasse: Vipps-betalingen lukkes og kortene frigis", async () => {
  const r = await kasse();
  const o = await salg.hentOrdre(r.ordrenr);
  await db().execute({ sql: "UPDATE salgsordrer SET utloper_at = '2000-01-01T00:00:00Z' WHERE ordrenr = ?", args: [r.ordrenr] });
  await salg.utløpGamle(true);
  assert.equal(betalinger.get(o.vipps_ref).state, "ABORTED");
  assert.equal((await salg.hentOrdre(r.ordrenr)).status, "utlopt");
});
