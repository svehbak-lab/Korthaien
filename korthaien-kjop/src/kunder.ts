import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, scrypt as scryptCb, timingSafeEqual, createHash } from "node:crypto";
import { promisify } from "node:util";
import type { Request, Response, NextFunction } from "express";
import { db } from "./db.js";
import { normaliserEpost } from "./kreditt.js";

// ─────────────────────────────────────────────────────────────────────────────
// KUNDEKONTO
// ─────────────────────────────────────────────────────────────────────────────
// E-post og passord, eller Google. Kontoen er e-postadressen: det er den
// kjøpssiden har brukt hele tiden, og den kredittboka er nøklet på. En kunde
// som har solgt kort til deg, har derfor kreditten sin første gang hen logger
// inn, uten at noe må flyttes.
//
// Passord: scrypt med tilfeldig salt per kunde. Selve passordet lagres aldri.
// Sesjon: et tilfeldig token i en httpOnly-cookie, 60 dager, fornyet ved bruk.
// I databasen ligger bare et hash av tokenet.

const scrypt = promisify(scryptCb) as (p: string, s: Buffer, n: number) => Promise<Buffer>;

export const COOKIE = "kh_kunde";
export const SESJON_DAGER = 60;
const DAG = 24 * 60 * 60 * 1000;

export type Kunde = {
  id: number;
  email: string;
  navn: string;
  telefon: string | null;
  adresse: string | null;
  postnr: string | null;
  poststed: string | null;
  land: string;
  har_passord: boolean;
  har_google: boolean;
  // Har kunden vist at hen eier e-postadressen? Kreditten og gjesteordrene
  // på adressen følger først kontoen når den er det.
  bekreftet: boolean;
  created_at: string;
};

const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const nyttToken = () => randomBytes(32).toString("base64url");

export function tilKunde(x: any): Kunde {
  return {
    id: Number(x.id),
    email: String(x.email),
    navn: String(x.navn || ""),
    telefon: x.telefon ?? null,
    adresse: x.adresse ?? null,
    postnr: x.postnr ?? null,
    poststed: x.poststed ?? null,
    land: String(x.land || "NO"),
    har_passord: !!x.passord_hash,
    har_google: !!x.google_sub,
    bekreftet: !!x.epost_bekreftet_at,
    created_at: String(x.created_at),
  };
}

export class KontoFeil extends Error {
  status: number;
  constructor(status: number, melding: string) {
    super(melding);
    this.status = status;
  }
}

// ── passord ─────────────────────────────────────────────────────────────────
// N = 16384 er Nodes standard og tar rundt 50 ms. Det merkes ikke ved én
// innlogging, men gjør det dyrt å prøve millioner av passord mot et lekket hash.
export async function hashPassord(passord: string): Promise<string> {
  const salt = randomBytes(16);
  const h = await scrypt(passord.normalize("NFKC"), salt, 64);
  return `scrypt$${salt.toString("base64")}$${h.toString("base64")}`;
}

export async function riktigPassord(passord: string, lagret: string | null): Promise<boolean> {
  if (!lagret) return false;
  const [type, saltB64, hashB64] = lagret.split("$");
  if (type !== "scrypt" || !saltB64 || !hashB64) return false;
  const forventet = Buffer.from(hashB64, "base64");
  const h = await scrypt(String(passord).normalize("NFKC"), Buffer.from(saltB64, "base64"), forventet.length);
  return h.length === forventet.length && timingSafeEqual(h, forventet);
}

export function sjekkPassordkrav(passord: string): void {
  if (String(passord || "").length < 8) throw new KontoFeil(400, "Passordet må ha minst 8 tegn.");
  if (String(passord).length > 200) throw new KontoFeil(400, "Passordet er for langt.");
}

function sjekkEpost(email: string): string {
  const e = normaliserEpost(email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) || e.length > 200) {
    throw new KontoFeil(400, "Skriv inn en gyldig e-postadresse.");
  }
  return e;
}

async function finnPåEpost(email: string): Promise<any | null> {
  const r = await db().execute({ sql: "SELECT * FROM kunder WHERE email = ?", args: [email] });
  return r.rows[0] ?? null;
}

export async function hentKunde(id: number): Promise<Kunde | null> {
  const r = await db().execute({ sql: "SELECT * FROM kunder WHERE id = ?", args: [id] });
  return r.rows[0] ? tilKunde(r.rows[0]) : null;
}

