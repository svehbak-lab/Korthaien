import { db } from "./db.js";
import type { SetRule } from "./pricing.js";

// ─────────────────────────────────────────────────────────────────────────────
// KVOTE
// ─────────────────────────────────────────────────────────────────────────────
//   ledig = ønsket − beholdning i Mystore − reservert i aktive ordrer
//
// Reservasjonsleddet er det som hindrer at to kunder samtidig får selge meg
// det samme siste eksemplaret. Reservasjonen holder helt til kortene er
// lagerført i Mystore. Slapp vi den ved mottak, ville kvoten stått åpen i
// vinduet mellom at pakken kommer og at varene er lagt inn.

export type Kvote = {
  wanted: number;
  stock: number;
  reserved: number;
  available: number;
  kilde: "kort" | "sett" | "av";
};

export async function hentKvote(
  cardId: string,
  finish: "nonfoil" | "foil",
  setCode: string,
  regel: SetRule
): Promise<Kvote> {
  const [want, stock, reserved] = await Promise.all([
    hentØnsket(cardId, finish, regel),
    hentBeholdning(cardId, finish),
    hentReservert(cardId, finish),
  ]);
  const available = Math.max(0, want.wanted - stock - reserved);
  return { wanted: want.wanted, stock, reserved, available, kilde: want.kilde };
}

async function hentØnsket(cardId: string, finish: string, regel: SetRule) {
  const r = await db().execute({
    sql: "SELECT wanted FROM card_wants WHERE card_id = ? AND finish = ?",
    args: [cardId, finish],
  });
  // Overstyring på kortnivå slår alltid settregelen, også når den er 0.
  if (r.rows[0]) return { wanted: Number(r.rows[0].wanted), kilde: "kort" as const };
  if (!regel.enabled) return { wanted: 0, kilde: "av" as const };
  // Foil har sitt eget antall på settet. Det arves aldri fra vanlig utgave —
  // prisene er helt ulike, og å arve tallet ville fylt hyllene med foils du
  // ikke har bedt om.
  if (finish === "foil") {
    return regel.wanted_foil > 0
      ? { wanted: regel.wanted_foil, kilde: "sett" as const }
      : { wanted: 0, kilde: "av" as const };
  }
  return { wanted: regel.wanted_default, kilde: "sett" as const };
}

async function hentBeholdning(cardId: string, finish: string): Promise<number> {
  const r = await db().execute({
    sql: "SELECT qty FROM mystore_stock WHERE card_id = ? AND finish = ?",
    args: [cardId, finish],
  });
  return r.rows[0] ? Number(r.rows[0].qty) : 0;
}

async function hentReservert(cardId: string, finish: string): Promise<number> {
  const r = await db().execute({
    sql: `SELECT COALESCE(SUM(l.qty), 0) AS n
            FROM order_lines l
            JOIN orders o ON o.id = l.order_id
           WHERE l.card_id = ? AND l.finish = ? AND o.status IN ('pending','received')`,
    args: [cardId, finish],
  });
  return Number(r.rows[0]?.n || 0);
}

// Bulkvariant — én spørring for mange kort, brukes av søk og bulkinnlegging.
export async function hentKvoterBulk(
  nøkler: { card_id: string; finish: string }[]
): Promise<Map<string, { stock: number; reserved: number; want: number | null }>> {
  const kart = new Map<string, { stock: number; reserved: number; want: number | null }>();
  if (!nøkler.length) return kart;
  const ids = [...new Set(nøkler.map((n) => n.card_id))];
  const plassholdere = ids.map(() => "?").join(",");

  const [stock, reserved, wants] = await Promise.all([
    db().execute({
      sql: `SELECT card_id, finish, qty FROM mystore_stock WHERE card_id IN (${plassholdere})`,
      args: ids,
    }),
    db().execute({
      sql: `SELECT l.card_id, l.finish, COALESCE(SUM(l.qty),0) AS n
              FROM order_lines l JOIN orders o ON o.id = l.order_id
             WHERE o.status IN ('pending','received') AND l.card_id IN (${plassholdere})
             GROUP BY l.card_id, l.finish`,
      args: ids,
    }),
    db().execute({
      sql: `SELECT card_id, finish, wanted FROM card_wants WHERE card_id IN (${plassholdere})`,
      args: ids,
    }),
  ]);

  const hent = (k: string) => {
    if (!kart.has(k)) kart.set(k, { stock: 0, reserved: 0, want: null });
    return kart.get(k)!;
  };
  for (const r of stock.rows) hent(`${r.card_id}:${r.finish}`).stock = Number(r.qty);
  for (const r of reserved.rows) hent(`${r.card_id}:${r.finish}`).reserved = Number(r.n);
  for (const r of wants.rows) hent(`${r.card_id}:${r.finish}`).want = Number(r.wanted);
  return kart;
}

export function regnLedig(
  oppslag: { stock: number; reserved: number; want: number | null } | undefined,
  finish: string,
  regel: SetRule
): Kvote {
  const stock = oppslag?.stock || 0;
  const reserved = oppslag?.reserved || 0;
  let wanted: number;
  let kilde: Kvote["kilde"];
  if (oppslag && oppslag.want !== null) {
    wanted = oppslag.want;
    kilde = "kort";
  } else if (!regel.enabled) {
    wanted = 0;
    kilde = "av";
  } else if (finish === "foil") {
    wanted = regel.wanted_foil || 0;
    kilde = wanted > 0 ? "sett" : "av";
  } else {
    wanted = regel.wanted_default;
    kilde = "sett";
  }
  return { wanted, stock, reserved, available: Math.max(0, wanted - stock - reserved), kilde };
}
