// Salget: konto, kasse, reservasjon, betaling, kansellering.
//
// Betalingen med Stripe kan ikke kjøres her uten nøkler. Det testes i stedet
// det som skjer rundt den: at kort holdes av og frigis, at en ordre betalt
// med kreditt bokføres riktig, og at samme betaling to ganger ikke trekker
// lageret to ganger. fullfør() er den samme funksjonen webhooken kaller.

import test from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";

const DB = `/tmp/salg-${process.pid}.db`;
rmSync(DB, { force: true });
process.env.DATABASE_URL = `file:${DB}`;
// Disse testene legger kort i lagerboken; butikken skal lese derfra.
process.env.LAGERKILDE = "bok";
delete process.env.STRIPE_SECRET_KEY;
delete process.env.RESEND_KEY;

const { db, migrate, normaliser } = await import("../src/db.ts");
const konto = await import("../src/kunder.ts");
const salg = await import("../src/salg.ts");
const kreditt = await import("../src/kreditt.ts");
const { settManuellSalg } = await import("../src/salgspris.ts");
const { salgsrapport } = await import("../src/rapporter.ts");

await migrate();
process.on("exit", () => rmSync(DB, { force: true }));

await db().execute({
  sql: "INSERT INTO sets (code,name,released_at,card_count,parent_code) VALUES ('aaa','Alfa','2020-01-01',10,NULL),('bbb','Beta','2021-01-01',10,NULL)",
  args: [],
});
let n = 0;
async function kort(sett, navn, rarity, prisØre, påLager) {
  const id = `k${n++}`;
  await db().execute({
    sql: `INSERT INTO cards (id,oracle_id,name,name_norm,front_norm,back_norm,variant,set_code,
                             collector_number,rarity,usd,usd_foil,has_nonfoil,has_foil,image_uri,released_at)
          VALUES (?,?,?,?,NULL,NULL,'vanlig',?,?,?,1,NULL,1,0,NULL,'2020-01-01')`,
    args: [id, "o-" + id, navn, normaliser(navn), sett, String(n), rarity],
  });
  await settManuellSalg(id, "nonfoil", prisØre);
  if (påLager) {
    await db().execute({
      sql: `INSERT INTO lager_bevegelser (card_id,finish,condition,antall,grunn,created_at)
            VALUES (?,'nonfoil','NM',?,'manuell','2026-01-01T00:00:00Z')`,
      args: [id, påLager],
    });
  }
  return id;
}
const ettEks = await kort("bbb", "Siste Eksemplar", "mythic", 10000, 1);
const vanlig = await kort("aaa", "Vanlig Kort", "common", 500, 10);
const sjelden = await kort("aaa", "Sjeldent Kort", "rare", 2000, 3);
const frakt = await db().execute({
  sql: "INSERT INTO frakt_alternativer (navn,pris_ore,forsikret_ore,sortering,aktiv,created_at) VALUES ('Brev',5500,NULL,0,1,?) RETURNING id",
  args: [new Date().toISOString()],
});
const FRAKT = Number(frakt.rows[0].id);

const adresse = { navn: "Kari Ås", adresse: "Gata 1", postnr: "0150", poststed: "Oslo", frakt_id: FRAKT, vilkar: true };
const lager = async (id) =>
  Number((await db().execute({ sql: "SELECT SUM(antall) AS n FROM lager_bevegelser WHERE card_id = ?", args: [id] })).rows[0].n);

test("passord lagres som hash, og innlogging virker bare med riktig passord", async () => {
  const k = await konto.registrer({ email: "Kari@Eksempel.no", passord: "hemmelig123", navn: "Kari" });
  assert.equal(k.email, "kari@eksempel.no");
  const rad = (await db().execute({ sql: "SELECT passord_hash FROM kunder WHERE id = ?", args: [k.id] })).rows[0];
  assert.ok(String(rad.passord_hash).startsWith("scrypt$"));
  assert.ok(!String(rad.passord_hash).includes("hemmelig123"));
  assert.equal((await konto.loggInn("kari@eksempel.no", "hemmelig123")).id, k.id);
  await assert.rejects(konto.loggInn("kari@eksempel.no", "feil-passord"), /Feil e-postadresse eller passord/);
  await assert.rejects(konto.loggInn("ukjent@eksempel.no", "hemmelig123"), /Feil e-postadresse eller passord/);
  await assert.rejects(konto.registrer({ email: "kari@eksempel.no", passord: "annetpassord" }), /finnes allerede/);
  await assert.rejects(konto.registrer({ email: "ny@eksempel.no", passord: "kort" }), /minst 8/);
});

