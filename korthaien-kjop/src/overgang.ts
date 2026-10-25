import { db } from "./db.js";
import { lagerkilde, settBokSomLagerkilde } from "./lager.js";

// ─────────────────────────────────────────────────────────────────────────────
// OVERGANGEN FRA MYSTORE
// ─────────────────────────────────────────────────────────────────────────────
// Én operasjon som tømmer lagerboken og fører Mystore-beholdningen inn som
// startbeholdning, og så bytter butikken til lagerboken. Kjøres etter siste
// fulle lagersynk, når Mystore er stengt. Nekter hvis det finnes åpne eller
// usendte salgsordrer — salgsbevegelsene deres ville forsvunnet med boken.

export class OvergangFeil extends Error {
  constructor(public status: number, melding: string) {
    super(melding);
  }
}

export async function overgangsstatus() {
  const [bok, mystore, sist, salg, kjop] = await Promise.all([
    db().execute(`SELECT grunn, COUNT(*) AS n, COALESCE(SUM(antall), 0) AS stk FROM lager_bevegelser GROUP BY grunn`),
    db().execute(`SELECT COUNT(*) AS kort, COALESCE(SUM(qty), 0) AS stk FROM mystore_stock WHERE qty > 0`),
    db().execute(`SELECT MAX(synced_at) AS t FROM mystore_stock`),
    db().execute(`SELECT COUNT(*) AS n FROM salgsordrer WHERE status IN ('apen', 'betalt', 'pakket')`),
    db().execute(`SELECT COUNT(*) AS n FROM orders WHERE status IN ('received', 'stocked') AND kvote_frigitt_at IS NULL`),
  ]);
  return {
    lagerkilde: lagerkilde(),
    bok: (bok.rows as any[]).map((x) => ({ grunn: String(x.grunn), rader: Number(x.n), stk: Number(x.stk) })),
    mystore: { kort: Number((mystore.rows[0] as any).kort), stk: Number((mystore.rows[0] as any).stk), sist_synket: (sist.rows[0] as any)?.t ?? null },
    usendte_salg: Number((salg.rows[0] as any).n),
    kjop_ikke_lagt_inn: Number((kjop.rows[0] as any).n),
  };
}


export async function gjennomførOvergang() {
  const før = await overgangsstatus();
  if (før.usendte_salg > 0) {
    throw new OvergangFeil(409, `Det finnes ${før.usendte_salg} åpne eller usendte salgsordrer. Send eller kanseller dem først.`);
  }
  if (!før.mystore.kort) throw new OvergangFeil(409, "Mystore-speilet er tomt. Kjør Full lagersynk først.");
  const nå = new Date().toISOString();
  await db().batch(
    [
      { sql: "DELETE FROM lager_bevegelser", args: [] },
      {
        sql: `INSERT INTO lager_bevegelser (card_id, finish, condition, antall, grunn, order_id, notat, created_at)
              SELECT card_id, finish, 'NM', qty, 'mystore', NULL, 'Åpningsbeholdning fra Mystore', COALESCE(inn_at, ?)
                FROM mystore_stock WHERE qty > 0`,
        args: [nå],
      },
      {
        sql: `INSERT INTO settings (key, value) VALUES ('lagerkilde', '"bok"')
              ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        args: [],
      },
    ],
    "write"
  );
  settBokSomLagerkilde(true);
  console.log(`Overgang: lagerboken tømt og ${før.mystore.kort} kort (${før.mystore.stk} stk.) ført inn fra Mystore.`);
  return overgangsstatus();
}
