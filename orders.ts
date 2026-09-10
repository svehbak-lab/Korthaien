import { db, hentSettings, CONDITIONS, type Condition } from "./db.js";

// Bunken sorteres slik du faktisk går gjennom den: sett for sett, og innenfor
// hvert sett de dyre kortene først. Da ligger det som må vurderes nøye øverst,
// og bulken nederst.
const RARITET = ["mythic", "rare", "uncommon", "common"];
export const raritetsRang = (r: unknown) => {
  const i = RARITET.indexOf(String(r || "").toLowerCase());
  return i === -1 ? RARITET.length : i;
};
// Samme rekkefølge i SQL, slik at lista er lik uansett hvor den hentes fra.
export const SORTERING = `set_name,
  CASE lower(COALESCE(rarity, ''))
    WHEN 'mythic' THEN 0 WHEN 'rare' THEN 1
    WHEN 'uncommon' THEN 2 WHEN 'common' THEN 3 ELSE 4 END,
  card_name`;
import { prisØre, hentSetRule, hentManuellPris } from "./pricing.js";
import { hentKvote } from "./quota.js";

// ─────────────────────────────────────────────────────────────────────────────
// ORDRE
// ─────────────────────────────────────────────────────────────────────────────
// Klienten sender bare kort-ID, finish, condition og antall. Alt annet —
// pris, kvote, hva som faktisk kjøpes — regnes på nytt her. En kunde som
// endrer prisen i nettleseren oppnår ingenting.

export type InnLinje = {
  card_id: string;
  finish: "nonfoil" | "foil";
  condition: Condition;
  qty: number;
};

export type Avvist = { card_id: string; finish: string; condition: string; grunn: string };

