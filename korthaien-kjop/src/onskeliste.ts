import { db } from "./db.js";
import { tilgjengeligFor, butikkUrl } from "./salg.js";

// ─────────────────────────────────────────────────────────────────────────────
// ØNSKELISTE
// ─────────────────────────────────────────────────────────────────────────────
// Kunden ber om beskjed når et kort er på lager — én bestemt utgave, eller
// hvilken som helst. En jobb sjekker jevnlig og sender én e-post per kunde
// med det som har kommet inn. Kortet må være ledig (ikke holdt av i en åpen
// kasse) for å telle.

export class ØnskeFeil extends Error {
  constructor(public status: number, melding: string) {
    super(melding);
  }
}

type Finish = "alle" | "foil" | "nonfoil";
const tilFinish = (f: unknown): Finish => (f === "foil" || f === "nonfoil" ? f : "alle");

export async function leggTilØnske(kundeId: number, inn: { card_id: string; hvilken?: string; finish?: string }) {
  const r = await db().execute({ sql: "SELECT id, oracle_id, name FROM cards WHERE id = ?", args: [String(inn.card_id || "")] });
  const k: any = r.rows[0];
  if (!k) throw new ØnskeFeil(404, "Fant ikke kortet.");
  const alle = inn.hvilken !== "denne";
  const antall = await db().execute({ sql: "SELECT COUNT(*) AS n FROM onskeliste WHERE kunde_id = ?", args: [kundeId] });
  if (Number(antall.rows[0].n) >= 500) throw new ØnskeFeil(400, "Ønskelista er full (500 kort).");
  await db().execute({
    sql: `INSERT INTO onskeliste (kunde_id, oracle_id, card_id, finish, navn, created_at)
          VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
    args: [kundeId, String(k.oracle_id || k.id), alle ? "" : String(k.id), tilFinish(inn.finish), String(k.name), new Date().toISOString()],
  });
  return hentØnsker(kundeId);
}

export async function fjernØnske(kundeId: number, id: number) {
  await db().execute({ sql: "DELETE FROM onskeliste WHERE id = ? AND kunde_id = ?", args: [id, kundeId] });
  return hentØnsker(kundeId);
}

// Kortene et ønske gjelder, og hvor mange som er ledige.
async function status(ønsker: any[]) {
  const oracle = [...new Set(ønsker.filter((ø) => !ø.card_id).map((ø) => String(ø.oracle_id)))];
  const bestemte = [...new Set(ønsker.filter((ø) => ø.card_id).map((ø) => String(ø.card_id)))];
  const kort: any[] = [];
  for (let i = 0; i < oracle.length; i += 300) {
    const del = oracle.slice(i, i + 300);
    const r = await db().execute({
      sql: `SELECT id, oracle_id FROM cards WHERE er_token = 0 AND oracle_id IN (${del.map(() => "?").join(",")})`,
      args: del,
    });
    kort.push(...r.rows);
  }
  const ider = [...new Set([...kort.map((k) => String(k.id)), ...bestemte])];
  const ledig = ider.length ? await tilgjengeligFor(ider.map((card_id) => ({ card_id }))) : new Map<string, number>();
  const perOracle = new Map<string, string[]>();
  for (const k of kort) {
    const o = String(k.oracle_id);
    if (!perOracle.has(o)) perOracle.set(o, []);
    perOracle.get(o)!.push(String(k.id));
  }
  return ønsker.map((ø) => {
    const kandidater = ø.card_id ? [String(ø.card_id)] : perOracle.get(String(ø.oracle_id)) || [];
    let antall = 0;
    let førsteKort: string | null = null;
    for (const [nøkkel, n] of ledig) {
      if (n <= 0) continue;
      const [id, finish] = nøkkel.split(":");
      if (!kandidater.includes(id)) continue;
      if (ø.finish !== "alle" && ø.finish !== finish) continue;
      antall += n;
      førsteKort ??= id;
    }
    return { ...ø, på_lager: antall, kort_id: førsteKort || ø.card_id || kandidater[0] || null };
  });
}

export async function hentØnsker(kundeId: number) {
  const r = await db().execute({
    sql: `SELECT o.*, c.set_code, COALESCE(s.visningsnavn, s.name) AS set_name, c.collector_number, c.image_uri
            FROM onskeliste o
            LEFT JOIN cards c ON c.id = o.card_id
            LEFT JOIN sets s ON s.code = c.set_code
           WHERE o.kunde_id = ? ORDER BY o.navn`,
    args: [kundeId],
  });
  return status(r.rows as any[]);
}

// Jobben: send beskjed om det som har kommet inn, og nullstill det som er
// utsolgt igjen. Bare til kunder med bekreftet e-post.
export async function varsleØnsker(send?: (email: string, kort: { navn: string; url: string; finish: string }[]) => Promise<any>) {
  const r = await db().execute(`
    SELECT o.*, k.email FROM onskeliste o JOIN kunder k ON k.id = o.kunde_id
     WHERE k.epost_bekreftet_at IS NOT NULL`);
  if (!r.rows.length) return { varslet: 0, nullstilt: 0 };
  const alle = await status(r.rows as any[]);
  const nå = new Date().toISOString();
  const nye = alle.filter((ø) => ø.på_lager > 0 && !ø.varslet_at);
  const tomme = alle.filter((ø) => ø.på_lager === 0 && ø.varslet_at);
  if (tomme.length) {
    await db().batch(tomme.map((ø) => ({ sql: "UPDATE onskeliste SET varslet_at = NULL WHERE id = ?", args: [ø.id] })), "write");
  }
  const perKunde = new Map<string, any[]>();
  for (const ø of nye) {
    if (!perKunde.has(ø.email)) perKunde.set(ø.email, []);
    perKunde.get(ø.email)!.push(ø);
  }
  const sender = send ?? (async (e: string, k: any[]) => (await import("./epost.js")).sendØnskelisteVarsel(e, k));
  let varslet = 0;
  for (const [email, liste] of perKunde) {
    await sender(
      email,
      liste.map((ø) => ({
        navn: String(ø.navn),
        finish: ø.finish,
        url: `${butikkUrl()}/?kort=${encodeURIComponent(String(ø.kort_id || ""))}`,
      }))
    );
    await db().batch(liste.map((ø) => ({ sql: "UPDATE onskeliste SET varslet_at = ? WHERE id = ?", args: [nå, ø.id] })), "write");
    varslet += liste.length;
  }
  return { varslet, nullstilt: tomme.length };
}
