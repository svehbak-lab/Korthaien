import { db, hentSettings, type Condition, type Settings } from "./db.js";
import { prisenFor, hentManuellPris } from "./pricing.js";

// ─────────────────────────────────────────────────────────────────────────────
// SALGSPRIS
// ─────────────────────────────────────────────────────────────────────────────
// Utsalgsprisen avledes av markedsprisen, i tre trinn:
//
//   1. Grunnprisen for Near Mint finnes. Din egen manuelle pris går foran.
//      Ellers slår vi opp i intervalltabellen: et rare til under 0,90 dollar
//      koster 10 kroner uansett om markedet sier 0,20 eller 0,80.
//      Er kortet dyrere enn alle intervallene, regnes prisen av markedet.
//   2. Salgstrappen trekker fra for tilstand. Den er sin egen, ikke den samme
//      som kjøpstrappen — ellers kunne du ikke justere marginen på slitte kort
//      uten å endre hva du betaler for dem.
//   3. Avrunding til nærmeste krone. Butikkpriser har ikke øre.
//
// Intervallene er global. Vil du ha andre priser i et bestemt sett, settes
// prisen manuelt på kortene der.

export type Intervall = {
  id?: number;
  // «alle» gjelder rariteter du ikke har satt egne intervaller for.
  rarity: string;
  usd_fra: number;
  // null betyr «og oppover».
  usd_til: number | null;
  pris_ore: number;
};

export const SALG_STANDARD = {
  trapp: { NM: 100, EX: 85, VG: 70, G: 55 } as Record<string, number>,
  // Brukes på kort som er dyrere enn alle intervallene. 1,0 er markedspris
  // i kroner; 1,15 er femten prosent over.
  faktor: 1.0,
  // Avrunding i øre. 100 gir hele kroner.
  avrunding: 100,
};

export async function hentIntervaller(): Promise<Intervall[]> {
  const r = await db().execute(
    "SELECT * FROM salg_intervaller ORDER BY rarity, usd_fra"
  );
  return (r.rows as any[]).map((x) => ({
    id: Number(x.id),
    rarity: String(x.rarity),
    usd_fra: Number(x.usd_fra),
    usd_til: x.usd_til === null || x.usd_til === undefined ? null : Number(x.usd_til),
    pris_ore: Number(x.pris_ore),
  }));
}

export async function lagreIntervaller(rader: Intervall[]): Promise<number> {
  // Hele tabellen skrives om. Den er liten, og delvise oppdateringer ville
  // gjort det mulig å ende med overlappende intervaller uten å merke det.
  await db().execute("DELETE FROM salg_intervaller");
  const rene = rader
    .filter((r) => r.rarity && Number.isFinite(r.usd_fra) && Number.isFinite(r.pris_ore))
    .map((r) => ({
      rarity: String(r.rarity).toLowerCase(),
      usd_fra: Math.max(0, Number(r.usd_fra)),
      usd_til: r.usd_til === null || r.usd_til === undefined ? null : Number(r.usd_til),
      pris_ore: Math.max(0, Math.round(Number(r.pris_ore))),
    }));
  if (!rene.length) return 0;
  await db().batch(
    rene.map((r) => ({
      sql: `INSERT INTO salg_intervaller (rarity, usd_fra, usd_til, pris_ore, updated_at)
            VALUES (?, ?, ?, ?, ?)`,
      args: [r.rarity, r.usd_fra, r.usd_til, r.pris_ore, new Date().toISOString()],
    })),
    "write"
  );
  return rene.length;
}

// Overlappende eller manglende intervaller er lette å lage og vanskelige å
// oppdage. Derfor sier vi fra i stedet for å velge stilltiende.
export function finnHull(rader: Intervall[]): string[] {
  const feil: string[] = [];
  const perRaritet = new Map<string, Intervall[]>();
  for (const r of rader) {
    if (!perRaritet.has(r.rarity)) perRaritet.set(r.rarity, []);
    perRaritet.get(r.rarity)!.push(r);
  }
  for (const [rarity, liste] of perRaritet) {
    const sortert = [...liste].sort((a, b) => a.usd_fra - b.usd_fra);
    for (let i = 0; i < sortert.length - 1; i++) {
      const nå = sortert[i];
      const neste = sortert[i + 1];
      if (nå.usd_til === null) {
        feil.push(`${rarity}: intervallet fra ${nå.usd_fra} er åpent, men det finnes flere under det`);
        continue;
      }
      if (nå.usd_til >= neste.usd_fra) {
        feil.push(`${rarity}: ${nå.usd_fra}–${nå.usd_til} overlapper med ${neste.usd_fra}–${neste.usd_til ?? "opp"}`);
      }
    }
  }
  return feil;
}

// ── manuell salgspris ────────────────────────────────────────────────────────
export async function hentManuellSalg(cardIds: string[]): Promise<Map<string, number>> {
  const kart = new Map<string, number>();
  const ider = [...new Set(cardIds)].filter(Boolean);
  if (!ider.length) return kart;
  for (let i = 0; i < ider.length; i += 400) {
    const del = ider.slice(i, i + 400);
    const r = await db().execute({
      sql: `SELECT card_id, finish, nm_ore FROM card_sale_prices
             WHERE card_id IN (${del.map(() => "?").join(",")})`,
      args: del,
    });
    for (const x of r.rows as any[]) kart.set(`${x.card_id}:${x.finish}`, Number(x.nm_ore));
  }
  return kart;
}

