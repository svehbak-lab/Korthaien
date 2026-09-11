import { db, hentSettings, type Condition, type Settings } from "./db.js";
import { prisenFor, hentManuellePriser } from "./pricing.js";

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

export type Avrunding = "5opp" | "9opp" | "krone" | "ingen";

export type Intervall = {
  id?: number;
  // «alle» gjelder rariteter du ikke har satt egne intervaller for.
  rarity: string;
  usd_fra: number;
  // null betyr «og oppover».
  usd_til: number | null;
  // Fast pris i øre. Brukes når faktor ikke er satt.
  pris_ore: number;
  // Kroner per dollar, med påslaget innbakt. Går foran fast pris.
  faktor: number | null;
  avrunding: Avrunding | null;
};

// Oppruning til nærmeste fem, eller til nærmeste tall som ender på ni. Begge
// er butikkpriser folk kjenner igjen; 14,19 kroner er ikke det.
export function rundOpp(øre: number, regel: Avrunding | null | undefined): number {
  const kr = øre / 100;
  switch (regel) {
    case "5opp":
      return Math.ceil(kr / 5) * 5 * 100;
    case "9opp":
      // 7,7 → 9.  12 → 19.  19 → 19.
      return (Math.ceil((kr - 9) / 10) * 10 + 9) * 100;
    case "krone":
      return Math.ceil(kr) * 100;
    default:
      return Math.round(øre);
  }
}

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
    pris_ore: Number(x.pris_ore || 0),
    faktor: x.faktor === null || x.faktor === undefined ? null : Number(x.faktor),
    avrunding: (x.avrunding as Avrunding) || null,
  }));
}

