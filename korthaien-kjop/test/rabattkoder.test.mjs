// Rabattkoder: gavekort med saldo som brukes ned, og prosentkoder. Ingen
// innlogging. Koden virker i kassen, bokføres ved betaling og går tilbake
// ved kansellering.
import test from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";

const DB = `/tmp/rabattkoder-${process.pid}.db`;
rmSync(DB, { force: true });
process.env.DATABASE_URL = `file:${DB}`;
process.env.LAGERKILDE = "bok";
delete process.env.STRIPE_SECRET_KEY;
delete process.env.RESEND_KEY;

const { db, migrate, normaliser } = await import("../src/db.ts");
const salg = await import("../src/salg.ts");
const koder = await import("../src/rabattkoder.ts");
const { settManuellSalg } = await import("../src/salgspris.ts");
await migrate();
process.on("exit", () => rmSync(DB, { force: true }));

await db().execute("INSERT INTO sets (code,name,released_at,card_count,parent_code) VALUES ('aaa','Alfa','2020-01-01',10,NULL)");
await db().execute(`INSERT INTO cards (id,oracle_id,name,name_norm,variant,set_code,collector_number,rarity,usd,has_nonfoil,has_foil,released_at)
                    VALUES ('k1','o1','Kort','${normaliser("Kort")}','vanlig','aaa','1','rare',1,1,0,'2020-01-01')`);
await settManuellSalg("k1", "nonfoil", 10000);
await db().execute("INSERT INTO lager_bevegelser (card_id,finish,condition,antall,grunn,created_at) VALUES ('k1','nonfoil','NM',10,'manuell','2026-01-01')");
const f = await db().execute({ sql: "INSERT INTO frakt_alternativer (navn,pris_ore,forsikret_ore,sortering,aktiv,created_at) VALUES ('Brev',5000,NULL,0,1,?) RETURNING id", args: [new Date().toISOString()] });
const kasse = (kode, antall = 1) => ({
  navn: "Gjest", email: "gjest@eksempel.no", adresse: "Gata 1", postnr: "0150", poststed: "Oslo",
  frakt_id: Number(f.rows[0].id), vilkar: true, rabattkode: kode,
  linjer: [{ card_id: "k1", finish: "nonfoil", condition: "NM", antall }],
});

test("gavekort: betaler uten innlogging, og resten står igjen til neste gang", async () => {
  await koder.opprettKode({ kode: "premie500", type: "saldo", saldo_ore: 50000, merknad: "Turnering" });
  // 100 kr kort + 50 kr frakt = 150 kr. Koden dekker alt.
  const r = await salg.åpneKasse(kasse(" Premie500 "), null);
  assert.equal(r.betalt, true);
  const o = await salg.hentOrdre(r.ordrenr);
  assert.equal(o.rabattkode, "PREMIE500");
  assert.equal(Number(o.gavekort_ore), 15000);
  assert.equal(Number(o.stripe_ore), 0);
  assert.equal((await koder.finnKode("PREMIE500")).saldo_ore, 35000);

  // Kansellert: beløpet går tilbake på gavekortet.
  await salg.kanseller(r.ordrenr, "Test", "kreditt");
  assert.equal((await koder.finnKode("PREMIE500")).saldo_ore, 50000);
});

test("ukjent, deaktivert og utløpt kode avvises", async () => {
  await assert.rejects(salg.åpneKasse(kasse("FINNESIKKE"), null), /finnes ikke/);
  const k = await koder.opprettKode({ kode: "GAMMEL", type: "prosent", prosent: 10, gyldig_til: "2020-01-01" });
  await assert.rejects(koder.sjekkKode("gammel"), /utløpt/);
  await koder.endreKode(k.id, { aktiv: false, gyldig_til: null });
  await assert.rejects(koder.sjekkKode("GAMMEL"), /finnes ikke/);
});

test("prosentkode: trekkes fra kortene, ikke frakten, og har tak på antall bruk", async () => {
  await koder.opprettKode({ kode: "HOST10", type: "prosent", prosent: 10, maks_bruk: 1 });
  // Uten Stripe kan ikke resten betales; vi legger kassen inn med en falsk
  // Stripe-klient og ser på beløpene.
  process.env.STRIPE_SECRET_KEY = "sk_test_falsk";
  salg._brukStripe({ checkout: { sessions: { create: async () => ({ id: "cs_1", url: "https://stripe.test" }) } } });
  try {
    const r = await salg.åpneKasse(kasse("host10", 2), null);
    const o = await salg.hentOrdre(r.ordrenr);
    assert.equal(Number(o.rabatt_ore), 2000); // 10 % av 200 kr
    assert.equal(Number(o.stripe_ore), 20000 - 2000 + 5000);
    // Taket på én bruk er nådd mens kassen er åpen.
    await assert.rejects(salg.åpneKasse(kasse("HOST10"), null), /brukt opp/);
  } finally {
    delete process.env.STRIPE_SECRET_KEY;
    salg._brukStripe(null);
  }
});

test("liste med gamle koder fra Mystore kan limes inn", async () => {
  const r = await koder.importerKoder("ABC123 250\nDEF456;99,50;Premie\nPREMIE500 100\nugyldig linje her\n");
  assert.deepEqual({ nye: r.nye, finnes: r.finnes, feil: r.feil.length }, { nye: 2, finnes: 1, feil: 1 });
  assert.equal((await koder.finnKode("def456")).saldo_ore, 9950);
});

test("saldo kan justeres, og begge endringer står i boka", async () => {
  const k = await koder.finnKode("ABC123");
  await koder.justerSaldo(k.id, { saldo_ore: 10000, notat: "Rettet" });
  assert.equal((await koder.finnKode("ABC123")).saldo_ore, 10000);
  assert.equal((await koder.bevegelser(k.id)).length, 2);
});