// ── kunder per fylke ─────────────────────────────────────────────────────────
// Postnummeret gir kommunen, og de to første sifrene i kommunenummeret gir
// fylket (inndelingen fra 2024). Tabellen er hentet fra Postens register
// via npm-pakken «postnummer», lagret i src/data.
let postnrFylke: Record<string, string> | null = null;
function fylkeFor(postnr: unknown): string | null {
  if (!postnrFylke) {
    const her = dirname(fileURLToPath(import.meta.url));
    postnrFylke = JSON.parse(readFileSync(join(her, "data", "postnr-fylke.json"), "utf8"));
  }
  const p = String(postnr || "").replace(/\D/g, "").padStart(4, "0").slice(0, 4);
  return postnrFylke![p] || null;
}

export async function kunderPerFylke() {
  // Tre mål per fylke: kunder, ordrer og omsetning. Ordrene er Mystore-
  // historikken fra kundeimporten (antall og verdi per kunde) pluss ordrene i
  // den nye butikken, plassert etter leveringsadressens postnummer.
  const [r, o] = await Promise.all([
    db().execute("SELECT postnr, land, mystore_ordrer, mystore_ordreverdi_ore FROM kunder"),
    db().execute(`SELECT postnr, land, kreditt_ore + stripe_ore + COALESCE(gavekort_ore, 0) AS ore
                    FROM salgsordrer WHERE status IN ('betalt', 'pakket', 'sendt')`),
  ]);
  const tom = () => ({ kunder: 0, ordrer: 0, sum_ore: 0 });
  const fylker: Record<string, { kunder: number; ordrer: number; sum_ore: number }> = {};
  const utland = tom(), ukjent = tom();
  const plass = (postnr: unknown, land: unknown) => {
    if (String(land || "NO").toUpperCase() !== "NO") return utland;
    const f = postnr ? fylkeFor(postnr) : null;
    if (!f) return ukjent;
    return (fylker[f] ||= tom());
  };
  for (const x of r.rows as any[]) {
    const m = plass(x.postnr, x.land);
    m.kunder++;
    m.ordrer += Number(x.mystore_ordrer || 0);
    m.sum_ore += Number(x.mystore_ordreverdi_ore || 0);
  }
  for (const x of o.rows as any[]) {
    const m = plass(x.postnr, x.land);
    m.ordrer++;
    m.sum_ore += Number(x.ore || 0);
  }
  return { fylker, utland, ukjent, totalt: r.rows.length };
}

// ── registrering og innlogging ──────────────────────────────────────────────
export async function registrer(inn: { email: string; passord: string; navn?: string }): Promise<Kunde> {
  const email = sjekkEpost(inn.email);
  sjekkPassordkrav(inn.passord);
  const finnes = await finnPåEpost(email);
  // En konto laget med Google har ikke passord. Registrerer samme person seg
  // med passord senere, er det ikke en ny konto — men vi kan ikke legge til
  // et passord uten å vite at det er hen. Da må hen bruke «glemt passord»,
  // som beviser at hen eier adressen.
  if (finnes) {
    // Kontoer uten passord og uten Google — importert fra Mystore, eller
    // laget av «glemt passord» — er kunder som aldri har valgt passord her.
    // Serveren sender dem en lenke for å velge passord i stedet.
    if (!finnes.passord_hash && !finnes.google_sub) {
      throw new KontoFeil(409, "uten_passord");
    }
    throw new KontoFeil(409, "Det finnes allerede en konto med denne e-postadressen. Logg inn, eller bruk «Glemt passord».");
  }
  const r = await db().execute({
    sql: `INSERT INTO kunder (email, navn, passord_hash, created_at) VALUES (?, ?, ?, ?) RETURNING *`,
    args: [email, String(inn.navn || "").trim().slice(0, 120), await hashPassord(inn.passord), new Date().toISOString()],
  });
  return tilKunde(r.rows[0]);
}

export async function loggInn(emailInn: string, passord: string): Promise<Kunde> {
  const email = normaliserEpost(emailInn);
  const rad = await finnPåEpost(email);
  // Samme svar for ukjent adresse og feil passord, og samme tidsbruk: ellers
  // kan hvem som helst finne ut hvem som er kunde.
  const ok = await riktigPassord(passord, rad?.passord_hash ?? "scrypt$AAAAAAAAAAAAAAAAAAAAAA==$" + "A".repeat(86));
  // Samme melding også for kontoer som bare bruker Google: en egen melding
  // for dem ville fortalt hvem som har konto.
  if (!rad || !ok) throw new KontoFeil(401, "Feil e-postadresse eller passord.");
  return tilKunde(rad);
}

