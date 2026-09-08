import { db } from "./db.js";
import { lagSkrivefeilrapport, type Rad } from "./skrivefeil.js";
import { writeFileSync } from "node:fs";

// ─────────────────────────────────────────────────────────────────────────────
// OPPRYDDING
// ─────────────────────────────────────────────────────────────────────────────
// Godtar de entydige skrivefeilforslagene og merker tokens som ikke-kort, så
// Kobling-fanen bare inneholder det som faktisk trenger et menneske.
//
// Alt som gjøres her merkes med kilde, og kan angres samlet med --angre.
// Automatiske koblinger på 2947 produkter uten en vei tilbake er ikke noe
// noen skal måtte leve med.

export async function ryddOpp(
  opts: { rapportSti?: string } = {},
  logg: (s: string) => void = console.log
) {
  const rader = await lagSkrivefeilrapport("/dev/null", () => {});
  if (!rader.length) {
    logg("Ingen ukoblede produkter.");
    return { skrivefeil: 0, tokens: 0, igjen: 0 };
  }

  const nå = new Date().toISOString();
  const lenker: { sql: string; args: any[] }[] = [];
  const lager: { sql: string; args: any[] }[] = [];

  const skrivefeil = rader.filter((r) => r.gruppe === "skrivefeil" && r.forslagId);
  const tokens = rader.filter((r) => r.gruppe === "token");

  for (const r of skrivefeil) {
    const finish = r.foil ? "foil" : "nonfoil";
    lenker.push({
      sql: `INSERT INTO mystore_links (product_id, card_id, finish, ignored, kilde, updated_at)
            VALUES (?, ?, ?, 0, 'auto-skrivefeil', ?)
            ON CONFLICT(product_id) DO UPDATE SET
              card_id = excluded.card_id, finish = excluded.finish,
              ignored = 0, kilde = excluded.kilde, updated_at = excluded.updated_at`,
      args: [r.produktId, r.forslagId, finish, nå],
    });
    // Beholdningen skrives med én gang, så kvoten er riktig uten å vente på
    // neste synk.
    lager.push({
      sql: `INSERT INTO mystore_stock (card_id, finish, qty, product_id, synced_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(card_id, finish) DO UPDATE SET
              qty = excluded.qty, product_id = excluded.product_id, synced_at = excluded.synced_at`,
      args: [r.forslagId, finish, r.lager, r.produktId, nå],
    });
  }

  for (const r of tokens) {
    lenker.push({
      sql: `INSERT INTO mystore_links (product_id, card_id, finish, ignored, kilde, updated_at)
            VALUES (?, NULL, NULL, 1, 'auto-token', ?)
            ON CONFLICT(product_id) DO UPDATE SET
              ignored = 1, card_id = NULL, kilde = excluded.kilde, updated_at = excluded.updated_at`,
      args: [r.produktId, nå],
    });
  }

  for (const bunt of [lenker, lager]) {
    for (let i = 0; i < bunt.length; i += 300) await db().batch(bunt.slice(i, i + 300), "write");
  }

  // Ryddede produkter skal ut av lista med det samme, ikke ved neste synk.
  const ryddet = [...skrivefeil, ...tokens].map((r) => r.produktId);
  for (let i = 0; i < ryddet.length; i += 300) {
    const del = ryddet.slice(i, i + 300);
    await db().execute({
      sql: `DELETE FROM mystore_unmatched WHERE product_id IN (${del.map(() => "?").join(",")})`,
      args: del,
    });
  }

  const igjen = rader.filter((r) => r.gruppe === "ukjent" || r.gruppe === "tvetydig");
  logg(`${skrivefeil.length} skrivefeil koblet til riktig kort.`);
  logg(`${tokens.length} tokens merket som ikke-kort.`);
  logg(`${igjen.length} produkter står igjen.`);

  if (opts.rapportSti) skrivGjenstående(igjen, opts.rapportSti, logg);
  return { skrivefeil: skrivefeil.length, tokens: tokens.length, igjen: igjen.length };
}

// Gruppert per sett, siden et helt sett med bom som regel betyr én årsak —
// feil settkobling — og ikke hundre uavhengige feil.
function skrivGjenstående(rader: Rad[], sti: string, logg: (s: string) => void) {
  const perSett = new Map<string, Rad[]>();
  for (const r of rader) {
    if (!perSett.has(r.sett)) perSett.set(r.sett, []);
    perSett.get(r.sett)!.push(r);
  }
  const sortert = [...perSett.entries()].sort((a, b) => b[1].length - a[1].length);

  const csv = [
    "Sett;Antall i settet;Produktnavn;Kategori;Pa lager;Naermeste treff;Avstand",
    ...sortert.flatMap(([sett, liste]) =>
      liste
        .sort((a, b) => b.lager - a.lager || a.produkt.localeCompare(b.produkt, "nb"))
        .map((r) =>
          [sett.toUpperCase(), liste.length, r.produkt, r.kategori, r.lager, r.forslag, r.avstand ?? ""]
            .map((f) => `"${String(f).replace(/"/g, '""')}"`)
            .join(";")
        )
    ),
  ].join("\r\n");
  writeFileSync(sti, "\uFEFF" + csv, "utf8");

  logg(`\nSkrevet til ${sti}`);
  logg("\nSett med flest gjenstående — mange fra samme sett betyr som regel én årsak:");
  for (const [sett, liste] of sortert.slice(0, 15)) {
    const eksempel = liste[0]?.produkt || "";
    logg(`  ${sett.toUpperCase().padEnd(6)} ${String(liste.length).padStart(4)} stk   f.eks. «${eksempel}»`);
  }
}

export async function angreOpprydding(logg: (s: string) => void = console.log) {
  const r = await db().execute("DELETE FROM mystore_links WHERE kilde LIKE 'auto-%'");
  logg(`${r.rowsAffected || 0} automatiske koblinger fjernet. Kjør «npm run mystore» for å bygge lista på nytt.`);
  return r.rowsAffected || 0;
}
