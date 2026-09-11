import { db, hentSettings, normaliser, CONDITION_NAVN, type Condition, type Settings } from "./db.js";
import { prisØre, hentAlleSetRules, hentManuellePriser, hentEgneConditions, standardRegel, type SetRule } from "./pricing.js";
import { hentKvoterBulk, regnLedig } from "./quota.js";
import { finnKandidater, type Kandidat } from "./bulk.js";
import { byggIndeks, finnSett } from "./settnavn.js";

// ─────────────────────────────────────────────────────────────────────────────
// KATALOG
// ─────────────────────────────────────────────────────────────────────────────
// Alt kunden ser går gjennom her: hvilke utgaver som er aktuelle, hvilke
// conditions settet tar imot, hva de betales med, og hvor mange det er plass
// til. Kunden får aldri se kort jeg ikke vil ha.

export type Tilbud = {
  card_id: string;
  name: string;
  set_code: string;
  set_name: string;
  collector_number: string | null;
  rarity: string | null;
  image_uri: string | null;
  finish: "nonfoil" | "foil";
  available: number;
  // Beløpet er i øre. Kunden ser kroner, men alt regnes og lagres i øre.
  conditions: { condition: Condition; navn: string; ore: number }[];
};

async function byggTilbud(
  kandidater: Kandidat[],
  regler: Map<string, SetRule>,
  s: Settings
): Promise<Tilbud[]> {
  const nøkler: { card_id: string; finish: string }[] = [];
  for (const k of kandidater) {
    if (k.has_nonfoil) nøkler.push({ card_id: k.card_id, finish: "nonfoil" });
    if (k.has_foil) nøkler.push({ card_id: k.card_id, finish: "foil" });
  }
  const kvoter = await hentKvoterBulk(nøkler);
  const manuelle = await hentManuellePriser(kandidater.map((k) => k.card_id));
  const egne = await hentEgneConditions(kandidater.map((k) => k.card_id));

  const ut: Tilbud[] = [];
  for (const k of kandidater) {
    const regel = regler.get(k.set_code) || standardRegel(k.set_code, s);
    for (const finish of ["nonfoil", "foil"] as const) {
      if (finish === "nonfoil" && !k.has_nonfoil) continue;
      if (finish === "foil" && !k.has_foil) continue;

      const kvote = regnLedig(kvoter.get(`${k.card_id}:${finish}`), finish, regel);
      if (kvote.available <= 0) continue;

      const manuell = manuelle.get(`${k.card_id}:${finish}`) ?? null;
      // Kortets egen liste slår settets, der du har satt en.
      const mine = egne.get(k.card_id) ?? null;
      const conditions = (mine ?? regel.conditions)
        .map((c) => ({
          condition: c,
          navn: CONDITION_NAVN[c],
          ore: prisØre(k, finish, c, regel, s, manuell, mine),
        }))
        .filter((c) => c.ore > 0);
      if (!conditions.length) continue;

      ut.push({
        card_id: k.card_id,
        name: k.name,
        set_code: k.set_code,
        set_name: k.set_name,
        collector_number: k.collector_number,
        rarity: k.rarity,
        image_uri: k.image_uri,
        finish,
        available: kvote.available,
        conditions,
      });
    }
  }
  return ut;
}

