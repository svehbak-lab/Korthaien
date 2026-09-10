import { createClient, type Client } from "@libsql/client";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HER = dirname(fileURLToPath(import.meta.url));

let klient: Client | null = null;

export function db(): Client {
  if (klient) return klient;
  const url = process.env.DATABASE_URL || "file:./korthaien-kjop.db";
  klient = createClient({
    url,
    authToken: process.env.DATABASE_AUTH_TOKEN || undefined,
  });
  return klient;
}

export async function migrate(): Promise<void> {
  const rå = readFileSync(join(HER, "schema.sql"), "utf8");
  // Kommentarene fjernes før vi splitter. En semikolon inne i en kommentar
  // ville ellers delt setningen i to, og feilen («incomplete input») peker
  // ingen steder i nærheten av årsaken.
  const sql = rå
    .split("\n")
    .map((l) => {
      const i = l.indexOf("--");
      return i === -1 ? l : l.slice(0, i);
    })
    .join("\n");
  const setninger = sql
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);

  // Rekkefølgen er viktig. Tabellene først, så kolonner som er kommet til
  // senere, og indeksene til slutt — en indeks på en kolonne som ennå ikke
  // er lagt til feiler, og CREATE TABLE IF NOT EXISTS rører ikke en tabell
  // som allerede finnes.
  const indekser = setninger.filter((s) => /^CREATE\s+(UNIQUE\s+)?INDEX/i.test(s));
  const resten = setninger.filter((s) => !indekser.includes(s));

  for (const s of resten) await db().execute(s);
  await leggTilNyeKolonner();
  for (const s of indekser) await db().execute(s);
  // Nye kolonner er tomme til de fylles. Uten dette ville dobbeltsidige kort
  // fortsatt bomme, og feilen ville vært usynlig — kolonnen finnes jo.
  await fyllForsidenavn();
}