test("sesjonen er et token; i databasen ligger bare et hash", async () => {
  const k = await konto.loggInn("kari@eksempel.no", "hemmelig123");
  const token = await konto.nySesjon(k.id);
  assert.equal((await konto.sesjonsKunde(token)).id, k.id);
  const lagret = await db().execute({ sql: "SELECT 1 FROM kunde_sesjoner WHERE token_hash = ?", args: [token] });
  assert.equal(lagret.rows.length, 0, "tokenet selv skal ikke stå i databasen");
  await konto.avsluttSesjon(token);
  assert.equal(await konto.sesjonsKunde(token), null);
});

test("glemt passord: lenken virker én gang og logger ut andre sesjoner", async () => {
  const k = await konto.loggInn("kari@eksempel.no", "hemmelig123");
  const gammel = await konto.nySesjon(k.id);
  const t = await konto.lagTilbakestilling("kari@eksempel.no");
  await konto.brukTilbakestilling(t.token, "nyttpassord1");
  assert.equal(await konto.sesjonsKunde(gammel), null);
  await assert.rejects(konto.brukTilbakestilling(t.token, "enda-et-passord"), /utløpt eller allerede brukt/);
  assert.ok(await konto.loggInn("kari@eksempel.no", "nyttpassord1"));
  // En adresse uten historikk får ingen lenke, og ingen konto lages.
  assert.equal(await konto.lagTilbakestilling("fremmed@eksempel.no"), null);
});

test("kunde fra kjøpssiden får konto via glemt passord, og kreditten følger med", async () => {
  await kreditt.leggTil({ email: "selger@eksempel.no", ore: 30000, grunn: "kjopsordre" });
  const t = await konto.lagTilbakestilling("selger@eksempel.no");
  assert.ok(t, "en adresse med kreditt skal kunne lage konto");
  const k = await konto.brukTilbakestilling(t.token, "passord123");
  assert.equal(await salg.tilgjengeligKreditt(k.email), 30000);
});

test("kurven prises på serveren, og utsolgte linjer merkes", async () => {
  const l = await salg.prisKurv([
    { card_id: vanlig, finish: "nonfoil", condition: "NM", antall: 2, enhet_ore: 1 },
    { card_id: ettEks, finish: "nonfoil", condition: "NM", antall: 2 },
  ]);
  assert.equal(l[0].enhet_ore, 500, "prisen fra klienten skal ignoreres");
  assert.equal(l[1].feil, "Bare 1 igjen.");
});

test("kreditt som dekker alt: ordren er betalt, lager og kreditt bokført, linjene sortert", async () => {
  const kari = await konto.loggInn("selger@eksempel.no", "passord123");
  const r = await salg.åpneKasse(
    {
      ...adresse,
      email: "ignoreres@eksempel.no",
      bruk_kreditt: true,
      linjer: [
        { card_id: vanlig, finish: "nonfoil", condition: "NM", antall: 2 },
        { card_id: ettEks, finish: "nonfoil", condition: "NM", antall: 1 },
        { card_id: sjelden, finish: "nonfoil", condition: "NM", antall: 1 },
      ],
    },
    kari
  );
  assert.equal(r.betalt, true);
  assert.equal(r.url, null);
  const o = await salg.hentOrdre(r.ordrenr);
  assert.equal(o.status, "betalt");
  assert.equal(o.email, "selger@eksempel.no", "innlogget kunde handler på sin egen adresse");
  assert.equal(o.varer_ore, 2 * 500 + 10000 + 2000);
  assert.equal(o.frakt_ore, 5500);
  assert.equal(o.kreditt_ore, 18500);
  assert.equal(o.stripe_ore, 0);
  // Sett, så raritet: Alfa (rare, common), så Beta.
  assert.deepEqual(o.linjer.map((l) => l.card_name), ["Sjeldent Kort", "Vanlig Kort", "Siste Eksemplar"]);
  assert.equal(await lager(ettEks), 0);
  assert.equal(await lager(vanlig), 8);
  assert.equal(await kreditt.saldo("selger@eksempel.no"), 30000 - 18500);

  // Samme betaling en gang til (Stripe sender på nytt) endrer ingenting.
  assert.equal(await salg.fullfør(o.id, "test"), false);
  assert.equal(await lager(vanlig), 8);
  assert.equal(await kreditt.saldo("selger@eksempel.no"), 30000 - 18500);

  // Rapporten teller penger. En ordre betalt helt med kreditt står ikke der.
  const dag = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Oslo" }).format(new Date());
  const rap = await salgsrapport(dag, dag);
  assert.equal(rap.rader.find((x) => x.ordrenr === r.ordrenr), undefined);
});

