import { db as rådb, normaliser, ryddFeilkoblinger } from "./db.js";

// ── databasen, med nye forsøk ────────────────────────────────────────────────
// Synken gjør titusener av kall mot Turso. Ett brudd i nettet («fetch
// failed», «other side closed») felte tidligere hele synken halvveis. Alt
// synken skriver er upsert eller sletting, og lesingene er bare lesinger, så
// et kall som feilet på nettverket kan trygt gjøres på nytt.
const NETTFEIL = /fetch failed|other side closed|ECONNRESET|ETIMEDOUT|UND_ERR|socket hang up|EAI_AGAIN|network/i;
export const erNettfeil = (e: any) =>
  NETTFEIL.test(String(e?.message || "")) || NETTFEIL.test(String(e?.cause?.message || e?.cause?.code || ""));
async function medForsøk<T>(f: () => Promise<T>): Promise<T> {
  for (let forsøk = 0; ; forsøk++) {
    try {
      return await f();
    } catch (e: any) {
      if (forsøk >= 5 || !erNettfeil(e)) throw e;
      const vent = Math.min(20000, 1000 * 2 ** forsøk);
      console.log(`  Nettverksfeil mot databasen (${e?.cause?.message || e?.message}) — prøver igjen om ${vent / 1000} s`);
      await new Promise((r) => setTimeout(r, vent));
    }
  }
}
const db = () => {
  const d = rådb();
  return {
    execute: (q: any) => medForsøk(() => d.execute(q)),
    batch: (q: any, modus?: any) => medForsøk(() => d.batch(q, modus)),
  };
};
import { byggIndeks, finnSett } from "./settnavn.js";
import { gjettSett } from "./gjett.js";
import { variantFraNavn, skillUtNummer, skillUtBokstav, nummerFraParentes, oppgirBehandling, erDisplayProdukt, erScrollProdukt } from "./varianter.js";

// ─────────────────────────────────────────────────────────────────────────────
// MYSTORE
// ─────────────────────────────────────────────────────────────────────────────
// Butikken er bygget som et tre: settkategori → raritetskategori → produkter.
// Produktet selv vet ingenting om hvilket sett det tilhører — `sku` er bare et
// løpenummer, og navnet er kortnavnet alene. Settet finnes utelukkende i
// kategorien over.
//
// Derfor går synken gjennom kategorier, ikke produkter: vi bygger treet, finner
// hvilket sett hver gren hører til, og henter så produktene i grenen. Da blir
// kortoppslaget settkode + kortnavn, som er presist.

export function harMystore(): boolean {
  return !!(process.env.MYSTORE_URL && process.env.MYSTORE_KEY);
}

const HODER = () => ({
  Authorization: `Bearer ${process.env.MYSTORE_KEY}`,
  Accept: "application/vnd.api+json",
});

// Mystore struperegulerer. Vi holder en minsteavstand mellom kallene, og
// øker den permanent hvis vi likevel blir avvist — det er billigere å gå litt
// saktere enn å bli stengt ute midt i en jobb.
let minPause = 220;
let sistKall = 0;

async function hent(sti: string, forsøk = 0): Promise<any> {
  const vent = minPause - (Date.now() - sistKall);
  if (vent > 0) await pause(vent);
  sistKall = Date.now();

  // Mystore lukker forbindelsen av og til midt i en lang kjøring — etter
  // flere tusen kall og noen megabyte svarer serveren med å kutte socketen
  // (UND_ERR_SOCKET). Da kaster fetch, og uten dette tok én slik kutt livet
  // av en jobb som var 85 % ferdig. Kallene er GET, så det er trygt å
  // gjenta dem. Teller deles med 429-grenen, så samlet antall forsøk er
  // begrenset uansett hvilken av dem som slår til.
  let r: Awaited<ReturnType<typeof fetch>>;
  try {
    r = await fetch(process.env.MYSTORE_URL + sti, { headers: HODER() });
  } catch (e: any) {
    if (forsøk >= 6) {
      throw new Error(
        `Mystore brøt forbindelsen seks ganger på ${sti} (${e?.cause?.code || e?.message}). ` +
          `Arbeidet som er gjort er lagret — kjør synken på nytt.`
      );
    }
    const ventetid = Math.min(30000, 1000 * 2 ** forsøk);
    console.log(
      `  · Forbindelsen brøt på ${sti} (${e?.cause?.code || "nettverksfeil"}). ` +
        `Prøver igjen om ${Math.round(ventetid / 1000)} s.`
    );
    await pause(ventetid);
    return hent(sti, forsøk + 1);
  }

  if (r.status === 429) {
    if (forsøk >= 6) {
      throw new Error(
        `Mystore avviste ${sti} seks ganger på rad. Vent noen minutter og kjør på nytt — ` +
          `arbeidet som er gjort er lagret.`
      );
    }
    // Server-anvisning først, ellers doblende ventetid.
    const anvist = parseInt(r.headers.get("retry-after") || "0", 10);
    const ventetid = anvist > 0 ? anvist * 1000 : Math.min(60000, 3000 * 2 ** forsøk);
    minPause = Math.min(1500, Math.round(minPause * 1.6));
    console.log(`  · Mystore ba oss vente. Pause i ${Math.round(ventetid / 1000)} s, går saktere videre.`);
    await pause(ventetid);
    return hent(sti, forsøk + 1);
  }

  if (!r.ok) throw new Error(`Mystore svarte ${r.status} på ${sti}`);
  return r.json();
}

