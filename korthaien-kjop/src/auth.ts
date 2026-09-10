import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";
import type { Request, Response, NextFunction } from "express";

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN-INNLOGGING
// ─────────────────────────────────────────────────────────────────────────────
// Ett passord, signert sesjonscookie, ingen brukertabell. Det holder når det
// bare er deg — men passordet må ligge i miljøvariabel, aldri i koden.

const COOKIE = "kh_admin";
const VARIGHET_MS = 7 * 24 * 60 * 60 * 1000;

function hemmelighet(): string {
  const s = process.env.SESSION_SECRET;
  if (s) return s;
  // Uten satt hemmelighet blir alle sesjoner ugyldige ved omstart. Det er
  // riktigere enn å ha en forutsigbar standardverdi liggende i koden.
  if (!globalThis.__kh_secret) globalThis.__kh_secret = randomBytes(32).toString("hex");
  return globalThis.__kh_secret as string;
}

function signer(data: string): string {
  return createHmac("sha256", hemmelighet()).update(data).digest("hex");
}

export function lagToken(): string {
  const utløp = Date.now() + VARIGHET_MS;
  return `${utløp}.${signer(String(utløp))}`;
}

export function gyldigToken(token: string | undefined): boolean {
  if (!token) return false;
  const [utløpStr, sig] = token.split(".");
  if (!utløpStr || !sig) return false;
  const utløp = parseInt(utløpStr, 10);
  if (!Number.isFinite(utløp) || utløp < Date.now()) return false;
  const forventet = signer(utløpStr);
  if (sig.length !== forventet.length) return false;
  return timingSafeEqual(Buffer.from(sig), Buffer.from(forventet));
}

export function sjekkPassord(oppgitt: string): boolean {
  const riktig = process.env.ADMIN_PASSWORD || "";
  if (!riktig) return false;
  const a = Buffer.from(String(oppgitt || ""));
  const b = Buffer.from(riktig);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function settCookie(res: Response): void {
  // Ligger admin og API på ulike domener (vercel.app mot onrender.com), er
  // forespørselen «cross-site», og en lax-cookie sendes rett og slett ikke.
  // Da må den være none + secure. Legger du begge under korthaien.no, er
  // lax både tryggere og upåvirket av at nettlesere stenger tredjepartscookies.
  const påTversAvDomener = process.env.COOKIE_CROSS_SITE === "1";
  res.cookie(COOKIE, lagToken(), {
    httpOnly: true,
    secure: påTversAvDomener || process.env.NODE_ENV === "production",
    sameSite: påTversAvDomener ? "none" : "lax",
    maxAge: VARIGHET_MS,
  });
}

export function fjernCookie(res: Response): void {
  res.clearCookie(COOKIE);
}

export function krevAdmin(req: Request, res: Response, next: NextFunction): void {
  if (gyldigToken(req.cookies?.[COOKIE])) return next();
  res.status(401).json({ feil: "Ikke innlogget" });
}

// ─────────────────────────────────────────────────────────────────────────────
// TOTRINNS INNLOGGING
// ─────────────────────────────────────────────────────────────────────────────
import { createHash } from "node:crypto";
import { db } from "./db.js";
import { sjekkKode, nyHemmelighet, nyeReservekoder, normaliserReservekode, otpauthUri } from "./totp.js";

export type TotpStatus = { påslått: boolean; venter: boolean; reservekoder: number };

export async function totpStatus(): Promise<TotpStatus> {
  const r = await db().execute("SELECT * FROM admin_totp WHERE id = 1");
  const rad: any = r.rows[0];
  const b = await db().execute("SELECT COUNT(*) AS n FROM admin_backup_codes WHERE used_at IS NULL");
  return {
    påslått: !!rad?.confirmed_at,
    venter: !!rad && !rad.confirmed_at,
    reservekoder: Number(b.rows[0]?.n || 0),
  };
}

// Starter oppsettet på nytt hver gang. En hemmelighet som ikke er bekreftet,
// har ingen verdi, og å gjenbruke den ville bare gjort feilsøking vanskeligere.
export async function startTotp(): Promise<{ hemmelighet: string; uri: string }> {
  const hemmelighet = nyHemmelighet();
  await db().execute({
    sql: `INSERT INTO admin_totp (id, secret, confirmed_at, updated_at) VALUES (1, ?, NULL, ?)
          ON CONFLICT(id) DO UPDATE SET secret = excluded.secret, confirmed_at = NULL,
                                        updated_at = excluded.updated_at`,
    args: [hemmelighet, new Date().toISOString()],
  });
  return { hemmelighet, uri: otpauthUri(hemmelighet) };
}

const hashKode = (k: string) => createHash("sha256").update(normaliserReservekode(k)).digest("hex");

export async function bekreftTotp(kode: string): Promise<string[]> {
  const r = await db().execute("SELECT * FROM admin_totp WHERE id = 1");
  const rad: any = r.rows[0];
  if (!rad) throw new Error("Start oppsettet først");
  if (!sjekkKode(String(rad.secret), kode)) throw new Error("Koden stemmer ikke");

  await db().execute({
    sql: "UPDATE admin_totp SET confirmed_at = ? WHERE id = 1",
    args: [new Date().toISOString()],
  });
  // Nye reservekoder erstatter alle gamle. Ellers ville koder fra et tidligere
  // oppsett fortsatt sluppet noen inn.
  await db().execute("DELETE FROM admin_backup_codes");
  const koder = nyeReservekoder();
  for (const k of koder) {
    await db().execute({
      sql: "INSERT INTO admin_backup_codes (hash, used_at, created_at) VALUES (?, NULL, ?)",
      args: [hashKode(k), new Date().toISOString()],
    });
  }
  return koder;
}

export async function slåAvTotp(): Promise<void> {
  await db().execute("DELETE FROM admin_totp");
  await db().execute("DELETE FROM admin_backup_codes");
}

// Godtar både en kode fra appen og en ubrukt reservekode. Reservekoden
// forbrukes i samme slengen.
export async function sjekkAndreTrinn(kode: string): Promise<boolean> {
  const r = await db().execute("SELECT * FROM admin_totp WHERE id = 1");
  const rad: any = r.rows[0];
  if (!rad?.confirmed_at) return true;
  if (sjekkKode(String(rad.secret), kode)) return true;

  const h = hashKode(kode);
  if (normaliserReservekode(kode).length < 8) return false;
  const b = await db().execute({
    sql: "SELECT hash FROM admin_backup_codes WHERE hash = ? AND used_at IS NULL",
    args: [h],
  });
  if (!b.rows.length) return false;
  await db().execute({
    sql: "UPDATE admin_backup_codes SET used_at = ? WHERE hash = ?",
    args: [new Date().toISOString(), h],
  });
  return true;
}
