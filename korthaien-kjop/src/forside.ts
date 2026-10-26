import { butikklagerSql } from "./lager.js";
import { db } from "./db.js";
import { hentSettings } from "./db.js";

// ─────────────────────────────────────────────────────────────────────────────
// SETTENE PÅ FORSIDEN
// ─────────────────────────────────────────────────────────────────────────────
// Raden med nyeste sett, slik Card Kingdom har den: et kortbilde og settnavnet
// under, klikkbart til settet.
//
// Den oppdaterer seg selv. Lista er settene du sist har fått kort inn i, og
// den endrer seg når lageret gjør det — ingen må be noen om å bytte den. Det
// er hele poenget: innhold som endrer seg ofte skal ikke gå gjennom et
// menneske.
//
// Vil du likevel bestemme selv, setter du forside_sett i innstillingene. Da
// gjelder den lista, i den rekkefølgen, til du tømmer den igjen.

export type ForsideSett = {
  code: string;
  name: string;
  utgitt: string | null;
  kort: number;
  image_uri: string | null;
  // Bare illustrasjonen, uten ramme og tekst. Scryfall har den som egen
  // utgave av hvert bilde, på samme adresse med «art_crop» i stedet for
  // «normal». Det er den Card Kingdom bruker i settraden sin.
  kunst_uri: string | null;
  kort_navn: string | null;
};

// Kort du faktisk har. Samme regel som butikken bruker, så et sett ikke kan
// stå på forsiden uten at det er noe å kjøpe i det.
// Butikkens lager (se butikklagerSql): Mystore-speilet fram til overgangen.
const PÅ_LAGER_SQL = () => `SELECT card_id FROM (${butikklagerSql()})
                   GROUP BY card_id HAVING SUM(antall) > 0`;

export async function forsideSett(antall = 5): Promise<ForsideSett[]> {
  const n = Math.min(24, Math.max(1, Math.round(antall)));
  const valgte = await settene(n);
  if (!valgte.length) return [];

  // Ett bilde per sett: det dyreste kortet du har i det. Det er kortet folk
  // kjenner settet igjen på, og det ser best ut i en rad.
  //
  // Window-funksjon framfor én spørring per sett. Seks spørringer er ikke
  // mye, men dette kalles på hver forsidevisning.
  const plass = valgte.map(() => "?").join(",");
  const bilder = await db().execute({
    sql: `WITH lager AS (${PÅ_LAGER_SQL()}),
               rangert AS (
                 SELECT c.set_code, c.name, c.image_uri,
                        ROW_NUMBER() OVER (
                          PARTITION BY c.set_code
                          ORDER BY COALESCE(c.usd, c.usd_foil, 0) DESC,
                                   CAST(c.collector_number AS INTEGER)
                        ) AS nr
                   FROM cards c JOIN lager l ON l.card_id = c.id
                  WHERE c.er_token = 0 AND c.er_serialized = 0
                    AND c.image_uri IS NOT NULL
                    AND c.set_code IN (${plass})
               )
          SELECT set_code, name, image_uri FROM rangert WHERE nr = 1`,
    args: valgte.map((s) => s.code),
  });

  const bilde = new Map<string, any>();
  for (const b of bilder.rows as any[]) bilde.set(String(b.set_code), b);

  return valgte.map((s) => ({
    ...s,
    image_uri: bilde.get(s.code)?.image_uri ?? null,
    kunst_uri: kunstAv(bilde.get(s.code)?.image_uri ?? null),
    kort_navn: bilde.get(s.code)?.name ?? null,
  }));
}

async function settene(n: number) {
  const { forside_sett } = await hentSettings();
  const valgt = Array.isArray(forside_sett) ? forside_sett.filter(Boolean) : [];

  if (valgt.length) {
    const plass = valgt.map(() => "?").join(",");
    const r = await db().execute({
      sql: `SELECT c.set_code AS code,
                   COALESCE(s.visningsnavn, s.name, c.set_code) AS name,
                   MAX(s.released_at) AS utgitt,
                   COUNT(DISTINCT c.id) AS kort
              FROM (${PÅ_LAGER_SQL()}) l
              JOIN cards c ON c.id = l.card_id
              LEFT JOIN sets s ON s.code = c.set_code
             WHERE c.er_token = 0 AND c.er_serialized = 0 AND c.set_code IN (${plass})
             GROUP BY c.set_code`,
      args: valgt,
    });
    const kart = new Map((r.rows as any[]).map((x) => [String(x.code), x]));
    // Din rekkefølge, ikke databasens. Sett uten kort på lager faller ut —
    // en rute som leder til et tomt sett er verre enn én rute mindre.
    return valgt
      .map((c) => kart.get(String(c).toLowerCase()))
      .filter(Boolean)
      // Raden har plass til et fast antall. Er det valgt flere, faller de
      // siste ut i stedet for å brekke raden til en ny linje.
      .slice(0, n)
      .map(rad);
  }

  const r = await db().execute({
    sql: `SELECT c.set_code AS code,
                 COALESCE(s.visningsnavn, s.name, c.set_code) AS name,
                 MAX(s.released_at) AS utgitt,
                 COUNT(DISTINCT c.id) AS kort
            FROM (${PÅ_LAGER_SQL()}) l
            JOIN cards c ON c.id = l.card_id
            LEFT JOIN sets s ON s.code = c.set_code
           WHERE c.er_token = 0 AND c.er_serialized = 0
           GROUP BY c.set_code
           ORDER BY utgitt DESC NULLS LAST
           LIMIT ?`,
    args: [n],
  });
  return (r.rows as any[]).map(rad);
}

export function kunstAv(bilde: string | null): string | null {
  if (!bilde) return null;
  return /\/(normal|large|small|png)\/(front|back)\//.test(bilde)
    ? bilde.replace(/\/(normal|large|small|png)\/(front|back)\//, "/art_crop/$2/")
    : null;
}

const rad = (x: any) => ({
  code: String(x.code),
  name: String(x.name),
  utgitt: x.utgitt ? String(x.utgitt) : null,
  kort: Number(x.kort || 0),
});