// ── sesjoner ────────────────────────────────────────────────────────────────
export async function nySesjon(kundeId: number): Promise<string> {
  const token = nyttToken();
  const nå = new Date();
  await db().batch(
    [
      {
        sql: `INSERT INTO kunde_sesjoner (token_hash, kunde_id, expires_at, created_at) VALUES (?, ?, ?, ?)`,
        args: [hash(token), kundeId, new Date(nå.getTime() + SESJON_DAGER * DAG).toISOString(), nå.toISOString()],
      },
      { sql: "UPDATE kunder SET sist_inne_at = ? WHERE id = ?", args: [nå.toISOString(), kundeId] },
      { sql: "INSERT OR IGNORE INTO kunde_besok (dato, kunde_id) VALUES (?, ?)", args: [osloDato(nå), kundeId] },
      // Utløpte sesjoner ryddes når nye lages. Det holder tabellen liten uten
      // en egen jobb.
      { sql: "DELETE FROM kunde_sesjoner WHERE expires_at < ?", args: [nå.toISOString()] },
    ],
    "write"
  );
  return token;
}

// Norsk dato (YYYY-MM-DD), uansett hvor serveren står.
const osloDato = (d = new Date()) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Oslo" }).format(d);

// «Sist inne» oppdateres når kunden er innom, ikke bare når hen logger inn —
// en innlogging varer i 60 dager. Høyst én gang i timen, så hvert sidebytte
// ikke blir en skriving.
async function registrerBesøk(kundeId: number, sist: unknown): Promise<void> {
  const t = sist ? Date.parse(String(sist)) : 0;
  if (t && Date.now() - t < 3600_000 && osloDato(new Date(t)) === osloDato()) return;
  await db().batch([
    { sql: "UPDATE kunder SET sist_inne_at = ? WHERE id = ?", args: [new Date().toISOString(), kundeId] },
    { sql: "INSERT OR IGNORE INTO kunde_besok (dato, kunde_id) VALUES (?, ?)", args: [osloDato(), kundeId] },
  ], "write");
}

export async function sesjonsKunde(token: string | undefined): Promise<Kunde | null> {
  if (!token) return null;
  const r = await db().execute({
    sql: `SELECT k.*, s.expires_at AS s_utløp FROM kunde_sesjoner s JOIN kunder k ON k.id = s.kunde_id
           WHERE s.token_hash = ? AND s.expires_at > ?`,
    args: [hash(token), new Date().toISOString()],
  });
  const rad: any = r.rows[0];
  if (!rad) return null;
  await registrerBesøk(Number(rad.id), rad.sist_inne_at).catch(() => {});
  // Fornyes ved bruk, men ikke ved hvert eneste kall: én gang i døgnet holder.
  const igjen = Date.parse(String(rad.s_utløp)) - Date.now();
  if (igjen < (SESJON_DAGER - 1) * DAG) {
    await db().execute({
      sql: "UPDATE kunde_sesjoner SET expires_at = ? WHERE token_hash = ?",
      args: [new Date(Date.now() + SESJON_DAGER * DAG).toISOString(), hash(token)],
    });
  }
  return tilKunde(rad);
}

export async function avsluttSesjon(token: string | undefined): Promise<void> {
  if (!token) return;
  await db().execute({ sql: "DELETE FROM kunde_sesjoner WHERE token_hash = ?", args: [hash(token)] });
}

export function settKundeCookie(res: Response, token: string): void {
  const påTvers = process.env.COOKIE_CROSS_SITE === "1";
  res.cookie(COOKIE, token, {
    httpOnly: true,
    secure: påTvers || process.env.NODE_ENV === "production",
    sameSite: påTvers ? "none" : "lax",
    maxAge: SESJON_DAGER * DAG,
  });
}

export function fjernKundeCookie(res: Response): void {
  // Samme flagg som da den ble satt, ellers kan nettleseren overse slettingen.
  const påTvers = process.env.COOKIE_CROSS_SITE === "1";
  res.clearCookie(COOKIE, {
    httpOnly: true,
    secure: påTvers || process.env.NODE_ENV === "production",
    sameSite: påTvers ? "none" : "lax",
  });
}

