import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import Stripe from "stripe";
import { db, CONDITIONS, type Condition } from "./db.js";
import { hentSalgsOppsett, salgsprisØre, hentManuellSalg } from "./salgspris.js";
import { hentManuellePriser } from "./pricing.js";
import { hentFrakt } from "./frakt.js";
import { normaliserEpost, saldo as kredittSaldo } from "./kreditt.js";
import { SORTERING } from "./orders.js";

// ─────────────────────────────────────────────────────────────────────────────
// SALG
// ─────────────────────────────────────────────────────────────────────────────
// Handlekurven bor i nettleseren. Serveren ser den først når kassen åpnes,
// og da regnes alt på nytt her: pris, beholdning, frakt og kreditt. Det
// klienten sender, er bare hvilke kort og hvor mange.
//
// Kortene holdes av når kassen åpnes, ikke når de legges i kurven: en kurv
// kan bli liggende i dagevis, en kasse fullføres eller forlates i løpet av
// minutter. Reservasjonen er selve ordren med status «apen» — beholdningen
// som kan selges, er lageret minus åpne ordrer som ikke er utløpt.
//
// Kreditten reserveres på samme måte og bokføres først når betalingen er
// bekreftet. Feiler betalingen, står saldoen urørt.

export const RESERVASJON_MIN = 15;
// Stripes minstebeløp i norske kroner. Et restbeløp under dette kan ikke
// betales med kort, så da tas det som er igjen av kreditten.
const STRIPE_MIN_ORE = 300;
const MAKS_PER_LINJE = 99;

export class SalgFeil extends Error {
  status: number;
  data: any;
  constructor(status: number, melding: string, data?: any) {
    super(melding);
    this.status = status;
    this.data = data;
  }
}

export type KurvLinje = { card_id: string; finish: "nonfoil" | "foil"; condition: Condition; antall: number };

export type PrisetLinje = KurvLinje & {
  enhet_ore: number;
  tilgjengelig: number;
  card_name: string;
  set_code: string;
  set_name: string;
  collector_number: string | null;
  rarity: string | null;
  image_uri: string | null;
  feil?: string;
};

const nå = () => new Date().toISOString();

// ── Stripe ──────────────────────────────────────────────────────────────────
let klient: Stripe | null = null;
export const harStripe = () => !!process.env.STRIPE_SECRET_KEY;
function stripe(): Stripe {
  if (!harStripe()) throw new SalgFeil(503, "Betaling er ikke satt opp ennå (STRIPE_SECRET_KEY mangler).");
  if (!klient) klient = new Stripe(process.env.STRIPE_SECRET_KEY!);
  return klient;
}
// Vipps hos Stripe er i lukket forhåndsvisning. Når kontoen har fått
// tilgang, slås den på med STRIPE_VIPPS=1. Forhåndsvisningen krever et
// eget versjonsflagg på kallene som tar Vipps.
const vipps = () => process.env.STRIPE_VIPPS === "1";
export const butikkUrl = () =>
  (process.env.SHOP_URL || process.env.ADMIN_URL || "https://admin.kortsalg.korthaien.no").replace(/\/$/, "");

// Kvitteringslenken etter betaling. En gjest har ingen innlogging, så siden
// åpnes med et signert merke på ordrenummeret i stedet for å slippe hvem som
// helst inn med bare nummeret.
function hemmelighet(): string {
  return process.env.SESSION_SECRET || ((globalThis as any).__kh_secret ??= randomBytes(32).toString("hex"));
}
export const kvitteringsmerke = (ordrenr: string) =>
  createHmac("sha256", hemmelighet()).update(`kvittering:${ordrenr}`).digest("hex").slice(0, 32);
export function riktigMerke(ordrenr: string, merke: string): boolean {
  const a = Buffer.from(kvitteringsmerke(ordrenr));
  const b = Buffer.from(String(merke || ""));
  return a.length === b.length && timingSafeEqual(a, b);
}

// ── tilgjengelighet ─────────────────────────────────────────────────────────
// Lageret minus det som er holdt av i åpne kasser. Kassen som spør, kan
// utelates — den skal ikke konkurrere med seg selv.
//
// En åpen ordre holder kortene til den faktisk er lukket, ikke bare til
// kvarteret er ute: Stripe-siden kan fortsatt betales til vi har lukket den
// (se utløpGamle). Teller vi den som ledig før det, kan siste eksemplar
// selges to ganger.
async function tilgjengeligFor(linjer: { card_id: string }[], utenOrdre?: number) {
  const ider = [...new Set(linjer.map((l) => l.card_id))];
  const kart = new Map<string, number>();
  if (!ider.length) return kart;
  const ph = ider.map(() => "?").join(",");
  const lager = await db().execute({
    sql: `SELECT card_id, finish, condition, SUM(antall) AS n FROM lager_bevegelser
           WHERE card_id IN (${ph}) GROUP BY card_id, finish, condition`,
    args: ider,
  });
  for (const x of lager.rows as any[]) kart.set(`${x.card_id}:${x.finish}:${x.condition}`, Number(x.n));
  const holdt = await db().execute({
    sql: `SELECT l.card_id, l.finish, l.condition, SUM(l.antall) AS n
            FROM salgsordre_linjer l JOIN salgsordrer o ON o.id = l.ordre_id
           WHERE o.status = 'apen' AND l.card_id IN (${ph})
             ${utenOrdre ? "AND o.id <> ?" : ""}
           GROUP BY l.card_id, l.finish, l.condition`,
    args: [...ider, ...(utenOrdre ? [utenOrdre] : [])],
  });
  for (const x of holdt.rows as any[]) {
    const k = `${x.card_id}:${x.finish}:${x.condition}`;
    kart.set(k, (kart.get(k) || 0) - Number(x.n));
  }
  return kart;
}

