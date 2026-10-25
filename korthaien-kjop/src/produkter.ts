import { db } from "./db.js";

// ─────────────────────────────────────────────────────────────────────────────
// EGNE PRODUKTER
// ─────────────────────────────────────────────────────────────────────────────
// Sealed og komplette sett — det du selger som ikke er et enkeltkort.
//
// De lever ved siden av kortene, ikke inni dem. Alt i cards kommer fra
// Scryfall og blir overskrevet av prisimporten hver natt; et produkt har
// hverken samlernummer, raritet eller en Scryfall-pris å importere. Skillet
// er med vilje, og det er det som gjør at kjøpslista slipper å kjenne til
// boosterbokser.
//
// Én pris per produkt. Et kort har NM og EX til ulik pris fordi tilstanden
// er en egenskap ved eksemplaret; en forseglet boks er en forseglet boks.

export const TYPER = ["sealed", "komplettsett"] as const;
export type Produkttype = (typeof TYPER)[number];

export const TYPENAVN: Record<Produkttype, string> = {
  sealed: "Sealed",
  komplettsett: "Komplette sett",
};

export type Produkt = {
  id: number;
  type: Produkttype;
  navn: string;
  beskrivelse: string | null;
  pris_ore: number;
  antall: number;
  bilde_url: string | null;
  set_code: string | null;
  foil: boolean;
  // Fra settet, til bildet som tegnes for komplette sett.
  set_navn: string | null;
  set_antall: number | null;
  // Overstyrt antall kort (komplette sett). Null betyr «regn ut».
  antall_kort: number | null;
  sortering: number;
  aktiv: number;
};

const rad = (x: any): Produkt => ({
  id: Number(x.id),
  type: String(x.type) as Produkttype,
  navn: String(x.navn),
  beskrivelse: x.beskrivelse ? String(x.beskrivelse) : null,
  pris_ore: Number(x.pris_ore),
  antall: Number(x.antall || 0),
  bilde_url: x.bilde_url ? String(x.bilde_url) : null,
  set_code: x.set_code ? String(x.set_code) : null,
  foil: !!Number(x.foil || 0),
  set_navn: x.set_navn ? String(x.set_navn) : null,
  set_antall: x.set_antall != null ? Number(x.set_antall) : null,
  antall_kort: x.antall_kort != null ? Number(x.antall_kort) : null,
  sortering: Number(x.sortering || 0),
  aktiv: Number(x.aktiv),
});

export function erType(s: unknown): s is Produkttype {
  return TYPER.includes(String(s) as Produkttype);
}

// Butikken ber om `barePåLager`, admin ber ikke. Det er samme regel som
// kortene følger: kunden ser det som finnes, du ser alt du har lagt inn.
export async function hentProdukter(
  opts: { type?: Produkttype; set_code?: string; barePåLager?: boolean; bareAktive?: boolean } = {}
): Promise<Produkt[]> {
  const hvor: string[] = [];
  const args: any[] = [];
  if (opts.type) {
    hvor.push("p.type = ?");
    args.push(opts.type);
  }
  if (opts.set_code) {
    hvor.push("p.set_code = ?");
    args.push(String(opts.set_code).toLowerCase());
  }
  if (opts.bareAktive !== false) hvor.push("p.aktiv = 1");
  if (opts.barePåLager) hvor.push("p.antall > 0");

  const r = await db().execute({
    sql: `SELECT p.*, COALESCE(s.visningsnavn, s.name) AS set_navn, s.printed_size, s.card_count
            FROM produkter p LEFT JOIN sets s ON s.code = p.set_code
           ${hvor.length ? "WHERE " + hvor.join(" AND ") : ""}
           ORDER BY p.sortering, p.navn`,
    args,
  });
  const koder = [...new Set((r.rows as any[]).filter((x) => x.set_code && !x.printed_size).map((x) => String(x.set_code)))];
  const utregnet = await settStørrelser(koder);
  return (r.rows as any[]).map((x) =>
    rad({
      ...x,
      set_antall:
        (Number(x.antall_kort) || 0) ||
        (Number(x.printed_size) || 0) ||
        utregnet.get(String(x.set_code)) ||
        (Number(x.card_count) || null),
    })
  );
}

// Hvor mange kort selve settet har, uten showcase, borderless og andre
// varianter. Scryfall oppgir det (printed_size) bare for noen sett. Ellers:
// hovedsettet er nummerert 1, 2, 3 … uten hull i vanlig ramme, og
// variantene kommer etter. Vi teller oss oppover til første hull.
export async function settStørrelser(koder: string[]): Promise<Map<string, number>> {
  const ut = new Map<string, number>();
  if (!koder.length) return ut;
  const r = await db().execute({
    sql: `SELECT set_code, collector_number FROM cards
           WHERE set_code IN (${koder.map(() => "?").join(",")})
             AND variant = 'vanlig' AND er_token = 0
             AND collector_number NOT GLOB '*[^0-9]*' AND collector_number <> ''`,
    args: koder,
  });
  const tall = new Map<string, Set<number>>();
  for (const x of r.rows as any[]) {
    const k = String(x.set_code);
    if (!tall.has(k)) tall.set(k, new Set());
    tall.get(k)!.add(Number(x.collector_number));
  }
  const totalt = await db().execute({
    sql: `SELECT code, card_count FROM sets WHERE code IN (${koder.map(() => "?").join(",")})`,
    args: koder,
  });
  const kortTotalt = new Map((totalt.rows as any[]).map((x) => [String(x.code), Number(x.card_count || 0)]));
  for (const [k, s] of tall) {
    let n = 0;
    while (s.has(n + 1)) n++;
    // Hovedsettet er alltid en god del av settet — ofte halvparten eller mer.
    // Er rekka mye kortere, mangler kortene i katalogen, og tallet er ikke
    // til å stole på.
    const alle = kortTotalt.get(k) || 0;
    if (n > 0 && (!alle || n >= alle * 0.3)) ut.set(k, n);
  }
  return ut;
}

