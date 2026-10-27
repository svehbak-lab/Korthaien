import { butikklagerSql } from "./lager.js";
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
  // «Bare disse fargene». Uten den betyr fargevalget «minst én av dem».
  fargeEksakt?: boolean;
  type?: string;
  baresalg?: boolean;
  prisFra?: number;
  prisTil?: number;
  finish?: string;
  sortering?: string;
  side?: number;
  perSide?: number;
  // Forsiden: «Nylig inn» skal vise kort, ikke tokens.
  utenTokens?: boolean;
  // Bare disse kortene (forsidens «Nylig inn»).
  ider?: string[];
};

export async function butikkvisning(opts: ButikkFilter) {
  const opp = await hentSalgsOppsett();
  const { beholdning } = await import("./lager.js");

  // Tokens selges som andre kort. I et sett vises også tokens fra
  // token-settet som hører til (Phyrexia: All Will Be One Tokens under
  // Phyrexia: All Will Be One).
  // Serienummererte utgaver selges ikke her — de er enkelteksemplarer med
  // egen pris, og vises derfor heller ikke.
  const hvor: string[] = opts.utenTokens ? ["c.er_token = 0", "c.er_serialized = 0"] : ["c.er_serialized = 0"];
  const args: any[] = [];
  if (opts.ider) {
    if (!opts.ider.length) hvor.push("0");
    else { hvor.push(`c.id IN (${opts.ider.map(() => "?").join(",")})`); args.push(...opts.ider); }
  }
  if (opts.sett) {
    hvor.push(`(c.set_code = ? OR c.set_code IN (SELECT code FROM sets WHERE parent_code = ? AND set_type = 'token'))`);
    args.push(opts.sett.toLowerCase(), opts.sett.toLowerCase());
  }
  // Finish-kravet legges på lenger ned, ikke her. Fanetallene skal telles
  // uten det — ellers telles fanene inni hverandre, og «Enkeltkort» viser
  // hvor mange enkeltkort det er blant foilene.
  // Har kortet en pris i denne finishen? Samme kilder som salgsprisØre:
  // din egen salgspris, din egen dollarpris, eller Scryfalls. Uten dette
  // telte fanene kort som så ble sortert bort fordi de ikke har pris — og
  // da sto det «Alle treff (3)» over en tom liste.
  const harPris = (f: string) => `(
      EXISTS (SELECT 1 FROM card_sale_prices sp WHERE sp.card_id = c.id AND sp.finish = '${f}' AND sp.nm_ore > 0)
      OR EXISTS (SELECT 1 FROM card_prices cp WHERE cp.card_id = c.id AND cp.finish = '${f}' AND cp.usd > 0)
      OR COALESCE(${f === "foil" ? "c.usd_foil" : "c.usd"}, 0) > 0)`;
  const påLagerMedPris = (f: string) =>
    `(EXISTS (SELECT 1 FROM (${butikklagerSql()}) b
               WHERE b.card_id = c.id AND b.finish = '${f}'
               GROUP BY b.card_id HAVING SUM(b.antall) > 0) AND ${harPris(f)})`;
  if (opts.baresalg) {
    hvor.push(`(${påLagerMedPris("nonfoil")} OR ${påLagerMedPris("foil")})`);
  } else if (!opts.sett && !opts.q) {
    // Uten sett, uten søk og uten lagerfilter ville vi hentet hele katalogen.
    hvor.push(`EXISTS (SELECT 1 FROM (${butikklagerSql()}) b
                        WHERE b.card_id = c.id
                        GROUP BY b.card_id HAVING SUM(b.antall) > 0)`);
  }
  // «token» i søket betyr «vis tokens»: Scryfall kaller tokenet «Treasure»,
  // ikke «Treasure Token». Ordet tas ut av navnesøket og blir et filter, så
  // både «token» og «treasure token» finner det folk mener.
  let q = String(opts.q || "");
  if (/\btokens?\b/i.test(q)) {
    hvor.push("c.er_token = 1");
    q = q.replace(/\btokens?\b/gi, " ").replace(/\s+/g, " ").trim();
  }
  // Søket er på kortnavnet. Regelteksten har sitt eget filter (tekst) —
  // ellers ga «treasure» Smothering Tithe og hundrevis av andre kort som
  // bare nevner ordet.
  if (q) {
    hvor.push("(c.name_norm LIKE ? OR c.front_norm LIKE ? OR c.back_norm LIKE ?)");
    const n = `%${normaliserEnkelt(q)}%`;
    args.push(n, n, n);
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
  //
  // Men ikke alltid: noen ganger er spørsmålet «svarte kort», ikke «kort som
  // har svart i seg». Da huker man av «Bare disse fargene», og svart alene
  // gir monofargede svarte kort. To farger gir kort som er nøyaktig de to.
  const FARGENE = ["W", "U", "B", "R", "G"];
  const farger = String(opts.farge || "").split(",").filter(Boolean);
  if (farger.length) {
    const kulører = farger.filter((f) => f !== "C");

    if (opts.fargeEksakt && kulører.length) {
      // Hver valgt farge må være der, og ingen av de andre.
      //
      // Hver farge sjekkes for seg i stedet for å sammenligne hele
      // JSON-teksten mot ["B","R"]. Da spiller rekkefølge og mellomrom
      // ingen rolle, og vi slipper å stole på at importen alltid skriver
      // lista likt.
      //
      // Fargeløs kan ikke være «en av disse fargene» — et kort er enten
      // uten farge eller ikke. Er C huket av sammen med en farge, er det
      // fargene som gjelder.
      hvor.push(
        `(${FARGENE.map((f) =>
          kulører.includes(f) ? `c.colors LIKE '%"${f}"%'` : `c.colors NOT LIKE '%"${f}"%'`
        ).join(" AND ")})`
      );
    } else if (opts.fargeEksakt) {
      // Bare fargeløs huket av: da er «bare disse fargene» det samme som
      // fargeløs alene.
      hvor.push("(c.colors IS NULL OR c.colors = '[]')");
    } else {
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
  }

  const perSide = Math.min(200, Math.max(1, opts.perSide ?? 25));
  const side = Math.max(1, opts.side ?? 1);
  const foilFørst = opts.finish === "foil";

  // «Prisen som gjelder» i sorteringen: din egen først, så markedets.
  const SORTPRIS = foilFørst
    ? `COALESCE((SELECT usd FROM card_prices p WHERE p.card_id = c.id AND p.finish='foil'),
                c.usd_foil, c.usd, 0)`
    : `COALESCE((SELECT usd FROM card_prices p WHERE p.card_id = c.id AND p.finish='nonfoil'),
                c.usd, c.usd_foil, 0)`;

  const ORDNING = {
    pris_ned: `${SORTPRIS} DESC, c.name`,
    pris_opp: `${SORTPRIS} ASC, c.name`,
    navn: "c.name COLLATE NOCASE ASC",
    navn_ned: "c.name COLLATE NOCASE DESC",
    // Sist lagt inn. Bare bevegelser som la noe TIL teller — en linje som
    // tok kort ut av hylla gjør ikke kortet nytt i butikken.
    nyeste: `(SELECT MAX(b.created_at) FROM (${butikklagerSql()}) b
               WHERE b.card_id = c.id AND b.antall > 0) DESC, c.name`,
  }[String(opts.sortering || "")] || (opts.sett
    ? "CAST(c.collector_number AS INTEGER), c.collector_number"
    : "c.name COLLATE NOCASE ASC");

  // ── hva hver fane viser ────────────────────────────────────────────────
  // Regelen skrives ett sted og brukes to ganger: til radene og til tallet i
  // fanen. Står de to i utakt, lyver det ene av dem — og det er den slags
  // feil ingen oppdager før en kunde ikke finner et kort.
  //
  //   Alle treff  alt søket fant. Ingen avgrensning, og derfor den eneste
  //               fanen et kort aldri kan falle ut av. Den er standard.
  //   Vanlig      kort du har i vanlig utgave.
  //   Foil        kort du har i foil.
  //
  // De to siste er avgrensninger av den første, ikke to halvdeler av
  // katalogen. Et kort som bare finnes i foil, som Kaladesh Inventions, er
  // med i Alle treff og i Foil — det blir aldri borte fordi man står i feil
  // fane. Det var nettopp dét som gjorde at søk på «Sol Ring» ikke fant den
  // dyreste utgaven.
  //
  // Med baresalg på avgrenses det på beholdning og ikke på hva kortet kan
  // trykkes som: et kort du bare har i vanlig utgave skal ikke stå i
  // foil-fanen fordi det finnes en foil-trykning et sted i verden.
  const påLager = (f: string) =>
    `EXISTS (SELECT 1 FROM (${butikklagerSql()}) b
              WHERE b.card_id = c.id AND b.finish = '${f}'
              GROUP BY b.card_id HAVING SUM(b.antall) > 0)`;

  const VISES = opts.baresalg
    ? { nonfoil: påLagerMedPris("nonfoil"), foil: påLagerMedPris("foil") }
    : { nonfoil: "c.has_nonfoil = 1", foil: "c.has_foil = 1" };

  const FINISH_KRAV =
    opts.finish === "foil" ? VISES.foil : opts.finish === "nonfoil" ? VISES.nonfoil : null;
  const hvorMedFinish = FINISH_KRAV ? [...hvor, FINISH_KRAV] : hvor;

  // Totalen og fanetallene telles i databasen. Å telle det som ligger på
  // siden ville gitt «Alle treff (25)» uansett hvor mange det er.
  //
  // Alle tre telles her, hver etter sin egen regel og uten hverandres
  // avgrensning. Tidligere ble de talt inni hverandre: sto du på Foils,
  // viste den andre fanen hvor mange den hadde til felles med foilene.
  const tellinger = await db().execute({
    sql: `SELECT COUNT(*) AS n,
                 SUM(CASE WHEN ${VISES.nonfoil} THEN 1 ELSE 0 END) AS nonfoil,
                 SUM(CASE WHEN ${VISES.foil} THEN 1 ELSE 0 END)    AS foil
            FROM cards c WHERE ${hvor.join(" AND ")}`,
    args,
  });
  const antall = {
    alle: Number(tellinger.rows[0]?.n || 0),
    nonfoil: Number(tellinger.rows[0]?.nonfoil || 0),
    foil: Number(tellinger.rows[0]?.foil || 0),
  };
  // Totalen er fanens egen, siden den styrer sidetallet.
  const totalt =
    opts.finish === "foil"
      ? antall.foil
      : opts.finish === "nonfoil"
        ? antall.nonfoil
        : antall.alle;

  const r = await db().execute({
    sql: `SELECT c.id, c.name, c.collector_number, c.rarity, c.variant,
                 c.usd, c.usd_foil, c.has_nonfoil, c.has_foil, c.er_token,
                 c.image_uri, c.type_line, c.oracle_text, c.mana_cost,
                 c.power, c.toughness, c.loyalty, c.colors, c.artist, c.set_code,
                 COALESCE(s.visningsnavn, s.name) AS set_name
            FROM cards c LEFT JOIN sets s ON s.code = c.set_code
           WHERE ${hvorMedFinish.join(" AND ")}
           ORDER BY ${ORDNING}
           LIMIT ? OFFSET ?`,
    args: [...args, perSide, (side - 1) * perSide],
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
      // Uten pris er kortet ikke til salgs. Ble det lagt inn likevel, sorterte
      // det som «ingen pris» og fylte første side ved lav til høy.
      if (!tilstander.length) continue;
      varianter.push({ finish, manuell, tilstander, påLager });
    }
    if (varianter.length) ut.push({ ...k, name: tokenNavn(k.name, k.er_token), varianter });
  }

  // Prisintervallet kan først anvendes når prisene er regnet ut, og de finnes
  // bare for denne siden. Det filtrerer derfor innenfor siden.
  const filtrert = ut.filter((k) => {
    if (opts.prisFra === undefined && opts.prisTil === undefined) return true;
    const finish = foilFørst ? "foil" : "nonfoil";
    const p = k.varianter.find((v: any) => v.finish === finish)?.tilstander?.[0]?.ore ?? -1;
    if (p < 0) return true;
    if (opts.prisFra !== undefined && p < opts.prisFra * 100) return false;
    if (opts.prisTil !== undefined && p > opts.prisTil * 100) return false;
    return true;
  });

  const sider = Math.max(1, Math.ceil(totalt / perSide));
  return {
    oppsett: opp,
    kort: filtrert,
    totalt,
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


// ── ett kort ─────────────────────────────────────────────────────────────────
// Kortsiden: alt vi vet om ett trykk, pluss de andre utgavene av samme kort.
// «Samme kort» er oracle_id — det er Scryfalls identitet på tvers av sett, og
// den holder også når navnet er skrevet ulikt.
// ── nylig inn ─────────────────────────────────────────────────────────────────
// Forsidens rad: de siste kortene som kom inn, én flis per utgave (vanlig og
// foil hver for seg), i den rekkefølgen de kom. Innkjøp og manuelt innlagte
// kort teller; et salg som ble kansellert, en telling eller en rettelse gjør
// ikke kortet nytt. Gammelt Mystore-lager som kobles etter overgangen, er
// heller ikke nytt.
//
// Leses baklengs fra de siste bevegelsene (indeks på tid), ikke ved å regne
// ut siste dato for hvert kort i katalogen — det ville lest hele lagerboken
// for hver som åpner forsiden.
export async function nyligInn(antall = 30) {
  const r = await db().execute(`
    SELECT card_id, finish, notat FROM lager_bevegelser
     WHERE antall > 0 AND grunn IN ('ordre', 'mystore', 'manuell')
     ORDER BY created_at DESC LIMIT 600`);
  const par: { id: string; finish: string }[] = [];
  const sett = new Set<string>();
  for (const x of r.rows as any[]) {
    if (String(x.notat || "").startsWith("Fra Mystore via Kobling")) continue;
    const k = `${x.card_id}:${x.finish}`;
    if (sett.has(k)) continue;
    sett.add(k);
    par.push({ id: String(x.card_id), finish: String(x.finish) });
    if (par.length >= antall * 2) break;
  }
  const ider = [...new Set(par.map((p) => p.id))];
  const v = await butikkvisning({ sett: "", ider, baresalg: true, utenTokens: true, perSide: 200 });
  const etterId = new Map((v.kort as any[]).map((k) => [k.id, k]));
  const ut: any[] = [];
  for (const p of par) {
    const k = etterId.get(p.id);
    const variant = (k?.varianter || []).find((x: any) => x.finish === p.finish && x.påLager > 0);
    if (!variant) continue;
    ut.push({ ...k, varianter: [variant], flisnøkkel: `${p.id}:${p.finish}` });
    if (ut.length >= antall) break;
  }
  return ut;
}

export async function kortdetaljer(cardId: string) {
  const opp = await hentSalgsOppsett();
  const { beholdning } = await import("./lager.js");

  const r = await db().execute({
    sql: `SELECT c.*, COALESCE(s.visningsnavn, s.name) AS set_name, s.released_at AS sett_utgitt
            FROM cards c LEFT JOIN sets s ON s.code = c.set_code
           WHERE c.id = ?`,
    args: [cardId],
  });
  const kort: any = r.rows[0];
  if (!kort || Number(kort.er_serialized)) return null;
  kort.name = tokenNavn(kort.name, kort.er_token);

  // Andre utgaver: samme oracle_id, men ikke samme trykk. Faller tilbake på
  // navnet for kort der oracle_id mangler.
  const andre = await db().execute({
    sql: `SELECT c.id, c.name, c.set_code, c.collector_number, c.image_uri, c.rarity,
                 c.usd, c.usd_foil, c.has_nonfoil, c.has_foil, c.variant,
                 COALESCE(s.visningsnavn, s.name) AS set_name, s.released_at
            FROM cards c LEFT JOIN sets s ON s.code = c.set_code
           WHERE c.id <> ?
             AND c.er_token = ${Number(kort.er_token) ? 1 : 0}
             AND c.er_serialized = 0
             AND (${kort.oracle_id ? "c.oracle_id = ?" : "c.name_norm = ?"})
           ORDER BY s.released_at DESC
           LIMIT 40`,
    args: [cardId, kort.oracle_id || kort.name_norm],
  });

  const ider = [cardId, ...(andre.rows as any[]).map((x) => String(x.id))];
  const manuelleSalg = await hentManuellSalg(ider);
  const manuelleKjøp = await hentManuellePriser(ider);
  const lager = await beholdning(ider);

  const priserFor = (k: any) => {
    const ut: any[] = [];
    for (const finish of ["nonfoil", "foil"]) {
      if (finish === "nonfoil" && !Number(k.has_nonfoil)) continue;
      if (finish === "foil" && !Number(k.has_foil)) continue;
      const manuell = manuelleSalg.get(`${k.id}:${finish}`) ?? null;
      const kjøp = manuelleKjøp.get(`${k.id}:${finish}`) ?? null;
      const tilstander = salgspriser(k, finish, opp, manuell, kjøp).map((p) => ({
        ...p,
        lager: lager.get(`${k.id}:${finish}:${p.condition}`) || 0,
      }));
      if (tilstander.length) ut.push({ finish, manuell, tilstander });
    }
    return ut;
  };

  return {
    kort: { ...kort, varianter: priserFor(kort) },
    andreUtgaver: (andre.rows as any[])
      .map((k) => {
        const v = priserFor(k);
        return {
          ...k,
          nm: v[0]?.tilstander?.[0]?.ore ?? null,
          påLager: v.reduce((n, x: any) => n + x.tilstander.reduce((m: number, t: any) => m + t.lager, 0), 0),
        };
      })
      // Utgaver uten pris er ikke til salgs, men de er fortsatt utgaver du
      // kanskje leter etter. De blir med, bakerst.
      .sort((a, b) => (b.nm ?? -1) - (a.nm ?? -1)),
  };
}

// ── kort på lager uten pris ──────────────────────────────────────────────────
// Et kort uten pris vises ikke i butikken: Scryfall har ingen markedspris,
// ingen intervall treffer, og ingen manuell pris er satt. Ligger det i hylla,
// er det et kort du ikke får solgt før det får en pris — derfor listen.
export async function utenPrisPåLager(): Promise<
  { card_id: string; finish: string; antall: number; name: string; set_code: string; set_name: string; collector_number: string | null; rarity: string | null; er_token: boolean }[]
> {
  const lager = await db().execute(
    `SELECT card_id, finish, SUM(antall) AS n FROM (${butikklagerSql()}) GROUP BY card_id, finish HAVING SUM(antall) > 0`
  );
  const rader = lager.rows as any[];
  if (!rader.length) return [];
  const ider = [...new Set(rader.map((x) => String(x.card_id)))];
  const kort = new Map<string, any>();
  for (let i = 0; i < ider.length; i += 400) {
    const del = ider.slice(i, i + 400);
    const r = await db().execute({
      sql: `SELECT c.id, c.name, c.set_code, c.collector_number, c.rarity, c.usd, c.usd_foil, c.er_token,
                   COALESCE(s.visningsnavn, s.name) AS set_name
              FROM cards c LEFT JOIN sets s ON s.code = c.set_code
             WHERE c.id IN (${del.map(() => "?").join(",")})`,
      args: del,
    });
    for (const x of r.rows as any[]) kort.set(String(x.id), x);
  }
  const [opp, manuellSalg, manuellUsd] = await Promise.all([
    hentSalgsOppsett(),
    hentManuellSalg(ider),
    hentManuellePriser(ider),
  ]);
  const ut = [];
  for (const x of rader) {
    const k = kort.get(String(x.card_id));
    if (!k) continue;
    const nøkkel = `${x.card_id}:${x.finish}`;
    const pris = salgsprisØre(k, String(x.finish), "NM", opp, manuellSalg.get(nøkkel) ?? null, manuellUsd.get(nøkkel) ?? null);
    if (pris > 0) continue;
    ut.push({
      card_id: String(x.card_id), finish: String(x.finish), antall: Number(x.n),
      name: String(k.name), set_code: String(k.set_code), set_name: String(k.set_name || k.set_code),
      collector_number: k.collector_number ?? null, rarity: k.rarity ?? null, er_token: !!Number(k.er_token),
    });
  }
  return ut.sort((a, b) => a.set_name.localeCompare(b.set_name) || a.name.localeCompare(b.name));
}

// Scryfall kaller tokenet «Treasure». Folk kaller det «Treasure Token», og
// det er det de leter etter og kjenner igjen i lista.
export function tokenNavn(navn: unknown, erToken: unknown): string {
  const n = String(navn ?? "");
  if (!Number(erToken)) return n;
  return /\b(token|emblem)\b/i.test(n) ? n : `${n} Token`;
}