// ── enkeltsøk ────────────────────────────────────────────────────────────────
export async function søk(opts: {
  q?: string;
  set?: string;
  rarity?: string;
  limit?: number;
}): Promise<Tilbud[]> {
  const s = await hentSettings();
  const regler = await hentAlleSetRules(s);
  const args: any[] = [];
  // Tokens ligger i katalogen fordi de selges, men de kjøpes aldri inn.
  const hvor: string[] = ["c.er_token = 0"];

  if (opts.q) {
    // Kunden skriver «Bonecrusher Giant», Scryfall kaller det
    // «Bonecrusher Giant // Stomp». Begge skal treffe.
    hvor.push("(c.name_norm LIKE ? OR c.front_norm LIKE ? OR c.back_norm LIKE ?)");
    const n = normaliser(opts.q) + "%";
    args.push(n, n, n);
  }
  if (opts.set) {
    hvor.push("c.set_code = ?");
    args.push(opts.set.toLowerCase());
  }
  if (opts.rarity) {
    hvor.push("c.rarity = ?");
    args.push(opts.rarity.toLowerCase());
  }
  if (!hvor.length) return [];

  // Vi henter bredt og filtrerer på kvote etterpå, siden «vil jeg ha dette»
  // avhenger av beholdning og reservasjoner som ikke ligger i cards-tabellen.
  const r = await db().execute({
    sql: `SELECT c.id AS card_id, c.name, c.set_code, COALESCE(s.visningsnavn, s.name) AS set_name,
                 c.collector_number, c.rarity, c.image_uri, c.usd, c.usd_foil,
                 c.has_foil, c.has_nonfoil, c.er_token, c.released_at
            FROM cards c LEFT JOIN sets s ON s.code = c.set_code
           WHERE ${hvor.join(" AND ")}
           ORDER BY c.name, c.released_at DESC LIMIT 300`,
    args,
  });

  const kandidater = r.rows.map(radTilKandidat);
  const tilbud = await byggTilbud(kandidater, regler, s);
  return tilbud.slice(0, opts.limit || 100);
}

// ── gjenoppslag ──────────────────────────────────────────────────────────────
// Kurven i nettleseren husker bare kort-ID, finish og tilstand. Priser og
// kvoter hentes hit hver gang den åpnes, slik at kunden ser hva som faktisk
// gjelder nå og ikke det som gjaldt da hen la kortet inn.
export async function tilbudFor(nøkler: { card_id: string }[]): Promise<Tilbud[]> {
  const ider = [...new Set(nøkler.map((n) => String(n.card_id)).filter(Boolean))].slice(0, 500);
  if (!ider.length) return [];
  const s = await hentSettings();
  const regler = await hentAlleSetRules(s);
  const r = await db().execute({
    sql: `SELECT c.id AS card_id, c.name, c.set_code, COALESCE(s.visningsnavn, s.name) AS set_name,
                 c.collector_number, c.rarity, c.image_uri, c.usd, c.usd_foil,
                 c.has_foil, c.has_nonfoil, c.er_token, c.released_at
            FROM cards c LEFT JOIN sets s ON s.code = c.set_code
           WHERE c.er_token = 0 AND c.id IN (${ider.map(() => "?").join(",")})`,
    args: ider,
  });
  return byggTilbud(r.rows.map(radTilKandidat), regler, s);
}

// ── bulkoppløsning ───────────────────────────────────────────────────────────
export type BulkResultat = {
  linje: number;
  rå: string;
  qty: number;
  navn: string;
  status: "løst" | "velg" | "ikke_ønsket" | "ukjent" | "feil";
  melding?: string;
  // Tilstanden kunden skrev på linjen, hvis vi kjente den igjen. Frontend
  // forhåndsvelger den — men bare der settet faktisk tar imot den.
  condHint: Condition | null;
  valg: Tilbud[];
};

// Settnavn i klamme («[Magic 2010]») må slås opp mot settlista. Indeksen
// bygges én gang per bulkkall, ikke én gang per linje.
async function settIndeks() {
  const r = await db().execute("SELECT code, name FROM sets");
  return byggIndeks(r.rows.map((x: any) => ({ code: String(x.code), name: String(x.name) })));
}