export async function lagreIntervaller(rader: Intervall[]): Promise<number> {
  // Hele tabellen skrives om. Den er liten, og delvise oppdateringer ville
  // gjort det mulig å ende med overlappende intervaller uten å merke det.
  await db().execute("DELETE FROM salg_intervaller");
  const rene = rader
    // Et intervall må ha enten en fast pris eller en faktor. Uten begge ville
    // det stilltiende gitt null kroner.
    .filter((r) => r.rarity && Number.isFinite(r.usd_fra) && (Number(r.pris_ore) > 0 || Number(r.faktor) > 0))
    .map((r) => ({
      rarity: String(r.rarity).toLowerCase(),
      usd_fra: Math.max(0, Number(r.usd_fra)),
      usd_til: r.usd_til === null || r.usd_til === undefined ? null : Number(r.usd_til),
      pris_ore: Math.max(0, Math.round(Number(r.pris_ore) || 0)),
      faktor: r.faktor === null || r.faktor === undefined || r.faktor === ("" as any)
        ? null
        : Number(r.faktor),
      avrunding: r.avrunding || null,
    }));
  if (!rene.length) return 0;
  await db().batch(
    rene.map((r) => ({
      sql: `INSERT INTO salg_intervaller (rarity, usd_fra, usd_til, pris_ore, faktor, avrunding, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [r.rarity, r.usd_fra, r.usd_til, r.pris_ore, r.faktor, r.avrunding, new Date().toISOString()],
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
    if (!i) {
      // Over alle intervallene: markedspris ganget med den globale faktoren.
      grunn = rund(Math.round(usd * opp.usd_nok * opp.faktor * 100), opp.avrunding);
    } else if (i.faktor && i.faktor > 0) {
      // Faktoren er kroner per dollar, påslaget innbakt. Den erstatter
      // valutakursen i stedet for å ganges med den: 1,29 × 11 = 14,19 kr.
      grunn = rundOpp(usd * i.faktor * 100, i.avrunding);
    } else {
      grunn = i.pris_ore;
    }
  }

  const pct = opp.trapp[condition];
  if (pct === undefined || pct === null) return 0;
  // Opprundingen gjelder ankerprisen for Near Mint. Tilstandene regnes av den
  // og rundes til nærmeste krone — ellers ville 85 % av 15 blitt 15 igjen, og
  // trappen ville forsvunnet for billige kort.
  if (condition === "NM") return grunn;
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
  // Én spørring for hele settet, ikke én per kort. Med over tusen kall til
  // en database i Frankfurt tok dette minutter i stedet for sekunder.
  const manuelleKjøp = await hentManuellePriser(ider);

  const ut = [];
  for (const k of r.rows as any[]) {
    const rad: any = { ...k, priser: {} };
    for (const finish of ["nonfoil", "foil"]) {
      if (finish === "nonfoil" && !Number(k.has_nonfoil)) continue;
      if (finish === "foil" && !Number(k.has_foil)) continue;
      const manuell = manuelleSalg.get(`${k.id}:${finish}`) ?? null;
      const manuellKjøp = manuelleKjøp.get(`${k.id}:${finish}`) ?? null;
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


// ── butikkvisning ────────────────────────────────────────────────────────────
// Slik kunden vil se det: pris og beholdning per tilstand, per finish. Dette
// er den eneste måten å oppdage at et intervall traff feil — tallene må stå
// ved siden av kortet, ikke i en tabell over regler.
export type ButikkFilter = {
  sett: string;
  q?: string;
  tekst?: string;
  rarity?: string;
  farge?: string;
  type?: string;
  baresalg?: boolean;
  prisFra?: number;
  prisTil?: number;
  finish?: string;
  sortering?: string;
  side?: number;
  perSide?: number;
};

export async function butikkvisning(opts: ButikkFilter) {
  const opp = await hentSalgsOppsett();
  const { beholdning } = await import("./lager.js");

  const hvor: string[] = ["c.set_code = ?"];
  const args: any[] = [opts.sett.toLowerCase()];
  if (opts.q) {
    hvor.push("(c.name_norm LIKE ? OR c.oracle_text LIKE ?)");
    args.push(`%${normaliserEnkelt(opts.q)}%`, `%${opts.q}%`);
  }
  // Flere rariteter om gangen. Ett valg er sjelden nok — man leter gjerne
  // etter rare og mythic samtidig.
  const rariteter = String(opts.rarity || "").split(",").filter(Boolean);
  if (rariteter.length) {
    hvor.push(`c.rarity IN (${rariteter.map(() => "?").join(",")})`);
    args.push(...rariteter);
  }
  if (opts.tekst) {
    hvor.push("c.oracle_text LIKE ?");
    args.push(`%${opts.tekst}%`);
  }
  const typer = String(opts.type || "").split(",").filter(Boolean);
  if (typer.length) {
    hvor.push(`(${typer.map(() => "c.type_line LIKE ?").join(" OR ")})`);
    args.push(...typer.map((t) => `%${t}%`));
  }
  // Flere farger betyr «minst én av dem», ikke «alle sammen». Det er det
  // folk mener når de huker av hvit og blå.
  const farger = String(opts.farge || "").split(",").filter(Boolean);
  if (farger.length) {
    const deler: string[] = [];
    for (const f of farger) {
      if (f === "C") {
        // Fargeløs: enten ingen farger lagret, eller en tom liste.
        deler.push("(c.colors IS NULL OR c.colors = '[]')");
      } else {
        deler.push("c.colors LIKE ?");
        args.push(`%"${f}"%`);
      }
    }
    hvor.push(`(${deler.join(" OR ")})`);
  }

  const r = await db().execute({
    sql: `SELECT c.id, c.name, c.collector_number, c.rarity, c.variant,
                 c.usd, c.usd_foil, c.has_nonfoil, c.has_foil, c.er_token,
                 c.image_uri, c.type_line, c.oracle_text, c.mana_cost,
                 c.power, c.toughness, c.loyalty, c.colors, c.artist,
                 COALESCE(s.visningsnavn, s.name) AS set_name
            FROM cards c LEFT JOIN sets s ON s.code = c.set_code
           WHERE ${hvor.join(" AND ")}
           ORDER BY CAST(c.collector_number AS INTEGER), c.collector_number`,
    args,
  });

  const ider = (r.rows as any[]).map((x) => String(x.id));
  const manuelleSalg = await hentManuellSalg(ider);
  const manuelleKjøp = await hentManuellePriser(ider);
  const lager = await beholdning(ider);

  const ut: any[] = [];
  for (const k of r.rows as any[]) {
    const varianter: any[] = [];
    for (const finish of ["nonfoil", "foil"]) {
      if (finish === "nonfoil" && !Number(k.has_nonfoil)) continue;
      if (finish === "foil" && !Number(k.has_foil)) continue;

      const manuell = manuelleSalg.get(`${k.id}:${finish}`) ?? null;
      const manuellKjøp = manuelleKjøp.get(`${k.id}:${finish}`) ?? null;
      const priser = salgspriser(k, finish, opp, manuell, manuellKjøp);
      const tilstander = priser.map((p) => ({
        ...p,
        // Butikken viser bare det du faktisk har. Null på lager betyr
        // utsolgt, ikke at prisen er feil.
        lager: lager.get(`${k.id}:${finish}:${p.condition}`) || 0,
      }));
      const påLager = tilstander.reduce((n, t) => n + t.lager, 0);
      if (opts.baresalg && !påLager) continue;
      varianter.push({ finish, manuell, tilstander, påLager });
    }
    if (varianter.length) ut.push({ ...k, varianter });
  }

  // Fanene viser antall per finish. De telles før finish velges, ellers
  // kunne ikke den andre fanen vise sitt eget tall.
  const antall = {
    nonfoil: ut.filter((k) => k.varianter.some((v: any) => v.finish === "nonfoil" && v.tilstander.length)).length,
    foil: ut.filter((k) => k.varianter.some((v: any) => v.finish === "foil" && v.tilstander.length)).length,
  };

  // Sorteringen må skje over hele settet, ikke over siden. Sorterer man bare
  // det man allerede har hentet, får man den dyreste av de 25 første.
  const finish = opts.finish === "foil" ? "foil" : "nonfoil";
  const nmPris = (k: any) =>
    k.varianter.find((v: any) => v.finish === finish)?.tilstander?.[0]?.ore ?? -1;

  switch (opts.sortering) {
    case "pris_ned": ut.sort((a, b) => nmPris(b) - nmPris(a)); break;
    case "pris_opp": ut.sort((a, b) => nmPris(a) - nmPris(b)); break;
    case "navn":     ut.sort((a, b) => String(a.name).localeCompare(String(b.name), "nb")); break;
    case "navn_ned": ut.sort((a, b) => String(b.name).localeCompare(String(a.name), "nb")); break;
    default: break; // samlernummer, som spørringen allerede gir
  }

  // Prisfilteret må komme etter at prisene er regnet ut — de finnes ikke i
  // databasen, de utledes.
  const filtrert = ut.filter((k) => {
    const p = nmPris(k);
    if (p < 0) return true;
    if (opts.prisFra !== undefined && p < opts.prisFra * 100) return false;
    if (opts.prisTil !== undefined && p > opts.prisTil * 100) return false;
    return true;
  });
  // Et helt sett med regeltekst og bilder er mye å sende og mye å tegne opp.
  // Grensen holder visningen rask; filteret er der for å snevre inn.
  const perSide = Math.min(200, Math.max(1, opts.perSide ?? 25));
  const side = Math.max(1, opts.side ?? 1);
  const sider = Math.max(1, Math.ceil(filtrert.length / perSide));
  return {
    oppsett: opp,
    kort: filtrert.slice((side - 1) * perSide, side * perSide),
    totalt: filtrert.length,
    antall,
    side: Math.min(side, sider),
    sider,
    perSide,
    utenPris: (r.rows as any[]).length - ut.length,
  };
}

// Samme normalisering som resten av søket, uten å dra inn hele db-modulen
// på nytt her.
function normaliserEnkelt(s: string): string {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}
