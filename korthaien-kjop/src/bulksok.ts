import { db, normaliser, CONDITIONS } from "./db.js";
import { parseBulk } from "./bulk.js";
import { hentSalgsOppsett, salgsprisØre, hentManuellSalg } from "./salgspris.js";
import { hentManuellePriser } from "./pricing.js";
import { tilgjengeligFor } from "./salg.js";
import { utgaveNavn } from "./varianter.js";

// ─────────────────────────────────────────────────────────────────────────────
// BULKSØK I BUTIKKEN
// ─────────────────────────────────────────────────────────────────────────────
// For den som bygger en deck eller en kube: lim inn en liste («4 Lightning
// Bolt»), få se hva som finnes på lager. Settet i lista betyr ingenting — det
// er kortet folk vil ha, ikke trykket. For hvert navn finner vi alle
// utgaver, finisher og tilstander som er på lager, billigst først.
//
// Samme navn på flere linjer (main og sideboard) slås sammen.

export const MAKS_BULKSØK = 600;

export type Alternativ = {
  card_id: string;
  finish: "nonfoil" | "foil";
  condition: string;
  enhet_ore: number;
  tilgjengelig: number;
  set_code: string;
  set_name: string;
  collector_number: string | null;
  rarity: string | null;
  image_uri: string | null;
  utgave: string;
};

export type BulkTreff = {
  navn: string; // slik kortet heter i katalogen
  søkt: string; // slik kunden skrev det
  antall: number;
  linjer: number[];
  status: "ok" | "ikke_på_lager" | "ukjent";
  alternativer: Alternativ[];
};

const COND_RANG = Object.fromEntries(CONDITIONS.map((c, i) => [c, i]));

export async function bulkSøk(tekst: string, kunFoil = false): Promise<{ treff: BulkTreff[]; linjer: number }> {
  // Kommentarer og overskrifter fra deckbyggere: «// Sideboard», «# Lands»,
  // «Sideboard:», «Commander (1)».
  const OVERSKRIFT = /^(sideboard|maybeboard|mainboard|main|deck|commander|companion|lands?|creatures?|spells?|instants?|sorcery|sorceries|artifacts?|enchantments?|planeswalkers?|tokens?)\s*(\(\d+\))?:?$/i;
  const rene = String(tekst || "")
    .split(/\r?\n/)
    .filter((l) => !/^\s*(\/\/|#)/.test(l) && !OVERSKRIFT.test(l.trim()))
    .join("\n");
  const tolket = parseBulk(rene, MAKS_BULKSØK).filter((l) => l.navn);

  // Slå sammen samme navn.
  const etterNavn = new Map<string, { søkt: string; antall: number; linjer: number[]; foil: boolean }>();
  for (const l of tolket) {
    const n = normaliser(l.navn);
    if (!n) continue;
    const før = etterNavn.get(n);
    if (før) {
      før.antall += l.qty;
      før.linjer.push(l.linje);
      før.foil = før.foil || l.foil;
    } else {
      etterNavn.set(n, { søkt: l.navn, antall: l.qty, linjer: [l.linje], foil: l.foil });
    }
  }
  const navn = [...etterNavn.keys()];
  if (!navn.length) return { treff: [], linjer: tolket.length };

  // Alle trykk med navnet — hele navnet, eller forsiden av et tosidig kort.
  const kort: any[] = [];
  for (let i = 0; i < navn.length; i += 300) {
    const del = navn.slice(i, i + 300);
    const ph = del.map(() => "?").join(",");
    const r = await db().execute({
      sql: `SELECT c.id, c.name, c.name_norm, c.front_norm, c.set_code, c.collector_number, c.rarity,
                   c.usd, c.usd_foil, c.image_uri, c.variant, c.er_scroll, c.er_display,
                   COALESCE(s.visningsnavn, s.name) AS set_name
              FROM cards c LEFT JOIN sets s ON s.code = c.set_code
             WHERE c.er_token = 0 AND (c.name_norm IN (${ph}) OR c.front_norm IN (${ph}))`,
      args: [...del, ...del],
    });
    kort.push(...r.rows);
  }
  const ider = [...new Set(kort.map((k) => String(k.id)))];
  const [ledig, opp, manuellSalg, manuellKjøp] = await Promise.all([
    ider.length ? tilgjengeligFor(ider.map((card_id) => ({ card_id }))) : Promise.resolve(new Map<string, number>()),
    hentSalgsOppsett(),
    hentManuellSalg(ider),
    hentManuellePriser(ider),
  ]);

  const perKort = new Map<string, any>(kort.map((k) => [String(k.id), k]));
  const alternativerFor = new Map<string, Alternativ[]>();
  const kjentNavn = new Map<string, string>();
  for (const k of kort) {
    for (const n of [String(k.name_norm), k.front_norm ? String(k.front_norm) : null]) {
      if (n && etterNavn.has(n) && !kjentNavn.has(n)) kjentNavn.set(n, String(k.name));
    }
  }
  for (const [nøkkel, antall] of ledig) {
    if (antall <= 0) continue;
    const [id, finish, condition] = nøkkel.split(":");
    const k = perKort.get(id);
    if (!k) continue;
    if (kunFoil && finish !== "foil") continue;
    const enhet = salgsprisØre(
      k, finish as any, condition as any, opp,
      manuellSalg.get(`${id}:${finish}`) ?? null,
      manuellKjøp.get(`${id}:${finish}`) ?? null
    );
    if (!enhet) continue;
    const alt: Alternativ = {
      card_id: id,
      finish: finish === "foil" ? "foil" : "nonfoil",
      condition,
      enhet_ore: enhet,
      tilgjengelig: antall,
      set_code: String(k.set_code),
      set_name: String(k.set_name || k.set_code),
      collector_number: k.collector_number ?? null,
      rarity: k.rarity ?? null,
      image_uri: k.image_uri ?? null,
      utgave: utgaveNavn(k),
    };
    for (const n of [String(k.name_norm), k.front_norm ? String(k.front_norm) : null]) {
      if (!n || !etterNavn.has(n)) continue;
      if (!alternativerFor.has(n)) alternativerFor.set(n, []);
      alternativerFor.get(n)!.push(alt);
    }
  }

  const treff: BulkTreff[] = [];
  for (const [n, s] of etterNavn) {
    let alt = alternativerFor.get(n) || [];
    // Står det «foil» på linja, vil kunden ha foil.
    if (s.foil && !kunFoil) alt = alt.filter((a) => a.finish === "foil");
    alt.sort((a, b) =>
      a.enhet_ore - b.enhet_ore ||
      (COND_RANG[a.condition] ?? 9) - (COND_RANG[b.condition] ?? 9) ||
      b.tilgjengelig - a.tilgjengelig
    );
    treff.push({
      navn: kjentNavn.get(n) || s.søkt,
      søkt: s.søkt,
      antall: s.antall,
      linjer: s.linjer,
      status: alt.length ? "ok" : kjentNavn.has(n) ? "ikke_på_lager" : "ukjent",
      alternativer: alt,
    });
  }
  // I samme rekkefølge som lista kunden limte inn.
  treff.sort((a, b) => a.linjer[0] - b.linjer[0]);
  return { treff, linjer: tolket.length };
}
