import { db, normaliser } from "./db.js";
// Disse tre pakkene er CommonJS og eksporterer funksjonen som selve modulen,
// så navngitt import virker ikke under ESM.
import chain from "stream-chain";
import parser from "stream-json";
import streamArray from "stream-json/streamers/StreamArray.js";
import { Readable } from "node:stream";

// ─────────────────────────────────────────────────────────────────────────────
// SCRYFALL-IMPORT
// ─────────────────────────────────────────────────────────────────────────────
// Publikum på siden betyr at vi ikke kan slå opp priser live per kort slik
// KARDEX gjør. Scryfall tilbyr bulk-nedlastinger nettopp for dette. Filen er
// stor (flere hundre MB), så den strømmes gjennom en JSON-parser og skrives i
// bolker. Ingenting mellomlagres på disk, og minnebruken holder seg flat —
// det er nødvendig på Render, der du ikke har mye å gå på.

// @types-pakkene beskriver disse som klasser, mens kjøretiden eksporterer
// fabrikkfunksjoner. Vi låser formen her i stedet for å strø casts utover.
const kjede = chain as unknown as (ledd: any[]) => AsyncIterable<any>;
const jsonParser = parser as unknown as () => any;
const jsonArray = streamArray as unknown as () => any;

const BULK_INDEKS = "https://api.scryfall.com/bulk-data";
const BOLK = 500;

type Rå = {
  id: string;
  oracle_id?: string;
  name: string;
  set: string;
  set_name?: string;
  collector_number?: string;
  rarity?: string;
  lang?: string;
  digital?: boolean;
  games?: string[];
  finishes?: string[];
  released_at?: string;
  prices?: { usd?: string | null; usd_foil?: string | null };
  image_uris?: { normal?: string; small?: string };
  card_faces?: { image_uris?: { normal?: string; small?: string } }[];
};

export async function importerScryfall(logg: (s: string) => void = console.log): Promise<{ kort: number; sett: number }> {
  logg("Henter bulk-indeks fra Scryfall…");
  const indeks = await fetch(BULK_INDEKS, { headers: { "User-Agent": "KorthaienKjop/1.0" } });
  if (!indeks.ok) throw new Error(`Scryfall svarte ${indeks.status} på bulk-indeksen`);
  const liste = await indeks.json();
  // default_cards har én rad per trykk, som er det vi trenger for å skille
  // utgaver. oracle_cards har bare ett kort per navn og duger ikke her.
  const valgt = (liste.data || []).find((d: any) => d.type === "default_cards");
  if (!valgt?.download_uri) throw new Error("Fant ikke default_cards i bulk-indeksen");

  await importerSett(logg);

  logg(`Laster ned ${valgt.download_uri} (${Math.round((valgt.size || 0) / 1e6)} MB)…`);
  const svar = await fetch(valgt.download_uri, { headers: { "User-Agent": "KorthaienKjop/1.0" } });
  if (!svar.ok || !svar.body) throw new Error(`Nedlasting feilet: ${svar.status}`);

  const strøm = kjede([Readable.fromWeb(svar.body as any), jsonParser(), jsonArray()]);

  let bolk: Rå[] = [];
  let antall = 0;
  let hoppet = 0;

  for await (const { value } of strøm) {
    const k = value as Rå;
    if (!brukbart(k)) {
      hoppet++;
      continue;
    }
    bolk.push(k);
    if (bolk.length >= BOLK) {
      await skrivBolk(bolk);
      antall += bolk.length;
      bolk = [];
      if (antall % 20000 === 0) logg(`  ${antall} kort importert…`);
    }
  }
  if (bolk.length) {
    await skrivBolk(bolk);
    antall += bolk.length;
  }

  const sett = await db().execute("SELECT COUNT(*) AS n FROM sets");
  logg(`Ferdig: ${antall} kort importert, ${hoppet} hoppet over.`);
  return { kort: antall, sett: Number(sett.rows[0]?.n || 0) };
}

// Digitale kort og fremmedspråklige utgaver er ikke varer du kjøper over
// disk, og de ville blåst opp katalogen til liten nytte.
function brukbart(k: Rå): boolean {
  if (!k?.id || !k.name || !k.set) return false;
  if (k.digital) return false;
  if (k.lang && k.lang !== "en") return false;
  if (k.games && !k.games.includes("paper")) return false;
  return true;
}

async function skrivBolk(bolk: Rå[]): Promise<void> {
  const setninger = bolk.map((k) => {
    const finishes = k.finishes || ["nonfoil"];
    const bilde =
      k.image_uris?.normal || k.card_faces?.[0]?.image_uris?.normal || k.image_uris?.small || null;
    return {
      sql: `INSERT INTO cards
              (id, oracle_id, name, name_norm, set_code, collector_number, rarity,
               usd, usd_foil, has_nonfoil, has_foil, image_uri, released_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              usd = excluded.usd, usd_foil = excluded.usd_foil,
              image_uri = excluded.image_uri, rarity = excluded.rarity`,
      args: [
        k.id,
        k.oracle_id || k.id,
        k.name,
        normaliser(k.name),
        k.set.toLowerCase(),
        k.collector_number || null,
        (k.rarity || "").toLowerCase() || null,
        tall(k.prices?.usd),
        tall(k.prices?.usd_foil),
        finishes.includes("nonfoil") ? 1 : 0,
        finishes.includes("foil") || finishes.includes("etched") ? 1 : 0,
        bilde,
        k.released_at || null,
      ],
    };
  });
  await db().batch(setninger, "write");
}

async function importerSett(logg: (s: string) => void): Promise<void> {
  const r = await fetch("https://api.scryfall.com/sets", { headers: { "User-Agent": "KorthaienKjop/1.0" } });
  if (!r.ok) throw new Error(`Kunne ikke hente settlista: ${r.status}`);
  const data = await r.json();
  const sett = (data.data || []).filter((s: any) => s.code && s.name && !s.digital);
  await db().batch(
    sett.map((s: any) => ({
      sql: `INSERT INTO sets (code, name, released_at, card_count) VALUES (?, ?, ?, ?)
            ON CONFLICT(code) DO UPDATE SET name = excluded.name,
              released_at = excluded.released_at, card_count = excluded.card_count`,
      args: [String(s.code).toLowerCase(), s.name, s.released_at || null, s.card_count || 0],
    })),
    "write"
  );
  logg(`${sett.length} sett importert.`);
}

function tall(v: unknown): number | null {
  const n = parseFloat(String(v ?? ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}
