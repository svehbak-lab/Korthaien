import { butikklagerSql } from "./lager.js";
import { db } from "./db.js";

// ─────────────────────────────────────────────────────────────────────────────
// OM SETTET
// ─────────────────────────────────────────────────────────────────────────────
// Fakta om ett sett, til fanen i butikken.
//
// Alt her er regnet ut, ikke skrevet. Card Kingdom har en redaksjonell tekst
// per sett; den må noen sette seg ned og skrive, og den blir sittende uendret
// når lageret endrer seg. Dette tallet — «du har 259 av 281 kort» — er sant
// hver gang noen åpner sida, og ingen må huske å oppdatere det.
//
// Samme kall svarer på om det finnes sealed i settet. Fanen skal bare vises
// når det gjør det, og da er det bedre at ett svar bestemmer begge deler enn
// at to kall kan bli uenige.

// Butikkens lager (se butikklagerSql): Mystore-speilet fram til overgangen.
const PÅ_LAGER_SQL = () => `SELECT card_id FROM (${butikklagerSql()})
                   GROUP BY card_id HAVING SUM(antall) > 0`;

export type Settinfo = {
  code: string;
  navn: string;
  offisielt_navn: string;
  utgitt: string | null;
  // Hvor mange kort settet har i alt, slik Scryfall teller dem.
  kort_i_settet: number;
  // Med showcase, borderless og andre varianter.
  kort_med_varianter: number;
  // Hvor mange forskjellige du har på lager, og hvor mange eksemplarer.
  ulike_på_lager: number;
  eksemplarer: number;
  rariteter: { raritet: string; antall: number }[];
  // Settene Scryfall har knyttet til dette: Commander-dekkene, Art Series,
  // retro-arket. Kundene tenker på dem som samme utgivelse.
  slektninger: { code: string; navn: string }[];
  // Egne produkter med denne settkoden. Styrer om Sealed-fanen vises.
  sealed: number;
  komplettsett: number;
  set_type: string | null;
  ikon: string | null;
  // Finnes kortene i settet som foil, ikke-foil, eller begge?
  foil: "begge" | "bare_foil" | "ingen_foil";
  // Formatene der settet er lovlig (de fleste kortene), i MTG-rekkefølge.
  formater: string[];
};

const FORMATER: [string, string][] = [
  ["standard", "Standard"], ["pioneer", "Pioneer"], ["modern", "Modern"], ["legacy", "Legacy"],
  ["vintage", "Vintage"], ["commander", "Commander"], ["pauper", "Pauper"],
];

export async function settinfo(kode: string): Promise<Settinfo | null> {
  const code = String(kode || "").toLowerCase().trim();
  if (!code) return null;

  const s = await db().execute({
    sql: `SELECT code, name, visningsnavn, released_at, card_count, printed_size, parent_code, set_type, ikon
            FROM sets WHERE code = ?`,
    args: [code],
  });
  if (!s.rows.length) return null;
  const rad = s.rows[0] as any;

  // Ett kall per spørsmål ville vært fem turer til basen for en side som
  // åpnes ofte. De som kan svares i samme spørring, svares i samme spørring.
  const [lager, rariteter, slekt, produkter, kortinfo] = await Promise.all([
    db().execute({
      // Prisen staar ikke i lagerbevegelsene — den regnes ut av
      // salgsreglene hver gang. Et prisspenn her ville enten vaert et nytt
      // tall aa holde i takt, eller et gjett. Begge deler er verre enn aa
      // la vaere.
      sql: `SELECT COUNT(DISTINCT c.id) AS ulike,
                   COALESCE(SUM(b.antall), 0) AS eksemplarer
              FROM cards c
              JOIN (SELECT card_id, SUM(antall) AS antall
                      FROM (${butikklagerSql()}) GROUP BY card_id
                     HAVING SUM(antall) > 0) b ON b.card_id = c.id
             WHERE c.set_code = ? AND c.er_token = 0`,
      args: [code],
    }),
    db().execute({
      sql: `SELECT c.rarity AS raritet, COUNT(DISTINCT c.id) AS antall
              FROM cards c JOIN (${PÅ_LAGER_SQL()}) l ON l.card_id = c.id
             WHERE c.set_code = ? AND c.er_token = 0
             GROUP BY c.rarity`,
      args: [code],
    }),
    // Foreldre og søsken i samme slengen: begge er «samme utgivelse» sett
    // med kundens øyne, og lista skal ikke ha settet selv i seg.
    db().execute({
      sql: `SELECT code, COALESCE(visningsnavn, name) AS navn FROM sets
             WHERE code <> ?
               AND (code = ? OR parent_code = ? OR (parent_code IS NOT NULL AND parent_code = ?))
             ORDER BY navn`,
      args: [code, rad.parent_code ?? "", code, rad.parent_code ?? ""],
    }),
    db().execute({
      sql: `SELECT type, COUNT(*) AS n FROM produkter
             WHERE set_code = ? AND aktiv = 1 AND antall > 0 GROUP BY type`,
      args: [code],
    }),
    db().execute({
      sql: `SELECT has_foil, has_nonfoil, legalities FROM cards WHERE set_code = ? AND er_token = 0`,
      args: [code],
    }),
  ]);
  const kortrader = kortinfo.rows as any[];
  const medFoil = kortrader.some((x) => Number(x.has_foil));
  const utenFoil = kortrader.some((x) => Number(x.has_nonfoil));
  const lovlig: Record<string, number> = {};
  for (const x of kortrader) {
    let l: any = null;
    try { l = x.legalities ? JSON.parse(String(x.legalities)) : null; } catch { l = null; }
    if (!l) continue;
    for (const [f] of FORMATER) if (l[f] === "legal" || l[f] === "restricted") lovlig[f] = (lovlig[f] || 0) + 1;
  }
  const formater = FORMATER.filter(([f]) => kortrader.length && (lovlig[f] || 0) / kortrader.length >= 0.5).map(([, n]) => n);

  const l = lager.rows[0] as any;
  const p: Record<string, number> = {};
  for (const x of produkter.rows as any[]) p[String(x.type)] = Number(x.n || 0);

  return {
    code,
    navn: String(rad.visningsnavn || rad.name),
    offisielt_navn: String(rad.name),
    utgitt: rad.released_at ? String(rad.released_at) : null,
    kort_i_settet: Number(rad.printed_size || 0) || Number(rad.card_count || 0),
    kort_med_varianter: Number(rad.card_count || 0),
    ulike_på_lager: Number(l?.ulike || 0),
    eksemplarer: Number(l?.eksemplarer || 0),
    rariteter: (rariteter.rows as any[])
      .map((x) => ({ raritet: String(x.raritet || "ukjent"), antall: Number(x.antall || 0) }))
      .sort((a, b) => RARITETSREKKE.indexOf(a.raritet) - RARITETSREKKE.indexOf(b.raritet)),
    slektninger: (slekt.rows as any[]).map((x) => ({ code: String(x.code), navn: String(x.navn) })),
    sealed: p.sealed || 0,
    komplettsett: p.komplettsett || 0,
    set_type: rad.set_type ? String(rad.set_type) : null,
    ikon: rad.ikon ? String(rad.ikon) : null,
    foil: medFoil && utenFoil ? "begge" : medFoil ? "bare_foil" : "ingen_foil",
    formater,
  };
}

// Sjeldnest sist, slik kortene selv er sortert overalt ellers. En raritet vi
// ikke kjenner havner bakerst i stedet for å havne først ved et uhell.
const RARITETSREKKE = ["common", "uncommon", "rare", "mythic", "special", "bonus"];