export async function hentProdukt(id: number): Promise<Produkt | null> {
  const r = await db().execute({ sql: "SELECT * FROM produkter WHERE id = ?", args: [id] });
  return r.rows.length ? rad(r.rows[0]) : null;
}

// Hvor mange av hver type som finnes på lager. Menyen i butikken skal ikke
// lenke til en tom side, og forsiden skal ikke vise en seksjon uten varer.
export async function antallPerType(): Promise<Record<string, number>> {
  const r = await db().execute(
    `SELECT type, COUNT(*) AS n FROM produkter
      WHERE aktiv = 1 AND antall > 0 GROUP BY type`
  );
  const ut: Record<string, number> = {};
  for (const t of TYPER) ut[t] = 0;
  for (const x of r.rows as any[]) ut[String(x.type)] = Number(x.n || 0);
  return ut;
}

export type NyttProdukt = {
  type: Produkttype;
  navn: string;
  pris_ore: number;
  antall?: number;
  beskrivelse?: string | null;
  bilde_url?: string | null;
  set_code?: string | null;
  foil?: boolean;
  antall_kort?: number | null;
  sortering?: number;
};

export async function leggTilProdukt(p: NyttProdukt): Promise<number> {
  const navn = String(p.navn || "").trim();
  if (!navn) throw new Error("Produktet må ha et navn.");
  if (!erType(p.type)) throw new Error("Ukjent produkttype.");

  const nå = new Date().toISOString();
  const r = await db().execute({
    sql: `INSERT INTO produkter
            (type, navn, beskrivelse, pris_ore, antall, bilde_url, set_code,
             sortering, aktiv, created_at, updated_at, foil, antall_kort)
          VALUES (?,?,?,?,?,?,?,?,1,?,?,?,?)`,
    args: [
      p.type,
      navn,
      tomTilNull(p.beskrivelse),
      heltall(p.pris_ore),
      Math.max(0, heltall(p.antall ?? 0)),
      tomTilNull(p.bilde_url),
      tomTilNull(p.set_code)?.toLowerCase() ?? null,
      heltall(p.sortering ?? 0),
      nå,
      nå,
      p.foil ? 1 : 0,
      Number(p.antall_kort) > 0 ? heltall(p.antall_kort) : null,
    ],
  });
  return Number(r.lastInsertRowid);
}

export async function endreProdukt(id: number, p: Partial<NyttProdukt & { aktiv: boolean }>): Promise<void> {
  const nå = await hentProdukt(id);
  if (!nå) throw new Error("Fant ikke produktet.");
  if (p.type !== undefined && !erType(p.type)) throw new Error("Ukjent produkttype.");

  const navn = p.navn === undefined ? nå.navn : String(p.navn).trim();
  if (!navn) throw new Error("Produktet må ha et navn.");

  await db().execute({
    sql: `UPDATE produkter
             SET type = ?, navn = ?, beskrivelse = ?, pris_ore = ?, antall = ?,
                 bilde_url = ?, set_code = ?, sortering = ?, aktiv = ?,
                 updated_at = ?, foil = ?, antall_kort = ?
           WHERE id = ?`,
    args: [
      p.type ?? nå.type,
      navn,
      p.beskrivelse === undefined ? nå.beskrivelse : tomTilNull(p.beskrivelse),
      p.pris_ore === undefined ? nå.pris_ore : heltall(p.pris_ore),
      p.antall === undefined ? nå.antall : Math.max(0, heltall(p.antall)),
      p.bilde_url === undefined ? nå.bilde_url : tomTilNull(p.bilde_url),
      p.set_code === undefined ? nå.set_code : tomTilNull(p.set_code)?.toLowerCase() ?? null,
      p.sortering === undefined ? nå.sortering : heltall(p.sortering),
      p.aktiv === undefined ? nå.aktiv : p.aktiv ? 1 : 0,
      new Date().toISOString(),
      p.foil === undefined ? (nå.foil ? 1 : 0) : p.foil ? 1 : 0,
      p.antall_kort === undefined ? nå.antall_kort : Number(p.antall_kort) > 0 ? heltall(p.antall_kort) : null,
      id,
    ],
  });
}

// Som fraktalternativene: slås av, ikke slettes. Et produkt som har stått på
// en ordre skal fortsatt kunne vises på den.
export async function slåAvProdukt(id: number): Promise<void> {
  await db().execute({
    sql: "UPDATE produkter SET aktiv = 0, updated_at = ? WHERE id = ?",
    args: [new Date().toISOString(), id],
  });
}

// Trekk fra lageret når noe selges. Vilkåret står i setningen og ikke i et
// if-ledd over: to kunder som trykker samtidig skal ikke kunne kjøpe det
// samme siste eksemplaret.
export async function trekkFraLager(id: number, antall: number): Promise<boolean> {
  const n = heltall(antall);
  if (n <= 0) return true;
  const r = await db().execute({
    sql: `UPDATE produkter SET antall = antall - ?, updated_at = ?
           WHERE id = ? AND antall >= ?`,
    args: [n, new Date().toISOString(), id, n],
  });
  return Number(r.rowsAffected) > 0;
}

const heltall = (v: unknown) => Math.round(Number(v) || 0);
const tomTilNull = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v).trim();
  return s === "" ? null : s;
};