test("et kort som er holdt av i en åpen kasse, kan ikke kjøpes av en annen", async () => {
  // Uten Stripe-nøkler feiler betalingssiden, og reservasjonen frigis. Vi
  // legger derfor en åpen kasse inn direkte, slik åpneKasse skriver den.
  const id = await kort("aaa", "Ettertraktet", "mythic", 9900, 1);
  const o = await db().execute({
    sql: `INSERT INTO salgsordrer (ordrenr, kunde_navn, email, status, utloper_at, created_at, varer_ore)
          VALUES ('KS-TEST-1', 'Per', 'per@eksempel.no', 'apen', ?, ?, 9900) RETURNING id`,
    args: [new Date(Date.now() + 10 * 60_000).toISOString(), new Date().toISOString()],
  });
  await db().execute({
    sql: `INSERT INTO salgsordre_linjer (ordre_id, card_id, finish, condition, antall, enhet_ore, card_name, set_code, set_name)
          VALUES (?, ?, 'nonfoil', 'NM', 1, 9900, 'Ettertraktet', 'aaa', 'Alfa')`,
    args: [o.rows[0].id, id],
  });
  const kurv = await salg.prisKurv([{ card_id: id, finish: "nonfoil", condition: "NM", antall: 1 }]);
  assert.equal(kurv[0].feil, "Utsolgt.");
  await assert.rejects(
    salg.åpneKasse({ ...adresse, email: "ola@eksempel.no", linjer: [{ card_id: id, finish: "nonfoil", condition: "NM", antall: 1 }] }, null),
    /ikke tilgjengelige/
  );

  // Når kvarteret er ute, holdes kortet fortsatt til kassen faktisk er
  // lukket — betalingssiden kan ennå betales. Først etter opprydningen er
  // det ledig.
  await db().execute({ sql: "UPDATE salgsordrer SET utloper_at = ? WHERE id = ?", args: ["2000-01-01T00:00:00Z", o.rows[0].id] });
  const førRydding = await salg.prisKurv([{ card_id: id, finish: "nonfoil", condition: "NM", antall: 1 }]);
  assert.equal(førRydding[0].feil, "Utsolgt.");
  assert.equal(await salg.utløpGamle(true), 1);
  const etter = await salg.prisKurv([{ card_id: id, finish: "nonfoil", condition: "NM", antall: 1 }]);
  assert.equal(etter[0].feil, undefined);
  assert.equal((await salg.hentOrdre("KS-TEST-1")).status, "utlopt");
});

test("uten Stripe feiler en kasse som må betales, og ingenting holdes av", async () => {
  await assert.rejects(
    salg.åpneKasse({ ...adresse, email: "ola@eksempel.no", linjer: [{ card_id: vanlig, finish: "nonfoil", condition: "NM", antall: 1 }] }, null),
    /Betaling er ikke satt opp/
  );
  const åpne = await db().execute("SELECT COUNT(*) AS n FROM salgsordrer WHERE status = 'apen'");
  assert.equal(Number(åpne.rows[0].n), 0);
});

test("kassen krever vilkår, adresse og frakt", async () => {
  const linjer = [{ card_id: vanlig, finish: "nonfoil", condition: "NM", antall: 1 }];
  await assert.rejects(salg.åpneKasse({ ...adresse, vilkar: false, email: "a@b.no", linjer }, null), /kjøpsvilkårene/);
  await assert.rejects(salg.åpneKasse({ ...adresse, adresse: "", email: "a@b.no", linjer }, null), /adresse/);
  await assert.rejects(salg.åpneKasse({ ...adresse, frakt_id: 9999, email: "a@b.no", linjer }, null), /fraktmåte/);
});

