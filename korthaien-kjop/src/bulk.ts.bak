import { db, normaliser } from "./db.js";

// ─────────────────────────────────────────────────────────────────────────────
// BULKINNLEGGING
// ─────────────────────────────────────────────────────────────────────────────
// Kunden limer inn en liste. Vi tolker antall, navn, eventuell settkode og
// finish, og slår opp mot katalogen — men bare blant kort jeg faktisk vil ha.
//
// Det viktige: en linje som «4 Lightning Bolt» treffer titalls trykk. Vi
// gjetter aldri. Linjen får status «velg utgave», og kunden må peke på riktig
// trykk med settnavn og bilde foran seg. Bare linjer med nøyaktig ett mulig
// treff løses automatisk.

export type BulkLinje = {
  linje: number;
  rå: string;
  qty: number;
  navn: string;
  settHint: string | null;
  nummerHint: string | null;
  foil: boolean;
  feil?: string;
};

export const MAX_LINJER = 50;

const FOIL_ORD = /\b(foil|f)\b/i;

export function parseBulk(tekst: string): BulkLinje[] {
  const linjer = String(tekst || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, MAX_LINJER);

  return linjer.map((rå, i) => {
    const resultat: BulkLinje = {
      linje: i + 1,
      rå,
      qty: 1,
      navn: "",
      settHint: null,
      nummerHint: null,
      foil: false,
    };

    let s = rå;

    // Settkode i parentes eller klammer: "Lightning Bolt (2ED) 161"
    const sett = s.match(/[([]\s*([A-Za-z0-9]{2,6})\s*[)\]]\s*(\d{1,4}[a-z]?)?/);
    if (sett) {
      resultat.settHint = sett[1].toLowerCase();
      if (sett[2]) resultat.nummerHint = sett[2].toLowerCase();
      s = s.replace(sett[0], " ");
    }

    // Foil-markering, før vi tar navnet
    if (FOIL_ORD.test(s)) {
      resultat.foil = true;
      s = s.replace(FOIL_ORD, " ");
    }

    // Antall foran: "4 Bolt", "4x Bolt", "4 x Bolt"
    const foran = s.match(/^\s*(\d{1,3})\s*[xX*]?\s+/);
    if (foran) {
      resultat.qty = parseInt(foran[1], 10);
      s = s.slice(foran[0].length);
    } else {
      // Antall bak: "Bolt x4"
      const bak = s.match(/\s+[xX*]\s*(\d{1,3})\s*$/);
      if (bak) {
        resultat.qty = parseInt(bak[1], 10);
        s = s.slice(0, bak.index);
      }
    }

    resultat.navn = s.replace(/\s{2,}/g, " ").trim();

    if (!resultat.navn) resultat.feil = "Fant ikke noe kortnavn på linjen";
    else if (resultat.qty < 1) resultat.feil = "Antall må være minst 1";
    else if (resultat.qty > 99) resultat.feil = "Maks 99 av samme kort per linje";

    return resultat;
  });
}

// ── oppslag mot katalogen ────────────────────────────────────────────────────
export type Kandidat = {
  card_id: string;
  name: string;
  set_code: string;
  set_name: string;
  collector_number: string | null;
  rarity: string | null;
  image_uri: string | null;
  usd: number | null;
  usd_foil: number | null;
  has_foil: boolean;
  has_nonfoil: boolean;
  released_at: string | null;
};

export async function finnKandidater(navn: string, settHint: string | null, nummerHint: string | null): Promise<Kandidat[]> {
  const norm = normaliser(navn);
  if (!norm) return [];

  const args: any[] = [norm, norm, norm];
  let sql = `SELECT c.id AS card_id, c.name, c.set_code, s.name AS set_name,
                    c.collector_number, c.rarity, c.image_uri, c.usd, c.usd_foil,
                    c.has_foil, c.has_nonfoil, c.released_at
               FROM cards c LEFT JOIN sets s ON s.code = c.set_code
              WHERE (c.name_norm = ? OR c.front_norm = ? OR c.back_norm = ?)`;
  if (settHint) {
    sql += " AND c.set_code = ?";
    args.push(settHint);
  }
  if (nummerHint) {
    sql += " AND lower(c.collector_number) = ?";
    args.push(nummerHint);
  }
  sql += " ORDER BY c.released_at DESC LIMIT 60";

  let r = await db().execute({ sql, args });

  // Ingen eksakt navnetreff — prøv prefiks, så kunden slipper å skrive
  // «Ragavan, Nimble Pilferer» i sin helhet.
  if (r.rows.length === 0 && !settHint) {
    r = await db().execute({
      sql: `SELECT c.id AS card_id, c.name, c.set_code, s.name AS set_name,
                   c.collector_number, c.rarity, c.image_uri, c.usd, c.usd_foil,
                   c.has_foil, c.has_nonfoil, c.released_at
              FROM cards c LEFT JOIN sets s ON s.code = c.set_code
             WHERE c.name_norm LIKE ? OR c.front_norm LIKE ? OR c.back_norm LIKE ?
             ORDER BY c.released_at DESC LIMIT 60`,
      args: [norm + "%", norm + "%", norm + "%"],
    });
  }

  return r.rows.map((x: any) => ({
    card_id: String(x.card_id),
    name: String(x.name),
    set_code: String(x.set_code),
    set_name: String(x.set_name || x.set_code),
    collector_number: x.collector_number ? String(x.collector_number) : null,
    rarity: x.rarity ? String(x.rarity) : null,
    image_uri: x.image_uri ? String(x.image_uri) : null,
    usd: x.usd === null ? null : Number(x.usd),
    usd_foil: x.usd_foil === null ? null : Number(x.usd_foil),
    has_foil: !!Number(x.has_foil),
    has_nonfoil: !!Number(x.has_nonfoil),
    released_at: x.released_at ? String(x.released_at) : null,
  }));
}
