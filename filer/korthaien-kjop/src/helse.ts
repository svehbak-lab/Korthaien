import { db } from "./db.js";

// ─────────────────────────────────────────────────────────────────────────────
// HELSESJEKK
// ─────────────────────────────────────────────────────────────────────────────
// Feil i koblingene er stille. Et produkt koblet til to kort, eller et kort
// med beholdning fra et produkt som ikke finnes lenger, gir feil kvote uten
// at noe varsler. Denne kommandoen leter etter slikt.

export type Funn = { alvor: "feil" | "advarsel"; hva: string; antall: number; eksempler: string[] };

export async function helsesjekk(logg: (s: string) => void = console.log): Promise<Funn[]> {
  const funn: Funn[] = [];

  // Ett produkt skal peke på nøyaktig ett kort. Peker det på flere, er minst
  // én av dem gal, og beholdningen telles to steder.
  const dobbel = await db().execute(`
    SELECT m.product_id, COUNT(*) AS n,
           GROUP_CONCAT(c.name || ' #' || COALESCE(c.collector_number,'?')) AS kort
      FROM mystore_stock m JOIN cards c ON c.id = m.card_id
     WHERE m.product_id IS NOT NULL
     GROUP BY m.product_id HAVING COUNT(*) > 1
     ORDER BY n DESC LIMIT 50`);
  if (dobbel.rows.length) {
    funn.push({
      alvor: "feil",
      hva: "produkter koblet til flere kort",
      antall: dobbel.rows.length,
      eksempler: dobbel.rows.slice(0, 5).map((r: any) => `${r.product_id}: ${r.kort}`),
    });
  }

  // Beholdning uten produkt bak seg. Tallet oppdateres aldri.
  const foreldreløs = await db().execute(`
    SELECT COUNT(*) AS n FROM mystore_stock WHERE product_id IS NULL OR product_id = ''`);
  const n1 = Number(foreldreløs.rows[0]?.n || 0);
  if (n1) funn.push({ alvor: "advarsel", hva: "lagerrader uten produkt", antall: n1, eksempler: [] });

  // Koblinger som ikke er oppdatert på lenge, i sett du kjøper fra. Enten er
  // produktet borte, eller så synkes ikke kategorien lenger.
  const gamle = await db().execute(`
    SELECT c.set_code, COUNT(*) AS n FROM mystore_stock m
      JOIN cards c ON c.id = m.card_id
      JOIN set_rules r ON r.set_code = c.set_code AND r.enabled = 1
     WHERE m.synced_at < datetime('now', '-7 days')
     GROUP BY c.set_code ORDER BY n DESC LIMIT 10`);
  if (gamle.rows.length) {
    const sum = gamle.rows.reduce((a: number, r: any) => a + Number(r.n), 0);
    funn.push({
      alvor: "advarsel",
      hva: "koblinger eldre enn en uke i aktive sett",
      antall: sum,
      eksempler: gamle.rows.slice(0, 5).map((r: any) => `${String(r.set_code).toUpperCase()}: ${r.n}`),
    });
  }

  // Kort med ønsket antall satt, men uten kobling. Da regnes beholdningen som
  // 0, og kunden kan selge deg noe du har fullt av.
  const utenKobling = await db().execute(`
    SELECT COUNT(*) AS n FROM card_wants w
      JOIN cards c ON c.id = w.card_id
     WHERE w.wanted > 0
       AND NOT EXISTS (SELECT 1 FROM mystore_stock m WHERE m.card_id = w.card_id AND m.finish = w.finish)`);
  const n2 = Number(utenKobling.rows[0]?.n || 0);
  if (n2) {
    funn.push({
      alvor: "advarsel",
      hva: "enkeltkort du vil ha, uten kobling mot Korthaien",
      antall: n2,
      eksempler: [],
    });
  }

  logg("");
  if (!funn.length) {
    logg("  Ingen problemer funnet.");
  } else {
    for (const f of funn) {
      logg(`  ${f.alvor === "feil" ? "✗" : "!"} ${f.antall} ${f.hva}`);
      for (const e of f.eksempler) logg(`      ${e}`);
    }
  }

  const total = await db().execute(`
    SELECT (SELECT COUNT(*) FROM mystore_stock) AS koblet,
           (SELECT COUNT(*) FROM mystore_unmatched) AS ukoblet,
           (SELECT COUNT(*) FROM set_rules WHERE enabled = 1) AS sett`);
  const t: any = total.rows[0];
  logg(`\n  ${t.koblet} koblinger, ${t.ukoblet} ukoblede produkter, ${t.sett} aktive sett.`);
  return funn;
}
