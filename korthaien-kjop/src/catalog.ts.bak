import { db, hentSettings, normaliser, type Condition, type Settings } from "./db.js";
import { beregnPris, hentAlleSetRules, prisenFor, standardRegel, type SetRule } from "./pricing.js";
import { hentKvoterBulk, regnLedig } from "./quota.js";
import { finnKandidater, type Kandidat } from "./bulk.js";

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
  conditions: { condition: Condition; navn: string; pris: number }[];
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

  const ut: Tilbud[] = [];
  for (const k of kandidater) {
    const regel = regler.get(k.set_code) || standardRegel(k.set_code, s);
    for (const finish of ["nonfoil", "foil"] as const) {
      if (finish === "nonfoil" && !k.has_nonfoil) continue;
      if (finish === "foil" && !k.has_foil) continue;

      const kvote = regnLedig(kvoter.get(`${k.card_id}:${finish}`), finish, regel);
      if (kvote.available <= 0) continue;

      const usd = prisenFor(k, finish);
      const conditions = regel.conditions
        .map((c) => ({
          condition: c,
          navn: ({ NM: "Near Mint", EX: "Excellent", VG: "Very Good", G: "Good" } as const)[c],
          pris: beregnPris(usd, c, regel, s),
        }))
        .filter((c) => c.pris > 0);
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
  const hvor: string[] = [];

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
    sql: `SELECT c.id AS card_id, c.name, c.set_code, s.name AS set_name,
                 c.collector_number, c.rarity, c.image_uri, c.usd, c.usd_foil,
                 c.has_foil, c.has_nonfoil, c.released_at
            FROM cards c LEFT JOIN sets s ON s.code = c.set_code
           WHERE ${hvor.join(" AND ")}
           ORDER BY c.name, c.released_at DESC LIMIT 300`,
    args,
  });

  const kandidater = r.rows.map(radTilKandidat);
  const tilbud = await byggTilbud(kandidater, regler, s);
  return tilbud.slice(0, opts.limit || 100);
}

// ── bulkoppløsning ───────────────────────────────────────────────────────────
export type BulkResultat = {
  linje: number;
  rå: string;
  qty: number;
  navn: string;
  status: "løst" | "velg" | "ikke_ønsket" | "ukjent" | "feil";
  melding?: string;
  valg: Tilbud[];
};

export async function løsBulk(linjer: ReturnType<typeof import("./bulk.js").parseBulk>): Promise<BulkResultat[]> {
  const s = await hentSettings();
  const regler = await hentAlleSetRules(s);
  const ut: BulkResultat[] = [];

  for (const l of linjer) {
    if (l.feil) {
      ut.push({ linje: l.linje, rå: l.rå, qty: l.qty, navn: l.navn, status: "feil", melding: l.feil, valg: [] });
      continue;
    }

    const kandidater = await finnKandidater(l.navn, l.settHint, l.nummerHint);
    if (!kandidater.length) {
      ut.push({
        linje: l.linje, rå: l.rå, qty: l.qty, navn: l.navn,
        status: "ukjent", melding: "Fant ikke kortet. Sjekk stavemåten.", valg: [],
      });
      continue;
    }

    let valg = await byggTilbud(kandidater, regler, s);
    // Respekter foil-markeringen fra linjen, men bare når den finnes.
    const medFinish = valg.filter((v) => (l.foil ? v.finish === "foil" : v.finish === "nonfoil"));
    if (medFinish.length) valg = medFinish;

    if (!valg.length) {
      ut.push({
        linje: l.linje, rå: l.rå, qty: l.qty, navn: l.navn,
        status: "ikke_ønsket",
        melding: "Jeg kjøper ikke dette kortet nå — enten er kvoten full eller settet er ikke aktivt.",
        valg: [],
      });
      continue;
    }

    // Ett mulig trykk: løst. Flere: kunden må peke ut riktig utgave selv.
    // Dette er hele poenget med steget — å gjette her ville gitt meg feil
    // kort i posten og kunden feil pris.
    ut.push({
      linje: l.linje, rå: l.rå, qty: l.qty, navn: l.navn,
      status: valg.length === 1 ? "løst" : "velg",
      melding: valg.length === 1 ? undefined : `${valg.length} utgaver — velg den du faktisk har`,
      valg,
    });
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
    released_at: x.released_at ? String(x.released_at) : null,
  };
}
