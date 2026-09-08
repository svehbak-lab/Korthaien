import { db, normaliser } from "./db.js";

// ─────────────────────────────────────────────────────────────────────────────
// ANALYSER EN GRUPPE UKOBLEDE PRODUKTER
// ─────────────────────────────────────────────────────────────────────────────
// Når 730 produkter under samme settkode ikke finner kortet sitt, er det som
// regel én årsak, ikke 730. Denne kommandoen svarer på hvilken: peker
// kategorien på feil sett, eller er kortene reelt spredt over flere sett fordi
// butikken har slått dem sammen?
//
// Normaliseringen må skje i JavaScript — SQLite kan ikke gjøre den, og et
// oppslag uten normalisering ville bommet på nøyaktig de samme kortene som
// synken bommer på.

export type Fordeling = {
  set_code: string;
  set_name: string;
  treff: number;
  andel: number;
};

export type Analyse = {
  produkter: number;
  navn: number;
  fordeling: Fordeling[];
  iFlereSett: { navn: string; sett: string[] }[];
  utenTreff: string[];
};

export async function analyserGruppe(settkode: string): Promise<Analyse> {
  const u = await db().execute({
    sql: "SELECT name FROM mystore_unmatched WHERE set_code = ?",
    args: [settkode.toLowerCase()],
  });

  const normPerNavn = new Map<string, string>();
  for (const r of u.rows as any[]) {
    const rå = String(r.name || "");
    const rent = rå.replace(/\bfoil\b/gi, "").replace(/\([^)]*\)/g, "").trim();
    const n = normaliser(rent);
    if (n.length > 1) normPerNavn.set(n, rå);
  }
  const normer = [...normPerNavn.keys()];

  if (!normer.length) {
    return { produkter: u.rows.length, navn: 0, fordeling: [], iFlereSett: [], utenTreff: [] };
  }

  // Hvilke sett inneholder disse navnene? Vi spør i bolker, siden SQLite har
  // en øvre grense for antall parametre.
  const perSett = new Map<string, { navn: string; treff: Set<string> }>();
  const settPerNavn = new Map<string, Set<string>>();

  for (let i = 0; i < normer.length; i += 400) {
    const del = normer.slice(i, i + 400);
    const plass = del.map(() => "?").join(",");
    const r = await db().execute({
      sql: `SELECT c.set_code, s.name AS set_name, c.name_norm, c.front_norm, c.back_norm
              FROM cards c LEFT JOIN sets s ON s.code = c.set_code
             WHERE c.name_norm IN (${plass})
                OR c.front_norm IN (${plass})
                OR c.back_norm IN (${plass})`,
      args: [...del, ...del, ...del],
    });
    for (const x of r.rows as any[]) {
      const kode = String(x.set_code);
      // Hvilket av feltene som traff avgjør hvilket navn vi teller.
      for (const felt of ["name_norm", "front_norm", "back_norm"]) {
        const v = x[felt] ? String(x[felt]) : null;
        if (!v || !normPerNavn.has(v)) continue;
        if (!perSett.has(kode)) {
          perSett.set(kode, { navn: String(x.set_name || kode), treff: new Set() });
        }
        perSett.get(kode)!.treff.add(v);
        if (!settPerNavn.has(v)) settPerNavn.set(v, new Set());
        settPerNavn.get(v)!.add(kode);
      }
    }
  }

  const fordeling: Fordeling[] = [...perSett.entries()]
    .map(([kode, d]) => ({
      set_code: kode,
      set_name: d.navn,
      treff: d.treff.size,
      andel: d.treff.size / normer.length,
    }))
    .sort((a, b) => b.treff - a.treff);

  // Navn som finnes i flere av de aktuelle settene. Er denne tom, kan en
  // kategori trygt peke på flere sett samtidig — oppslaget blir entydig.
  const topp = new Set(fordeling.slice(0, 6).map((f) => f.set_code));
  const iFlereSett: { navn: string; sett: string[] }[] = [];
  for (const [norm, sett] of settPerNavn) {
    const relevante = [...sett].filter((s) => topp.has(s));
    if (relevante.length > 1) {
      iFlereSett.push({ navn: normPerNavn.get(norm)!, sett: relevante });
    }
  }

  const utenTreff = normer
    .filter((n) => !settPerNavn.has(n))
    .map((n) => normPerNavn.get(n)!)
    .slice(0, 20);

  return { produkter: u.rows.length, navn: normer.length, fordeling, iFlereSett, utenTreff };
}

export function skrivAnalyse(kode: string, a: Analyse, logg: (s: string) => void = console.log) {
  logg(`\n${a.produkter} ukoblede produkter under ${kode.toUpperCase()} — ${a.navn} ulike kortnavn\n`);

  if (!a.fordeling.length) {
    logg("  Ingen av navnene finnes i katalogen i det hele tatt.");
    logg("  Da er dette trolig forseglede produkter, tilbehør eller skrivefeil,");
    logg("  ikke en feil settkobling.");
  } else {
    logg("  Kortene finnes i disse settene:");
    for (const f of a.fordeling.slice(0, 8)) {
      const merke = f.set_code === kode.toLowerCase() ? "  ← koblingen peker hit" : "";
      logg(
        `    ${f.set_code.padEnd(6)} ${f.set_name.slice(0, 38).padEnd(40)} ` +
          `${String(f.treff).padStart(4)} av ${a.navn}  (${Math.round(f.andel * 100)} %)${merke}`
      );
    }
  }

  logg("");
  if (a.iFlereSett.length) {
    logg(`  ⚠ ${a.iFlereSett.length} kortnavn finnes i flere av settene over.`);
    logg("    Da er ikke oppslaget entydig, og ett av settene må prioriteres.");
    for (const k of a.iFlereSett.slice(0, 5)) {
      logg(`      «${k.navn}» i ${k.sett.join(", ")}`);
    }
  } else if (a.fordeling.length > 1) {
    logg("  ✓ Ingen kortnavn finnes i flere av settene.");
    logg("    En kategori kan derfor trygt peke på flere av dem samtidig —");
    logg("    hvert navn treffer nøyaktig ett sett.");
  }

  if (a.utenTreff.length) {
    logg(`\n  ${a.utenTreff.length}+ navn finnes ikke i noe sett, f.eks.:`);
    logg(`    ${a.utenTreff.slice(0, 6).join(", ")}`);
  }
}
