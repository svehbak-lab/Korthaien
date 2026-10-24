import { db, hentSettings } from "./db.js";

// ─────────────────────────────────────────────────────────────────────────────
// TOPPBILDET PÅ FORSIDEN
// ─────────────────────────────────────────────────────────────────────────────
// Et stort bilde av neste sett, med én linje tekst over. Teksten følger
// datoen, så banneret aldri kan stå med en dato som er passert:
//
//   før utgivelsen     «Kommer 13. november»
//   de neste 30 dagene «Ute nå»
//   deretter           skjules, og forsiden viser den vanlige teksten igjen

export const UTE_NÅ_DAGER = 30;

const MÅNEDER = ["januar", "februar", "mars", "april", "mai", "juni", "juli",
  "august", "september", "oktober", "november", "desember"];

export const osloIdag = (d = new Date()) =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Oslo" }).format(d);

function plussDager(dato: string, n: number): string {
  const d = new Date(`${dato}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function bannertekst(dato: string | null, idag = osloIdag()): string | null {
  if (!dato) return null;
  if (idag < dato) {
    const [, m, d] = dato.split("-").map(Number);
    return `Kommer ${d}. ${MÅNEDER[m - 1]}`;
  }
  if (idag < plussDager(dato, UTE_NÅ_DAGER)) return "Ute nå";
  return null;
}

export async function aktivtBanner(idag = osloIdag()) {
  const { toppbanner: b } = await hentSettings();
  if (!b || !b.aktiv || !b.bilde_id) return null;
  const tekst = bannertekst(b.dato, idag);
  if (!tekst) return null;
  const r = await db().execute({ sql: "SELECT bredde, hoyde FROM bilder WHERE id = ?", args: [b.bilde_id] });
  if (!r.rows[0]) return null;
  return { bilde_id: Number(b.bilde_id), tekst, bredde: r.rows[0].bredde, hoyde: r.rows[0].hoyde };
}

// ── bildefiler ──────────────────────────────────────────────────────────────
// Typen avgjøres av filens første bytes, ikke av hva nettleseren sier. Bare
// JPEG, PNG og WebP godtas — et bilde som skal vises på forsiden, skal ikke
// kunne være noe annet.
export function bildeinfo(b: Buffer): { mime: string; bredde: number | null; hoyde: number | null } | null {
  if (b.length > 24 && b[0] === 0x89 && b.toString("ascii", 1, 4) === "PNG") {
    return { mime: "image/png", bredde: b.readUInt32BE(16), hoyde: b.readUInt32BE(20) };
  }
  if (b.length > 30 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") {
    const type = b.toString("ascii", 12, 16);
    if (type === "VP8X") return { mime: "image/webp", bredde: 1 + b.readUIntLE(24, 3), hoyde: 1 + b.readUIntLE(27, 3) };
    if (type === "VP8 ") return { mime: "image/webp", bredde: b.readUInt16LE(26) & 0x3fff, hoyde: b.readUInt16LE(28) & 0x3fff };
    if (type === "VP8L") {
      const v = b.readUInt32LE(21);
      return { mime: "image/webp", bredde: (v & 0x3fff) + 1, hoyde: ((v >> 14) & 0x3fff) + 1 };
    }
    return { mime: "image/webp", bredde: null, hoyde: null };
  }
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    // Størrelsen står i første SOF-segment.
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
        return { mime: "image/jpeg", hoyde: b.readUInt16BE(i + 5), bredde: b.readUInt16BE(i + 7) };
      }
      i += 2 + b.readUInt16BE(i + 2);
    }
    return { mime: "image/jpeg", bredde: null, hoyde: null };
  }
  return null;
}

export async function lagreBilde(data: Buffer) {
  const info = bildeinfo(data);
  if (!info) throw new Error("Bare JPEG, PNG og WebP kan lastes opp.");
  const r = await db().execute({
    sql: "INSERT INTO bilder (mime, data, bredde, hoyde, created_at) VALUES (?, ?, ?, ?, ?) RETURNING id",
    args: [info.mime, data, info.bredde, info.hoyde, new Date().toISOString()],
  });
  return { id: Number(r.rows[0].id), ...info };
}

export async function hentBilde(id: number): Promise<{ mime: string; data: Buffer } | null> {
  const r = await db().execute({ sql: "SELECT mime, data FROM bilder WHERE id = ?", args: [id] });
  const x: any = r.rows[0];
  if (!x) return null;
  return { mime: String(x.mime), data: Buffer.from(x.data as ArrayBuffer) };
}
