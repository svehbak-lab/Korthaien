import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// ─────────────────────────────────────────────────────────────────────────────
// ENGANGSKODER (TOTP, RFC 6238)
// ─────────────────────────────────────────────────────────────────────────────
// Sekssifret kode som skifter hvert 30. sekund, regnet ut fra en hemmelighet
// og klokka. Ingen nettverkstrafikk, ingen leverandør, ingen kostnad — og
// koden virker uten dekning.
//
// Vi godtar ett steg i hver retning, altså nittisekunders vindu. Klokker går
// sjelden helt likt, og uten slingringsmonn blir det umulig å logge inn fra en
// telefon som ligger noen sekunder etter.

const STEG = 30;
const SIFRE = 6;
const SLINGRING = 1;

// ── base32 ───────────────────────────────────────────────────────────────────
// Autentiseringsapper forventer hemmeligheten i base32. Node har ikke det
// innebygd, så det er skrevet ut her.
const ALFABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function tilBase32(bytes: Buffer): string {
  let bits = 0;
  let verdi = 0;
  let ut = "";
  for (const b of bytes) {
    verdi = (verdi << 8) | b;
    bits += 8;
    while (bits >= 5) {
      ut += ALFABET[(verdi >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) ut += ALFABET[(verdi << (5 - bits)) & 31];
  return ut;
}

export function fraBase32(s: string): Buffer {
  const rent = String(s || "").toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let verdi = 0;
  const ut: number[] = [];
  for (const tegn of rent) {
    const i = ALFABET.indexOf(tegn);
    if (i < 0) continue;
    verdi = (verdi << 5) | i;
    bits += 5;
    if (bits >= 8) {
      ut.push((verdi >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(ut);
}

// 20 byte er lengden HMAC-SHA1 bruker internt. Kortere gir ingen gevinst,
// lengre gir ingen ekstra sikkerhet.
export function nyHemmelighet(): string {
  return tilBase32(randomBytes(20));
}

// ── selve koden ──────────────────────────────────────────────────────────────
export function kodeFor(hemmelighet: string, tid = Date.now()): string {
  // Slingringsmonnet kan regne seg bakover forbi 1970 hvis klokka er absurd
  // feil. Det skal ikke velte innloggingen.
  const teller = Math.max(0, Math.floor(tid / 1000 / STEG));
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(teller / 2 ** 32), 0);
  buf.writeUInt32BE(teller >>> 0, 4);

  const hmac = createHmac("sha1", fraBase32(hemmelighet)).update(buf).digest();
  // Dynamisk trunkering: de fire siste bitene peker på hvor i digesten
  // tallet skal hentes fra.
  const offset = hmac[hmac.length - 1] & 0x0f;
  const tall =
    ((hmac[offset] & 0x7f) << 24) |
    (hmac[offset + 1] << 16) |
    (hmac[offset + 2] << 8) |
    hmac[offset + 3];
  return String(tall % 10 ** SIFRE).padStart(SIFRE, "0");
}

export function sjekkKode(hemmelighet: string, oppgitt: string, tid = Date.now()): boolean {
  const rent = String(oppgitt || "").replace(/\D/g, "");
  if (rent.length !== SIFRE || !hemmelighet) return false;
  for (let d = -SLINGRING; d <= SLINGRING; d++) {
    const fasit = kodeFor(hemmelighet, tid + d * STEG * 1000);
    // Sammenligning som ikke røper hvor mange sifre som stemte.
    if (timingSafeEqual(Buffer.from(fasit), Buffer.from(rent))) return true;
  }
  return false;
}

// ── oppsett ──────────────────────────────────────────────────────────────────
// Adressen appen skanner. «issuer» er navnet som vises i lista i telefonen.
export function otpauthUri(hemmelighet: string, konto = "admin", utsteder = "Korthaien Kjøp"): string {
  const p = new URLSearchParams({
    secret: hemmelighet,
    issuer: utsteder,
    algorithm: "SHA1",
    digits: String(SIFRE),
    period: String(STEG),
  });
  return `otpauth://totp/${encodeURIComponent(utsteder)}:${encodeURIComponent(konto)}?${p}`;
}

// ── reservekoder ─────────────────────────────────────────────────────────────
// Mistet telefon uten disse betyr at eneste vei inn er å endre databasen for
// hånd. De vises én gang, lagres bare som hash, og hver kan brukes én gang.
export function nyeReservekoder(antall = 10): string[] {
  const koder: string[] = [];
  for (let i = 0; i < antall; i++) {
    // Ti tegn fra et alfabet uten 0/O og 1/I, delt i to for lesbarhet.
    const tegn = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
    let k = "";
    for (const b of randomBytes(10)) k += tegn[b % tegn.length];
    koder.push(`${k.slice(0, 5)}-${k.slice(5)}`);
  }
  return koder;
}

export function normaliserReservekode(s: string): string {
  return String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}
