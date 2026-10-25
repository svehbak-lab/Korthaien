import { randomBytes } from "node:crypto";
import { db } from "./db.js";

// ─────────────────────────────────────────────────────────────────────────────
// RABATTKODER
// ─────────────────────────────────────────────────────────────────────────────
// To slags koder, og ingen av dem krever innlogging:
//
//   saldo   Gavekort. Et beløp som brukes ned. Er koden på 500 kr og kjøpet
//           300 kr, står 200 kr igjen til neste gang — av seg selv, ikke ved
//           at noen retter koden for hånd. Saldoen er summen av bevegelsene,
//           akkurat som kreditten, så det står hvor pengene gikk.
//   prosent Kampanje. En prosent av kortene (ikke frakten). Kan ha siste dag
//           og et tak på hvor mange ordrer som kan bruke den.
//
// Én kode per ordre. Gavekortet brukes før kreditten, og begge før kortet.

export class KodeFeil extends Error {
  constructor(public status: number, melding: string) {
    super(melding);
  }
}

export type Kode = {
  id: number;
  kode: string;
  type: "saldo" | "prosent";
  prosent: number | null;
  gyldig_til: string | null;
  maks_bruk: number | null;
  aktiv: boolean;
  merknad: string | null;
  created_at: string;
  saldo_ore: number; // bare saldo-koder
  holdt_ore: number; // holdt av i åpne kasser
  brukt: number; // antall betalte ordrer
  holdt: number; // antall åpne kasser
};

export const normaliserKode = (k: unknown) => String(k ?? "").toUpperCase().replace(/\s+/g, "").slice(0, 40);

const nå = () => new Date().toISOString();
const iDag = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Oslo" }).format(new Date());

const VALG = `
  SELECT r.*,
         (SELECT COALESCE(SUM(b.ore), 0) FROM rabattkode_bevegelser b WHERE b.kode_id = r.id) AS saldo_ore,
         (SELECT COALESCE(SUM(o.gavekort_ore), 0) FROM salgsordrer o WHERE o.rabattkode = r.kode AND o.status = 'apen') AS holdt_ore,
         (SELECT COUNT(*) FROM salgsordrer o WHERE o.rabattkode = r.kode AND o.status IN ('betalt','pakket','sendt')) AS brukt,
         (SELECT COUNT(*) FROM salgsordrer o WHERE o.rabattkode = r.kode AND o.status = 'apen') AS holdt
    FROM rabattkoder r`;

function tilKode(r: any): Kode {
  return {
    id: Number(r.id),
    kode: String(r.kode),
    type: r.type === "prosent" ? "prosent" : "saldo",
    prosent: r.prosent == null ? null : Number(r.prosent),
    gyldig_til: r.gyldig_til ? String(r.gyldig_til) : null,
    maks_bruk: r.maks_bruk == null ? null : Number(r.maks_bruk),
    aktiv: !!Number(r.aktiv),
    merknad: r.merknad ? String(r.merknad) : null,
    created_at: String(r.created_at),
    saldo_ore: Number(r.saldo_ore || 0),
    holdt_ore: Number(r.holdt_ore || 0),
    brukt: Number(r.brukt || 0),
    holdt: Number(r.holdt || 0),
  };
}

export async function finnKode(kode: string, kjører: { execute: (q: any) => Promise<any> } = db()): Promise<Kode | null> {
  const r = await kjører.execute({ sql: `${VALG} WHERE r.kode = ?`, args: [normaliserKode(kode)] });
  return r.rows[0] ? tilKode(r.rows[0]) : null;
}

// Det kassen får vite om en kode. Samme feilmelding for ukjent og
// deaktivert kode, så ingen kan prøve seg fram til hvilke koder som finnes.
export async function sjekkKode(kode: string, kjører?: { execute: (q: any) => Promise<any> }) {
  const k = await finnKode(kode, kjører);
  if (!k || !k.aktiv) throw new KodeFeil(404, "Koden finnes ikke, eller er ikke gyldig lenger.");
  if (k.gyldig_til && iDag() > k.gyldig_til) throw new KodeFeil(410, "Koden er utløpt.");
  if (k.type === "prosent") {
    if (k.maks_bruk != null && k.brukt + k.holdt >= k.maks_bruk) throw new KodeFeil(410, "Koden er brukt opp.");
    return { kode: k.kode, type: "prosent" as const, prosent: Number(k.prosent) };
  }
  const tilgjengelig = Math.max(0, k.saldo_ore - k.holdt_ore);
  if (tilgjengelig <= 0) {
    throw new KodeFeil(410, k.holdt_ore > 0 ? "Koden er i bruk i en annen kasse akkurat nå." : "Koden er brukt opp.");
  }
  return { kode: k.kode, type: "saldo" as const, tilgjengelig_ore: tilgjengelig };
}

// ── admin ───────────────────────────────────────────────────────────────────
export async function alleKoder(): Promise<Kode[]> {
  const r = await db().execute(`${VALG} ORDER BY r.aktiv DESC, r.created_at DESC`);
  return r.rows.map(tilKode);
}

export async function bevegelser(id: number) {
  const r = await db().execute({
    sql: "SELECT * FROM rabattkode_bevegelser WHERE kode_id = ? ORDER BY created_at DESC, id DESC",
    args: [id],
  });
  return r.rows;
}

// Lett å lese opp og skrive av: ingen 0/O eller 1/I.
export function lagKode(lengde = 8): string {
  const tegn = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const b = randomBytes(lengde);
  return Array.from(b, (x) => tegn[x % tegn.length]).join("");
}

