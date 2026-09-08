import { db, normaliser } from "./db.js";
import { variantFraScryfall } from "./varianter.js";
import { Readable } from "node:stream";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";

// ─────────────────────────────────────────────────────────────────────────────
// SCRYFALL-IMPORT
// ─────────────────────────────────────────────────────────────────────────────
// Publikum på siden betyr at vi ikke kan slå opp priser live per kort slik
// KARDEX gjør. Scryfall tilbyr bulk-nedlastinger nettopp for dette. Filen er
// stor (flere hundre MB), så den strømmes gjennom en JSON-parser og skrives i
// bolker. Ingenting mellomlagres på disk, og minnebruken holder seg flat —
// det er nødvendig på Render, der du ikke har mye å gå på.

// Scryfall krever BÅDE User-Agent og Accept. Mangler Accept, svarer de 200
// med et innhold som ikke inneholder bulkfilene i det hele tatt.
const HODER = { "User-Agent": "KorthaienKjop/1.0", Accept: "application/json" };
// Vi henter filen på type direkte i stedet for å lete i lista, så importen
// ikke er avhengig av hvilke typer Scryfall legger til senere.
const BULK_FIL = "https://api.scryfall.com/bulk-data/default-cards";
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
  border_color?: string;
  frame_effects?: string[];
  full_art?: boolean;
  image_uris?: { normal?: string; small?: string };
  card_faces?: { image_uris?: { normal?: string; small?: string } }[];
};

export async function importerSett(logg: (s: string) => void = console.log) {
  await importerSettliste(logg);
}

export async function importerScryfall(logg: (s: string) => void = console.log): Promise<{ kort: number; sett: number }> {
  logg("Henter bulk-indeks fra Scryfall…");
  // default-cards har én rad per trykk, som er det vi trenger for å skille
  // utgaver. oracle-cards har bare ett kort per navn og duger ikke her.
  const indeks = await fetch(BULK_FIL, { headers: HODER });
  if (!indeks.ok) throw new Error(`Scryfall svarte ${indeks.status} på bulk-indeksen`);
  const valgt: any = await indeks.json();
  // download_uri har forsvunnet fra svaret. ?format=file på samme adresse er
  // den dokumenterte veien til selve filen, og virker uansett om feltet
  // kommer tilbake senere.
  // Scryfall leverer nå JSONL — én JSON per linje. Det er enklere og mer
  // robust enn den gamle store arrayen: vi trenger ingen JSON-strømparser,
  // bare å lese linje for linje.
  const filUrl: string = valgt?.jsonl_download_uri || valgt?.download_uri || `${BULK_FIL}?format=file`;
  const erJsonl = !!valgt?.jsonl_download_uri;

  await importerSettliste(logg);

  const mb = Math.round((valgt?.compressed_size || valgt?.size || 0) / 1e6);
  logg(`Laster ned ${filUrl}${mb ? ` (${mb} MB)` : ""}…`);
  const svar = await fetch(filUrl, { headers: HODER });
  if (!svar.ok || !svar.body) throw new Error(`Nedlasting feilet: ${svar.status}`);
  if (!erJsonl) {
    throw new Error(
      "Scryfall tilbyr ikke JSONL lenger. Importen må skrives om til det formatet de bruker nå."
    );
  }

  let bolk: Rå[] = [];
  let antall = 0;
  let hoppet = 0;

  for await (const linje of linjerFra(svar.body as any)) {
    let k: Rå;
    try {
      k = JSON.parse(linje);
    } catch {
      hoppet++;
      continue;
    }
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

// Filen kan komme gzippet uten at Content-Encoding er satt, og da pakker ikke
// fetch den ut selv. Vi kikker på de to første bytene og pakker ut ved behov.
async function* linjerFra(kropp: any): AsyncGenerator<string> {
  const rå = Readable.fromWeb(kropp);
  const iter = rå[Symbol.asyncIterator]();
  const først = await iter.next();
  const start: Buffer = først.done ? Buffer.alloc(0) : Buffer.from(først.value);
  const erGzip = start.length > 1 && start[0] === 0x1f && start[1] === 0x8b;

  const satt = Readable.from(
    (async function* () {
      if (start.length) yield start;
      for await (const del of { [Symbol.asyncIterator]: () => iter } as AsyncIterable<any>) yield del;
    })()
  );

  const tekst = erGzip ? satt.pipe(createGunzip()) : satt;
  for await (const linje of createInterface({ input: tekst, crlfDelay: Infinity })) {
    const t = linje.trim().replace(/,$/, "");
    if (t && t !== "[" && t !== "]") yield t;
  }
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
              (id, oracle_id, name, name_norm, front_norm, back_norm, variant, set_code,
               collector_number, rarity, usd, usd_foil, has_nonfoil, has_foil, image_uri, released_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              usd = excluded.usd, usd_foil = excluded.usd_foil,
              image_uri = excluded.image_uri, rarity = excluded.rarity,
              variant = excluded.variant`,
      args: [
        k.id,
        k.oracle_id || k.id,
        k.name,
        normaliser(k.name),
        // Hver halvdel for seg, for kort som «Bonecrusher Giant // Stomp».
        k.name.includes("//") ? normaliser(k.name.split("//")[0]) : null,
        k.name.includes("//") ? normaliser(k.name.split("//")[1] || "") || null : null,
        variantFraScryfall(k),
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

async function importerSettliste(logg: (s: string) => void): Promise<void> {
  const r = await fetch("https://api.scryfall.com/sets", { headers: HODER });
  if (!r.ok) throw new Error(`Kunne ikke hente settlista: ${r.status}`);
  const data = await r.json();
  const sett = (data.data || []).filter((s: any) => s.code && s.name && !s.digital);
  await db().batch(
    sett.map((s: any) => ({
      sql: `INSERT INTO sets (code, name, released_at, card_count, parent_code)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(code) DO UPDATE SET name = excluded.name,
              released_at = excluded.released_at, card_count = excluded.card_count,
              parent_code = excluded.parent_code`,
      args: [
        String(s.code).toLowerCase(),
        s.name,
        s.released_at || null,
        s.card_count || 0,
        s.parent_set_code ? String(s.parent_set_code).toLowerCase() : null,
      ],
    })),
    "write"
  );
  logg(`${sett.length} sett importert.`);
}

function tall(v: unknown): number | null {
  const n = parseFloat(String(v ?? ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}