// Kolonner lagt til etter at noen allerede har en database i drift.
async function leggTilNyeKolonner(): Promise<void> {
  const kolonner = async (tabell: string) => {
    const r = await db().execute(`PRAGMA table_info(${tabell})`);
    return new Set(r.rows.map((x: any) => String(x.name)));
  };

  const cards = await kolonner("cards");
  if (cards.size && !cards.has("front_norm")) {
    await db().execute("ALTER TABLE cards ADD COLUMN front_norm TEXT");
  }
  if (cards.size && !cards.has("back_norm")) {
    await db().execute("ALTER TABLE cards ADD COLUMN back_norm TEXT");
  }
  if (cards.size && !cards.has("variant")) {
    await db().execute("ALTER TABLE cards ADD COLUMN variant TEXT NOT NULL DEFAULT 'vanlig'");
  }

  const kat = await kolonner("mystore_categories");
  if (kat.size && !kat.has("gjettet")) {
    await db().execute("ALTER TABLE mystore_categories ADD COLUMN gjettet INTEGER NOT NULL DEFAULT 0");
  }
  if (kat.size && !kat.has("forslag")) {
    await db().execute("ALTER TABLE mystore_categories ADD COLUMN forslag TEXT");
  }

  const settKol = await kolonner("sets");
  if (settKol.size && !settKol.has("parent_code")) {
    await db().execute("ALTER TABLE sets ADD COLUMN parent_code TEXT");
  }

  const regler = await kolonner("set_rules");
  if (regler.size && !regler.has("wanted_foil")) {
    await db().execute("ALTER TABLE set_rules ADD COLUMN wanted_foil INTEGER NOT NULL DEFAULT 0");
  }

  const lenker = await kolonner("mystore_links");
  if (lenker.size && !lenker.has("kilde")) {
    await db().execute("ALTER TABLE mystore_links ADD COLUMN kilde TEXT");
  }

  const lager = await kolonner("mystore_stock");
  if (lager.size && !lager.has("product_name")) {
    await db().execute("ALTER TABLE mystore_stock ADD COLUMN product_name TEXT");
  }
  if (lager.size && !lager.has("category")) {
    await db().execute("ALTER TABLE mystore_stock ADD COLUMN category TEXT");
  }

  // Beløp gikk fra hele kroner til øre. De gamle kolonnene blir stående —
  // de er NOT NULL, og å bygge om tabellen for å bli kvitt dem er ikke verdt
  // risikoen. De fylles fortsatt med avrundede kroner.
  const linjer = await kolonner("order_lines");
  if (linjer.size && !linjer.has("unit_ore")) {
    await db().execute("ALTER TABLE order_lines ADD COLUMN unit_ore INTEGER NOT NULL DEFAULT 0");
    await db().execute("UPDATE order_lines SET unit_ore = unit_nok * 100");
  }

  // Egen kjøpsandel per sett. Uten den måtte du regnet baklengs i trappen —
  // 80 % av markedsprisen med en global sats på 70 blir NM 114 i trappen, og
  // det er ingen som klarer å lese ut av et grensesnitt.
  if (regler.size && !regler.has("buy_pct")) {
    await db().execute("ALTER TABLE set_rules ADD COLUMN buy_pct REAL");
  }

  const linjer2 = await kolonner("order_lines");
  if (linjer2.size && !linjer2.has("unit_ore_start")) {
    await db().execute("ALTER TABLE order_lines ADD COLUMN unit_ore_start INTEGER NOT NULL DEFAULT 0");
    await db().execute("UPDATE order_lines SET unit_ore_start = unit_ore");
  }
  if (linjer2.size && !linjer2.has("condition_start")) {
    await db().execute("ALTER TABLE order_lines ADD COLUMN condition_start TEXT");
    await db().execute("UPDATE order_lines SET condition_start = condition");
  }

  if (linjer2.size && !linjer2.has("kilde")) {
    await db().execute("ALTER TABLE order_lines ADD COLUMN kilde TEXT NOT NULL DEFAULT 'kunde'");
  }
  if (linjer2.size && !linjer2.has("fjernet_at")) {
    await db().execute("ALTER TABLE order_lines ADD COLUMN fjernet_at TEXT");
  }

  const ordre = await kolonner("orders");
  if (ordre.size && !ordre.has("total_ore")) {
    await db().execute("ALTER TABLE orders ADD COLUMN total_ore INTEGER NOT NULL DEFAULT 0");
    await db().execute("UPDATE orders SET total_ore = total_nok * 100");
  }
  // Det kunden ble forespeilet, frosset ved innsending. unit_ore endrer seg
  // når du justerer tilstand ved mottak, og uten disse ville vi ikke lenger
  // kunne si hva avviket besto i.
  if (ordre.size && !ordre.has("quoted_ore")) {
    await db().execute("ALTER TABLE orders ADD COLUMN quoted_ore INTEGER NOT NULL DEFAULT 0");
    await db().execute("UPDATE orders SET quoted_ore = total_ore");
  }
  if (ordre.size && !ordre.has("vilkar_godtatt")) {
    await db().execute("ALTER TABLE orders ADD COLUMN vilkar_godtatt TEXT");
  }
  // Rabattkoden lages manuelt i Mystore og limes inn her. Når den er sendt,
  // er credit_sent_at satt — det er dét som skiller «mottatt» fra «gjort opp».
  if (ordre.size && !ordre.has("discount_code")) {
    await db().execute("ALTER TABLE orders ADD COLUMN discount_code TEXT");
  }
  if (ordre.size && !ordre.has("credit_sent_at")) {
    await db().execute("ALTER TABLE orders ADD COLUMN credit_sent_at TEXT");
  }
  if (ordre.size && !ordre.has("credit_note")) {
    await db().execute("ALTER TABLE orders ADD COLUMN credit_note TEXT");
  }

  // Manuell pris var først et kronebeløp for Near Mint. Det viste seg tyngre
  // å vedlikeholde enn en dollarpris hentet fra en butikk, siden kronebeløpet
  // må regnes om for hånd hver gang kursen flytter seg. Vi bygger tabellen om
  // og regner de gamle radene tilbake til dollar.
  const priser = await kolonner("card_prices");
  if (priser.size && priser.has("nm_ore") && !priser.has("usd")) {
    const s = await hentSettings();
    const deler = s.usd_nok * (s.buy_pct / 100) * 100;
    await db().execute(`CREATE TABLE card_prices_ny (
      card_id TEXT NOT NULL,
      finish TEXT NOT NULL CHECK (finish IN ('nonfoil','foil')),
      usd REAL NOT NULL,
      kilde TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (card_id, finish))`);
    await db().execute({
      sql: `INSERT INTO card_prices_ny (card_id, finish, usd, kilde, updated_at)
            SELECT card_id, finish, nm_ore / ?, note, updated_at FROM card_prices WHERE nm_ore > 0`,
      args: [deler || 1],
    });
    await db().execute("DROP TABLE card_prices");
    await db().execute("ALTER TABLE card_prices_ny RENAME TO card_prices");
  }

  const um = await kolonner("mystore_unmatched");
  if (um.size && !um.has("category")) {
    await db().execute("ALTER TABLE mystore_unmatched ADD COLUMN category TEXT");
  }
  if (um.size && !um.has("set_code")) {
    await db().execute("ALTER TABLE mystore_unmatched ADD COLUMN set_code TEXT");
  }
}