export async function opprettKode(inn: {
  kode?: string;
  type: string;
  prosent?: number;
  saldo_ore?: number;
  gyldig_til?: string | null;
  maks_bruk?: number | null;
  merknad?: string | null;
}): Promise<Kode> {
  const kode = normaliserKode(inn.kode) || lagKode();
  if (!/^[A-Z0-9_-]{3,40}$/.test(kode)) throw new KodeFeil(400, "Koden kan bare ha bokstaver A–Z, tall, - og _, og minst 3 tegn.");
  const type = inn.type === "prosent" ? "prosent" : "saldo";
  const gyldig = String(inn.gyldig_til || "").trim() || null;
  if (gyldig && !/^\d{4}-\d{2}-\d{2}$/.test(gyldig)) throw new KodeFeil(400, "Siste dag må være på formen ÅÅÅÅ-MM-DD.");
  let prosent: number | null = null;
  let maks: number | null = null;
  if (type === "prosent") {
    prosent = Math.round(Number(inn.prosent));
    if (!(prosent >= 1 && prosent <= 100)) throw new KodeFeil(400, "Prosenten må være mellom 1 og 100.");
    maks = inn.maks_bruk == null || String(inn.maks_bruk) === "" ? null : Math.max(1, Math.round(Number(inn.maks_bruk)));
  }
  const saldo = Math.round(Number(inn.saldo_ore || 0));
  if (type === "saldo" && !(saldo > 0)) throw new KodeFeil(400, "Gavekortet må ha et beløp.");
  if (await finnKode(kode)) throw new KodeFeil(409, `Koden ${kode} finnes allerede.`);
  const tid = nå();
  const r = await db().execute({
    sql: `INSERT INTO rabattkoder (kode, type, prosent, gyldig_til, maks_bruk, merknad, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    args: [kode, type, prosent, gyldig, maks, String(inn.merknad || "").trim().slice(0, 200) || null, tid],
  });
  if (type === "saldo") {
    await db().execute({
      sql: "INSERT INTO rabattkode_bevegelser (kode_id, ore, grunn, notat, created_at) VALUES (?, ?, 'opprettet', ?, ?)",
      args: [Number(r.rows[0].id), saldo, "Opprettet", tid],
    });
  }
  return (await finnKode(kode))!;
}

// Endre saldo på et gavekort: legg til et beløp, eller sett saldoen. Begge
// blir en linje, som i kredittboka.
export async function justerSaldo(id: number, inn: { ore?: number; saldo_ore?: number; notat?: string }) {
  const r = await db().execute({ sql: `${VALG} WHERE r.id = ?`, args: [id] });
  if (!r.rows[0]) throw new KodeFeil(404, "Fant ikke koden.");
  const k = tilKode(r.rows[0]);
  if (k.type !== "saldo") throw new KodeFeil(400, "Bare gavekort har saldo.");
  const endring = inn.saldo_ore != null ? Math.round(Number(inn.saldo_ore)) - k.saldo_ore : Math.round(Number(inn.ore || 0));
  if (!endring) return k;
  await db().execute({
    sql: "INSERT INTO rabattkode_bevegelser (kode_id, ore, grunn, notat, created_at) VALUES (?, ?, 'manuell', ?, ?)",
    args: [id, endring, String(inn.notat || "").trim().slice(0, 200) || null, nå()],
  });
  return (await finnKode(k.kode))!;
}

export async function endreKode(id: number, inn: { aktiv?: boolean; gyldig_til?: string | null; maks_bruk?: number | null; merknad?: string | null }) {
  const sett: string[] = [];
  const args: any[] = [];
  if ("aktiv" in inn) { sett.push("aktiv = ?"); args.push(inn.aktiv ? 1 : 0); }
  if ("gyldig_til" in inn) {
    const g = String(inn.gyldig_til || "").trim() || null;
    if (g && !/^\d{4}-\d{2}-\d{2}$/.test(g)) throw new KodeFeil(400, "Siste dag må være på formen ÅÅÅÅ-MM-DD.");
    sett.push("gyldig_til = ?"); args.push(g);
  }
  if ("maks_bruk" in inn) {
    sett.push("maks_bruk = ?");
    args.push(inn.maks_bruk == null || String(inn.maks_bruk) === "" ? null : Math.max(1, Math.round(Number(inn.maks_bruk))));
  }
  if ("merknad" in inn) { sett.push("merknad = ?"); args.push(String(inn.merknad || "").trim().slice(0, 200) || null); }
  if (!sett.length) return;
  await db().execute({ sql: `UPDATE rabattkoder SET ${sett.join(", ")} WHERE id = ?`, args: [...args, id] });
}

// Lim inn mange gavekort på én gang, for eksempel kodene fra Mystore. Én kode
// per linje: «KODE beløp merknad», skilt med mellomrom, semikolon eller tab.
// Beløpet i kroner. Koder som finnes fra før, hoppes over.
export async function importerKoder(tekst: string) {
  const resultat = { nye: 0, finnes: 0, feil: [] as string[] };
  for (const linje of String(tekst || "").split(/\r?\n/)) {
    const l = linje.trim();
    if (!l) continue;
    const m = l.match(/^([A-Za-z0-9_-]{3,40})[\s;,\t]+(-?\d+(?:[.,]\d{1,2})?)\s*(?:kr)?(?:[\s;,\t]+(.*))?$/i);
    if (!m) { resultat.feil.push(l); continue; }
    const kode = normaliserKode(m[1]);
    if (await finnKode(kode)) { resultat.finnes++; continue; }
    const ore = Math.round(parseFloat(m[2].replace(",", ".")) * 100);
    if (!(ore > 0)) { resultat.feil.push(l); continue; }
    await opprettKode({ kode, type: "saldo", saldo_ore: ore, merknad: (m[3] || "").trim() || "Fra Mystore" });
    resultat.nye++;
  }
  return resultat;
}
