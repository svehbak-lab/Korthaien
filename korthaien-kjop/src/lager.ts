import { db, CONDITIONS, type Condition } from "./db.js";

// ─────────────────────────────────────────────────────────────────────────────
// VARELAGER
// ─────────────────────────────────────────────────────────────────────────────
// Lageret er en rekke bevegelser, ikke et tall. Beholdningen er summen av dem.
//
// Det koster ingenting ekstra å føre det slik, og det gir to ting et enkelt
// tall ikke kan: du ser alltid hvor et kort kom fra, og en feil rettes ved å
// legge til en motpost i stedet for å gjette hva tallet var før. Det er også
// det som gjør varetelling mulig — teller du tre der systemet sier fire, blir
// differansen en egen linje med sin egen grunn, ikke et tall som stilltiende
// overskrives.
//
// Kostnad føres ikke her. Innkjøpsprisen finnes i kjøpsordrene for kortene som
// kom den veien, og finnes ikke i det hele tatt for et parti displaybokser.
// Et snitt av de to ville sett presist ut og vært oppdiktet.

export type Grunn = "ordre" | "mystore" | "manuell" | "telling" | "reversert" | "salg";

export type Bevegelse = {
  card_id: string;
  finish: string;
  condition: Condition;
  // Fortegn: positivt inn på lager, negativt ut.
  antall: number;
  grunn: Grunn;
  order_id?: number | null;
  notat?: string | null;
};

const nøkkel = (card_id: string, finish: string, condition: string) =>
  `${card_id}:${finish}:${condition}`;