// Legger kunden på forespørselen hvis hen er innlogget. Stopper ingenting:
// kassen er åpen for gjester.
export async function kundeValgfri(req: any, _res: Response, next: NextFunction) {
  try {
    req.kunde = await sesjonsKunde(req.cookies?.[COOKIE]);
    next();
  } catch (e) {
    next(e);
  }
}

export async function krevKunde(req: any, res: Response, next: NextFunction) {
  try {
    req.kunde = await sesjonsKunde(req.cookies?.[COOKIE]);
    if (!req.kunde) return res.status(401).json({ feil: "Du må logge inn." });
    next();
  } catch (e) {
    next(e);
  }
}

// ── profil ──────────────────────────────────────────────────────────────────
export async function oppdaterProfil(
  id: number,
  inn: { navn?: string; telefon?: string; adresse?: string; postnr?: string; poststed?: string; land?: string }
): Promise<Kunde> {
  const felt: [string, string | null][] = [];
  const kort = (v: unknown, maks: number) => {
    const t = String(v ?? "").trim().slice(0, maks);
    return t || null;
  };
  if (inn.navn !== undefined) felt.push(["navn", kort(inn.navn, 120) ?? ""]);
  if (inn.telefon !== undefined) felt.push(["telefon", kort(inn.telefon, 30)]);
  if (inn.adresse !== undefined) felt.push(["adresse", kort(inn.adresse, 200)]);
  if (inn.postnr !== undefined) felt.push(["postnr", kort(inn.postnr, 12)]);
  if (inn.poststed !== undefined) felt.push(["poststed", kort(inn.poststed, 80)]);
  if (inn.land !== undefined) felt.push(["land", (kort(inn.land, 2) || "NO").toUpperCase()]);
  if (felt.length) {
    await db().execute({
      sql: `UPDATE kunder SET ${felt.map(([n]) => `${n} = ?`).join(", ")} WHERE id = ?`,
      args: [...felt.map(([, v]) => v), id],
    });
  }
  return (await hentKunde(id))!;
}

export async function byttPassord(id: number, gammelt: string, nytt: string, nåværendeToken?: string): Promise<void> {
  sjekkPassordkrav(nytt);
  const r = await db().execute({ sql: "SELECT passord_hash FROM kunder WHERE id = ?", args: [id] });
  const lagret = (r.rows[0] as any)?.passord_hash ?? null;
  // Har kontoen ikke passord (bare Google), finnes det ikke noe gammelt å
  // bekrefte. Da er innloggingen beviset.
  if (lagret && !(await riktigPassord(gammelt, lagret))) throw new KontoFeil(400, "Det nåværende passordet stemmer ikke.");
  await db().batch(
    [
      { sql: "UPDATE kunder SET passord_hash = ? WHERE id = ?", args: [await hashPassord(nytt), id] },
      // Nytt passord logger ut alle andre steder enn her.
      {
        sql: "DELETE FROM kunde_sesjoner WHERE kunde_id = ? AND token_hash <> ?",
        args: [id, nåværendeToken ? hash(nåværendeToken) : ""],
      },
    ],
    "write"
  );
}

// ── glemt passord ───────────────────────────────────────────────────────────
// Lenken varer i en time og kan brukes én gang. Den gjelder også for
// Google-kontoer som vil ha et passord i tillegg, og for kunder fra
// kjøpssiden som aldri har hatt konto: å eie adressen er beviset.
// Engangslenker: én for nytt passord (en time), én for å bekrefte
// e-postadressen (et døgn). Begge brukes én gang, atomisk: to klikk på samme
// lenke i samme øyeblikk kan ikke begge gå gjennom.
async function lagEngangslenke(kundeId: number, formaal: "reset" | "bekreft", varighetMs: number): Promise<string> {
  const token = nyttToken();
  await db().execute({
    sql: `INSERT INTO kunde_tokens (token_hash, kunde_id, formaal, expires_at) VALUES (?, ?, ?, ?)`,
    args: [hash(token), kundeId, formaal, new Date(Date.now() + varighetMs).toISOString()],
  });
  return token;
}

