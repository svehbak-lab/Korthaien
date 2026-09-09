import { db, hentSettings, CONDITIONS, type Condition } from "./db.js";
import { beregnPris, hentSetRule, prisenFor } from "./pricing.js";
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
    const pris = beregnPris(prisenFor(kort, l.finish), l.condition, regel, s);
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
      unit_nok: pris,
      card_name: String(kort.name),
      set_code: String(kort.set_code),
      set_name: String(kort.set_name || kort.set_code),
      collector_number: kort.collector_number ? String(kort.collector_number) : null,
    });
  }

  if (!godkjent.length) throw new HttpFeil(409, "Ingen av kortene kunne tas imot", { avvist });

  // Sortert på settnavn og deretter kortnavn. Kunden får beskjed om å legge
  // bunken i samme rekkefølge, så mottakskontrollen går rett gjennom lista.
  godkjent.sort(
    (a, b) =>
      a.set_name.localeCompare(b.set_name, "nb") ||
      a.card_name.localeCompare(b.card_name, "nb") ||
      a.finish.localeCompare(b.finish) ||
      CONDITIONS.indexOf(a.condition) - CONDITIONS.indexOf(b.condition)
  );

  const total = godkjent.reduce((n, l) => n + l.unit_nok * l.qty, 0);
  const nå = new Date();
  const utløp = new Date(nå.getTime() + s.order_expiry_days * 86400000);
  const ordreNr = await nyttOrdrenummer(nå);

  const res = await db().execute({
    sql: `INSERT INTO orders (order_no, customer_name, email, phone, status, total_nok, note, created_at, expires_at)
          VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?)`,
    args: [ordreNr, navn, epost, input.phone || null, total, input.note || null, nå.toISOString(), utløp.toISOString()],
  });
  const ordreId = Number(res.lastInsertRowid);

  for (const l of godkjent) {
    await db().execute({
      sql: `INSERT INTO order_lines
              (order_id, card_id, finish, condition, qty, unit_nok, card_name, set_code, set_name, collector_number)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [ordreId, l.card_id, l.finish, l.condition, l.qty, l.unit_nok, l.card_name, l.set_code, l.set_name, l.collector_number],
    });
  }

  return {
    order_no: ordreNr,
    total_nok: total,
    expires_at: utløp.toISOString(),
    linjer: godkjent,
    avvist,
    instruksjoner: instruksjoner(ordreNr, s.ship_to, utløp),
  };
}

function instruksjoner(ordreNr: string, adresse: string, utløp: Date) {
  return [
    "Sorter kortene i nøyaktig samme rekkefølge som kortlista i denne bekreftelsen. Det gjør mottaket raskere, og du får oppgjøret fortere.",
    "Legg en lapp i pakken med ordrenummer " + ordreNr + ".",
    "Send til:\n" + adresse,
    "Pakken må være sendt innen " + utløp.toLocaleDateString("nb-NO") + ". Etter det frigjøres kortene til andre selgere.",
    "Kortene sjekkes mot oppgitt condition ved mottak. Avviker de, tar jeg kontakt før noe justeres.",
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
    sql: "SELECT * FROM order_lines WHERE order_id = ? ORDER BY set_name, card_name",
    args: [o.rows[0].id],
  });
  return { ...o.rows[0], linjer: l.rows };
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