export async function settManuellSalg(
  cardId: string,
  finish: string,
  nmØre: number | null
): Promise<void> {
  if (!nmØre || nmØre <= 0) {
    await db().execute({
      sql: "DELETE FROM card_sale_prices WHERE card_id = ? AND finish = ?",
      args: [cardId, finish],
    });
    return;
  }
  await db().execute({
    sql: `INSERT INTO card_sale_prices (card_id, finish, nm_ore, updated_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(card_id, finish) DO UPDATE SET
            nm_ore = excluded.nm_ore, updated_at = excluded.updated_at`,
    args: [cardId, finish, Math.round(nmØre), new Date().toISOString()],
  });
}

// ── selve regnestykket ───────────────────────────────────────────────────────
export type SalgsOppsett = {
  intervaller: Intervall[];
  trapp: Record<string, number>;
  faktor: number;
  avrunding: number;
  usd_nok: number;
};

export async function hentSalgsOppsett(s?: Settings): Promise<SalgsOppsett> {
  const settings = s || (await hentSettings());
  return {
    intervaller: await hentIntervaller(),
    trapp: (settings as any).salg_trapp || SALG_STANDARD.trapp,
    faktor: (settings as any).salg_faktor ?? SALG_STANDARD.faktor,
    avrunding: (settings as any).salg_avrunding ?? SALG_STANDARD.avrunding,
    usd_nok: settings.usd_nok,
  };
}

// Mest spesifikke treff først: en regel for «rare» slår en regel for «alle».
export function finnIntervall(
  intervaller: Intervall[],
  rarity: string | null,
  usd: number
): Intervall | null {
  const r = String(rarity || "").toLowerCase();
  const passer = (i: Intervall) =>
    usd >= i.usd_fra && (i.usd_til === null || usd <= i.usd_til);
  return (
    intervaller.find((i) => i.rarity === r && passer(i)) ||
    intervaller.find((i) => i.rarity === "alle" && passer(i)) ||
    null
  );
}

const rund = (øre: number, til: number) =>
  til > 1 ? Math.max(til, Math.round(øre / til) * til) : Math.round(øre);

export function salgsprisØre(
  kort: { usd?: number | null; usd_foil?: number | null; rarity?: string | null },
  finish: string,
  condition: Condition,
  opp: SalgsOppsett,
  manuellSalgØre?: number | null,
  manuellUsd?: number | null
): number {
  // Grunnprisen gjelder Near Mint. Trappen tar resten.
  let grunn: number | null = null;

  if (manuellSalgØre && manuellSalgØre > 0) {
    grunn = manuellSalgØre;
  } else {
    const usd = manuellUsd && manuellUsd > 0 ? manuellUsd : prisenFor(kort, finish);
    if (!usd || usd <= 0) return 0;
    const i = finnIntervall(opp.intervaller, kort.rarity ?? null, usd);
    grunn = i ? i.pris_ore : Math.round(usd * opp.usd_nok * opp.faktor * 100);
  }

  const pct = opp.trapp[condition];
  if (pct === undefined || pct === null) return 0;
  return rund((grunn * pct) / 100, opp.avrunding);
}

// Alle tilstandene for ett kort, slik butikken viser dem.
export function salgspriser(
  kort: { usd?: number | null; usd_foil?: number | null; rarity?: string | null },
  finish: string,
  opp: SalgsOppsett,
  manuellSalgØre?: number | null,
  manuellUsd?: number | null
): { condition: Condition; ore: number }[] {
  return (["NM", "EX", "VG", "G"] as Condition[])
    .map((c) => ({ condition: c, ore: salgsprisØre(kort, finish, c, opp, manuellSalgØre, manuellUsd) }))
    .filter((x) => x.ore > 0);
}

// ── massevisning for admin ───────────────────────────────────────────────────
// Prisene for et helt sett, med begge finisher, slik du ser dem før du
// eventuelt overstyrer noen av dem.
export async function salgsprisForSett(setCode: string) {
  const opp = await hentSalgsOppsett();
  const r = await db().execute({
    sql: `SELECT id, name, collector_number, rarity, variant, usd, usd_foil,
                 has_nonfoil, has_foil, er_token
            FROM cards WHERE set_code = ?
           ORDER BY CAST(collector_number AS INTEGER), collector_number`,
    args: [setCode.toLowerCase()],
  });
  const ider = (r.rows as any[]).map((x) => String(x.id));
  const manuelleSalg = await hentManuellSalg(ider);

  const ut = [];
  for (const k of r.rows as any[]) {
    const rad: any = { ...k, priser: {} };
    for (const finish of ["nonfoil", "foil"]) {
      if (finish === "nonfoil" && !Number(k.has_nonfoil)) continue;
      if (finish === "foil" && !Number(k.has_foil)) continue;
      const manuell = manuelleSalg.get(`${k.id}:${finish}`) ?? null;
      const manuellKjøp = await hentManuellPris(String(k.id), finish);
      rad.priser[finish] = {
        manuell,
        nm: salgsprisØre(k, finish, "NM", opp, manuell, manuellKjøp),
        alle: salgspriser(k, finish, opp, manuell, manuellKjøp),
      };
    }
    ut.push(rad);
  }
  return { oppsett: opp, kort: ut };
}