async function brukEngangslenke(token: string, formaal: "reset" | "bekreft"): Promise<number> {
  const nå = new Date().toISOString();
  const h = hash(String(token || ""));
  const r = await db().execute({
    sql: `UPDATE kunde_tokens SET brukt_at = ?
           WHERE token_hash = ? AND formaal = ? AND brukt_at IS NULL AND expires_at > ?
       RETURNING kunde_id`,
    args: [nå, h, formaal, nå],
  });
  const id = Number((r.rows[0] as any)?.kunde_id || 0);
  if (!id) throw new KontoFeil(400, "Lenken er utløpt eller allerede brukt. Be om en ny.");
  // Andre lenker av samme slag for kontoen er utdatert nå.
  await db().execute({
    sql: "DELETE FROM kunde_tokens WHERE kunde_id = ? AND formaal = ? AND token_hash <> ?",
    args: [id, formaal, h],
  });
  return id;
}

// «Glemt passord». Lenken varer i en time og kan brukes én gang. Den gjelder
// også for Google-kontoer som vil ha et passord i tillegg, og for kunder fra
// kjøpssiden som aldri har hatt konto: å eie adressen er beviset.
export async function lagTilbakestilling(emailInn: string): Promise<{ email: string; token: string } | null> {
  const email = normaliserEpost(emailInn);
  if (!email.includes("@")) return null;
  let rad = await finnPåEpost(email);
  if (!rad) {
    // Har adressen solgt kort til butikken eller har kreditt, lager vi
    // kontoen her. Ellers sender vi ingenting — og sier ikke det heller.
    const kjent = await db().execute({
      sql: `SELECT 1 FROM orders WHERE lower(email) = ? UNION SELECT 1 FROM kreditt_bevegelser WHERE email = ? LIMIT 1`,
      args: [email, email],
    });
    if (!kjent.rows.length) return null;
    const ny = await db().execute({
      sql: "INSERT INTO kunder (email, created_at) VALUES (?, ?) RETURNING *",
      args: [email, new Date().toISOString()],
    });
    rad = ny.rows[0];
  }
  return { email, token: await lagEngangslenke(Number(rad.id), "reset", 60 * 60 * 1000) };
}

export async function brukTilbakestilling(token: string, nytt: string): Promise<Kunde> {
  sjekkPassordkrav(nytt);
  const id = await brukEngangslenke(token, "reset");
  const nå = new Date().toISOString();
  await db().batch(
    [
      // Lenken kom til adressen, så adressen er bekreftet.
      {
        sql: "UPDATE kunder SET passord_hash = ?, epost_bekreftet_at = COALESCE(epost_bekreftet_at, ?) WHERE id = ?",
        args: [await hashPassord(nytt), nå, id],
      },
      // Nytt passord logger ut alle andre steder. Var det noen andre som
      // hadde kommet seg inn, er de ute nå.
      { sql: "DELETE FROM kunde_sesjoner WHERE kunde_id = ?", args: [id] },
    ],
    "write"
  );
  return (await hentKunde(id))!;
}

// Bekreftelse av e-postadressen etter registrering.
export async function lagBekreftelse(kundeId: number): Promise<string> {
  return lagEngangslenke(kundeId, "bekreft", 24 * 60 * 60 * 1000);
}

export async function bekreftEpost(token: string): Promise<Kunde> {
  const id = await brukEngangslenke(token, "bekreft");
  await db().execute({
    sql: "UPDATE kunder SET epost_bekreftet_at = COALESCE(epost_bekreftet_at, ?) WHERE id = ?",
    args: [new Date().toISOString(), id],
  });
  return (await hentKunde(id))!;
}

// ── Google ──────────────────────────────────────────────────────────────────
// Vanlig OAuth-flyt med autorisasjonskode. Knappen vises først når
// GOOGLE_CLIENT_ID og GOOGLE_CLIENT_SECRET er satt.
export const harGoogle = () => !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