function rensKurv(inn: any): KurvLinje[] {
  if (!Array.isArray(inn)) throw new SalgFeil(400, "Handlekurven er tom.");
  const samlet = new Map<string, KurvLinje>();
  for (const x of inn.slice(0, 500)) {
    const card_id = String(x?.card_id || "");
    const finish = x?.finish === "foil" ? "foil" : "nonfoil";
    const condition = String(x?.condition || "NM").toUpperCase() as Condition;
    const antall = Math.trunc(Number(x?.antall));
    if (!card_id || !CONDITIONS.includes(condition) || !(antall > 0)) continue;
    const k = `${card_id}:${finish}:${condition}`;
    const før = samlet.get(k);
    samlet.set(k, { card_id, finish, condition, antall: Math.min(MAKS_PER_LINJE, (før?.antall || 0) + antall) });
  }
  return [...samlet.values()];
}

// Pris og beholdning for kurven, slik kunden skal se den akkurat nå.
export async function prisKurv(inn: any, utenOrdre?: number): Promise<PrisetLinje[]> {
  const linjer = rensKurv(inn);
  if (!linjer.length) return [];
  const ider = [...new Set(linjer.map((l) => l.card_id))];
  const r = await db().execute({
    sql: `SELECT c.id, c.name, c.set_code, c.collector_number, c.rarity, c.usd, c.usd_foil, c.image_uri,
                 COALESCE(s.visningsnavn, s.name) AS set_name
            FROM cards c LEFT JOIN sets s ON s.code = c.set_code
           WHERE c.id IN (${ider.map(() => "?").join(",")})`,
    args: ider,
  });
  const kort = new Map((r.rows as any[]).map((k) => [String(k.id), k]));
  const opp = await hentSalgsOppsett();
  const manuellSalg = await hentManuellSalg(ider);
  const manuellKjøp = await hentManuellePriser(ider);
  const ledig = await tilgjengeligFor(linjer, utenOrdre);

  return linjer.map((l) => {
    const k: any = kort.get(l.card_id);
    const tilgjengelig = Math.max(0, ledig.get(`${l.card_id}:${l.finish}:${l.condition}`) || 0);
    if (!k) {
      return { ...l, enhet_ore: 0, tilgjengelig: 0, card_name: "Ukjent kort", set_code: "", set_name: "",
               collector_number: null, rarity: null, image_uri: null, feil: "Kortet finnes ikke lenger." };
    }
    const enhet = salgsprisØre(
      k, l.finish, l.condition, opp,
      manuellSalg.get(`${l.card_id}:${l.finish}`) ?? null,
      manuellKjøp.get(`${l.card_id}:${l.finish}`) ?? null
    );
    const linje: PrisetLinje = {
      ...l,
      enhet_ore: enhet,
      tilgjengelig,
      card_name: String(k.name),
      set_code: String(k.set_code),
      set_name: String(k.set_name || k.set_code),
      collector_number: k.collector_number ?? null,
      rarity: k.rarity ?? null,
      image_uri: k.image_uri ?? null,
    };
    if (!enhet) linje.feil = "Kortet er ikke til salgs i denne tilstanden.";
    else if (tilgjengelig <= 0) linje.feil = "Utsolgt.";
    else if (tilgjengelig < l.antall) linje.feil = `Bare ${tilgjengelig} igjen.`;
    return linje;
  });
}

// ── kassen ──────────────────────────────────────────────────────────────────
export type KasseInn = {
  linjer: any;
  navn: string;
  email: string;
  telefon?: string;
  adresse: string;
  postnr: string;
  poststed: string;
  land?: string;
  frakt_id: number;
  bruk_kreditt?: boolean;
  notat?: string;
  vilkar?: boolean;
};

// S-15000, S-15001 … Fortløpende fra nummerserien.
async function nyttOrdrenummer(): Promise<string> {
  const { nesteNummer } = await import("./db.js");
  return nesteNummer("salg");
}

// Kreditt som allerede er holdt av i åpne kasser for samme adresse — av
// samme grunn som kortene: til kassen faktisk er lukket.
const HOLDT_KREDITT = `SELECT COALESCE(SUM(kreditt_ore), 0) AS n FROM salgsordrer WHERE email = ? AND status = 'apen'`;
async function holdtKreditt(email: string): Promise<number> {
  const r = await db().execute({ sql: HOLDT_KREDITT, args: [email] });
  return Number(r.rows[0]?.n || 0);
}

export async function tilgjengeligKreditt(email: string): Promise<number> {
  const e = normaliserEpost(email);
  return Math.max(0, (await kredittSaldo(e)) - (await holdtKreditt(e)));
}