test("pakket, sendt og kansellering: penger tilbake som kreditt, kort tilbake på lager", async () => {
  const kari = await konto.loggInn("selger@eksempel.no", "passord123");
  await kreditt.leggTil({ email: kari.email, ore: 20000, grunn: "manuell" });
  const r = await salg.åpneKasse(
    { ...adresse, email: "", bruk_kreditt: true, linjer: [{ card_id: vanlig, finish: "nonfoil", condition: "NM", antall: 3 }] },
    kari
  );
  const før = await kreditt.saldo(kari.email);
  assert.equal((await salg.settStatus(r.ordrenr, { status: "pakket" })).status, "pakket");
  await assert.rejects(salg.settStatus(r.ordrenr, { status: "kansellert" }), /ikke mulig/);
  const k = await salg.kanseller(r.ordrenr, "Kunden angret");
  assert.equal(k.status, "kansellert");
  assert.equal(await kreditt.saldo(kari.email), før + 1500 + 5500);
  assert.equal(await lager(vanlig), 8);
  await assert.rejects(salg.kanseller(r.ordrenr, "igjen"), /kan ikke kanselleres/);
});

test("statistikken teller ordrer og kort denne måneden, ikke kansellerte", async () => {
  const s = await salg.salgsstatistikk();
  assert.equal(s.denne.ordrer, 1);
  assert.equal(s.denne.kort, 4);
  // Betalt helt med kreditt: ingen penger inn.
  assert.equal(s.denne.omsetning_ore, 0);
});

test("kundens ordrehistorikk har bare egne ordrer, og ikke forlatte kasser", async () => {
  const kari = await konto.loggInn("selger@eksempel.no", "passord123");
  const ordrer = await salg.kundensOrdrer(kari);
  assert.equal(ordrer.length, 2);
  assert.ok(ordrer.every((o) => !["apen", "utlopt"].includes(o.status)));
  const per = { id: 999, email: "per@eksempel.no" };
  assert.equal((await salg.kundensOrdrer(per)).length, 0);
});

test("måneder før det første salget logges ikke i statistikken", async () => {
  await db().execute("DELETE FROM salg_statistikk");
  const s = await salg.salgsstatistikk();
  // Alle salgene i testen er denne måneden, så forrige måned fantes ikke
  // butikken ennå.
  assert.equal(s.historikk.length, 0);
});

test("ubekreftet konto: kreditten og gjesteordrene på adressen følger ikke med", async () => {
  // Noen registrerer adressen til en kunde som har kreditt og ordrer.
  const tyv = await konto.registrer({ email: "selger@eksempel.no".replace("selger", "offer"), passord: "tyvepassord1" });
  await kreditt.leggTil({ email: "offer@eksempel.no", ore: 50000, grunn: "kjopsordre" });
  await db().execute({
    sql: `INSERT INTO salgsordrer (ordrenr, kunde_navn, email, status, betalt_at, created_at, adresse)
          VALUES ('KS-GJEST-1', 'Offer', 'offer@eksempel.no', 'betalt', ?, ?, 'Hemmelig vei 1')`,
    args: [new Date().toISOString(), new Date().toISOString()],
  });
  assert.equal(tyv.bekreftet, false);
  assert.equal((await salg.kundensOrdrer(tyv)).length, 0, "gjesteordren skal ikke vises");
  const gjesteordre = await salg.hentOrdre("KS-GJEST-1");
  assert.equal(await salg.tilhørerKunde(gjesteordre, tyv), false);
  // Kassen bruker ikke kreditten, selv om kunden ber om det.
  await assert.rejects(
    salg.åpneKasse({ ...adresse, email: "", bruk_kreditt: true, linjer: [{ card_id: vanlig, finish: "nonfoil", condition: "NM", antall: 1 }] }, tyv),
    /Betaling er ikke satt opp/
  );
  assert.equal(await kreditt.saldo("offer@eksempel.no"), 50000);

  // Eieren bekrefter adressen med lenken i e-posten: da følger det med.
  const token = await konto.lagBekreftelse(tyv.id);
  const bekreftet = await konto.bekreftEpost(token);
  assert.equal(bekreftet.bekreftet, true);
  assert.equal((await salg.kundensOrdrer(bekreftet)).length, 1);
  await assert.rejects(konto.bekreftEpost(token), /utløpt eller allerede brukt/);
});