export function googleUrl(redirectUri: string, state: string): string {
  const p = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID || "",
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

// ID-tokenet kommer rett fra Googles token-endepunkt over HTTPS, og kan da
// leses uten å sjekke signaturen (Googles egen anbefaling). Vi sjekker
// likevel at det er utstedt til oss og at e-postadressen er bekreftet.
export async function googleKunde(kode: string, redirectUri: string): Promise<Kunde> {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: kode,
      client_id: process.env.GOOGLE_CLIENT_ID || "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET || "",
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!r.ok) throw new KontoFeil(400, "Google godtok ikke innloggingen. Prøv igjen.");
  const svar: any = await r.json();
  const del = String(svar.id_token || "").split(".")[1];
  if (!del) throw new KontoFeil(400, "Fikk ikke svar fra Google.");
  const krav = JSON.parse(Buffer.from(del, "base64url").toString("utf8"));
  if (krav.aud !== process.env.GOOGLE_CLIENT_ID) throw new KontoFeil(400, "Svaret fra Google var ikke til oss.");
  if (!krav.email || krav.email_verified !== true) {
    throw new KontoFeil(400, "Google-kontoen har ingen bekreftet e-postadresse.");
  }
  const email = normaliserEpost(krav.email);
  const sub = String(krav.sub);

  // Først på Google-ID (adressen kan være endret hos Google), så på e-post.
  // Finnes en passordkonto med samme bekreftede adresse, kobles Google til
  // den — Google har bekreftet at det er samme person som eier adressen.
  const nå = new Date().toISOString();
  const påSub = await db().execute({ sql: "SELECT * FROM kunder WHERE google_sub = ?", args: [sub] });
  if (påSub.rows[0]) return tilKunde(påSub.rows[0]);
  const påEpost = await finnPåEpost(email);
  if (påEpost) {
    const navn = !påEpost.navn && krav.name ? String(krav.name).slice(0, 120) : påEpost.navn;
    if (påEpost.epost_bekreftet_at) {
      await db().execute({ sql: "UPDATE kunder SET google_sub = ?, navn = ? WHERE id = ?", args: [sub, navn, påEpost.id] });
    } else {
      // En ubekreftet konto på adressen kan være laget av noen andre enn
      // eieren. Google har nå bevist hvem som eier adressen: passordet som
      // ble satt av den ukjente, og alle innloggingene, fjernes.
      await db().batch(
        [
          {
            sql: "UPDATE kunder SET google_sub = ?, navn = ?, passord_hash = NULL, epost_bekreftet_at = ? WHERE id = ?",
            args: [sub, navn, nå, påEpost.id],
          },
          { sql: "DELETE FROM kunde_sesjoner WHERE kunde_id = ?", args: [påEpost.id] },
        ],
        "write"
      );
    }
    return (await hentKunde(Number(påEpost.id)))!;
  }
  const ny = await db().execute({
    sql: "INSERT INTO kunder (email, navn, google_sub, epost_bekreftet_at, created_at) VALUES (?, ?, ?, ?, ?) RETURNING *",
    args: [email, String(krav.name || "").slice(0, 120), sub, nå, nå],
  });
  return tilKunde(ny.rows[0]);
}

// ── import fra Mystore ──────────────────────────────────────────────────────
// Kundelisten fra Mystore (Kunder → Eksporter, CSV). Kundene får en konto uten
// passord, med navn, adresse og telefon ferdig utfylt. Første gang de vil
// logge inn, bruker de «Glemt passord» eller Google — det beviser at de eier
// adressen, og da følger kreditt og ordrehistorikk med.
//
// Fødselsdato tas ikke med: butikken trenger den ikke, og det vi ikke lagrer,
// kan ikke lekke. Finnes kontoen fra før, fylles bare tomme felt.
//
// Mystore-lista har tusenvis av falske registreringer (2024, «Zambia»,
// tilfeldige bokstaver som postnummer, aldri innlogget, ingen ordrer). En rad
// uten ordrer og innlogging, og med et postnummer som ikke er tall, hoppes over.
export function lesCsv(tekst: string): Record<string, string>[] {
  const t = tekst.replace(/^\uFEFF/, "");
  const rader: string[][] = [];
  let rad: string[] = [], felt = "", i = 0, iAnf = false;
  while (i < t.length) {
    const c = t[i];
    if (iAnf) {
      if (c === '"' && t[i + 1] === '"') { felt += '"'; i += 2; continue; }
      if (c === '"') { iAnf = false; i++; continue; }
      felt += c; i++; continue;
    }
    if (c === '"') { iAnf = true; i++; continue; }
    if (c === "," || c === ";") { rad.push(felt); felt = ""; i++; continue; }
    if (c === "\r") { i++; continue; }
    if (c === "\n") { rad.push(felt); rader.push(rad); rad = []; felt = ""; i++; continue; }
    felt += c; i++;
  }
  if (felt || rad.length) { rad.push(felt); rader.push(rad); }
  const [hode, ...resten] = rader;
  if (!hode) return [];
  return resten
    .filter((r) => r.some((x) => x.trim()))
    .map((r) => Object.fromEntries(hode.map((h, j) => [h.trim(), (r[j] ?? "").trim()])));
}

