import { db } from "./db.js";
import { butikklagerSql } from "./lager.js";
import { settStørrelser } from "./produkter.js";

// ─────────────────────────────────────────────────────────────────────────────
// KOMPLETTE SETT
// ─────────────────────────────────────────────────────────────────────────────
// Hvor nær du er et komplett sett, for hvert sett du har noe fra. Et sett er
// hovedsettet: samlernummer 1 til settets størrelse, uten tokens og
// serienummererte. Størrelsen er den du har satt selv under Beholdning
// («Grunnsett til»), ellers den trykte størrelsen fra Scryfall, ellers den
// lengste sammenhengende rekka av numre i katalogen.
//
// Vanlig og foil er hvert sitt sett: et nummer er dekket når du har minst
// ett eksemplar av det i den finishen, i hvilken som helst tilstand. Numre
// som ikke finnes i finishen (et foil-only kort i vanlig, eller omvendt),
// teller ikke med i settets størrelse for den finishen. «alle» slår sammen:
// et nummer er dekket av hvilken som helst finish. «7†» (Play Boost) teller for 7 — det
// er samme kort. «Komplette» er hvor mange hele sett du kan sette sammen:
// det minste antallet du har av noe nummer.

export type SettFullføring = {
  set_code: string;
  set_name: string;
  released_at: string | null;
  størrelse: number;
  har: number;
  mangler: number;
  prosent: number;
  komplette: number;
};

export type ManglendeKort = {
  id: string;
  nummer: string;
  name: string;
  rarity: string | null;
};

type Kort = {
  id: string; set_code: string; collector_number: string; name: string; rarity: string | null;
  nonfoil: boolean; foil: boolean;
};
export type Finish = "nonfoil" | "foil" | "alle";
export function tilFinish(x: unknown): Finish {
  return x === "foil" ? "foil" : x === "alle" ? "alle" : "nonfoil";
}
const finnes = (k: Kort, f: Finish) => (f === "alle" ? true : f === "foil" ? k.foil : k.nonfoil);
const finishSql = (f: Finish) => (f === "alle" ? "" : ` WHERE finish = '${f}'`);

const BIT = 60;

async function beholdningPerKort(f: Finish): Promise<Map<string, number>> {
  const r = await db().execute(
    `SELECT card_id, SUM(antall) AS n FROM (${butikklagerSql()})${finishSql(f)} GROUP BY card_id HAVING n > 0`
  );
  return new Map((r.rows as any[]).map((x) => [String(x.card_id), Number(x.n)]));
}

async function størrelser(koder: string[]): Promise<Map<string, number>> {
  const ut = new Map<string, number>();
  const trenger: string[] = [];
  for (let i = 0; i < koder.length; i += 400) {
    const del = koder.slice(i, i + 400);
    const r = await db().execute({
      sql: `SELECT s.code, s.printed_size, r.grunnsett_til
              FROM sets s LEFT JOIN set_rules r ON r.set_code = s.code
             WHERE s.code IN (${del.map(() => "?").join(",")})`,
      args: del,
    });
    for (const x of r.rows as any[]) {
      const n = Number(x.grunnsett_til || 0) || Number(x.printed_size || 0);
      if (n > 0) ut.set(String(x.code), n);
      else trenger.push(String(x.code));
    }
  }
  for (let i = 0; i < trenger.length; i += 200) {
    for (const [k, n] of await settStørrelser(trenger.slice(i, i + 200))) ut.set(k, n);
  }
  return ut;
}

// Kortene i hovedsettet, gruppert på nummer. Hentes noen sett om gangen —
// én spørring over hele katalogen er for tung for Turso.
async function hovedsett(koder: string[], størrelse: Map<string, number>) {
  const ut = new Map<string, Map<number, Kort[]>>();
  for (let i = 0; i < koder.length; i += BIT) {
    const del = koder.slice(i, i + BIT);
    const r = await db().execute({
      sql: `SELECT id, set_code, collector_number, name, rarity, has_nonfoil, has_foil FROM cards
             WHERE set_code IN (${del.map(() => "?").join(",")})
               AND er_token = 0 AND er_serialized = 0`,
      args: del,
    });
    for (const x of r.rows as any[]) {
      const kode = String(x.set_code);
      const til = størrelse.get(kode) || 0;
      const cn = String(x.collector_number || "");
      const n = parseInt(cn, 10);
      if (!Number.isFinite(n) || n < 1 || n > til) continue;
      // Bare rene tall og tall med ett suffikstegn («7†», «120a»). «12-A» og
      // lignende er egne serier, ikke hovedsettet.
      if (!/^\d+[^\d]?$/.test(cn)) continue;
      let s = ut.get(kode);
      if (!s) ut.set(kode, (s = new Map()));
      let liste = s.get(n);
      if (!liste) s.set(n, (liste = []));
      liste.push({
        id: String(x.id), set_code: kode, collector_number: cn, name: String(x.name),
        rarity: x.rarity ? String(x.rarity) : null,
        nonfoil: !!Number(x.has_nonfoil), foil: !!Number(x.has_foil),
      });
    }
  }
  return ut;
}