function sisteSide(lenker: any): number {
  const m = String(lenker?.last || "").match(/page\[number\]=(\d+)/);
  return m ? parseInt(m[1], 10) : 1;
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── kategoritreet ────────────────────────────────────────────────────────────
type Kategori = { id: string; navn: string; forelder: string | null };

async function hentKategorier(logg: (s: string) => void): Promise<Kategori[]> {
  const ut: Kategori[] = [];
  let side = 1;
  let sider = 1;
  while (side <= sider && side <= 60) {
    const d = await hent(`/categories?page[number]=${side}&page[size]=50`);
    for (const c of d.data || []) {
      ut.push({
        id: String(c.id),
        navn: String(c.attributes?.name?.no || c.attributes?.name || ""),
        forelder: c.relationships?.parent?.data?.id ? String(c.relationships.parent.data.id) : null,
      });
    }
    if (side === 1) sider = sisteSide(d.links);
    side++;
  }
  logg(`  ${ut.length} kategorier hentet`);
  return ut;
}

// Klatrer oppover i treet til vi finner en kategori som heter det samme som et
// sett i katalogen. En raritetskategori arver dermed settet fra grenen sin.
export function knyttTilSett(
  kategorier: Kategori[],
  indeks: ReturnType<typeof byggIndeks>,
  overstyringer: Map<string, string | null>,
  tokenSett: Map<string, string> = new Map()
) {
  const etterId = new Map(kategorier.map((k) => [k.id, k]));
  const resultat = new Map<string, { set_code: string | null; regel?: string }>();
  const buffer = new Map<string, { code: string; regel: string } | null>();

  // Samme kategorinavn går igjen tusenvis av ganger («Rare», «Common»), så
  // oppslaget bufres.
  const slåOpp = (navn: string) => {
    const n = normaliser(navn);
    if (!buffer.has(n)) {
      let t: { code: string; regel: string } | null = finnSett(navn, indeks);
      // «… Tokens»: finn hovedsettet uten ordet, og ta token-settet dets.
      if (/\btokens?\s*$/i.test(navn)) {
        const hoved = finnSett(navn.replace(/\btokens?\s*$/i, "").trim(), indeks);
        const tok = hoved ? tokenSett.get(hoved.code) : undefined;
        if (tok) t = { code: tok, regel: "token-sett" };
      }
      buffer.set(n, t ? { code: t.code, regel: t.regel } : null);
    }
    return buffer.get(n)!;
  };

  for (const k of kategorier) {
    if (overstyringer.has(k.id)) {
      resultat.set(k.id, { set_code: overstyringer.get(k.id) ?? null, regel: "manuell" });
      continue;
    }
    let node: Kategori | undefined = k;
    let hopp = 0;
    let funnet: { code: string; regel: string } | null = null;
    while (node && hopp < 8) {
      funnet = slåOpp(node.navn);
      if (funnet) break;
      node = node.forelder ? etterId.get(node.forelder) : undefined;
      hopp++;
    }
    resultat.set(k.id, { set_code: funnet?.code || null, regel: funnet?.regel });
  }
  return resultat;
}

// ── produkter i én kategori ──────────────────────────────────────────────────
export type Produkt = {
  id: string;
  navn: string;
  lager: number;
  sku: string;
  // price fra Mystore er prisen kunden ser, med moms, som desimaltall i
  // kroner: «10.0000». Alt annet i systemet regnes i øre.
  pris_ore: number | null;
};

export async function hentProdukter(katId: string, maksSider = 40): Promise<Produkt[]> {
  const ut: Produkt[] = [];
  let side = 1;
  let sider = 1;
  while (side <= sider && side <= maksSider) {
    const d = await hent(`/categories/${katId}/products?page[number]=${side}&page[size]=50`);
    for (const p of d.data || []) {
      const a = p.attributes || {};
      // Et produkt du har skrudd av i butikken er ikke til salgs, og verken
      // lageret eller prisen hører hjemme i noe regnestykke. Verre: et avskrudd
      // produkt kunne overskrive et aktivt som peker på samme kort.
      // Mangler feltet, tas produktet med — vi skal ikke tømme lageret fordi
      // Mystore en dag slutter å sende status.
      if (a.status != null && Number(a.status) !== 1) continue;
      ut.push({
        id: String(p.id),
        navn: String(a.name?.no || a.name || ""),
        // quantity_physical er det som faktisk står i hylla. quantity kan være
        // trukket ned av reserverte ordrer som ennå ikke er plukket.
        lager: Number(a.quantity_physical ?? a.quantity ?? 0) || 0,
        sku: String(a.sku || ""),
        pris_ore: a.price == null ? null : Math.round(Number(a.price) * 100) || null,
      });
    }
    if (side === 1) sider = sisteSide(d.links);
    side++;
  }
  return ut;
}

// ── hovedjobb ────────────────────────────────────────────────────────────────
export async function synkMystore(
  logg: (s: string) => void = console.log,
  opts: { alleSett?: boolean } = {}
) {
  if (!harMystore()) {
    // Før meldte denne suksess og gikk videre. Cron-jobben lyste grønt i ni
    // dager mens beholdningen sto stille, og feilen ble oppdaget ved en
    // tilfeldighet. En jobb som ikke gjør arbeidet sitt skal feile.
    throw new Error(
      "MYSTORE_URL eller MYSTORE_KEY er ikke satt. Synken kan ikke kjøre, og " +
        "beholdningen blir stående på gamle tall. Sjekk Environment på tjenesten."
    );
  }

  const settRader = await db().execute("SELECT code, name, parent_code, set_type FROM sets");
  // Token-settet til hvert hovedsett: «Strixhaven: School of Mages Tokens»
  // i Mystore skal havne på Scryfalls token-sett for Strixhaven, uansett
  // hva Scryfall kaller det.
  const tokenSett = new Map<string, string>();
  for (const s of settRader.rows as any[]) {
    if (String(s.set_type || "") === "token" && s.parent_code) tokenSett.set(String(s.parent_code), String(s.code));
  }
  const indeks = byggIndeks(
    settRader.rows.map((s: any) => ({ code: String(s.code), name: String(s.name) }))
  );

  const lenkeRader = await db().execute(
    "SELECT category_id, set_code FROM mystore_categories WHERE manuell = 1"
  );
  const overstyringer = new Map<string, string | null>(
    lenkeRader.rows.map((r: any) => [String(r.category_id), r.set_code ? String(r.set_code) : null])
  );

  // Settfamilier: hovedsettet pluss alle Scryfall-sett som peker på det.
  // Et kort i «Strixhaven Mystical Archive» ligger fysisk i en Strixhaven-
  // pakke, og butikken selger det som et Strixhaven-kort.
  const familie = await byggFamilier();

  logg("Henter kategorier fra Mystore…");
  const kategorier = await hentKategorier(logg);
  const kobling = knyttTilSett(kategorier, indeks, overstyringer, tokenSett);
  // mystore_stock har én rad per kort og trykk. Lander to produkter på samme
  // rad, vant før det siste synken kom over — uten et ord, og med både lager
  // og pris. Et kunstkort til fire kroner tok plassen til et kort til flere
  // hundre, og ingenting pekte på det.
  //
  // Nå beholdes det første, og det andre havner blant de ukoblede der du kan
  // se det. Hvilket av to produkter som er det riktige, kan ingen regel
  // gjette — men den kan la være å late som om den vet.
  const settKort = new Map<string, string>();
  let kollisjoner = 0;
  const nå = new Date().toISOString();

  for (let i = 0; i < kategorier.length; i += 200) {
    await db().batch(
      kategorier.slice(i, i + 200).map((k) => ({
        sql: `INSERT INTO mystore_categories (category_id, name, parent_id, set_code, manuell, seen_at)
              VALUES (?, ?, ?, ?, 0, ?)
              ON CONFLICT(category_id) DO UPDATE SET
                name = excluded.name, parent_id = excluded.parent_id,
                set_code = CASE WHEN mystore_categories.manuell = 1
                                THEN mystore_categories.set_code ELSE excluded.set_code END,
                seen_at = excluded.seen_at`,
        args: [k.id, k.navn, k.forelder, kobling.get(k.id)?.set_code || null, nå],
      })),
      "write"
    );
  }

  // Bare sett jeg kjøper fra trenger beholdning. Resten påvirker ingen kvote,
  // og å hente dem ville kostet tusenvis av kall til ingen nytte.
  const aktive = await db().execute("SELECT set_code FROM set_rules WHERE enabled = 1");
  const aktiveSett = new Set(aktive.rows.map((r: any) => String(r.set_code)));
  // Tokens kjøpes sjelden inn, men selges. Token-settet hentes derfor når
  // hovedsettet er slått på, selv om token-settet selv står av.
  for (const [hoved, tok] of tokenSett) if (aktiveSett.has(hoved)) aktiveSett.add(tok);

  // Produktene ligger i løvnodene — raritetskategoriene nederst i treet.
  const harBarn = new Set(kategorier.filter((k) => k.forelder).map((k) => k.forelder!));
  const løvnoder = kategorier.filter((k) => !harBarn.has(k.id));
  const utenSett = løvnoder.filter((k) => !kobling.get(k.id)?.set_code).length;

  const skalHentes = løvnoder.filter((k) => {
    const kode = kobling.get(k.id)?.set_code;
    return kode ? opts.alleSett || aktiveSett.has(kode) : false;
  });

  logg(`  ${løvnoder.length} produktkategorier — ${løvnoder.length - utenSett} knyttet til et sett, ${utenSett} uten`);
  const perRegel = new Map<string, number>();
  for (const k of løvnoder) {
    const r = kobling.get(k.id)?.regel;
    if (r) perRegel.set(r, (perRegel.get(r) || 0) + 1);
  }
  if (perRegel.size) {
    logg("  matchet slik: " + [...perRegel].map(([r, n]) => `${r} ${n}`).join(", "));
  }
  if (!skalHentes.length) {
    logg("  Ingen kategorier å hente. Slå på settene du kjøper fra i admin først.");
  }
  logg(`  Henter produkter fra ${skalHentes.length} kategorier…`);

  let koblet = 0;
  const uløste: { p: Produkt; kat: string; setCode: string }[] = [];
  const stockRader: { sql: string; args: any[] }[] = [];
  // Manuelle koblinger. Hele tabellen leses én gang — den er liten, og et
  // oppslag per produkt ville vært titusener av spørringer mot Frankfurt.
  //
  // Disse går foran alle regler. Har du bestemt hvilket kort et produkt er,
  // er det ikke matcherens oppgave å ha en mening om det.
  const lenker = new Map<string, { card_id: string | null; finish: string; ignored: number }>();
  {
    const lr = await db().execute(
      "SELECT product_id, card_id, finish, ignored FROM mystore_links"
    );
    for (const x of lr.rows as any[]) {
      lenker.set(String(x.product_id), {
        card_id: x.card_id == null ? null : String(x.card_id),
        finish: String(x.finish || "nonfoil"),
        ignored: Number(x.ignored || 0),
      });
    }
    if (lenker.size) logg(`  ${lenker.size} manuelle koblinger lest.`);
  }

  const settSett = new Set<string>();

  for (let i = 0; i < skalHentes.length; i++) {
    const kat = skalHentes[i];
    const setCode = kobling.get(kat.id)!.set_code!;
    settSett.add(setCode);
    let produkter: Produkt[];
    try {
      produkter = await hentProdukter(kat.id);
    } catch (e: any) {
      logg(`  ⚠ ${kat.navn} (${kat.id}): ${e.message}`);
      continue;
    }

    // Manuelt koblede først. Kollisjonsvakten under lar det første produktet
    // ta kortet, og rekkefølgen kommer fra butikken — den sier ingenting om
    // hvilket produkt som har rett. Uten denne sorteringen taper en kobling
    // du har bestemt mot et produkt som bare gjettet på navnet, avhengig av
    // hvilken vei lista tilfeldigvis kom.
    //
    // En manuell kobling er en beslutning. Et navneoppslag er en antakelse.
    produkter.sort(
      (a, b) =>
        (lenker.get(String(b.id))?.card_id ? 1 : 0) -
        (lenker.get(String(a.id))?.card_id ? 1 : 0)
    );

    for (const p of produkter) {
      const lenke = lenker.get(String(p.id));
      // Et produkt du har merket som «ikke et kort» skal verken kobles eller
      // havne i uløst-lista. Ellers kommer det tilbake ved hver synk, og
      // lista blir aldri kortere uansett hvor mye du rydder.
      if (lenke?.ignored) continue;
      // «non-foil» inneholder «foil», og bindestreken er en ordgrense — så
      // \bfoil\b traff dem også, og kortene ble koblet som foil-utgaver.
      // Beholdningen havnet på feil rad, og kvoten for vanlige ble null.
      const erFoil = (t: string) =>
        /\bfoil\b/i.test(t) && !/\bnon[\s-]?foil\b/i.test(t);
      let foil = erFoil(p.navn) || erFoil(kat.navn);
      // Varianten leses ut av navnet før parentesene kastes — det er nettopp
      // der den står: «Bold Plagiarist (Extended Art)».
      // Varianten kan stå i kategorien i stedet for i navnet — «Retro
      // Artifacts», «Basicland (Fullart)» — nøyaktig som foil gjør to linjer
      // under. Navnet går foran: det er mer spesifikt enn hyllen kortet står i.
      const variantINavn = variantFraNavn(p.navn);
      const variant = variantINavn !== "vanlig" ? variantINavn : variantFraNavn(kat.navn);
      const utenFoil = p.navn.replace(/\bfoil\b/gi, "");
      // Må leses her, ikke etter linjen under: den kaster parentesene, og da
      // er «Zombie Army Token (009)» blitt «Zombie Army Token» og nummeret
      // finnes ikke lenger å lete etter.
      const parentesNummer = nummerFraParentes(utenFoil);
      let rent = utenFoil.replace(/\([^)]*\)/g, "").trim();

      // Samlernummer eller bokstav i navnet: «Island 267», «Swamp B».
      // Basic lands finnes i mange like utgaver, og dette er det eneste som
      // skiller dem — Scryfall kaller dem alle bare «Island».
      const medNummer = skillUtNummer(rent);
      // Et nummer bakerst i navnet vinner. Det er den gamle veien, og den er
      // mer presis — parentesen kan inneholde hva som helst.
      let nummer: string | null = medNummer.nummer ?? parentesNummer;
      rent = medNummer.navn;
      let posisjon: number | null = null;
      if (!nummer) {
        const medBokstav = skillUtBokstav(rent);
        posisjon = medBokstav.posisjon;
        rent = medBokstav.navn;
      }

      // Tokens heter «Dragon Token» hos deg og bare «Dragon» hos Scryfall.
      // Uten dette treffer ingen av dem, og de blir liggende i lista over
      // ukoblede produkter for alltid.
      const erToken = /\b(token|emblem)\b/i.test(p.navn);
      // «Wrenn and Six Emblem» mister «Emblem» i linjen under, og står da
      // igjen som «Wrenn and Six» — navnet på et ekte kort til over tusen
      // kroner. Det koblet seg dit og skrev lagertallet sitt over.
      //
      // Kravet går bare én vei: er produktet et token, må kortet være det
      // også. Omvendt holder ikke, for et token-kort kan hete hva som helst
      // uten at produktnavnet røper det.
      const tokenKrav = erToken ? " AND er_token = 1" : "";
      const tokenKravC = erToken ? " AND c.er_token = 1" : "";

      // Serienummererte utgaver nås bare når samlernummeret sier det — «120z»
      // treffer z-utgaven over, og det er riktig. Oppslagene under gjetter:
      // de sorterer på CAST(collector_number AS INTEGER), og både «120» og
      // «120z» blir 120. Da er rekkefølgen mellom dem vilkårlig, og et
      // foilprodukt uten nummer kan havne på serieutgaven.
      //
      // Det skjer stille. Serieutgaver er holdt utenfor kjøpslista,
      // prisingen og kupplista, men ingenting hindrer beholdning i å bli
      // ført på dem — og da står kortet i butikken til en pris som gjelder
      // et eksemplar du ikke har. Derfor er de ikke gyldige gjetninger.
      // Displaykort (se erDisplayProdukt) skal bare finne displayutgaven, og
      // alle andre produkter skal aldri havne på den. Filteret står på samme
      // sted som serieutgavene, så det gjelder i hvert oppslag under.
      const display = erDisplayProdukt(p.navn) || erDisplayProdukt(kat.navn);
      // Scroll-showcase likedan: den deler variant med vanlig showcase, så
      // uten filteret kunne «Gandalf the Grey (Showcase)» lande på #658.
      const scroll = erScrollProdukt(p.navn) || erScrollProdukt(kat.navn);
      const ikkeSerie = ` AND c.er_serialized = 0 AND c.er_display = ${display ? 1 : 0}`
        + ` AND c.er_scroll = ${scroll ? 1 : 0}`;
      if (erToken) rent = rent.replace(/\b(token|emblem)\b/gi, "").replace(/\s{2,}/g, " ").trim();

      const n = normaliser(rent);
      // Splittkort listes én gang per halvdel: «Determined (Bound/Determined)».
      const iParentes = utenFoil.match(/\(([^)]*\/[^)]*)\)/);
      const helt = iParentes ? normaliser(iParentes[1]) : n;
      // Søk i hele familien, ikke bare hovedsettet.
      const sett = familie.get(setCode) || [setCode];
      const plass = sett.map(() => "?").join(",");

      // Brukes to steder: når vi velger kandidat, og når vi oppdager at
      // kandidaten ikke finnes i produktets finish.
      const behandling =
        variant !== "vanlig" || oppgirBehandling(utenFoil) || oppgirBehandling(kat.navn);

      let treff: any = null;
      // Er kortet bestemt manuelt, er alt under uten betydning. Finishen følger
      // med fra koblingen — du vet om kortet i hylla er foil, og det gjør
      // hverken navnet eller kortdataene bedre enn deg.
      if (lenke?.card_id) {
        treff = { rows: [{ id: lenke.card_id, has_nonfoil: 1, has_foil: 1 }] };
        foil = lenke.finish === "foil";
      }
      if (!treff?.rows?.[0] && nummer) {
        // Nummeret er entydig. Da trenger vi verken variant eller navn.
        //
        // Butikken skiller to kunstvarianter med «244A» og «244B», mens Scryfall
        // gir dem hvert sitt nummer — 243 og 244. Bokstaven er da butikkens egen
        // notasjon og ikke en del av samlernummeret, og «244b» finner ingenting.
        //
        // Rekkefølgen betyr noe: finnes «250a» hos Scryfall, som på Battle for
        // Zendikars fullart-land, er den riktig og skal ikke overprøves av «250».
        // Derfor prøves nummeret med bokstav først.
        const nummerKandidater = /^\d+[a-z]$/.test(nummer)
          ? [nummer, nummer.slice(0, -1)]
          : [nummer];
        for (const kandidat of nummerKandidater) {
          treff = await db().execute({
            sql: `SELECT id, has_nonfoil, has_foil FROM cards
                   WHERE set_code IN (${plass}) AND (lower(collector_number) = ? OR ltrim(lower(collector_number), '0') = ?)
                     AND (name_norm = ? OR front_norm = ? OR back_norm = ?)${tokenKrav}
                   LIMIT 1`,
            args: [...sett, kandidat, kandidat, n, n, n],
          });
          // Feil nummer skal ikke gi feil kort. Bommer alle kandidatene, faller
          // vi tilbake til vanlig navneoppslag under.
          if (treff.rows[0]) break;
          treff = null as any;
        }
      }

      // Står varianten i navnet eller kategorien, er den et krav — ikke bare
      // en sorteringsnøkkel slik den er i det frie oppslaget under. Uten dette
      // faller «Timeless Dragon (Retro Frame)» ned på grunnkortet, kolliderer
      // med det vanlige produktet, og begge blir uløste.
      //
      // Bommer det strenge oppslaget, prøves det frie som før. Å la kortet bli
      // uløst ville vært å bytte én feil mot en annen.
      if (!treff?.rows?.[0] && variant !== "vanlig") {
        const streng = await db().execute({
          sql: `SELECT c.id, c.has_nonfoil, c.has_foil FROM cards c LEFT JOIN sets s ON s.code = c.set_code
                 WHERE c.set_code IN (${plass}) AND c.variant = ?
                   AND (c.name_norm = ? OR c.name_norm = ? OR c.front_norm = ? OR c.back_norm = ?)${tokenKravC}${ikkeSerie}
                 ORDER BY (c.set_code = ?) DESC,
                          CAST(c.collector_number AS INTEGER) ASC,
                          s.released_at ASC
                 LIMIT 1 OFFSET ?`,
          args: [...sett, variant, n, helt, n, n, setCode, posisjon || 0],
        });
        if (streng.rows[0]) treff = streng;
      }

      // Produktet oppgir en behandling, men ingen kandidat har nøyaktig den
      // varianten. «Shao Jun (Showcase)» i Assassin's Creed er et eksempel:
      // settet har ikke ett eneste showcase-kort, utgaven heter `borderless`
      // hos Scryfall. Vi vet ikke oversettelsen, men vi vet at grunnutgaven er
      // feil svar — og da er hvilken som helst av de andre bedre enn den.
      //
      // Det er også grunnen til at regelen ikke er en ordliste: Promo Pack,
      // Prerelease Foil og Schematic Art løses av det samme, uten at vi
      // trenger å vite hva de heter hos Scryfall.
      if (!treff?.rows?.[0] && behandling) {
        const ikkeVanlig = await db().execute({
          sql: `SELECT c.id, c.has_nonfoil, c.has_foil FROM cards c LEFT JOIN sets s ON s.code = c.set_code
                 WHERE c.set_code IN (${plass}) AND c.variant <> 'vanlig'
                   AND (c.name_norm = ? OR c.name_norm = ? OR c.front_norm = ? OR c.back_norm = ?)${tokenKravC}${ikkeSerie}
                 ORDER BY (c.set_code = ?) DESC,
                          CAST(c.collector_number AS INTEGER) ASC,
                          s.released_at ASC
                 LIMIT 1 OFFSET ?`,
          args: [...sett, n, helt, n, n, setCode, posisjon || 0],
        });
        if (ikkeVanlig.rows[0]) treff = ikkeVanlig;
      }

      if (!treff?.rows?.[0]) {
        treff = await db().execute({
          sql: `SELECT c.id, c.has_nonfoil, c.has_foil FROM cards c LEFT JOIN sets s ON s.code = c.set_code
                 WHERE c.set_code IN (${plass})
                   AND (c.name_norm = ? OR c.name_norm = ? OR c.front_norm = ? OR c.back_norm = ?)${tokenKravC}${ikkeSerie}
                 ORDER BY (c.variant = ?) DESC,
                          (c.set_code = ?) DESC,
                          (c.name_norm = ? OR c.name_norm = ?) DESC,
                          CAST(c.collector_number AS INTEGER) ASC,
                          s.released_at ASC
                 LIMIT 1 OFFSET ?`,
          args: [...sett, n, helt, n, n, variant, setCode, n, helt, posisjon || 0],
        });
      }
      if (!treff.rows[0]) {
        uløste.push({ p, kat: kat.navn, setCode });
        continue;
      }
      koblet++;
      // Expeditions finnes bare som foil, og butikken kaller dem ikke «foil» —
      // det ville vært overflødig. Da sier kortdataene det navnet ikke sier,
      // og beholdningen havner på en finish kortet ikke har. Butikken viser
      // bare finisher kortet faktisk har, så kortene blir usynlige.
      //
      // Bare denne veien. Sier navnet «foil» mens kortdataene mener foil ikke
      // finnes, er navnet en påstand du har skrevet om et fysisk kort — og da
      // er det importen som skal mistenkes, ikke deg.
      if (
        !foil &&
        Number((treff.rows[0] as any).has_foil) === 1 &&
        Number((treff.rows[0] as any).has_nonfoil) === 0
      ) {
        // Produktet er ikke foil, men kortet vi fant finnes bare i foil. Da
        // er det mest sannsynlig feil KORT, ikke feil finish — et ikke-foil
        // produkt kan umulig være et trykk som aldri ble laget i annet enn
        // foil.
        //
        // «Aerid Konstrari (Showcase)» er eksempelet: settet har to trykk som
        // heter `showcase` hos Scryfall, begge bare i foil, og ett som heter
        // `borderless` og finnes i begge. Butikken kaller det siste
        // «Showcase». Finishen utelukker de to første helt.
        //
        // Har nummeret allerede avgjort koblingen, er den sikrere enn dette
        // resonnementet, og da rører vi den ikke.
        const sammeFinish = nummer
          ? null
          : await db().execute({
              sql: `SELECT c.id, c.has_nonfoil, c.has_foil FROM cards c LEFT JOIN sets s ON s.code = c.set_code
                     WHERE c.set_code IN (${plass}) AND c.has_nonfoil = 1
                       AND (c.name_norm = ? OR c.name_norm = ? OR c.front_norm = ? OR c.back_norm = ?)${tokenKravC}${ikkeSerie}
                       ${behandling ? "AND c.variant <> 'vanlig'" : ""}
                     ORDER BY (c.set_code = ?) DESC,
                              CAST(c.collector_number AS INTEGER) ASC,
                              s.released_at ASC
                     LIMIT 1`,
              args: [...sett, n, helt, n, n, setCode],
            });
        if (sammeFinish?.rows[0]) {
          // Det fantes et trykk i riktig finish. Da var det kortet som var
          // feil, og finishen var riktig hele tiden.
          treff = sammeFinish;
        } else {
          // Ingen utgave i produktets finish. Da er det Expeditions-tilfellet:
          // kortet finnes bare i foil, og butikken sier det ikke fordi det
          // ville vært overflødig.
          foil = true;
        }
      }
      // Motsatt vei: produktet sier foil, men kortet vi fant finnes ikke i
      // foil. Finnes det et annet trykk av kortet i samme settfamilie som
      // finnes i foil (som regel extended art eller showcase), er det mest
      // sannsynlig det. «Rain of Riches (Foil)» i New Capenna Commander er
      // eksempelet: #150 finnes bare uten foil.
      //
      // Finnes det ikke, blir koblingen stående — navnet er en påstand om et
      // fysisk kort, og da er det kortdataene som skal mistenkes.
      if (
        foil && !nummer && !lenke?.card_id &&
        Number((treff.rows[0] as any).has_foil) === 0
      ) {
        const medFoil = await db().execute({
          sql: `SELECT c.id, c.has_nonfoil, c.has_foil FROM cards c LEFT JOIN sets s ON s.code = c.set_code
                 WHERE c.set_code IN (${plass}) AND c.has_foil = 1
                   AND (c.name_norm = ? OR c.name_norm = ? OR c.front_norm = ? OR c.back_norm = ?)${tokenKravC}${ikkeSerie}
                 ORDER BY (c.set_code = ?) DESC,
                          CAST(c.collector_number AS INTEGER) ASC,
                          s.released_at ASC
                 LIMIT 1`,
          args: [...sett, n, helt, n, n, setCode],
        });
        if (medFoil.rows[0]) treff = medFoil;
      }
      // Et produkt kan bare være ett kort. Flytter det seg — fordi
      // variantmatchingen ble bedre, eller fordi du rettet et navn — må den
      // gamle raden bort. Ellers står beholdningen igjen på et kort som ikke
      // lenger peker noe sted, og kvoten der blir feil uten at noe varsler.
      const kortNøkkel = `${String(treff.rows[0].id)}:${foil ? "foil" : "nonfoil"}`;
      const alt = settKort.get(kortNøkkel);
      if (alt) {
        kollisjoner++;
        logg(`  ! «${p.navn}» peker på samme kort som «${alt}». Hopper over.`);
        uløste.push({ p, kat: `${kat.navn} — kollisjon med «${alt}»`, setCode });
        continue;
      }
      settKort.set(kortNøkkel, p.navn);

      stockRader.push({
        sql: `DELETE FROM mystore_stock
               WHERE product_id = ? AND NOT (card_id = ? AND finish = ?)`,
        args: [p.id, String(treff.rows[0].id), foil ? "foil" : "nonfoil"],
      });
      stockRader.push({
        sql: `INSERT INTO mystore_stock (card_id, finish, qty, product_id, product_name, category, pris_ore, synced_at, inn_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN ? > 0 THEN ? ELSE NULL END)
              ON CONFLICT(card_id, finish) DO UPDATE SET
                inn_at = CASE WHEN excluded.qty > mystore_stock.qty THEN excluded.synced_at ELSE mystore_stock.inn_at END,
                qty = excluded.qty, product_id = excluded.product_id,
                product_name = excluded.product_name, category = excluded.category,
                pris_ore = excluded.pris_ore,
                synced_at = excluded.synced_at`,
        args: [String(treff.rows[0].id), foil ? "foil" : "nonfoil", p.lager, p.id, p.navn, kat.navn, p.pris_ore, nå, p.lager, nå],
      });
    }
    if ((i + 1) % 25 === 0) logg(`  ${i + 1}/${skalHentes.length} kategorier — ${koblet} koblet`);
  }

  for (let i = 0; i < stockRader.length; i += 300) {
    await db().batch(stockRader.slice(i, i + 300), "write");
  }

  // Produkter som ikke lenger finnes i Mystore, eller som har byttet
  // kategori til et sett vi ikke synker. Raden ville ellers blitt stående
  // for alltid med et lagertall ingen oppdaterer.
  const foreldet = await db().execute({
    sql: `DELETE FROM mystore_stock
           WHERE synced_at < ?
             AND card_id IN (SELECT id FROM cards WHERE set_code IN
                 (SELECT set_code FROM set_rules WHERE enabled = 1))`,
    args: [nå],
  });
  if (foreldet.rowsAffected) {
    logg(`  ${foreldet.rowsAffected} foreldede koblinger fjernet.`);
  }

  // Lista bygges på nytt hver synk, så koblede produkter forsvinner av seg selv.
  await db().execute("DELETE FROM mystore_unmatched");
  for (let i = 0; i < uløste.length; i += 300) {
    await db().batch(
      uløste.slice(i, i + 300).map(({ p, kat, setCode }) => ({
        sql: `INSERT INTO mystore_unmatched (product_id, sku, name, stock, category, set_code, seen_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(product_id) DO UPDATE SET
                name = excluded.name, stock = excluded.stock, category = excluded.category,
                set_code = excluded.set_code, seen_at = excluded.seen_at`,
        args: [p.id, p.sku, p.navn, p.lager, kat, setCode, nå],
      })),
      "write"
    );
  }

  const ryddet = await ryddFeilkoblinger();
  if (ryddet) logg(`  ${ryddet} feilkoblede rader fjernet (display/scroll).`);
  logg(`Synk ferdig: ${koblet} produkter koblet i ${settSett.size} sett, ${uløste.length} uten treff.`);
  if (kollisjoner) {
    logg(`  ${kollisjoner} produkter pekte på et kort et annet produkt allerede hadde tatt.`);
    logg("  De står under Kobling, merket «kollisjon».");
  }
  if (uløste.length) {
    logg(`  eksempler: ${uløste.slice(0, 5).map((u) => `${u.p.navn} (${u.setCode})`).join(", ")}`);
    logg("  Koble dem i admin under Kobling.");
  }
  // Dagens punkt i utviklingskurven. Dynamisk import, så modulene ikke
  // peker på hverandre. Feiler målingen, skal synken likevel stå som
  // fullført — beholdningen er oppdatert, det er bare punktet som mangler.
  try {
    const { lagreLagermåling } = await import("./statistikk.js");
    const m = await lagreLagermåling();
    logg(
      `  måling lagret: ${m.antall + m.antall_foil} kort, ` +
        `${Math.round(m.butikk_ore / 100)} kr i butikken.`
    );
  } catch (e: any) {
    logg(`  (lagermålingen feilet: ${e?.message || e})`);
  }

  return { kategorier: kategorier.length, koblet, ukoblet: uløste.length, sett: settSett.size };
}