test("kreditt holdt av i en åpen kasse kan ikke brukes i en annen, heller ikke etter kvarteret", async () => {
  const k = await konto.loggInn("selger@eksempel.no", "passord123");
  const saldo = await kreditt.saldo(k.email);
  await db().execute({
    sql: `INSERT INTO salgsordrer (ordrenr, kunde_navn, email, status, kreditt_ore, utloper_at, created_at)
          VALUES ('KS-HOLDT-1', 'Kari', ?, 'apen', ?, '2000-01-01T00:00:00Z', ?)`,
    args: [k.email, saldo, new Date().toISOString()],
  });
  assert.equal(await salg.tilgjengeligKreditt(k.email), 0);
  await db().execute("UPDATE salgsordrer SET status = 'utlopt' WHERE ordrenr = 'KS-HOLDT-1'");
  assert.equal(await salg.tilgjengeligKreditt(k.email), saldo);
});

test("et restbeløp under 3 kr kan ikke sendes til Stripe", async () => {
  const gratis = await db().execute({
    sql: "INSERT INTO frakt_alternativer (navn,pris_ore,forsikret_ore,sortering,aktiv,created_at) VALUES ('Hent selv',0,NULL,9,1,?) RETURNING id",
    args: [new Date().toISOString()],
  });
  const billig = await kort("aaa", "Ørlite Kort", "common", 100, 5);
  await assert.rejects(
    salg.åpneKasse({ ...adresse, frakt_id: Number(gratis.rows[0].id), email: "a@b.no", linjer: [{ card_id: billig, finish: "nonfoil", condition: "NM", antall: 1 }] }, null),
    /minst 3 kr/
  );
});

test("bytte av passord logger ut de andre innloggingene, men ikke denne", async () => {
  const k = await konto.loggInn("selger@eksempel.no", "passord123");
  const her = await konto.nySesjon(k.id);
  const der = await konto.nySesjon(k.id);
  await konto.byttPassord(k.id, "passord123", "nyttpassord9", her);
  assert.ok(await konto.sesjonsKunde(her));
  assert.equal(await konto.sesjonsKunde(der), null);
  await konto.byttPassord(k.id, "nyttpassord9", "passord123", her);
});

test("en ny tilbakestillingslenke gjør den forrige ubrukelig når én brukes", async () => {
  const a = await konto.lagTilbakestilling("selger@eksempel.no");
  const b = await konto.lagTilbakestilling("selger@eksempel.no");
  await konto.brukTilbakestilling(b.token, "passord123");
  await assert.rejects(konto.brukTilbakestilling(a.token, "annetpassord"), /utløpt eller allerede brukt/);
});

test("feil passord og en konto som bare bruker Google gir samme melding", async () => {
  await db().execute({
    sql: "INSERT INTO kunder (email, google_sub, epost_bekreftet_at, created_at) VALUES ('g@eksempel.no', 'sub-1', ?, ?)",
    args: [new Date().toISOString(), new Date().toISOString()],
  });
  await assert.rejects(konto.loggInn("g@eksempel.no", "hvaSomHelst1"), /^Error: Feil e-postadresse eller passord\.$|Feil e-postadresse eller passord/);
});

test("kansellering til kort: bare kortdelen går til kortet, kredittdelen tilbake som kreditt", async () => {
  const id = await kort("aaa", "Delt Betaling", "rare", 4500, 2);
  const kari = await konto.loggInn("selger@eksempel.no", "passord123");
  // Bruk opp eventuell rest fra tidligere tester, og gi nøyaktig 50 kr.
  const saldo0 = await kreditt.saldo(kari.email);
  if (saldo0) await kreditt.leggTil({ email: kari.email, ore: -saldo0, grunn: "manuell" });
  await kreditt.leggTil({ email: kari.email, ore: 5000, grunn: "manuell" });

  const refusjoner = [];
  process.env.STRIPE_SECRET_KEY = "sk_test_falsk";
  salg._brukStripe({
    checkout: { sessions: { create: async () => ({ id: "cs_falsk", url: "https://stripe.test/cs" }) } },
    refunds: { create: async (p) => { refusjoner.push(p); return { id: "re_falsk" }; } },
  });
  try {
    // 45 kr kort + 55 kr frakt = 100 kr; 50 kr kreditt, 50 kr kort.
    const r = await salg.åpneKasse(
      { ...adresse, email: "", bruk_kreditt: true, linjer: [{ card_id: id, finish: "nonfoil", condition: "NM", antall: 1 }] },
      kari
    );
    const o = (await db().execute({ sql: "SELECT id FROM salgsordrer WHERE ordrenr = ?", args: [r.ordrenr] })).rows[0];
    await salg.fullfør(Number(o.id), "stripe", "pi_falsk");
    await db().execute({ sql: "UPDATE salgsordrer SET stripe_betaling = 'pi_falsk' WHERE id = ?", args: [o.id] });
    const betalt = await salg.hentOrdre(r.ordrenr);
    assert.equal(Number(betalt.kreditt_ore), 5000);
    assert.equal(Number(betalt.stripe_ore), 5000);
    assert.equal(await kreditt.saldo(kari.email), 0);

    // Rapporten: bare pengene (50 kr), frakten først — så alt er frakt med mva.
    const dag = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Oslo" }).format(new Date());
    const rad = (await salgsrapport(dag, dag)).rader.find((x) => x.ordrenr === r.ordrenr);
    assert.equal(rad.sum_ore, 5000);
    assert.equal(rad.med_mva_ore, 5000);
    assert.equal(rad.uten_mva_ore, 0);
    assert.equal((await salg.salgsstatistikk()).denne.omsetning_ore >= 5000, true);

    await salg.kanseller(r.ordrenr, "Angret", "kort");
    assert.equal(refusjoner.length, 1);
    assert.equal(refusjoner[0].amount, 5000);
    assert.equal(await kreditt.saldo(kari.email), 5000);
  } finally {
    delete process.env.STRIPE_SECRET_KEY;
    salg._brukStripe(null);
  }
});