export async function åpneKasse(
  inn: KasseInn,
  kunde: { id: number; email: string; bekreftet?: boolean } | null
): Promise<{ ordrenr: string; url: string | null; betalt: boolean; merke: string }> {
  await utløpGamle();

  const t = (v: unknown, maks: number) => String(v ?? "").trim().slice(0, maks);
  const email = normaliserEpost(kunde?.email || inn.email);
  const navn = t(inn.navn, 120);
  const adresse = t(inn.adresse, 200);
  const postnr = t(inn.postnr, 12);
  const poststed = t(inn.poststed, 80);
  if (!navn) throw new SalgFeil(400, "Fyll inn navn.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new SalgFeil(400, "Fyll inn en gyldig e-postadresse.");
  if (!adresse || !postnr || !poststed) throw new SalgFeil(400, "Fyll inn adresse, postnummer og poststed.");
  if (!inn.vilkar) throw new SalgFeil(400, "Du må godta kjøpsvilkårene.");

  const frakt = (await hentFrakt(true)).find((f) => f.id === Number(inn.frakt_id));
  if (!frakt) throw new SalgFeil(400, "Velg en fraktmåte.");

  // Første prising, utenfor transaksjonen: for å kunne gi kunden en god
  // feilmelding med alle linjene som ikke går.
  const linjer = await prisKurv(inn.linjer);
  if (!linjer.length) throw new SalgFeil(400, "Handlekurven er tom.");
  const feil = linjer.filter((l) => l.feil);
  if (feil.length) throw new SalgFeil(409, "Noen kort i handlekurven er ikke tilgjengelige lenger.", { linjer });

  const varer = linjer.reduce((n, l) => n + l.enhet_ore * l.antall, 0);
  const totalt = varer + frakt.pris_ore;
  let kreditt = 0;
  // Kreditten følger e-postadressen. Før adressen er bekreftet, kan den ikke
  // brukes — ellers kunne hvem som helst registrere en annens adresse og
  // handle for kreditten deres.
  if (kunde?.bekreftet && inn.bruk_kreditt) kreditt = Math.min(await tilgjengeligKreditt(email), totalt);
  let rest = totalt - kreditt;
  if (rest > 0 && rest < STRIPE_MIN_ORE && kreditt > 0) {
    // Et restbeløp Stripe ikke kan ta: bruk litt mindre kreditt, så resten
    // blir et beløp som kan betales.
    const juster = Math.min(kreditt, STRIPE_MIN_ORE - rest);
    kreditt -= juster;
    rest += juster;
  }
  if (rest > 0 && rest < STRIPE_MIN_ORE) {
    throw new SalgFeil(400, "Beløpet som betales med kort eller Vipps må være minst 3 kr.");
  }

  const ordrenr = await nyttOrdrenummer();
  const opprettet = nå();
  const utløper = new Date(Date.now() + RESERVASJON_MIN * 60_000).toISOString();
  const antallKort = linjer.reduce((n, l) => n + l.antall, 0);

  // Reservasjonen skrives i én transaksjon som også sjekker beholdningen på
  // nytt. To kunder som trykker «Betal» på det siste eksemplaret samtidig,
  // kan ikke begge få det: den andre ser den førstes reservasjon.
  const tx = await db().transaction("write");
  let ordreId: number;
  try {
    // To spørringer for hele kurven, ikke to per linje: skrivelåsen holdes
    // mens dette pågår, og mot Turso er hver spørring en rundtur.
    const ider = [...new Set(linjer.map((l) => l.card_id))];
    const ph = ider.map(() => "?").join(",");
    const ledig = new Map<string, number>();
    const lager = await tx.execute({
      sql: `SELECT card_id, finish, condition, SUM(antall) AS n FROM lager_bevegelser
             WHERE card_id IN (${ph}) GROUP BY card_id, finish, condition`,
      args: ider,
    });
    for (const x of lager.rows as any[]) ledig.set(`${x.card_id}:${x.finish}:${x.condition}`, Number(x.n));
    const holdt = await tx.execute({
      sql: `SELECT l.card_id, l.finish, l.condition, SUM(l.antall) AS n
              FROM salgsordre_linjer l JOIN salgsordrer o ON o.id = l.ordre_id
             WHERE o.status = 'apen' AND l.card_id IN (${ph}) GROUP BY l.card_id, l.finish, l.condition`,
      args: ider,
    });
    for (const x of holdt.rows as any[]) {
      const k = `${x.card_id}:${x.finish}:${x.condition}`;
      ledig.set(k, (ledig.get(k) || 0) - Number(x.n));
    }
    for (const l of linjer) {
      if ((ledig.get(`${l.card_id}:${l.finish}:${l.condition}`) || 0) < l.antall) {
        // Den oppdaterte kurven hentes etter rollback, ikke her inne: en
        // lesing på en annen forbindelse mens skrivelåsen holdes, kan henge.
        throw new SalgFeil(409, `${l.card_name} ble akkurat tatt av en annen kunde.`, { oppdater: true });
      }
    }
    // Kreditten sjekkes på nytt her inne. Utenfor transaksjonen kunne to
    // kasser åpnet i samme øyeblikk begge sett den samme saldoen.
    if (kreditt > 0) {
      const saldo = await tx.execute({
        sql: "SELECT COALESCE(SUM(ore), 0) AS n FROM kreditt_bevegelser WHERE email = ?",
        args: [email],
      });
      const iBruk = await tx.execute({ sql: HOLDT_KREDITT, args: [email] });
      if (Number(saldo.rows[0]?.n || 0) - Number(iBruk.rows[0]?.n || 0) < kreditt) {
        throw new SalgFeil(409, "Kreditten din er i bruk i en annen kasse. Vent litt og prøv igjen.");
      }
    }
    const o = await tx.execute({
      sql: `INSERT INTO salgsordrer
              (ordrenr, kunde_navn, email, kunde_id, telefon, adresse, postnr, poststed, land,
               frakt_id, frakt_navn, frakt_ore, varer_ore, kreditt_ore, stripe_ore,
               antall_kort, kunde_notat, status, utloper_at, created_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'apen',?,?) RETURNING id`,
      args: [
        ordrenr, navn, email, kunde?.id ?? null, t(inn.telefon, 30) || null, adresse, postnr, poststed,
        (t(inn.land, 2) || "NO").toUpperCase(), frakt.id, frakt.navn, frakt.pris_ore, varer, kreditt, rest,
        antallKort, t(inn.notat, 1000) || null, utløper, opprettet,
      ],
    });
    ordreId = Number(o.rows[0].id);
    for (const l of linjer) {
      await tx.execute({
        sql: `INSERT INTO salgsordre_linjer
                (ordre_id, card_id, finish, condition, antall, enhet_ore, card_name, set_code, set_name, collector_number, rarity)
              VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        args: [ordreId, l.card_id, l.finish, l.condition, l.antall, l.enhet_ore, l.card_name, l.set_code,
               l.set_name, l.collector_number, l.rarity],
      });
    }
    await tx.commit();
  } catch (e: any) {
    await tx.rollback().catch(() => {});
    tx.close();
    if (e instanceof SalgFeil && e.data?.oppdater) e.data = { linjer: await prisKurv(inn.linjer) };
    throw e;
  }
  tx.close();

  const merke = kvitteringsmerke(ordrenr);
  // Dekker kreditten alt, finnes det ingenting å betale. Ordren er betalt.
  if (rest === 0) {
    await fullfør(ordreId, "kreditt");
    return { ordrenr, url: null, betalt: true, merke };
  }

  try {
    const tilbake = `${butikkUrl()}/?kasse=ok&ordre=${encodeURIComponent(ordrenr)}&m=${merke}`;
    const avbrutt = `${butikkUrl()}/?kasse=avbrutt&ordre=${encodeURIComponent(ordrenr)}&m=${merke}`;
    const sesjon = await stripe().checkout.sessions.create(
      {
        mode: "payment",
        currency: "nok",
        customer_email: email,
        client_reference_id: ordrenr,
        metadata: { ordrenr },
        payment_intent_data: { metadata: { ordrenr }, description: `Korthaien ${ordrenr}` },
        // Låst til betalingsmåter som bekreftes med en gang. En metode som
        // bekreftes dager senere, ville holdt kortene av i dager.
        allowed_payment_method_types: (vipps() ? ["card", "vipps"] : ["card"]) as any,
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: "nok",
              unit_amount: rest,
              product_data: {
                name: `Korthaien ordre ${ordrenr}`,
                description:
                  `${antallKort} kort og ${frakt.navn.toLowerCase()}` +
                  (kreditt ? ` (${(kreditt / 100).toFixed(2).replace(".", ",")} kr betalt med kreditt)` : ""),
              },
            },
          },
        ],
        // Stripe tar ikke kortere levetid enn 30 minutter. Reservasjonen er
        // 15; sesjonen utløpes av oss når den går ut (se utløpGamle).
        expires_at: Math.floor(Date.now() / 1000) + 31 * 60,
        success_url: tilbake,
        cancel_url: avbrutt,
        locale: "nb",
      },
      vipps() ? { apiVersion: `${Stripe.API_VERSION}; vipps_preview=v1` as any } : undefined
    );
    await db().execute({ sql: "UPDATE salgsordrer SET stripe_session = ? WHERE id = ?", args: [sesjon.id, ordreId] });
    return { ordrenr, url: sesjon.url, betalt: false, merke };
  } catch (e: any) {
    // Uten betalingsside er reservasjonen verdiløs. Frigi den med en gang.
    await db().execute({ sql: "UPDATE salgsordrer SET status = 'utlopt' WHERE id = ? AND status = 'apen'", args: [ordreId] });
    if (e instanceof SalgFeil) throw e;
    console.error("Stripe feilet:", e?.message);
    throw new SalgFeil(502, "Betalingen kunne ikke startes. Prøv igjen om litt.");
  }
}

// ── betaling bekreftet ──────────────────────────────────────────────────────
// Kalles fra Stripes webhook, og direkte når kreditten dekker alt. Den kan
// komme flere ganger for samme ordre — Stripe sender på nytt hvis svaret
// uteblir — så alt skjer bare hvis ordren ennå ikke er betalt.
export async function fullfør(ordreId: number, kilde: string, betalingsId?: string | null): Promise<boolean> {
  const tid = nå();
  const r = await db().execute({ sql: "SELECT * FROM salgsordrer WHERE id = ?", args: [ordreId] });
  const o: any = r.rows[0];
  if (!o) return false;
  if (!["apen", "utlopt"].includes(String(o.status))) return false;
  const linjer = await db().execute({ sql: "SELECT * FROM salgsordre_linjer WHERE ordre_id = ?", args: [ordreId] });

  const tx = await db().transaction("write");
  try {
    // Statusen er låsen. Kommer samme betaling to ganger samtidig, er det
    // bare én av dem som endrer raden.
    const opp = await tx.execute({
      sql: `UPDATE salgsordrer SET status = 'betalt', betalt_at = ?, uten_mva_ore = varer_ore, med_mva_ore = frakt_ore,
              stripe_betaling = COALESCE(?, stripe_betaling),
              admin_notat = CASE WHEN status = 'utlopt' OR utloper_at < ?
                THEN trim(COALESCE(admin_notat, '') || ' Betalt etter at reservasjonen var utløpt — sjekk at kortene finnes.')
                ELSE admin_notat END
             WHERE id = ? AND status IN ('apen', 'utlopt')`,
      args: [tid, betalingsId ?? null, tid, ordreId],
    });
    if (!opp.rowsAffected) {
      await tx.rollback();
      return false;
    }
    for (const l of linjer.rows as any[]) {
      await tx.execute({
        sql: `INSERT INTO lager_bevegelser (card_id, finish, condition, antall, grunn, order_id, notat, created_at)
              VALUES (?, ?, ?, ?, 'salg', NULL, ?, ?)`,
        args: [l.card_id, l.finish, l.condition, -Math.abs(Number(l.antall)), `Salg ${o.ordrenr}`, tid],
      });
    }
    if (Number(o.kreditt_ore) > 0) {
      // Kreditten ble holdt av da kassen ble åpnet, så den skal finnes. Gjør
      // den ikke det, er kortene likevel betalt for med resten — ordren
      // bokføres, men merkes så du ser det.
      const saldo = await tx.execute({
        sql: "SELECT COALESCE(SUM(ore), 0) AS n FROM kreditt_bevegelser WHERE email = ?",
        args: [o.email],
      });
      if (Number(saldo.rows[0]?.n || 0) < Number(o.kreditt_ore)) {
        await tx.execute({
          sql: `UPDATE salgsordrer SET admin_notat = trim(COALESCE(admin_notat, '') || ' Kreditten strakk ikke til — kundens saldo er negativ.') WHERE id = ?`,
          args: [ordreId],
        });
      }
      await tx.execute({
        sql: `INSERT INTO kreditt_bevegelser (email, ore, grunn, notat, order_no, created_at) VALUES (?, ?, 'kjop', ?, ?, ?)`,
        args: [o.email, -Number(o.kreditt_ore), `Brukt på ordre ${o.ordrenr}`, o.ordrenr, tid],
      });
    }
    await tx.commit();
  } catch (e) {
    await tx.rollback().catch(() => {});
    throw e;
  } finally {
    tx.close();
  }
  console.log(`Salgsordre ${o.ordrenr} betalt (${kilde}).`);
  // E-posten sendes etter at alt er bokført. Feiler den, er ordren likevel
  // betalt og registrert — den skal ikke rulles tilbake for en e-post.
  try {
    const { sendSalgsbekreftelse } = await import("./epost.js");
    await sendSalgsbekreftelse(ordreId);
  } catch (e: any) {
    console.error("Ordrebekreftelsen feilet:", e?.message);
  }
  return true;
}

// ── utløp ───────────────────────────────────────────────────────────────────
// Kasser som er forlatt, frigis. Har kunden en Stripe-side åpen, lukkes den
// først: da kan hen ikke betale for kort som ikke lenger er holdt av. Viser
// det seg at hen rakk å betale, fullføres ordren i stedet.
let sistSjekket = 0;
export async function utløpGamle(tvungen = false): Promise<number> {
  if (!tvungen && Date.now() - sistSjekket < 20_000) return 0;
  sistSjekket = Date.now();
  const r = await db().execute({
    sql: "SELECT id, ordrenr, stripe_session FROM salgsordrer WHERE status = 'apen' AND utloper_at <= ?",
    args: [nå()],
  });
  let n = 0;
  for (const o of r.rows as any[]) {
    if (o.stripe_session && harStripe()) {
      try {
        const s = await stripe().checkout.sessions.retrieve(String(o.stripe_session));
        if (s.status === "complete" && s.payment_status === "paid") {
          await fullfør(Number(o.id), "stripe (oppdaget ved utløp)", betalingsId(s));
          continue;
        }
        // Fullført, men ikke betalt ennå: en betaling som bekreftes senere.
        // Kortene holdes til Stripe sier ja eller nei.
        if (s.status === "complete") continue;
        if (s.status === "open") await stripe().checkout.sessions.expire(String(o.stripe_session));
      } catch (e: any) {
        // Lukker ikke Stripe sesjonen, lar vi ordren stå til neste runde.
        console.error(`Kunne ikke lukke Stripe-sesjonen for ${o.ordrenr}:`, e?.message);
        continue;
      }
    }
    const u = await db().execute({
      sql: "UPDATE salgsordrer SET status = 'utlopt' WHERE id = ? AND status = 'apen'",
      args: [o.id],
    });
    n += u.rowsAffected;
  }
  return n;
}

// Kunden trykket «tilbake» på Stripe-siden. Kortene frigis med en gang i
// stedet for å vente ut kvarteret.
export async function avbrytKasse(ordrenr: string, merke: string): Promise<void> {
  if (!riktigMerke(ordrenr, merke)) throw new SalgFeil(403, "Ugyldig lenke.");
  const r = await db().execute({
    sql: "SELECT id, stripe_session FROM salgsordrer WHERE ordrenr = ? AND status = 'apen'",
    args: [ordrenr],
  });
  const o: any = r.rows[0];
  if (!o) return;
  if (o.stripe_session && harStripe()) {
    try {
      const s = await stripe().checkout.sessions.retrieve(String(o.stripe_session));
      if (s.status === "complete") return; // betalt likevel; webhooken tar resten
      if (s.status === "open") await stripe().checkout.sessions.expire(String(o.stripe_session));
    } catch {
      return;
    }
  }
  await db().execute({ sql: "UPDATE salgsordrer SET status = 'utlopt' WHERE id = ? AND status = 'apen'", args: [o.id] });
}

// ── webhook ─────────────────────────────────────────────────────────────────
export async function stripeHendelse(råKropp: Buffer, signatur: string): Promise<void> {
  const hemmelig = process.env.STRIPE_WEBHOOK_SECRET;
  if (!hemmelig) throw new SalgFeil(503, "STRIPE_WEBHOOK_SECRET mangler.");
  let h: Stripe.Event;
  try {
    h = stripe().webhooks.constructEvent(råKropp, signatur, hemmelig);
  } catch {
    throw new SalgFeil(400, "Ugyldig signatur.");
  }
  if (
    h.type === "checkout.session.completed" ||
    h.type === "checkout.session.async_payment_succeeded"
  ) {
    const s = h.data.object as Stripe.Checkout.Session;
    if (s.payment_status !== "paid") return; // venter på en betaling som tar tid
    const o = await db().execute({ sql: "SELECT id, ordrenr, stripe_ore FROM salgsordrer WHERE stripe_session = ?", args: [s.id] });
    const rad: any = o.rows[0];
    if (!rad) return;
    // Beløpet settes av oss og er signert av Stripe, så dette skal aldri slå
    // til. Gjør det likevel, er det en feil hos oss — og da skal ordren ikke
    // gå gjennom på et beløp ingen har sett.
    if (s.amount_total !== Number(rad.stripe_ore) || String(s.currency).toLowerCase() !== "nok") {
      console.error(`Beløpet for ${rad.ordrenr} stemmer ikke: Stripe ${s.amount_total} ${s.currency}, ordre ${rad.stripe_ore}.`);
      await db().execute({
        sql: `UPDATE salgsordrer SET admin_notat = trim(COALESCE(admin_notat, '') || ' Betalt beløp stemmer ikke med ordren — sjekk i Stripe.') WHERE id = ?`,
        args: [rad.id],
      });
      return;
    }
    await fullfør(Number(rad.id), "stripe", betalingsId(s));
  } else if (h.type === "checkout.session.expired" || h.type === "checkout.session.async_payment_failed") {
    const s = h.data.object as Stripe.Checkout.Session;
    await db().execute({
      sql: "UPDATE salgsordrer SET status = 'utlopt' WHERE stripe_session = ? AND status = 'apen'",
      args: [s.id],
    });
  }
}

// Betalings-ID-en trengs for å refundere til kortet senere.
const betalingsId = (s: Stripe.Checkout.Session) =>
  typeof s.payment_intent === "string" ? s.payment_intent : s.payment_intent?.id ?? null;

// ── oppslag ─────────────────────────────────────────────────────────────────
export const STATUSER = ["apen", "betalt", "pakket", "sendt", "kansellert", "utlopt"] as const;

export async function hentOrdre(ordrenr: string): Promise<any | null> {
  const r = await db().execute({ sql: "SELECT * FROM salgsordrer WHERE ordrenr = ?", args: [ordrenr] });
  const o: any = r.rows[0];
  if (!o) return null;
  // Samme rekkefølge som kjøpsordrene: sett, raritet, navn. Lista følger
  // hyllene, så kortene kan plukkes i én runde.
  const l = await db().execute({
    sql: `SELECT * FROM salgsordre_linjer WHERE ordre_id = ? ORDER BY ${SORTERING}, collector_number, finish, condition`,
    args: [o.id],
  });
  return { ...o, linjer: l.rows };
}

// Det kunden får se. Ingen interne notater.
export function offentlig(o: any) {
  if (!o) return null;
  const { admin_notat, stripe_session, kunde_id, ...resten } = o;
  return resten;
}

export async function kundensOrdrer(kunde: { id: number; email: string; bekreftet?: boolean }) {
  // Også ordrer lagt inn som gjest med samme adresse, før kontoen fantes —
  // men bare når adressen er bekreftet. Ellers kunne hvem som helst
  // registrere en annens adresse og lese navn, adresse og ordrene deres.
  const medEpost = !!kunde.bekreftet;
  const r = await db().execute({
    sql: `SELECT ordrenr, status, created_at, betalt_at, sendt_at, varer_ore, frakt_ore, kreditt_ore, stripe_ore,
                 antall_kort, frakt_navn, sporingsnr
            FROM salgsordrer
           WHERE (kunde_id = ? ${medEpost ? "OR email = ?" : ""}) AND status NOT IN ('apen', 'utlopt')
           ORDER BY created_at DESC LIMIT 200`,
    args: medEpost ? [kunde.id, normaliserEpost(kunde.email)] : [kunde.id],
  });
  return r.rows;
}

export async function tilhørerKunde(o: any, kunde: { id: number; email: string; bekreftet?: boolean }): Promise<boolean> {
  if (Number(o.kunde_id) === kunde.id) return true;
  return !!kunde.bekreftet && String(o.email) === normaliserEpost(kunde.email);
}

// ── admin ───────────────────────────────────────────────────────────────────
export async function adminOrdrer(status: string) {
  await utløpGamle();
  const grupper: Record<string, string[]> = {
    pakkes: ["betalt"],
    pakket: ["pakket"],
    sendt: ["sendt"],
    kansellert: ["kansellert"],
    apen: ["apen", "utlopt"],
  };
  const st = grupper[status] || grupper.pakkes;
  const r = await db().execute({
    sql: `SELECT id, ordrenr, kunde_navn, email, status, created_at, betalt_at, pakket_at, sendt_at,
                 varer_ore, frakt_ore, kreditt_ore, stripe_ore, antall_kort, frakt_navn, sporingsnr, utloper_at,
                 (SELECT COUNT(*) FROM salgsordre_linjer l WHERE l.ordre_id = salgsordrer.id) AS linjer
            FROM salgsordrer WHERE status IN (${st.map(() => "?").join(",")})
           ORDER BY ${status === "pakkes" ? "betalt_at ASC" : "created_at DESC"} LIMIT 500`,
    args: st,
  });
  const tall = await db().execute(
    "SELECT status, COUNT(*) AS n FROM salgsordrer GROUP BY status"
  );
  const antall: Record<string, number> = {};
  for (const x of tall.rows as any[]) antall[String(x.status)] = Number(x.n);
  return { ordrer: r.rows, antall };
}

export async function settStatus(
  ordrenr: string,
  inn: { status?: string; sporingsnr?: string; admin_notat?: string }
): Promise<any> {
  const o = await hentOrdre(ordrenr);
  if (!o) throw new SalgFeil(404, "Fant ikke ordren.");
  const felt: string[] = [];
  const args: any[] = [];
  if (inn.sporingsnr !== undefined) {
    felt.push("sporingsnr = ?");
    args.push(String(inn.sporingsnr).trim().slice(0, 80) || null);
  }
  if (inn.admin_notat !== undefined) {
    felt.push("admin_notat = ?");
    args.push(String(inn.admin_notat).trim().slice(0, 2000) || null);
  }
  let blirSendt = false;
  if (inn.status && inn.status !== o.status) {
    // Bare fram og tilbake mellom de tre stegene etter betaling. Kansellering
    // har sin egen vei, fordi den flytter penger og kort.
    const lov = ["betalt", "pakket", "sendt"];
    if (!lov.includes(inn.status) || !lov.includes(String(o.status))) {
      throw new SalgFeil(400, "Den statusendringen er ikke mulig her.");
    }
    felt.push("status = ?");
    args.push(inn.status);
    if (inn.status === "pakket") felt.push(`pakket_at = COALESCE(pakket_at, '${nå()}')`);
    if (inn.status === "sendt") {
      felt.push(`sendt_at = '${nå()}'`, `pakket_at = COALESCE(pakket_at, '${nå()}')`);
      blirSendt = true;
    }
    if (inn.status === "betalt") felt.push("pakket_at = NULL", "sendt_at = NULL");
  }
  if (felt.length) {
    await db().execute({ sql: `UPDATE salgsordrer SET ${felt.join(", ")} WHERE id = ?`, args: [...args, o.id] });
  }
  if (blirSendt) {
    try {
      const { varsleSendt } = await import("./epost.js");
      await varsleSendt(o.id);
    } catch (e: any) {
      console.error("Varselet om sending feilet:", e?.message);
    }
  }
  return hentOrdre(ordrenr);
}

// Kansellering etter betaling. Kortene går tilbake på lager, og pengene
// tilbake til kunden — på én av to måter:
//
//   kort     Det som ble betalt med kort eller Vipps, refunderes dit hos
//            Stripe. Det som ble betalt med kreditt, går tilbake som kreditt.
//            Dette er hovedregelen i angrerettloven: tilbake samme vei.
//   kreditt  Hele beløpet som kreditt. Bare når kunden har sagt ja til det.
//
// Refusjonen hos Stripe gjøres før noe endres her, med en fast
// idempotensnøkkel: feiler den, er ingenting endret; feiler det som kommer
// etter, gir et nytt forsøk den samme refusjonen og ikke en til.
export async function kanseller(ordrenr: string, grunn: string, måte: "kort" | "kreditt" = "kort"): Promise<any> {
  const o = await hentOrdre(ordrenr);
  if (!o) throw new SalgFeil(404, "Fant ikke ordren.");
  if (!["betalt", "pakket"].includes(String(o.status))) {
    throw new SalgFeil(400, o.status === "sendt" ? "Ordren er sendt. Bruk retur i stedet." : "Ordren kan ikke kanselleres.");
  }
  const tid = nå();
  const kortdel = Number(o.stripe_ore);
  const tilKort = måte === "kort" && kortdel > 0;
  let refusjonsId: string | null = null;
  if (tilKort) {
    if (!o.stripe_betaling) {
      throw new SalgFeil(400, "Fant ikke betalingen hos Stripe for denne ordren. Refunder i Stripe, eller velg kreditt.");
    }
    try {
      const r = await stripe().refunds.create(
        { payment_intent: String(o.stripe_betaling), amount: kortdel, metadata: { ordrenr } },
        { idempotencyKey: `refusjon-${ordrenr}` }
      );
      refusjonsId = r.id;
    } catch (e: any) {
      throw new SalgFeil(502, `Stripe avviste refusjonen: ${e?.message || "ukjent feil"}. Ingenting er endret.`);
    }
  }
  const tilKreditt = tilKort ? Number(o.kreditt_ore) : Number(o.varer_ore) + Number(o.frakt_ore);
  const notat =
    `Kansellert: ${String(grunn || "").trim() || "uten oppgitt grunn"}.` +
    (tilKort ? ` ${(kortdel / 100).toFixed(2)} kr refundert til kort (${refusjonsId}).` : "") +
    (tilKreditt > 0 ? ` ${(tilKreditt / 100).toFixed(2)} kr som kreditt.` : "");

  const tx = await db().transaction("write");
  try {
    const u = await tx.execute({
      sql: `UPDATE salgsordrer SET status = 'kansellert', kansellert_at = ?,
              admin_notat = trim(COALESCE(admin_notat, '') || ' ' || ?)
             WHERE id = ? AND status IN ('betalt', 'pakket')`,
      args: [tid, notat, o.id],
    });
    if (!u.rowsAffected) throw new SalgFeil(409, "Ordren ble endret i mellomtiden. Last inn på nytt.");
    for (const l of o.linjer as any[]) {
      await tx.execute({
        sql: `INSERT INTO lager_bevegelser (card_id, finish, condition, antall, grunn, order_id, notat, created_at)
              VALUES (?, ?, ?, ?, 'reversert', NULL, ?, ?)`,
        args: [l.card_id, l.finish, l.condition, Math.abs(Number(l.antall)), `Kansellert ${o.ordrenr}`, tid],
      });
    }
    if (tilKreditt > 0) {
      await tx.execute({
        sql: `INSERT INTO kreditt_bevegelser (email, ore, grunn, notat, order_no, created_at) VALUES (?, ?, 'refusjon', ?, ?, ?)`,
        args: [o.email, tilKreditt, `Kansellert ordre ${o.ordrenr}`, o.ordrenr, tid],
      });
    }
    await tx.commit();
  } catch (e) {
    await tx.rollback().catch(() => {});
    throw e;
  } finally {
    tx.close();
  }
  return hentOrdre(ordrenr);
}

// ── statistikk ──────────────────────────────────────────────────────────────
// Omsetning er alt kunden betalte for (kort og frakt), uansett om det ble
// betalt med kreditt eller kort. Kansellerte ordrer telles ikke.
const måned = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
function osloMåned(iso: string): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Oslo", year: "numeric", month: "2-digit" })
    .format(new Date(iso)).slice(0, 7);
}

async function tallForMåned(mnd: string) {
  // Et døgn ekstra i hver ende; osloMåned avgjør.
  const [å, m] = mnd.split("-").map(Number);
  const fra = new Date(Date.UTC(å, m - 1, 1) - 86400000).toISOString();
  const til = new Date(Date.UTC(å, m, 1) + 86400000).toISOString();
  const r = await db().execute({
    sql: `SELECT betalt_at, varer_ore, frakt_ore, antall_kort FROM salgsordrer
           WHERE status IN ('betalt', 'pakket', 'sendt') AND betalt_at >= ? AND betalt_at < ?`,
    args: [fra, til],
  });
  let omsetning = 0, ordrer = 0, kort = 0;
  for (const x of r.rows as any[]) {
    if (osloMåned(String(x.betalt_at)) !== mnd) continue;
    omsetning += Number(x.varer_ore) + Number(x.frakt_ore);
    ordrer += 1;
    kort += Number(x.antall_kort);
  }
  return { maaned: mnd, omsetning_ore: omsetning, ordrer, kort };
}

export async function salgsstatistikk() {
  const nåMnd = osloMåned(nå());
  const [å, m] = nåMnd.split("-").map(Number);
  const forrige = måned(new Date(Date.UTC(å, m - 2, 1)));

  // Logg forrige måned når den er over, én gang. Står den allerede, røres
  // den ikke — det loggede tallet er det du sammenligner med.
  const logget = await db().execute({ sql: "SELECT 1 FROM salg_statistikk WHERE maaned = ?", args: [forrige] });
  if (!logget.rows.length) {
    const t = await tallForMåned(forrige);
    const første = await db().execute(
      "SELECT MIN(betalt_at) AS t FROM salgsordrer WHERE status IN ('betalt','pakket','sendt','kansellert')"
    );
    // En måned før det første salget noensinne er ikke en måned med null
    // salg, det er en måned før butikken fantes. Den logges ikke.
    const førsteMnd = første.rows[0]?.t ? osloMåned(String(første.rows[0].t)) : null;
    if (førsteMnd && forrige >= førsteMnd) {
      await db().execute({
        sql: `INSERT OR IGNORE INTO salg_statistikk (maaned, omsetning_ore, ordrer, kort, logget_at) VALUES (?, ?, ?, ?, ?)`,
        args: [t.maaned, t.omsetning_ore, t.ordrer, t.kort, nå()],
      });
    }
  }

  const historikk = await db().execute("SELECT * FROM salg_statistikk ORDER BY maaned DESC LIMIT 36");
  return {
    denne: await tallForMåned(nåMnd),
    forrige: await tallForMåned(forrige),
    historikk: historikk.rows,
  };
}
