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
  res.cookie(COOKIE, lagToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
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