export async function løsBulk(linjer: ReturnType<typeof import("./bulk.js").parseBulk>): Promise<BulkResultat[]> {
  const s = await hentSettings();
  const regler = await hentAlleSetRules(s);
  // Indeksen bygges først når en linje trenger den, og bare én gang.
  let indeks: Awaited<ReturnType<typeof settIndeks>> | null = null;
  const hentIndeks = async () => (indeks ??= await settIndeks());
  const ut: BulkResultat[] = [];

  for (const l of linjer) {
    const grunn = { linje: l.linje, rå: l.rå, qty: l.qty, navn: l.navn, condHint: l.condHint };
    if (l.feil) {
      ut.push({ ...grunn, status: "feil", melding: l.feil, valg: [] });
      continue;
    }

    let settHint = l.settHint;
    // «[Magic 2010]» er et settnavn, ikke en kode. Vi godtar bare entydige
    // treff — to mulige sett er verre enn ingen, for da gjetter vi feil pris.
    if (!settHint && l.settNavnHint) {
      const t = finnSett(l.settNavnHint, await hentIndeks());
      if (t) settHint = t.code;
    }

    let kandidater = await finnKandidater(l.navn, settHint, l.nummerHint);

    // «Liliana of the Veil Innistrad» — settnavnet står bakerst uten
    // parentes. Fant vi ingenting med hele navnet, prøver vi å skille av de
    // siste ordene og slå dem opp som sett. Vi begynner med det lengste
    // halet: «Modern Horizons 3» må prøves før «3».
    if (!kandidater.length) {
      // «Modern Horizons 3» slutter på et tall, og tallet ble tolket som
      // samlernummer lenger opp. Derfor prøver vi også varianten der det
      // settes tilbake på navnet.
      const varianter: [string, string | null][] = [[l.navn, l.nummerHint]];
      if (l.nummerHint) varianter.push([`${l.navn} ${l.nummerHint}`, null]);

      for (const [helt, nummer] of varianter) {
        if (kandidater.length) break;
        const ord = helt.split(/\s+/).filter(Boolean);
        for (let n = Math.min(5, ord.length - 1); n >= 1 && !kandidater.length; n--) {
          const start = ord.slice(0, ord.length - n).join(" ");
          if (start.length < 2) continue;
          const t = finnSett(ord.slice(ord.length - n).join(" "), await hentIndeks());
          if (!t) continue;
          // Uten settet ville dette blitt et treff på alle trykk. Vi krever
          // at kortet faktisk finnes i settet, ellers var ikke halet et
          // settnavn — bare noen ord som tilfeldigvis lignet.
          const medSett = await finnKandidater(start, t.code, nummer);
          const iSettet = medSett.filter((k) => k.set_code === t.code);
          if (iSettet.length) {
            kandidater = iSettet;
            grunn.navn = start;
            settHint = t.code;
          }
        }
      }
    }

    if (!kandidater.length) {
      ut.push({ ...grunn, status: "ukjent", melding: "Fant ikke kortet. Sjekk stavemåten.", valg: [] });
      continue;
    }

    let valg = await byggTilbud(kandidater, regler, s);
    // Respekter foil-markeringen fra linjen, men bare når den finnes.
    const medFinish = valg.filter((v) => (l.foil ? v.finish === "foil" : v.finish === "nonfoil"));
    if (medFinish.length) valg = medFinish;

    if (!valg.length) {
      ut.push({
        ...grunn,
        status: "ikke_ønsket",
        melding: "Jeg kjøper ikke dette kortet nå — enten er kvoten full eller settet er ikke aktivt.",
        valg: [],
      });
      continue;
    }

    // Ett mulig trykk: løst. Flere: kunden må peke ut riktig utgave selv.
    // Dette er hele poenget med steget — å gjette her ville gitt meg feil
    // kort i posten og kunden feil pris.
    const løst = valg.length === 1;
    let melding: string | undefined = løst ? undefined : `${valg.length} utgaver — velg den du faktisk har`;

    // Skrev kunden en tilstand jeg ikke tar imot for dette settet, må det sies
    // med én gang. Ellers oppdager hen det først i kassen.
    if (l.condHint && løst && !valg[0].conditions.some((c) => c.condition === l.condHint)) {
      const tilbudt = valg[0].conditions.map((c) => c.condition).join(", ");
      melding = `Jeg tar ikke imot ${l.condHint} fra dette settet — bare ${tilbudt}.`;
    }

    ut.push({ ...grunn, status: løst ? "løst" : "velg", melding, valg });
  }
  return ut;
}

export function radTilKandidat(x: any): Kandidat {
  return {
    card_id: String(x.card_id),
    name: String(x.name),
    set_code: String(x.set_code),
    set_name: String(x.set_name || x.set_code),
    collector_number: x.collector_number ? String(x.collector_number) : null,
    rarity: x.rarity ? String(x.rarity) : null,
    image_uri: x.image_uri ? String(x.image_uri) : null,
    usd: x.usd === null ? null : Number(x.usd),
    usd_foil: x.usd_foil === null ? null : Number(x.usd_foil),
    has_foil: !!Number(x.has_foil),
    has_nonfoil: !!Number(x.has_nonfoil),
    er_token: !!Number(x.er_token),
    released_at: x.released_at ? String(x.released_at) : null,
  };
}