// ─────────────────────────────────────────────────────────────────────────────
// GJETT SETT FOR KATEGORIER UTEN FORELDER
// ─────────────────────────────────────────────────────────────────────────────
// Mystore gir ingen forelder for disse, så vi ser på hva som ligger i dem.
// Bare kategorier med et tydelig flertall kobles automatisk; resten legges
// fram med kandidater du velger mellom.

export async function gjettKategorier(
  logg: (s: string) => void = console.log,
  opts: { bareForeslå?: boolean; maks?: number; påNytt?: boolean } = {}
) {
  if (!harMystore()) {
    logg("MYSTORE_URL/MYSTORE_KEY er ikke satt.");
    return { undersøkt: 0, koblet: 0, usikre: 0 };
  }

  // Kategorier som allerede er analysert hoppes over, så en avbrutt kjøring
  // fortsetter der den slapp i stedet for å bruke kall på det samme igjen.
  const r = await db().execute({
    sql: `SELECT c.category_id, c.name FROM mystore_categories c
           WHERE c.set_code IS NULL AND c.manuell = 0
             AND (c.forslag IS NULL OR ? = 1)
             AND NOT EXISTS (SELECT 1 FROM mystore_categories b WHERE b.parent_id = c.category_id)
           ORDER BY c.category_id`,
    args: [opts.påNytt ? 1 : 0],
  });

  const kandidater = r.rows.slice(0, opts.maks || 500);
  logg(`Undersøker ${kandidater.length} kategorier uten sett…`);

  let koblet = 0;
  let usikre = 0;
  let feilPåRad = 0;
  const nå = new Date().toISOString();

  for (let i = 0; i < kandidater.length; i++) {
    const k: any = kandidater[i];
    let produkter: Produkt[];
    try {
      // To sider holder som stikkprøve. Er 100 kort fra samme sett, er de
      // resterende det også.
      produkter = await hentProdukter(String(k.category_id), 2);
    } catch (e: any) {
      logg(`  ⚠ ${k.name} (${k.category_id}): ${e.message}`);
      feilPåRad++;
      // Fem på rad betyr at det ikke er denne ene kategorien som er problemet.
      if (feilPåRad >= 5) {
        logg("  Stopper her — Mystore slipper oss ikke til. Det som er koblet så langt er lagret.");
        break;
      }
      continue;
    }
    feilPåRad = 0;
    if (!produkter.length) continue;

    const g = await gjettSett(produkter.map((p) => p.navn));
    if (g.sikker && !opts.bareForeslå) {
      await db().execute({
        sql: `UPDATE mystore_categories SET set_code = ?, manuell = 0, gjettet = 1, seen_at = ?
               WHERE category_id = ?`,
        args: [g.sikker.set_code, nå, String(k.category_id)],
      });
      koblet++;
      logg(`  ✓ ${k.name} (${k.category_id}) → ${g.sikker.set_name} — ${g.sikker.treff} av ${g.antallKort} kort`);
    } else {
      usikre++;
      // Kandidatene lagres så koblingsskjermen kan vise dem uten å spørre
      // Mystore på nytt.
      await db().execute({
        sql: "UPDATE mystore_categories SET forslag = ?, seen_at = ? WHERE category_id = ?",
        args: [JSON.stringify(g.kandidater.slice(0, 4)), nå, String(k.category_id)],
      });
    }
    if ((i + 1) % 20 === 0) logg(`  ${i + 1}/${kandidater.length} — ${koblet} koblet`);
  }

  logg(`Ferdig: ${koblet} kategorier koblet automatisk, ${usikre} trenger et valg.`);
  return { undersøkt: kandidater.length, koblet, usikre };
}

// Hovedsett → [hovedsett, ...barn]. Scryfall oppgir forelderen selv, så
// familiene trenger ikke vedlikeholdes for hånd når nye sett kommer.
async function byggFamilier(): Promise<Map<string, string[]>> {
  const r = await db().execute("SELECT code, parent_code FROM sets");
  const kart = new Map<string, string[]>();
  for (const x of r.rows as any[]) {
    const kode = String(x.code);
    if (!kart.has(kode)) kart.set(kode, [kode]);
    const forelder = x.parent_code ? String(x.parent_code) : null;
    if (forelder && forelder !== kode) {
      if (!kart.has(forelder)) kart.set(forelder, [forelder]);
      kart.get(forelder)!.push(kode);
    }
  }
  return kart;
}