// Fyller front_norm og back_norm for kort som mangler dem. Kjøres av
// migreringen og av `npm run reindeks`, så du slipper en full import.
export async function fyllForsidenavn(logg: (s: string) => void = () => {}): Promise<number> {
  const r = await db().execute(
    `SELECT id, name FROM cards
      WHERE name LIKE '%//%' AND (front_norm IS NULL OR back_norm IS NULL)`
  );
  if (!r.rows.length) return 0;
  logg(`  ${r.rows.length} dobbeltsidige kort får for- og baksidenavn…`);
  const rader = r.rows.map((x: any) => {
    const deler = String(x.name).split("//");
    return {
      sql: "UPDATE cards SET front_norm = ?, back_norm = ? WHERE id = ?",
      args: [
        normaliser(deler[0]),
        deler[1] ? normaliser(deler[1]) : null,
        String(x.id),
      ],
    };
  });
  for (let i = 0; i < rader.length; i += 300) await db().batch(rader.slice(i, i + 300), "write");
  return rader.length;
}

// ── innstillinger ────────────────────────────────────────────────────────────
export type Ladder = Record<string, number>;

export const CONDITIONS = ["NM", "EX", "VG", "G"] as const;
export type Condition = (typeof CONDITIONS)[number];

export const CONDITION_NAVN: Record<Condition, string> = {
  NM: "Near Mint",
  EX: "Excellent",
  VG: "Very Good",
  G: "Good",
};

export type Settings = {
  usd_nok: number;
  buy_pct: number;
  // Begge beløpene er i øre. Se beregnØre i pricing.ts.
  min_buy_ore: number;
  min_order_ore: number;
  default_conditions: Condition[];
  default_ladder: Ladder;
  order_expiry_days: number;
  ship_to: string;
};

const STANDARD: Settings = {
  usd_nok: 9.33,
  buy_pct: 70,
  // Ingen bunn per kort. Er kortet verdt ti øre, får kunden ti øre — et kort
  // som vises til 0 kr får kunden til å tro hen blir lurt.
  min_buy_ore: 1,
  // Bunn per ordre. Under denne summen dekker ikke oppgjøret håndteringen.
  min_order_ore: 20000,
  // NM er standard for alle sett, slik du beskrev.
  default_conditions: ["NM"],
  default_ladder: { NM: 100, EX: 85, VG: 70, G: 55 },
  order_expiry_days: 14,
  ship_to: "Svein Bakke\nLørenvangen 23C\n0585 Oslo\n91774561",
};

export async function hentSettings(): Promise<Settings> {
  const rader = await db().execute("SELECT key, value FROM settings");
  const ut: any = { ...STANDARD };
  for (const r of rader.rows) {
    const k = String(r.key);
    if (!(k in STANDARD)) continue;
    try {
      ut[k] = JSON.parse(String(r.value));
    } catch {
      ut[k] = r.value;
    }
  }
  return ut as Settings;
}

export async function settSetting(key: keyof Settings, value: unknown): Promise<void> {
  await db().execute({
    sql: "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    args: [key, JSON.stringify(value)],
  });
}

// Ligaturer og særnorske tegn overlever ikke NFD-dekomponering — Æ blir bare
// borte i stedet for «ae». Butikken skriver «Æther Rift» der Scryfall skriver
// «Aether Rift», og uten denne oversettelsen finner de aldri hverandre. Det
// samme gjelder en kunde som skriver kortnavnet slik det står trykt på kortet.
const TEGN: [RegExp, string][] = [
  [/æ/g, "ae"], [/ø/g, "o"], [/å/g, "a"],
  [/œ/g, "oe"], [/ß/g, "ss"], [/đ/g, "d"], [/ð/g, "d"], [/þ/g, "th"],
];

export function normaliser(s: string): string {
  let ut = (s || "").toLowerCase();
  for (const [re, erstatning] of TEGN) ut = ut.replace(re, erstatning);
  return ut
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}