const LANDKODE: Record<string, string> = { norge: "NO", sverige: "SE", danmark: "DK", finland: "FI", island: "IS" };

export function erFalskMystoreKunde(r: Record<string, string>): boolean {
  const ordrer = parseInt(r["Ordrer"] || "0", 10) || 0;
  const innlogget = !!(r["Siste innlogging"] || "").trim();
  const postnr = (r["Postnummer"] || "").trim();
  return ordrer === 0 && !innlogget && postnr !== "" && !/^\d{3,5}$/.test(postnr);
}

export async function importerMystoreKunder(tekst: string): Promise<{
  rader: number; nye: number; oppdatert: number; falske: number; ugyldige: number;
}> {
  const rader = lesCsv(tekst);
  if (rader.length && !("E-post" in rader[0])) {
    throw new KontoFeil(400, "Fant ikke kolonnen «E-post». Er dette kundeeksporten fra Mystore?");
  }
  let nye = 0, oppdatert = 0, falske = 0, ugyldige = 0;
  const sett = new Set<string>();
  const setninger: { sql: string; args: any[] }[] = [];
  const nå = new Date().toISOString();
  for (const r of rader) {
    const email = normaliserEpost(r["E-post"] || "");
    // Ugyldig adresse, eller samme adresse to ganger i lista.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || sett.has(email)) { ugyldige++; continue; }
    if (erFalskMystoreKunde(r)) { falske++; continue; }
    sett.add(email);
    const navn = [r["Fornavn"], r["Etternavn"]].filter(Boolean).join(" ").trim().slice(0, 120);
    const land = LANDKODE[(r["Land"] || "").toLowerCase()] || "NO";
    const siden = /^\d{4}-\d{2}-\d{2}/.test(r["Kunde siden"] || "") ? `${r["Kunde siden"].slice(0, 10)}T12:00:00.000Z` : nå;
    const verdi = Math.round((parseFloat((r["Samlet ordreverdi"] || "0").replace(",", ".")) || 0) * 100);
    const sist = /^\d{4}-\d{2}-\d{2}/.test(r["Siste innlogging"] || "") ? r["Siste innlogging"].slice(0, 10) : null;
    setninger.push({
      sql: `INSERT INTO kunder (email, navn, telefon, adresse, postnr, poststed, land, created_at, kilde,
                                nyhetsbrev, mystore_ordrer, mystore_ordreverdi_ore, mystore_sist_inne)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'mystore', ?, ?, ?, ?)
            ON CONFLICT(email) DO UPDATE SET
              navn = CASE WHEN kunder.navn = '' THEN excluded.navn ELSE kunder.navn END,
              telefon = COALESCE(NULLIF(kunder.telefon, ''), excluded.telefon),
              adresse = COALESCE(NULLIF(kunder.adresse, ''), excluded.adresse),
              postnr = COALESCE(NULLIF(kunder.postnr, ''), excluded.postnr),
              poststed = COALESCE(NULLIF(kunder.poststed, ''), excluded.poststed),
              created_at = MIN(kunder.created_at, excluded.created_at),
              nyhetsbrev = excluded.nyhetsbrev,
              mystore_ordrer = excluded.mystore_ordrer,
              mystore_ordreverdi_ore = excluded.mystore_ordreverdi_ore,
              mystore_sist_inne = excluded.mystore_sist_inne`,
      args: [
        email, navn, r["Telefon"] || null, r["Gateadresse"] || null, r["Postnummer"] || null, r["By"] || null,
        land, siden, r["Nyhetsbrev"] === "1" ? 1 : 0, parseInt(r["Ordrer"] || "0", 10) || 0, verdi, sist,
      ],
    });
  }
  const før = await db().execute("SELECT COUNT(*) AS n FROM kunder");
  for (let i = 0; i < setninger.length; i += 200) {
    await db().batch(setninger.slice(i, i + 200), "write");
  }
  const etter = await db().execute("SELECT COUNT(*) AS n FROM kunder");
  nye = Number(etter.rows[0].n) - Number(før.rows[0].n);
  oppdatert = setninger.length - nye;
  return { rader: rader.length, nye, oppdatert, falske, ugyldige };
}