export async function førBevegelser(rader: Bevegelse[]): Promise<number> {
  const gyldige = rader.filter(
    (r) => r.card_id && r.antall && CONDITIONS.includes(r.condition)
  );
  if (!gyldige.length) return 0;

  const nå = new Date().toISOString();
  await db().batch(
    gyldige.map((r) => ({
      sql: `INSERT INTO lager_bevegelser
              (card_id, finish, condition, antall, grunn, order_id, notat, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        r.card_id,
        r.finish === "foil" ? "foil" : "nonfoil",
        r.condition,
        Math.trunc(r.antall),
        r.grunn,
        r.order_id ?? null,
        r.notat ?? null,
        nå,
      ],
    })),
    "write"
  );
  return gyldige.length;
}

// ── beholdning ───────────────────────────────────────────────────────────────
export async function beholdning(cardIds: string[]): Promise<Map<string, number>> {
  const kart = new Map<string, number>();
  const ider = [...new Set(cardIds)].filter(Boolean);
  if (!ider.length) return kart;
  for (let i = 0; i < ider.length; i += 400) {
    const del = ider.slice(i, i + 400);
    const r = await db().execute({
      sql: `SELECT card_id, finish, condition, SUM(antall) AS n
              FROM lager_bevegelser
             WHERE card_id IN (${del.map(() => "?").join(",")})
             GROUP BY card_id, finish, condition
            HAVING n <> 0`,
      args: del,
    });
    for (const x of r.rows as any[]) {
      kart.set(nøkkel(String(x.card_id), String(x.finish), String(x.condition)), Number(x.n));
    }
  }
  return kart;
}

export async function beholdningFor(
  cardId: string,
  finish: string,
  condition: Condition
): Promise<number> {
  const r = await db().execute({
    sql: `SELECT COALESCE(SUM(antall), 0) AS n FROM lager_bevegelser
           WHERE card_id = ? AND finish = ? AND condition = ?`,
    args: [cardId, finish, condition],
  });
  return Number(r.rows[0]?.n || 0);
}

// Historikken bak ett kort. Det er denne som svarer på «hvor kom disse fra».
export async function historikk(cardId: string, finish?: string) {
  const r = await db().execute({
    sql: `SELECT b.*, o.order_no FROM lager_bevegelser b
            LEFT JOIN orders o ON o.id = b.order_id
           WHERE b.card_id = ? ${finish ? "AND b.finish = ?" : ""}
           ORDER BY b.id DESC LIMIT 200`,
    args: finish ? [cardId, finish] : [cardId],
  });
  return r.rows;
}

// ── fra kjøpsordre ───────────────────────────────────────────────────────────
// Kortene går inn når du gjør opp ordren. Fjernede linjer teller ikke, og
// mottatt antall går foran oppgitt — det er det som faktisk lå i konvolutten.
export async function bokførOrdre(orderId: number): Promise<{ ført: number; grunn?: string }> {
  const fins = await db().execute({
    sql: "SELECT COUNT(*) AS n FROM lager_bevegelser WHERE order_id = ? AND grunn = 'ordre'",
    args: [orderId],
  });
  // To klikk på «gjør opp» skal ikke gi kortene to ganger.
  if (Number(fins.rows[0]?.n || 0) > 0) return { ført: 0, grunn: "allerede bokført" };

  const l = await db().execute({
    sql: `SELECT card_id, finish, condition, qty, qty_received
            FROM order_lines WHERE order_id = ? AND fjernet_at IS NULL`,
    args: [orderId],
  });

  const rader: Bevegelse[] = [];
  for (const x of l.rows as any[]) {
    const antall = Number(x.qty_received ?? x.qty);
    if (antall > 0) {
      rader.push({
        card_id: String(x.card_id),
        finish: String(x.finish),
        condition: String(x.condition) as Condition,
        antall,
        grunn: "ordre",
        order_id: orderId,
      });
    }
  }
  return { ført: await førBevegelser(rader) };
}

// Motposter i stedet for sletting. Da ser du at det skjedde, og hvorfor.
export async function reverserOrdre(orderId: number): Promise<{ ført: number; grunn?: string }> {
  const r = await db().execute({
    sql: `SELECT card_id, finish, condition, SUM(antall) AS n
            FROM lager_bevegelser WHERE order_id = ?
           GROUP BY card_id, finish, condition HAVING n <> 0`,
    args: [orderId],
  });
  if (!r.rows.length) return { ført: 0, grunn: "ingenting å reversere" };

  const rader: Bevegelse[] = (r.rows as any[]).map((x) => ({
    card_id: String(x.card_id),
    finish: String(x.finish),
    condition: String(x.condition) as Condition,
    antall: -Number(x.n),
    grunn: "reversert",
    order_id: orderId,
    notat: "Oppgjøret ble åpnet på nytt",
  }));
  return { ført: await førBevegelser(rader) };
}

// ── manuell justering ────────────────────────────────────────────────────────
// Ved nye utgivelser åpner du bokser og fører inn det du faktisk har. Du
// oppgir beholdningen, ikke differansen — bevegelsen regnes ut herfra, så du
// slipper å regne i hodet.
export async function settBeholdning(
  cardId: string,
  finish: string,
  condition: Condition,
  antall: number,
  grunn: Grunn = "manuell"
): Promise<{ før: number; etter: number; endring: number }> {
  const før = await beholdningFor(cardId, finish, condition);
  const mål = Math.max(0, Math.trunc(antall));
  const endring = mål - før;
  if (endring !== 0) {
    await førBevegelser([{ card_id: cardId, finish, condition, antall: endring, grunn }]);
  }
  return { før, etter: mål, endring };
}

// ── åpningsbeholdning ────────────────────────────────────────────────────────
// Det du allerede har i Mystore, ført inn som én bevegelse per kort med grunn
// «mystore». Da er det tydelig hva som er arvet og hva du har ført selv.
export async function åpningsbeholdningFraMystore(
  logg: (s: string) => void = console.log
): Promise<{ kort: number; stykker: number }> {
  const fins = await db().execute(
    "SELECT COUNT(*) AS n FROM lager_bevegelser WHERE grunn = 'mystore'"
  );
  if (Number(fins.rows[0]?.n || 0) > 0) {
    logg("Åpningsbeholdningen er allerede lagt inn. Kjør ikke denne to ganger.");
    return { kort: 0, stykker: 0 };
  }

  const r = await db().execute(
    "SELECT card_id, finish, qty FROM mystore_stock WHERE qty > 0"
  );
  // Alt som Near Mint. Mystore fører ikke tilstand, og NM er det du har i
  // praksis — avvik retter du ved telling.
  const rader: Bevegelse[] = (r.rows as any[]).map((x) => ({
    card_id: String(x.card_id),
    finish: String(x.finish),
    condition: "NM" as Condition,
    antall: Number(x.qty),
    grunn: "mystore" as Grunn,
    notat: "Åpningsbeholdning fra Mystore",
  }));

  let ført = 0;
  for (let i = 0; i < rader.length; i += 500) {
    ført += await førBevegelser(rader.slice(i, i + 500));
    if (i && i % 5000 === 0) logg(`  ${i} av ${rader.length}…`);
  }
  const stykker = rader.reduce((n, r) => n + r.antall, 0);
  logg(`Lagt inn ${ført} kort, ${stykker} eksemplarer til sammen.`);
  return { kort: ført, stykker };
}

// ── sammenligning ────────────────────────────────────────────────────────────
// Så lenge Mystore er fasit, er avviket det som forteller om modellen holder.
export async function avvikMotMystore(maks = 100) {
  const r = await db().execute({
    sql: `SELECT COALESCE(m.card_id, b.card_id) AS card_id,
                 COALESCE(m.finish, b.finish)   AS finish,
                 COALESCE(m.qty, 0)             AS mystore,
                 COALESCE(b.n, 0)               AS eget,
                 c.name, c.set_code
            FROM mystore_stock m
            FULL OUTER JOIN (
              SELECT card_id, finish, SUM(antall) AS n
                FROM lager_bevegelser GROUP BY card_id, finish
            ) b ON b.card_id = m.card_id AND b.finish = m.finish
            LEFT JOIN cards c ON c.id = COALESCE(m.card_id, b.card_id)
           WHERE COALESCE(m.qty, 0) <> COALESCE(b.n, 0)
           ORDER BY ABS(COALESCE(m.qty, 0) - COALESCE(b.n, 0)) DESC
           LIMIT ?`,
    args: [maks],
  });
  return r.rows;
}