test("plukklisten: i hylla teller solgte kort til ordren er sendt, ledig er det som kan selges", async () => {
  const id = await kort("aaa", "Hyllekort", "uncommon", 1000, 3);
  const kari = await konto.loggInn("selger@eksempel.no", "passord123");
  await kreditt.leggTil({ email: kari.email, ore: 20000, grunn: "manuell" });
  const r = await salg.åpneKasse(
    { ...adresse, email: "", bruk_kreditt: true, linjer: [{ card_id: id, finish: "nonfoil", condition: "NM", antall: 2 }] },
    kari
  );
  let p = (await salg.lagerForPlukk([id])).get(`${id}:nonfoil:NM`);
  assert.deepEqual(p, { hylle: 3, ledig: 1 });
  await salg.settStatus(r.ordrenr, { status: "sendt" });
  p = (await salg.lagerForPlukk([id])).get(`${id}:nonfoil:NM`);
  assert.deepEqual(p, { hylle: 1, ledig: 1 });
});

test("rettelse: antallet settes ned, mellomlegget går tilbake som kreditt, lageret står", async () => {
  const a = await kort("aaa", "Rett Meg", "rare", 1000, 5);
  const b = await kort("aaa", "Rett Meg Også", "rare", 2500, 5);
  const kari = await konto.loggInn("selger@eksempel.no", "passord123");
  await kreditt.leggTil({ email: kari.email, ore: 50000, grunn: "manuell" });
  const r = await salg.åpneKasse(
    {
      ...adresse, email: "", bruk_kreditt: true,
      linjer: [
        { card_id: a, finish: "nonfoil", condition: "NM", antall: 2 },
        { card_id: b, finish: "nonfoil", condition: "NM", antall: 1 },
      ],
    },
    kari
  );
  const o = await salg.hentOrdre(r.ordrenr);
  assert.equal(o.status, "betalt");
  const la = o.linjer.find((l) => l.card_id === a);
  const lb = o.linjer.find((l) => l.card_id === b);
  const saldo = await kreditt.saldo(kari.email);

  // Forhåndsvisning endrer ingenting.
  const f = await salg.justerOrdre(r.ordrenr, [{ id: la.id, antall: 1 }, { id: lb.id, antall: 0 }]);
  assert.equal(f.forslag.refusjon_ore, 1000 + 2500);
  assert.equal(f.forslag.til_kreditt_ore, 3500);
  assert.equal(await kreditt.saldo(kari.email), saldo);

  await assert.rejects(salg.justerOrdre(r.ordrenr, [{ id: la.id, antall: 3 }]), /bare settes ned/);
  await assert.rejects(salg.justerOrdre(r.ordrenr, [{ id: la.id, antall: 0 }, { id: lb.id, antall: 0 }]), /Kanseller/);

  const ut = await salg.justerOrdre(r.ordrenr, [{ id: la.id, antall: 1 }, { id: lb.id, antall: 0 }], { bekreft: true });
  assert.equal(await kreditt.saldo(kari.email), saldo + 3500);
  assert.equal(ut.ordre.linjer.length, 1);
  assert.equal(Number(ut.ordre.linjer[0].antall), 1);
  assert.equal(Number(ut.ordre.varer_ore), 1000);
  assert.equal(Number(ut.ordre.antall_kort), 1);
  assert.equal(Number(ut.ordre.kreditt_ore), 1000 + 5500);
  // Kortet fantes ikke: lageret skal ikke få det tilbake.
  assert.equal(await lager(a), 3);
  assert.equal(await lager(b), 4);
  assert.match(String(ut.ordre.admin_notat), /Rett Meg 2 → 1/);

  // Kansellering etterpå gir bare tilbake det som er igjen.
  await salg.kanseller(r.ordrenr, "Angret");
  assert.equal(await kreditt.saldo(kari.email), saldo + 3500 + 1000 + 5500);
});