export async function komplettSett(finish: Finish = "nonfoil"): Promise<{ sett: SettFullføring[] }> {
  const lager = await beholdningPerKort(finish);
  if (!lager.size) return { sett: [] };

  // Hvilke sett du har noe fra.
  const ider = [...lager.keys()];
  const koderSett = new Set<string>();
  for (let i = 0; i < ider.length; i += 400) {
    const del = ider.slice(i, i + 400);
    const r = await db().execute({
      sql: `SELECT DISTINCT set_code FROM cards WHERE id IN (${del.map(() => "?").join(",")})`,
      args: del,
    });
    for (const x of r.rows as any[]) if (x.set_code) koderSett.add(String(x.set_code));
  }
  const koder = [...koderSett];

  const størrelse = await størrelser(koder);
  const kort = await hovedsett(koder.filter((k) => størrelse.has(k)), størrelse);

  const navn = new Map<string, { set_name: string; released_at: string | null }>();
  for (let i = 0; i < koder.length; i += 400) {
    const del = koder.slice(i, i + 400);
    const r = await db().execute({
      sql: `SELECT code, COALESCE(visningsnavn, name) AS set_name, released_at FROM sets
             WHERE code IN (${del.map(() => "?").join(",")})`,
      args: del,
    });
    for (const x of r.rows as any[])
      navn.set(String(x.code), { set_name: String(x.set_name || x.code), released_at: x.released_at ? String(x.released_at) : null });
  }

  const sett: SettFullføring[] = [];
  for (const [kode, numre] of kort) {
    const til = størrelse.get(kode)!;
    let har = 0;
    let størrelseF = 0;
    let komplette = Infinity;
    for (let n = 1; n <= til; n++) {
      const liste = (numre.get(n) || []).filter((k) => finnes(k, finish));
      // Numre katalogen ikke har kort for, teller med (hullet skal synes).
      // Numre som finnes, men ikke i denne finishen, hører ikke til settet.
      if (!liste.length && numre.get(n)?.length) continue;
      størrelseF++;
      const antall = liste.reduce((s, k) => s + (lager.get(k.id) || 0), 0);
      if (antall > 0) har++;
      komplette = Math.min(komplette, antall);
    }
    if (!har || !størrelseF) continue;
    sett.push({
      set_code: kode,
      set_name: navn.get(kode)?.set_name || kode,
      released_at: navn.get(kode)?.released_at || null,
      størrelse: størrelseF,
      har,
      mangler: størrelseF - har,
      prosent: Math.floor((har / størrelseF) * 1000) / 10,
      komplette: Number.isFinite(komplette) ? komplette : 0,
    });
  }
  sett.sort((a, b) => b.prosent - a.prosent || a.mangler - b.mangler || a.set_name.localeCompare(b.set_name, "nb"));
  return { sett };
}

// Kortene du mangler i ett sett. Numre katalogen ikke har noe kort for,
// tas med uten navn, så hullet synes.
export async function manglerISett(kode: string, finish: Finish = "nonfoil"): Promise<{ størrelse: number; kort: ManglendeKort[] }> {
  const størrelse = await størrelser([kode]);
  const til = størrelse.get(kode) || 0;
  if (!til) return { størrelse: 0, kort: [] };
  const numre = (await hovedsett([kode], størrelse)).get(kode) || new Map<number, Kort[]>();
  const alleIder = [...numre.values()].flat().map((k) => k.id);
  const lager = new Map<string, number>();
  for (let i = 0; i < alleIder.length; i += 400) {
    const del = alleIder.slice(i, i + 400);
    const r = await db().execute({
      sql: `SELECT card_id, SUM(antall) AS n FROM (${butikklagerSql()})${finishSql(finish)}
             ${finish === "alle" ? "WHERE" : "AND"} card_id IN (${del.map(() => "?").join(",")})
             GROUP BY card_id HAVING n > 0`,
      args: del,
    });
    for (const x of r.rows as any[]) lager.set(String(x.card_id), Number(x.n));
  }
  const kort: ManglendeKort[] = [];
  let størrelseF = 0;
  for (let n = 1; n <= til; n++) {
    const liste = (numre.get(n) || []).filter((k) => finnes(k, finish));
    if (!liste.length && numre.get(n)?.length) continue;
    størrelseF++;
    if (liste.some((k) => (lager.get(k.id) || 0) > 0)) continue;
    // Korteste nummer er hovedutgaven: «7» foran «7†».
    const k = [...liste].sort((a, b) => a.collector_number.length - b.collector_number.length)[0];
    kort.push(k ? { id: k.id, nummer: k.collector_number, name: k.name, rarity: k.rarity } : { id: "", nummer: String(n), name: "", rarity: null });
  }
  return { størrelse: størrelseF, kort };
}