// ── oversikt i admin ────────────────────────────────────────────────────────
// Alle med konto, pluss de som har kreditt uten konto (selgere fra
// kjøpssiden som ikke har logget inn). Kreditten følger e-postadressen, så de
// skal kunne finnes og få kreditt endret her.
const ALLE = `
  SELECT k.id, k.email, k.navn, k.kilde, k.created_at, k.sist_inne_at, k.epost_bekreftet_at,
         k.passord_hash IS NOT NULL AS har_passord, k.google_sub IS NOT NULL AS har_google,
         k.poststed, k.mystore_ordrer, k.mystore_ordreverdi_ore,
         (SELECT COUNT(*) FROM salgsordrer o WHERE o.kunde_id = k.id AND o.status IN ('betalt','pakket','sendt')) AS ordrer,
         (SELECT COALESCE(SUM(b.ore), 0) FROM kreditt_bevegelser b WHERE b.email = k.email) AS kreditt_ore
    FROM kunder k
  UNION ALL
  SELECT NULL, b.email, '', 'kreditt', MIN(b.created_at), NULL, NULL, 0, 0, NULL, NULL, NULL, 0, SUM(b.ore)
    FROM kreditt_bevegelser b
   WHERE b.email NOT IN (SELECT email FROM kunder)
   GROUP BY b.email`;
const SORTERING: Record<string, string> = {
  sist_inne: "COALESCE(x.sist_inne_at, '')",
  navn: "lower(COALESCE(NULLIF(x.navn, ''), x.email))",
  siden: "x.created_at",
  kreditt: "x.kreditt_ore",
  ordrer: "x.ordrer",
  mystore: "COALESCE(x.mystore_ordreverdi_ore, -1)",
};

export async function kundeoversikt(q: string, side = 0, sort = "sist_inne", opp = false) {
  const s = `%${String(q || "").trim().toLowerCase()}%`;
  const per = 50;
  const orden = `${SORTERING[sort] || SORTERING.sist_inne} ${opp ? "ASC" : "DESC"}, x.created_at DESC`;
  const fra = new Date(Date.now() - 13 * 86400000);
  const [tall, liste, antall, besøk] = await Promise.all([
    db().execute(`
      SELECT COUNT(*) AS totalt,
             SUM(passord_hash IS NOT NULL) AS med_passord,
             SUM(google_sub IS NOT NULL) AS med_google,
             SUM(epost_bekreftet_at IS NOT NULL) AS bekreftet,
             SUM(kilde = 'mystore') AS fra_mystore,
             SUM(kilde = 'mystore' AND passord_hash IS NULL AND google_sub IS NULL) AS mystore_ikke_aktivert,
             SUM(kilde = 'konto' AND created_at >= datetime('now', '-30 days')) AS nye_30,
             SUM(sist_inne_at >= datetime('now', '-30 days')) AS inne_30
        FROM kunder`),
    db().execute({
      sql: `SELECT * FROM (${ALLE}) x
             WHERE ? = '%%' OR lower(x.email) LIKE ? OR lower(x.navn) LIKE ?
             ORDER BY ${orden}
             LIMIT ? OFFSET ?`,
      args: [s, s, s, per, side * per],
    }),
    db().execute({
      sql: `SELECT COUNT(*) AS n FROM (${ALLE}) x WHERE ? = '%%' OR lower(x.email) LIKE ? OR lower(x.navn) LIKE ?`,
      args: [s, s, s],
    }),
    db().execute({
      sql: "SELECT dato, COUNT(*) AS n FROM kunde_besok WHERE dato >= ? GROUP BY dato ORDER BY dato DESC",
      args: [osloDato(fra)],
    }),
  ]);
  // De siste 14 dagene, også dagene uten besøk.
  const perDag = new Map((besøk.rows as any[]).map((x) => [String(x.dato), Number(x.n)]));
  const dager = Array.from({ length: 14 }, (_, i) => {
    const d = osloDato(new Date(Date.now() - i * 86400000));
    return { dato: d, innom: perDag.get(d) || 0 };
  });
  const t: any = tall.rows[0];
  const n = (x: any) => Number(x || 0);
  return {
    tall: {
      totalt: n(t.totalt), med_passord: n(t.med_passord), med_google: n(t.med_google), bekreftet: n(t.bekreftet),
      fra_mystore: n(t.fra_mystore), mystore_ikke_aktivert: n(t.mystore_ikke_aktivert), nye_30: n(t.nye_30), inne_30: n(t.inne_30),
    },
    besok: dager,
    google_paa: harGoogle(),
    kunder: liste.rows,
    antall: n(antall.rows[0].n),
    per,
  };
}