test("rettelse på kortbetalt ordre: pengedelen refunderes først, og rapporten får en tilbakeføring", async () => {
  const id = await kort("aaa", "Kortbetalt Rettelse", "rare", 3000, 4);
  const kari = await konto.loggInn("selger@eksempel.no", "passord123");
  const saldo0 = await kreditt.saldo(kari.email);
  if (saldo0) await kreditt.leggTil({ email: kari.email, ore: -saldo0, grunn: "manuell" });
  await kreditt.leggTil({ email: kari.email, ore: 2000, grunn: "manuell" });

  const refusjoner = [];
  process.env.STRIPE_SECRET_KEY = "sk_test_falsk";
  salg._brukStripe({
    checkout: { sessions: { create: async () => ({ id: "cs_falsk2", url: "https://stripe.test/cs" }) } },
    refunds: { create: async (p, opt) => { refusjoner.push({ ...p, nøkkel: opt?.idempotencyKey }); return { id: "re_" + refusjoner.length }; } },
  });
  try {
    // 3 × 30 kr + 55 kr frakt = 145 kr; 20 kr kreditt, 125 kr kort.
    const r = await salg.åpneKasse(
      { ...adresse, email: "", bruk_kreditt: true, linjer: [{ card_id: id, finish: "nonfoil", condition: "NM", antall: 3 }] },
      kari
    );
    const o = (await db().execute({ sql: "SELECT id FROM salgsordrer WHERE ordrenr = ?", args: [r.ordrenr] })).rows[0];
    await salg.fullfør(Number(o.id), "stripe", "pi_falsk2");
    await db().execute({ sql: "UPDATE salgsordrer SET stripe_betaling = 'pi_falsk2', betalingsmate = 'kort' WHERE id = ?", args: [o.id] });
    const betalt = await salg.hentOrdre(r.ordrenr);
    assert.equal(Number(betalt.stripe_ore), 12500);

    const linje = betalt.linjer[0];
    await salg.justerOrdre(r.ordrenr, [{ id: linje.id, antall: 2 }], { bekreft: true, tilbakePåLager: true });
    assert.equal(refusjoner.length, 1);
    assert.equal(refusjoner[0].amount, 3000);
    assert.equal(await kreditt.saldo(kari.email), 0);
    // Bedt om å legge tilbake: 4 − 3 + 1.
    assert.equal(await lager(id), 2);

    const dag = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Oslo" }).format(new Date());
    const rap = await salgsrapport(dag, dag);
    const salgRad = rap.rader.find((x) => x.ordrenr === r.ordrenr);
    const rettet = rap.rader.find((x) => x.ordrenr === `${r.ordrenr} rettet`);
    assert.equal(salgRad.sum_ore, 12500);
    assert.equal(rettet.sum_ore, -3000);
    // Frakten står; det som går tilbake, er kort (avansemetoden).
    assert.equal(rettet.uten_mva_ore, -3000);

    await salg.kanseller(r.ordrenr, "Angret", "kort");
    assert.equal(refusjoner[1].amount, 9500);
    assert.notEqual(refusjoner[0].nøkkel, refusjoner[1].nøkkel);
    const rap2 = await salgsrapport(dag, dag);
    const kred = rap2.rader.find((x) => x.ordrenr === `${r.ordrenr} kreditert`);
    assert.equal(kred.sum_ore, -9500);
    assert.equal(rap2.rader.filter((x) => x.ordrenr.startsWith(r.ordrenr)).reduce((n, x) => n + x.sum_ore, 0), 0);
  } finally {
    delete process.env.STRIPE_SECRET_KEY;
    salg._brukStripe(null);
  }
});
