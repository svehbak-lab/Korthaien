import { db } from "./db.js";

// ─────────────────────────────────────────────────────────────────────────────
// FRAKTALTERNATIVER
// ─────────────────────────────────────────────────────────────────────────────
// Det kunden velger mellom i kassen. Prisene står i basen og ikke i koden,
// fordi Posten endrer dem og du skal slippe en utrulling for å rette et tall.
//
// Kunden velger fritt. Vi tvinger ingen over på sporing, heller ikke på dyre
// ordrer — men forsikringsgrensen vises, så valget er opplyst.

export type Fraktalternativ = {
  id: number;
  navn: string;
  pris_ore: number;
  // NULL for sendinger uten sporing og forsikring. Null og NULL er to ulike
  // ting: 0 ville betydd «forsikret for ingenting».
  forsikret_ore: number | null;
  beskrivelse: string | null;
  sortering: number;
  aktiv: number;
};

const rad = (x: any): Fraktalternativ => ({
  id: Number(x.id),
  navn: String(x.navn),
  pris_ore: Number(x.pris_ore),
  forsikret_ore: x.forsikret_ore === null || x.forsikret_ore === undefined
    ? null
    : Number(x.forsikret_ore),
  beskrivelse: x.beskrivelse ?? null,
  sortering: Number(x.sortering || 0),
  aktiv: Number(x.aktiv) ? 1 : 0,
});

// Sorteringen er din, ikke prisens: billigst først er ikke alltid den
// rekkefølgen du vil at kunden skal lese dem i.
export async function hentFrakt(baraktive = false): Promise<Fraktalternativ[]> {
  const r = await db().execute(
    `SELECT * FROM frakt_alternativer
      ${baraktive ? "WHERE aktiv = 1" : ""}
      ORDER BY sortering, pris_ore, id`
  );
  return (r.rows as any[]).map(rad);
}

export type FraktInn = {
  navn: string;
  pris_ore: number;
  forsikret_ore?: number | null;
  beskrivelse?: string | null;
  sortering?: number;
  aktiv?: boolean;
};

function sjekk(f: FraktInn): string | null {
  if (!String(f.navn || "").trim()) return "Alternativet må ha et navn";
  if (!Number.isFinite(f.pris_ore) || f.pris_ore < 0) return "Prisen må være et beløp fra 0 og opp";
  if (
    f.forsikret_ore !== null &&
    f.forsikret_ore !== undefined &&
    (!Number.isFinite(f.forsikret_ore) || f.forsikret_ore < 0)
  ) {
    return "Forsikringsgrensen må være tom eller et beløp fra 0 og opp";
  }
  return null;
}

export async function leggTilFrakt(f: FraktInn): Promise<Fraktalternativ> {
  const feil = sjekk(f);
  if (feil) throw new Error(feil);
  const r = await db().execute({
    sql: `INSERT INTO frakt_alternativer
            (navn, pris_ore, forsikret_ore, beskrivelse, sortering, aktiv, created_at)
          VALUES (?,?,?,?,?,?,?) RETURNING *`,
    args: [
      String(f.navn).trim(),
      Math.round(f.pris_ore),
      f.forsikret_ore === null || f.forsikret_ore === undefined ? null : Math.round(f.forsikret_ore),
      f.beskrivelse?.trim() || null,
      Math.round(f.sortering ?? 0),
      f.aktiv === false ? 0 : 1,
      new Date().toISOString(),
    ],
  });
  return rad((r.rows as any[])[0]);
}

export async function endreFrakt(id: number, f: FraktInn): Promise<Fraktalternativ> {
  const feil = sjekk(f);
  if (feil) throw new Error(feil);
  const r = await db().execute({
    sql: `UPDATE frakt_alternativer
             SET navn = ?, pris_ore = ?, forsikret_ore = ?, beskrivelse = ?,
                 sortering = ?, aktiv = ?
           WHERE id = ? RETURNING *`,
    args: [
      String(f.navn).trim(),
      Math.round(f.pris_ore),
      f.forsikret_ore === null || f.forsikret_ore === undefined ? null : Math.round(f.forsikret_ore),
      f.beskrivelse?.trim() || null,
      Math.round(f.sortering ?? 0),
      f.aktiv === false ? 0 : 1,
      id,
    ],
  });
  const ut = (r.rows as any[])[0];
  if (!ut) throw new Error("Fant ikke fraktalternativet");
  return rad(ut);
}

// Slås av, slettes ikke. En ordre som er sendt med et alternativ skal
// fortsatt kunne vise hva den ble sendt med, også etter at du har sluttet å
// tilby det.
export async function slåAvFrakt(id: number): Promise<void> {
  await db().execute({
    sql: "UPDATE frakt_alternativer SET aktiv = 0 WHERE id = ?",
    args: [id],
  });
}
