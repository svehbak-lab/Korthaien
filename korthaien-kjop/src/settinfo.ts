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

const PÅ_LAGER = `SELECT card_id FROM lager_bevegelser
                   GROUP BY card_id HAVING SUM(antall) > 0`;

export type Settinfo = {
  code: string;
  navn: string;
  offisielt_navn: string;
  utgitt: string | null;
  // Hvor mange kort settet har i alt, slik Scryfall teller dem.
  kort_i_settet: number;
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
};

export async function settinfo(kode: string): Promise<Settinfo | null> {
  const code = String(kode || "").toLowerCase().trim();
  if (!code) return null;

  const s = await db().execute({
    sql: `SELECT code, name, visningsnavn, released_at, card_count, parent_code
            FROM sets WHERE code = ?`,
    args: [code],
  });
  if (!s.rows.length) return null;
  const rad = s.rows[0] as any;

  // Ett kall per spørsmål ville vært fem turer til basen for en side som
  // åpnes ofte. De som kan svares i samme spørring, svares i samme spørring.
  const [lager, rariteter, slekt, produkter] = await Promise.all([
    db().execute({
      // Prisen staar ikke i lagerbevegelsene — den regnes ut av
      // salgsreglene hver gang. Et prisspenn her ville enten vaert et nytt
      // tall aa holde i takt, eller et gjett. Begge deler er verre enn aa
      // la vaere.
      sql: `SELECT COUNT(DISTINCT c.id) AS ulike,
                   COALESCE(SUM(b.antall), 0) AS eksemplarer
              FROM cards c
              JOIN (SELECT card_id, SUM(antall) AS antall
                      FROM lager_bevegelser GROUP BY card_id
                     HAVING SUM(antall) > 0) b ON b.card_id = c.id
             WHERE c.set_code = ? AND c.er_token = 0`,
      args: [code],
    }),
    db().execute({
      sql: `SELECT c.rarity AS raritet, COUNT(DISTINCT c.id) AS antall
              FROM cards c JOIN (${PÅ_LAGER}) l ON l.card_id = c.id
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
  ]);

  const l = lager.rows[0] as any;
  const p: Record<string, number> = {};
  for (const x of produkter.rows as any[]) p[String(x.type)] = Number(x.n || 0);

  return {
    code,
    navn: String(rad.visningsnavn || rad.name),
    offisielt_navn: String(rad.name),
    utgitt: rad.released_at ? String(rad.released_at) : null,
    kort_i_settet: Number(rad.card_count || 0),
    ulike_på_lager: Number(l?.ulike || 0),
    eksemplarer: Number(l?.eksemplarer || 0),
    rariteter: (rariteter.rows as any[])
      .map((x) => ({ raritet: String(x.raritet || "ukjent"), antall: Number(x.antall || 0) }))
      .sort((a, b) => RARITETSREKKE.indexOf(a.raritet) - RARITETSREKKE.indexOf(b.raritet)),
    slektninger: (slekt.rows as any[]).map((x) => ({ code: String(x.code), navn: String(x.navn) })),
    sealed: p.sealed || 0,
    komplettsett: p.komplettsett || 0,
  };
}

// Sjeldnest sist, slik kortene selv er sortert overalt ellers. En raritet vi
// ikke kjenner havner bakerst i stedet for å havne først ved et uhell.
const RARITETSREKKE = ["common", "uncommon", "rare", "mythic", "special", "bonus"];