export async function lagOrdre(input: {
  customer_name: string;
  email: string;
  phone?: string;
  note?: string;
  vilkar_godtatt?: boolean;
  linjer: InnLinje[];
}) {
  const s = await hentSettings();
  const navn = (input.customer_name || "").trim();
  const epost = (input.email || "").trim();
  if (navn.length < 2) throw new HttpFeil(400, "Navn mangler");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(epost)) throw new HttpFeil(400, "Ugyldig e-postadresse");
  if (!input.linjer?.length) throw new HttpFeil(400, "Ordren er tom");
  if (input.linjer.length > 500) throw new HttpFeil(400, "For mange linjer i én ordre");

  // Slå sammen duplikater før validering, ellers kan samme kort sendes
  // flere ganger for å komme rundt kvoten.
  const slått = new Map<string, InnLinje>();
  for (const l of input.linjer) {
    if (!CONDITIONS.includes(l.condition)) throw new HttpFeil(400, `Ukjent condition: ${l.condition}`);
    if (l.finish !== "nonfoil" && l.finish !== "foil") throw new HttpFeil(400, "Ukjent finish");
    const qty = Math.floor(Number(l.qty));
    if (!Number.isFinite(qty) || qty < 1) throw new HttpFeil(400, "Ugyldig antall");
    const k = `${l.card_id}:${l.finish}:${l.condition}`;
    const fins = slått.get(k);
    if (fins) fins.qty += qty;
    else slått.set(k, { ...l, qty });
  }

  const godkjent: any[] = [];
  const avvist: Avvist[] = [];
  // Kvoten deles på tvers av conditions for samme kort, så vi teller ned
  // underveis i stedet for å validere hver linje isolert.
  const brukt = new Map<string, number>();

  for (const l of slått.values()) {
    const r = await db().execute({
      sql: `SELECT c.*, s.name AS set_name FROM cards c
              LEFT JOIN sets s ON s.code = c.set_code WHERE c.id = ?`,
      args: [l.card_id],
    });
    const kort: any = r.rows[0];
    if (!kort) {
      avvist.push({ ...l, grunn: "Kortet finnes ikke" });
      continue;
    }
    if (l.finish === "foil" && !Number(kort.has_foil)) {
      avvist.push({ ...l, grunn: "Kortet finnes ikke i foil" });
      continue;
    }

    const regel = await hentSetRule(String(kort.set_code), s);
    if (!regel.conditions.includes(l.condition)) {
      avvist.push({ ...l, grunn: `${l.condition} tas ikke imot for dette settet` });
      continue;
    }

    const kvoteNøkkel = `${l.card_id}:${l.finish}`;
    const kvote = await hentKvote(l.card_id, l.finish, String(kort.set_code), regel);
    const alleredeBrukt = brukt.get(kvoteNøkkel) || 0;
    const ledig = kvote.available - alleredeBrukt;
    if (ledig <= 0) {
      avvist.push({ ...l, grunn: "Kvoten er full" });
      continue;
    }

    const qty = Math.min(l.qty, ledig);
    const manuell = await hentManuellPris(l.card_id, l.finish);
    const pris = prisØre(kort, l.finish, l.condition, regel, s, manuell);
    if (pris <= 0) {
      avvist.push({ ...l, grunn: "Ingen gyldig pris for dette kortet" });
      continue;
    }
    if (qty < l.qty) {
      avvist.push({ ...l, grunn: `Bare ${qty} av ${l.qty} fikk plass i kvoten` });
    }

    brukt.set(kvoteNøkkel, alleredeBrukt + qty);
    godkjent.push({
      card_id: l.card_id,
      finish: l.finish,
      condition: l.condition,
      qty,
      unit_ore: pris,
      rarity: kort.rarity ? String(kort.rarity) : null,
      card_name: String(kort.name),
      set_code: String(kort.set_code),
      set_name: String(kort.set_name || kort.set_code),
      collector_number: kort.collector_number ? String(kort.collector_number) : null,
    });
  }

  if (!godkjent.length) throw new HttpFeil(409, "Ingen av kortene kunne tas imot", { avvist });

  // Sett, så sjeldenhet, så kortnavn. Kunden får beskjed om å legge bunken i
  // samme rekkefølge, så mottakskontrollen går rett gjennom lista.
  godkjent.sort(
    (a, b) =>
      a.set_name.localeCompare(b.set_name, "nb") ||
      raritetsRang(a.rarity) - raritetsRang(b.rarity) ||
      a.card_name.localeCompare(b.card_name, "nb") ||
      a.finish.localeCompare(b.finish) ||
      CONDITIONS.indexOf(a.condition) - CONDITIONS.indexOf(b.condition)
  );

  const total = godkjent.reduce((n, l) => n + l.unit_ore * l.qty, 0);
  // Bunnen sjekkes på det som faktisk ble godkjent, ikke på det kunden la i
  // kurven. Røk halve ordren på kvote, skal hen få vite at resten er for lite
  // — ikke få en bekreftelse på en ordre jeg ikke vil ha i posten.
  if (total < s.min_order_ore) {
    throw new HttpFeil(400, `Ordren må være på minst ${Math.round(s.min_order_ore / 100)} kr. Denne er på ${(total / 100).toFixed(2).replace(".", ",")} kr.`, {
      total_ore: total,
      min_order_ore: s.min_order_ore,
      avvist,
    });
  }
  const nå = new Date();
  const utløp = new Date(nå.getTime() + s.order_expiry_days * 86400000);
  const ordreNr = await nyttOrdrenummer(nå);

  const res = await db().execute({
    sql: `INSERT INTO orders (order_no, customer_name, email, phone, status, total_nok, total_ore, quoted_ore,
                              vilkar_godtatt, note, created_at, expires_at)
          VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?)`,
    args: [ordreNr, navn, epost, input.phone || null, Math.round(total / 100), total, total,
           input.vilkar_godtatt ? nå.toISOString() : null,
           input.note || null, nå.toISOString(), utløp.toISOString()],
  });
  const ordreId = Number(res.lastInsertRowid);

  for (const l of godkjent) {
    await db().execute({
      sql: `INSERT INTO order_lines
              (order_id, card_id, finish, condition, condition_start, qty, unit_nok, unit_ore, unit_ore_start,
               card_name, set_code, set_name, collector_number, rarity)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [ordreId, l.card_id, l.finish, l.condition, l.condition, l.qty, Math.round(l.unit_ore / 100), l.unit_ore, l.unit_ore,
             l.card_name, l.set_code, l.set_name, l.collector_number, l.rarity],
    });
  }

  return {
    order_no: ordreNr,
    total_ore: total,
    expires_at: utløp.toISOString(),
    linjer: godkjent,
    avvist,
    instruksjoner: instruksjoner(ordreNr, s.ship_to, utløp),
  };
}

export function instruksjoner(ordreNr: string, adresse: string, utløp: Date) {
  return [
    "Sorter kortene i nøyaktig samme rekkefølge som kortlista under. Lista går sett for sett, og innenfor hvert sett fra de sjeldneste kortene til de vanligste. Gjør du dette, går mottaket raskere og du får oppgjøret fortere.",
    "Legg en lapp i pakken med ordrenummer " + ordreNr + ".",
    "Send til:\n" + adresse,
    "Pakken må være sendt innen " + utløp.toLocaleDateString("nb-NO") + " — etter det frigjøres kortene til andre selgere.",
    "Summen er et anslag. Jeg går gjennom alle kortene ved mottak og sjekker antall og tilstand. Avviker noe fra det du oppga, justerer jeg linjen og skriver hva som ble endret.",
    "Oppgjøret er butikkreditt på korthaien.no. Når kortene er godkjent, får du en rabattkode på e-post som du bruker i kassen.",
  ];
}

async function nyttOrdrenummer(nå: Date): Promise<string> {
  const d = nå.toISOString().slice(2, 10).replace(/-/g, "");
  for (let forsøk = 0; forsøk < 12; forsøk++) {
    const rand = Math.floor(1000 + Math.random() * 9000);
    const nr = `KH-${d}-${rand}`;
    const finnes = await db().execute({ sql: "SELECT 1 FROM orders WHERE order_no = ?", args: [nr] });
    if (!finnes.rows.length) return nr;
  }
  throw new HttpFeil(500, "Klarte ikke lage ordrenummer");
}

// ── utløp ────────────────────────────────────────────────────────────────────
// Uten dette blir kvoter liggende reservert av kunder som aldri sender pakken.
export async function utløpGamleOrdrer(): Promise<number> {
  const r = await db().execute({
    sql: `UPDATE orders SET status = 'expired'
           WHERE status = 'pending' AND expires_at < ?`,
    args: [new Date().toISOString()],
  });
  return r.rowsAffected || 0;
}

export async function hentOrdre(orderNo: string) {
  const o = await db().execute({ sql: "SELECT * FROM orders WHERE order_no = ?", args: [orderNo] });
  if (!o.rows[0]) return null;
  const l = await db().execute({
    sql: `SELECT * FROM order_lines WHERE order_id = ? AND fjernet_at IS NULL
           ORDER BY ${SORTERING}`,
    args: [o.rows[0].id],
  });
  return { ...o.rows[0], linjer: l.rows };
}

// ── endring ved mottak ───────────────────────────────────────────────────────
// Du endrer tilstand på en linje, og prisen skal følge trappen for settet.
// Regnestykket må gjøres her og ikke i admin — klienten skal aldri kunne
// bestemme et beløp, heller ikke din egen.
export async function regnOmLinje(
  linjeId: number,
  endring: { condition?: Condition; qty?: number; qty_received?: number }
): Promise<{ unit_ore: number; condition: Condition }> {
  const s = await hentSettings();
  const r = await db().execute({ sql: "SELECT * FROM order_lines WHERE id = ?", args: [linjeId] });
  const linje: any = r.rows[0];
  if (!linje) throw new HttpFeil(404, "Fant ikke linjen");

  const condition = (endring.condition || String(linje.condition)) as Condition;
  if (!CONDITIONS.includes(condition)) throw new HttpFeil(400, "Ukjent condition");

  const k = await db().execute({ sql: "SELECT * FROM cards WHERE id = ?", args: [String(linje.card_id)] });
  const kort: any = k.rows[0];
  // Kortet kan være borte etter en ny Scryfall-import. Da beholder vi prisen
  // linjen ble frosset med heller enn å nulle den ut.
  let unitØre = Number(linje.unit_ore || 0);
  if (kort) {
    const regel = await hentSetRule(String(kort.set_code), s);
    const manuell = await hentManuellPris(String(linje.card_id), String(linje.finish));
    const ny = prisØre(kort, String(linje.finish), condition, regel, s, manuell);
    // Tar jeg ikke imot tilstanden fra dette settet, blir prisen 0. Det er et
    // gyldig utfall — linjen betales ikke — men den skal ikke stilltiende
    // beholde gammel pris.
    unitØre = ny;
  }

  const felt: string[] = ["condition = ?", "unit_ore = ?", "unit_nok = ?"];
  const args: any[] = [condition, unitØre, Math.round(unitØre / 100)];
  for (const [navn, verdi] of [["qty", endring.qty], ["qty_received", endring.qty_received]] as const) {
    if (verdi !== undefined) {
      const n = Math.floor(Number(verdi));
      if (!Number.isFinite(n) || n < 0) throw new HttpFeil(400, `Ugyldig ${navn}`);
      felt.push(`${navn} = ?`);
      args.push(n);
    }
  }
  args.push(linjeId);
  await db().execute({ sql: `UPDATE order_lines SET ${felt.join(", ")} WHERE id = ?`, args });
  return { unit_ore: unitØre, condition };
}

// Totalen regnes alltid på det som faktisk er mottatt når det tallet finnes.
export async function oppdaterTotal(orderId: number): Promise<number> {
  const r = await db().execute({
    sql: `SELECT COALESCE(SUM(unit_ore * COALESCE(qty_received, qty)), 0) AS n
            FROM order_lines WHERE order_id = ? AND fjernet_at IS NULL`,
    args: [orderId],
  });
  const ore = Number(r.rows[0]?.n || 0);
  await db().execute({
    sql: "UPDATE orders SET total_ore = ?, total_nok = ? WHERE id = ?",
    args: [ore, Math.round(ore / 100), orderId],
  });
  return ore;
}

// ── linjer lagt til ved mottak ───────────────────────────────────────────────
// Kunden sендte et annet trykk enn hen trodde. Det er helt vanlig, og skal
// kunne rettes uten at ordren må gjøres om.
export async function leggTilLinje(
  orderId: number,
  input: { card_id: string; finish: string; condition: Condition; qty: number }
) {
  const s = await hentSettings();
  const k = await db().execute({ sql: "SELECT * FROM cards WHERE id = ?", args: [input.card_id] });
  const kort: any = k.rows[0];
  if (!kort) throw new HttpFeil(404, "Fant ikke kortet");
  if (!CONDITIONS.includes(input.condition)) throw new HttpFeil(400, "Ukjent condition");
  const qty = Math.floor(Number(input.qty));
  if (!Number.isFinite(qty) || qty < 1) throw new HttpFeil(400, "Antall må være minst 1");

  const regel = await hentSetRule(String(kort.set_code), s);
  const manuell = await hentManuellPris(input.card_id, input.finish);
  const ore = prisØre(kort, input.finish, input.condition, regel, s, manuell);

  const sett = await db().execute({ sql: "SELECT name FROM sets WHERE code = ?", args: [String(kort.set_code)] });
  await db().execute({
    sql: `INSERT INTO order_lines
            (order_id, card_id, finish, condition, condition_start, qty, qty_received,
             unit_nok, unit_ore, unit_ore_start, card_name, set_code, set_name,
             collector_number, rarity, kilde)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'admin')`,
    args: [
      orderId, input.card_id, input.finish, input.condition, input.condition,
      qty, qty, Math.round(ore / 100), ore, ore,
      String(kort.name), String(kort.set_code), String(sett.rows[0]?.name || kort.set_code),
      kort.collector_number ? String(kort.collector_number) : null,
      kort.rarity ? String(kort.rarity) : null,
    ],
  });
  return oppdaterTotal(orderId);
}

// Fjerning er en merking, ikke en sletting. Kunden skal kunne få vite at
// kortet ikke kom fram — og en slettet rad forklarer ingenting.
export async function fjernLinje(linjeId: number, angre = false): Promise<number> {
  const r = await db().execute({ sql: "SELECT order_id FROM order_lines WHERE id = ?", args: [linjeId] });
  if (!r.rows[0]) throw new HttpFeil(404, "Fant ikke linjen");
  await db().execute({
    sql: "UPDATE order_lines SET fjernet_at = ? WHERE id = ?",
    args: [angre ? null : new Date().toISOString(), linjeId],
  });
  return oppdaterTotal(Number(r.rows[0].order_id));
}

// ── endringslogg ─────────────────────────────────────────────────────────────
// Utledet, ikke lagret. Alt som trengs ligger allerede frosset på linjene, og
// en egen loggtabell ville før eller siden kommet i utakt med virkeligheten.
export type Endring = { hva: string; tekst: string };

export async function endringslogg(orderId: number): Promise<Endring[]> {
  const r = await db().execute({
    sql: `SELECT * FROM order_lines WHERE order_id = ? ORDER BY ${SORTERING}`,
    args: [orderId],
  });
  const ut: Endring[] = [];
  for (const l of r.rows as any[]) {
    const navn = `${l.card_name} (${l.set_name}${l.finish === "foil" ? ", foil" : ""})`;
    if (l.fjernet_at) {
      ut.push({ hva: "fjernet", tekst: `${navn}: kom ikke fram, tatt ut av ordren` });
      continue;
    }
    if (String(l.kilde) === "admin") {
      ut.push({ hva: "lagt_til", tekst: `${navn}: lagt til ved mottak, ${l.qty} stk. i ${l.condition}` });
      continue;
    }
    if (l.condition_start && l.condition_start !== l.condition) {
      ut.push({ hva: "condition", tekst: `${navn}: oppgitt ${l.condition_start}, vurdert til ${l.condition}` });
    }
    const mottatt = l.qty_received === null || l.qty_received === undefined ? null : Number(l.qty_received);
    if (mottatt !== null && mottatt !== Number(l.qty)) {
      ut.push({ hva: "antall", tekst: `${navn}: oppgitt ${l.qty} stk., mottatt ${mottatt}` });
    }
  }
  return ut;
}

// ── rabattkode ───────────────────────────────────────────────────────────────
// Koden lages manuelt i Mystore som et fastbeløp. Her lagres den bare, slik at
// den kan sendes i mottakseposten og slås opp igjen senere.
export async function settRabattkode(orderId: number, kode: string | null, notat?: string | null) {
  const ren = (kode || "").trim() || null;
  await db().execute({
    sql: "UPDATE orders SET discount_code = ?, credit_note = ? WHERE id = ?",
    args: [ren, notat ?? null, orderId],
  });
}

export async function markerKredittSendt(orderId: number) {
  const r = await db().execute({ sql: "SELECT discount_code FROM orders WHERE id = ?", args: [orderId] });
  if (!r.rows[0]) throw new HttpFeil(404, "Fant ikke ordren");
  if (!r.rows[0].discount_code) throw new HttpFeil(400, "Legg inn rabattkoden før du sender den");
  await db().execute({
    sql: "UPDATE orders SET credit_sent_at = ? WHERE id = ?",
    args: [new Date().toISOString(), orderId],
  });
}

export class HttpFeil extends Error {
  status: number;
  data: any;
  constructor(status: number, melding: string, data?: any) {
    super(melding);
    this.status = status;
    this.data = data;
  }
}
