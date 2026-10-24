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
  if (!rad || !ok) {
    if (rad && !rad.passord_hash && rad.google_sub) {
      throw new KontoFeil(401, "Denne kontoen bruker Google-innlogging. Trykk «Fortsett med Google», eller lag et passord med «Glemt passord».");
    }
    throw new KontoFeil(401, "Feil e-postadresse eller passord.");
  }
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
      // Utløpte sesjoner ryddes når nye lages. Det holder tabellen liten uten
      // en egen jobb.
      { sql: "DELETE FROM kunde_sesjoner WHERE expires_at < ?", args: [nå.toISOString()] },
    ],
    "write"
  );
  return token;
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
  res.clearCookie(COOKIE);
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

export async function byttPassord(id: number, gammelt: string, nytt: string): Promise<void> {
  sjekkPassordkrav(nytt);
  const r = await db().execute({ sql: "SELECT passord_hash FROM kunder WHERE id = ?", args: [id] });
  const lagret = (r.rows[0] as any)?.passord_hash ?? null;
  // Har kontoen ikke passord (bare Google), finnes det ikke noe gammelt å
  // bekrefte. Da er innloggingen beviset.
  if (lagret && !(await riktigPassord(gammelt, lagret))) throw new KontoFeil(400, "Det nåværende passordet stemmer ikke.");
  await db().execute({ sql: "UPDATE kunder SET passord_hash = ? WHERE id = ?", args: [await hashPassord(nytt), id] });
}

// ── glemt passord ───────────────────────────────────────────────────────────
// Lenken varer i en time og kan brukes én gang. Den gjelder også for
// Google-kontoer som vil ha et passord i tillegg, og for kunder fra
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
  const token = nyttToken();
  await db().execute({
    sql: `INSERT INTO kunde_tokens (token_hash, kunde_id, formaal, expires_at) VALUES (?, ?, 'reset', ?)`,
    args: [hash(token), Number(rad.id), new Date(Date.now() + 60 * 60 * 1000).toISOString()],
  });
  return { email, token };
}

export async function brukTilbakestilling(token: string, nytt: string): Promise<Kunde> {
  sjekkPassordkrav(nytt);
  const nå = new Date().toISOString();
  const r = await db().execute({
    sql: `SELECT * FROM kunde_tokens WHERE token_hash = ? AND formaal = 'reset' AND brukt_at IS NULL AND expires_at > ?`,
    args: [hash(String(token || "")), nå],
  });
  const t: any = r.rows[0];
  if (!t) throw new KontoFeil(400, "Lenken er utløpt eller allerede brukt. Be om en ny.");
  await db().batch(
    [
      { sql: "UPDATE kunde_tokens SET brukt_at = ? WHERE token_hash = ?", args: [nå, t.token_hash] },
      { sql: "UPDATE kunder SET passord_hash = ? WHERE id = ?", args: [await hashPassord(nytt), t.kunde_id] },
      // Nytt passord logger ut alle andre steder. Var det noen andre som
      // hadde kommet seg inn, er de ute nå.
      { sql: "DELETE FROM kunde_sesjoner WHERE kunde_id = ?", args: [t.kunde_id] },
    ],
    "write"
  );
  return (await hentKunde(Number(t.kunde_id)))!;
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
  const påSub = await db().execute({ sql: "SELECT * FROM kunder WHERE google_sub = ?", args: [sub] });
  if (påSub.rows[0]) return tilKunde(påSub.rows[0]);
  const påEpost = await finnPåEpost(email);
  if (påEpost) {
    await db().execute({ sql: "UPDATE kunder SET google_sub = ? WHERE id = ?", args: [sub, påEpost.id] });
    if (!påEpost.navn && krav.name) {
      await db().execute({ sql: "UPDATE kunder SET navn = ? WHERE id = ?", args: [String(krav.name).slice(0, 120), påEpost.id] });
    }
    return (await hentKunde(Number(påEpost.id)))!;
  }
  const ny = await db().execute({
    sql: "INSERT INTO kunder (email, navn, google_sub, created_at) VALUES (?, ?, ?, ?) RETURNING *",
    args: [email, String(krav.name || "").slice(0, 120), sub, new Date().toISOString()],
  });
  return tilKunde(ny.rows[0]);
}
