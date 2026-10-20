// Kuppjakt: finner kort andre norske butikker selger for mindre enn du selger
// dem for selv.
//
// Grunnlaget er din egen salgspris fra salgspris.ts, ikke rå markedspris.
// De har samme kilde — salgsprisen er Scryfall-prisen med intervallene og
// faktoren din på — men prosenten betyr noe ulikt. Mot markedsprisen betyr
// «25 % under» forskjellige ting for et kort til 200 og ett til 2 000, fordi
// påslaget varierer med intervall. Mot salgsprisen betyr den alltid det
// samme: hvor mye du sitter igjen med.
//
// Prisene hentes fra MTG Kortjakt, som spør butikkene live. Ett oppslag
// herfra blir sju forespørsler ut. Derfor rotasjon og pause — se kortjakt.ts.

import { db } from "./db.js";
import { hentSalgsOppsett, hentManuellSalg, salgsprisØre } from "./salgspris.js";
import { søkKort, type Tilbud, type SøkSvar } from "./kortjakt.js";

// Korthaien ligger i Kortjakts sammenligning. Uten dette ville dine egne
// billigste utgaver dukket opp som kupp hos deg selv.
const EGEN_BUTIKK = "korthaien";

export type KuppOppsett = {
  // Laveste salgspris et kort må ha for å være verdt å følge. Under denne er
  // det ingen margin å hente uansett hvor billig noen selger det.
  min_ore: number;
  // Hvor langt under salgsprisen din tilbudet må ligge for å telle.
  pct: number;
  // Kort per kjøring. Vaktelista deles på sju, så hvert kort er innom ukentlig.
  per_natt: number;
  // Pause mellom hvert oppslag. Ti sekunder er ett oppslag per butikk per
  // tiende sekund — mindre enn én besøkende som blar.
  pause_ms: number;
  // Hvor mye DIN EGEN pris må avvike fra salgsprisen din, i begge
  // retninger, for å havne i Korthaien-fanen. Egen terskel, fordi den måler
  // noe annet: ikke et kjøp du kan gjøre, men en feil du har gjort.
  egen_pct: number;
  // Spilte eksemplarer er ikke samme vare som den du priser i Near Mint.
  min_condition: string;
  // Sverige og Danmark. Prisene deres har norsk importmoms innbakt, og frakt
  // kommer i tillegg, så de er ikke sammenlignbare uten påslag.
  utland: boolean;
  aktiv: boolean;
};

const STANDARD: KuppOppsett = {
  min_ore: 20000,
  pct: 25,
  per_natt: 650,
  pause_ms: 10000,
  egen_pct: 25,
  min_condition: "EX",
  utland: false,
  // Av som utgangspunkt. Kortjakt ber om at endepunktet ikke kalles i løkke,
  // og det er en bønn fra én person som driver tjenesten gratis. Slå den på
  // når du har spurt ham.
  aktiv: false,
};

// Egne nøkler i settings-tabellen, lest direkte. hentSettings() filtrerer bort
// alt som ikke står i sin egen STANDARD, så disse ville forsvunnet der.
export async function hentKuppOppsett(): Promise<KuppOppsett> {
  const r = await db().execute("SELECT key, value FROM settings WHERE key LIKE 'kupp_%'");
  const ut: any = { ...STANDARD };
  for (const rad of r.rows as any[]) {
    const k = String(rad.key).replace(/^kupp_/, "");
    if (!(k in STANDARD)) continue;
    try {
      ut[k] = JSON.parse(String(rad.value));
    } catch {
      ut[k] = rad.value;
    }
  }
  return ut as KuppOppsett;
}

export async function settKuppOppsett(endringer: Partial<KuppOppsett>): Promise<KuppOppsett> {
  const rader = Object.entries(endringer)
    .filter(([k]) => k in STANDARD)
    .map(([k, v]) => ({
      sql: `INSERT INTO settings (key, value) VALUES (?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      args: [`kupp_${k}`, JSON.stringify(v)],
    }));
  if (rader.length) await db().batch(rader, "write");
  return hentKuppOppsett();
}

// ── vakteliste ───────────────────────────────────────────────────────────────

export type VaktKort = {
  card_id: string;
  finish: string;
  name: string;
  set_code: string;
  set_name: string | null;
  collector_number: string | null;
  rarity: string | null;
  salg_ore: number;
  marked_ore: number;
};

// Kortene det er verdt å følge: de du selv ville tatt mer enn minstegrensen
// for. Lista utledes av prisene og vedlikeholder seg selv — flytter et kort
// seg over eller under grensen, følger vaktelista etter ved neste kjøring.
export async function vaktelisten(opp?: KuppOppsett): Promise<VaktKort[]> {
  const o = opp || (await hentKuppOppsett());
  const salg = await hentSalgsOppsett();

  // Grovsil i SQL først. Billigste mulige salgspris er markedspris ganger
  // laveste faktor i oppsettet, så alt under en forsiktig dollarterskel kan
  // ikke nå minstegrensen uansett hvilket intervall det havner i.
  const lavesteFaktor = Math.max(
    1,
    Math.min(
      salg.usd_nok * salg.faktor,
      ...salg.intervaller.filter((i) => i.faktor && i.faktor > 0).map((i) => i.faktor as number)
    )
  );
  const usdGrense = o.min_ore / 100 / lavesteFaktor;

  const r = await db().execute({
    sql: `SELECT c.id AS card_id, c.name, c.set_code, c.collector_number, c.rarity,
                 c.usd, c.usd_foil, c.has_nonfoil, c.has_foil,
                 COALESCE(s.visningsnavn, s.name) AS set_name
            FROM cards c LEFT JOIN sets s ON s.code = c.set_code
           WHERE c.er_token = 0 AND c.er_serialized = 0
             AND (c.usd >= ? OR c.usd_foil >= ?)`,
    args: [usdGrense, usdGrense],
  });

  const rader = r.rows as any[];
  const manuell = await hentManuellSalgIBolker(rader.map((x) => String(x.card_id)));
  const manuellUsd = await manuelleDollarpriser();

  const ut: VaktKort[] = [];
  for (const k of rader) {
    for (const finish of ["nonfoil", "foil"] as const) {
      if (finish === "nonfoil" && !Number(k.has_nonfoil)) continue;
      if (finish === "foil" && !Number(k.has_foil)) continue;
      const nøkkel = `${k.card_id}:${finish}`;
      const salgOre = salgsprisØre(
        k,
        finish,
        "NM" as any,
        salg,
        manuell.get(nøkkel) ?? null,
        manuellUsd.get(nøkkel) ?? null
      );
      if (salgOre < o.min_ore) continue;

      const usd = finish === "foil" ? k.usd_foil : k.usd;
      ut.push({
        card_id: String(k.card_id),
        finish,
        name: String(k.name),
        set_code: String(k.set_code),
        set_name: k.set_name ? String(k.set_name) : null,
        collector_number: k.collector_number == null ? null : String(k.collector_number),
        rarity: k.rarity ? String(k.rarity) : null,
        salg_ore: salgOre,
        marked_ore: Math.round(Number(usd || 0) * salg.usd_nok * 100),
      });
    }
  }
  return ut;
}

// IN-lista tåler ikke tusenvis av parametere, og én spørring per kort mot en
// database i Frankfurt tar minutter.
async function hentManuellSalgIBolker(ider: string[]): Promise<Map<string, number>> {
  const ut = new Map<string, number>();
  for (let i = 0; i < ider.length; i += 400) {
    for (const [k, v] of await hentManuellSalg(ider.slice(i, i + 400))) ut.set(k, v);
  }
  return ut;
}

// Dine egne dollarpriser, der Scryfall mangler eller tar feil. Tabellen er
// liten — bare overstyringene ligger der — så den hentes hel.
async function manuelleDollarpriser(): Promise<Map<string, number>> {
  const r = await db().execute("SELECT card_id, finish, usd FROM card_prices");
  return new Map((r.rows as any[]).map((x) => [`${x.card_id}:${x.finish}`, Number(x.usd)]));
}

// ── rotasjon ─────────────────────────────────────────────────────────────────

// Aldri sjekkede kort først, deretter de som har ventet lengst. Faller en
// natt ut, står kortene som ble hoppet over øverst neste gang i stedet for å
// bli stående usjekket til neste runde.
export function nesteBolk<T extends { card_id: string; finish: string }>(
  liste: T[],
  sist: Map<string, string | null>,
  antall: number
): T[] {
  return [...liste]
    .sort((a, b) => {
      const sa = sist.get(`${a.card_id}:${a.finish}`) ?? "";
      const sb = sist.get(`${b.card_id}:${b.finish}`) ?? "";
      if (sa !== sb) return sa < sb ? -1 : 1;
      return a.card_id < b.card_id ? -1 : 1;
    })
    .slice(0, Math.max(0, antall));
}

export async function sistSjekket(): Promise<Map<string, string | null>> {
  const r = await db().execute("SELECT card_id, finish, sist_sjekket FROM kupp_sjekk");
  return new Map(
    (r.rows as any[]).map((x) => [
      `${x.card_id}:${x.finish}`,
      x.sist_sjekket ? String(x.sist_sjekket) : null,
    ])
  );
}

// ── vurdering ────────────────────────────────────────────────────────────────

const normnr = (s: string | null | undefined) =>
  String(s ?? "").trim().toLowerCase().replace(/^0+(?=\d)/, "");

// Gjelder tilbudet samme trykk som kortet vårt? Kortjakt har allerede
// filtrert på sett og foil, men samme sett kan ha flere utgaver av et kort —
// showcase, extended art, borderless — og de er ikke samme vare.
export function passerTrykk(t: Tilbud, kort: VaktKort): boolean {
  if (t.in_stock === false) return false;
  if (!t.pris_ore || t.pris_ore <= 0) return false;
  if (typeof t.foil === "boolean" && t.foil !== (kort.finish === "foil")) return false;
  // Oppgir butikken samlernummer, må det stemme. Gjør den det ikke, stoler vi
  // på Kortjakts settfilter — og merker treffet som usikkert.
  if (t.collector_number && kort.collector_number) {
    if (normnr(t.collector_number) !== normnr(kort.collector_number)) return false;
  }
  return true;
}

export const erUsikkert = (t: Tilbud, kort: VaktKort): boolean =>
  !t.collector_number || !kort.collector_number;

export const kuppgrenseØre = (salgOre: number, pct: number): number =>
  Math.floor((salgOre * (100 - pct)) / 100);

export type Treff = {
  kort: VaktKort;
  shop: string;
  shop_name: string | null;
  tilbud: Tilbud;
  avvik_pct: number;
  usikker: boolean;
};

// Frakten holdes utenfor sammenligningen med vilje. Den er 49–100 kr for ett
// kort, men den samme enten du kjøper ett eller tretti fra samme butikk — og
// skal du hente et kupp, henter du flere. Beløpet lagres likevel, så du ser
// det i lista.
export function finnTreff(svar: SøkSvar, kort: VaktKort, pct: number): Treff[] {
  const grense = kuppgrenseØre(kort.salg_ore, pct);
  const ut: Treff[] = [];
  for (const b of svar.butikker) {
    if (b.shop === EGEN_BUTIKK) continue;
    for (const t of b.tilbud) {
      if (!passerTrykk(t, kort)) continue;
      if (t.pris_ore > grense) continue;
      ut.push({
        kort,
        shop: b.shop,
        shop_name: b.shop_name,
        tilbud: t,
        avvik_pct: Math.round((1 - t.pris_ore / kort.salg_ore) * 100),
        usikker: erUsikkert(t, kort),
      });
    }
  }
  return ut.sort((a, b) => b.avvik_pct - a.avvik_pct);
}

// ── lagring ──────────────────────────────────────────────────────────────────

export async function lagreTreff(treff: Treff[], nå = new Date().toISOString()): Promise<void> {
  if (!treff.length) return;
  const rader = treff.map((t) => ({
    sql: `INSERT INTO kupp_treff
            (card_id, finish, shop, url, shop_name, tittel, pris_ore, frakt_ore,
             condition, collector_number, in_stock, salg_ore, marked_ore,
             avvik_pct, usikker, forst_sett, sist_sett, borte_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
          ON CONFLICT(card_id, finish, shop, url) DO UPDATE SET
            pris_ore = excluded.pris_ore, frakt_ore = excluded.frakt_ore,
            condition = excluded.condition, in_stock = excluded.in_stock,
            salg_ore = excluded.salg_ore, marked_ore = excluded.marked_ore,
            avvik_pct = excluded.avvik_pct, usikker = excluded.usikker,
            tittel = excluded.tittel, sist_sett = excluded.sist_sett,
            borte_at = NULL`,
    args: [
      t.kort.card_id, t.kort.finish, t.shop, t.tilbud.url || "",
      t.shop_name, t.tilbud.tittel, t.tilbud.pris_ore, t.tilbud.frakt_ore,
      t.tilbud.condition, t.tilbud.collector_number,
      t.tilbud.in_stock == null ? null : t.tilbud.in_stock ? 1 : 0,
      t.kort.salg_ore, t.kort.marked_ore, t.avvik_pct, t.usikker ? 1 : 0, nå, nå,
    ],
  }));
  for (let i = 0; i < rader.length; i += 200) await db().batch(rader.slice(i, i + 200), "write");
}

// Et tilbud som ikke lenger finnes markeres som borte i stedet for å slettes.
// At et kupp forsvant er også opplysning — da vet du at noen tok det.
async function markerBorte(kort: VaktKort, beholdte: string[], nå: string): Promise<void> {
  const utenom = beholdte.length ? ` AND url NOT IN (${beholdte.map(() => "?").join(",")})` : "";
  await db().execute({
    sql: `UPDATE kupp_treff SET borte_at = ?
           WHERE card_id = ? AND finish = ? AND borte_at IS NULL${utenom}`,
    args: [nå, kort.card_id, kort.finish, ...beholdte],
  });
}

// ── jobben ───────────────────────────────────────────────────────────────────

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function kjørKuppjakt(
  logg: (s: string) => void = console.log,
  opts: { antall?: number; tørr?: boolean } = {}
): Promise<{ sjekket: number; treff: number; hoppet: number; usjekkede: number }> {
  const o = await hentKuppOppsett();
  if (!o.aktiv && !opts.tørr) {
    throw new Error(
      "Kuppjakten er slått av. Den spør butikkene live gjennom Kortjakt, " +
        "og skal ikke gå før du har avklart det med dem. Slå den på i Innstillinger."
    );
  }

  const liste = await vaktelisten(o);
  const sist = await sistSjekket();
  const bolk = nesteBolk(liste, sist, opts.antall ?? o.per_natt);
  logg(`Vakteliste: ${liste.length} kort. Sjekker ${bolk.length} denne gangen.`);

  let treff = 0;
  let hoppet = 0;
  let usjekkede = 0;
  // Fem tomme svar på rad betyr at Kortjakt er tom for budsjett. Da er det
  // ingen vits i å mase videre — vi tar resten neste gang.
  let påRad = 0;
  let feilPåRad = 0;

  for (const [i, kort] of bolk.entries()) {
    if (i) await pause(o.pause_ms);
    try {
      const svar = await søkKort({
        navn: kort.name,
        sett: kort.set_code,
        foil: kort.finish === "foil",
        minCondition: o.min_condition,
        utland: o.utland,
      });

      if (svar.usjekkede.length) usjekkede++;
      påRad = svar.butikker.some((b) => b.spurt) ? 0 : påRad + 1;
      if (påRad >= 5) {
        logg("  Fem svar på rad uten at noen butikk ble sjekket. Stopper her.");
        break;
      }

      const funnet = finnTreff(svar, kort, o.pct);
      const nå = new Date().toISOString();
      await lagreTreff(funnet, nå);
      await markerBorte(kort, funnet.map((t) => t.tilbud.url || ""), nå);
      treff += funnet.length;

      // Egne priser leses fra Mystore, ikke herfra. Se egenliste() nederst.

      if (funnet.length) {
        const b = funnet[0];
        logg(
          `  ${kort.name} (${kort.set_code}): ${funnet.length} treff, billigst ` +
            `${(b.tilbud.pris_ore / 100).toFixed(0)} kr hos ${b.shop_name} — ${b.avvik_pct} % under.`
        );
      }
      feilPåRad = 0;
      await merkSjekket(kort, svar.usjekkede.length ? "delvis" : "ok", nå);
    } catch (e: any) {
      hoppet++;
      feilPåRad++;
      logg(`  ${kort.name} (${kort.set_code}): ${e?.message || e}`);
      await merkSjekket(kort, "feil", new Date().toISOString());
      // Sikringen over teller bare svar som kom gjennom. Et kastet kall
      // havner her, og uten dette fortsatte jobben i tusen forsøk — tre timer
      // på å få 401 igjen og igjen, hver natt.
      if (feilPåRad >= 10) {
        logg(`  Ti feil på rad. Stopper — noe er galt med forbindelsen til Kortjakt.`);
        break;
      }
    }
  }

  logg(`Ferdig: ${bolk.length - hoppet} sjekket, ${treff} treff, ${hoppet} feilet.`);
  if (usjekkede) {
    logg(`  ${usjekkede} kort fikk svar der minst én butikk ikke ble sjekket.`);
  }
  return { sjekket: bolk.length - hoppet, treff, hoppet, usjekkede };
}

async function merkSjekket(kort: VaktKort, status: string, nå: string): Promise<void> {
  await db().execute({
    sql: `INSERT INTO kupp_sjekk (card_id, finish, sist_sjekket, siste_status)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(card_id, finish) DO UPDATE SET
            sist_sjekket = excluded.sist_sjekket, siste_status = excluded.siste_status`,
    args: [kort.card_id, kort.finish, nå, status],
  });
}

// ── visning ──────────────────────────────────────────────────────────────────

export async function kuppliste(opts: { visBorte?: boolean; minAvvik?: number } = {}) {
  const r = await db().execute({
    sql: `SELECT t.*, c.name, c.set_code, c.rarity, c.image_uri,
                 COALESCE(s.visningsnavn, s.name) AS set_name
            FROM kupp_treff t
            JOIN cards c ON c.id = t.card_id
            LEFT JOIN sets s ON s.code = c.set_code
           WHERE (? OR t.borte_at IS NULL) AND t.avvik_pct >= ?
           ORDER BY t.borte_at IS NOT NULL, t.avvik_pct DESC, t.sist_sett DESC
           LIMIT 500`,
    args: [opts.visBorte ? 1 : 0, opts.minAvvik ?? 0],
  });

  const sjekk = await db().execute(
    `SELECT COUNT(*) AS n, MAX(sist_sjekket) AS siste,
            SUM(CASE WHEN sist_sjekket IS NULL THEN 1 ELSE 0 END) AS usjekket
       FROM kupp_sjekk`
  );
  const s = (sjekk.rows[0] || {}) as any;

  return {
    oppsett: await hentKuppOppsett(),
    status: {
      fulgt: Number(s.n || 0),
      aldri_sjekket: Number(s.usjekket || 0),
      sist_kjørt: s.siste ? String(s.siste) : null,
    },
    treff: (r.rows as any[]).map((x) => ({
      card_id: String(x.card_id),
      finish: String(x.finish),
      name: String(x.name),
      set_code: String(x.set_code),
      set_name: x.set_name ? String(x.set_name) : null,
      rarity: x.rarity ? String(x.rarity) : null,
      image_uri: x.image_uri ? String(x.image_uri) : null,
      shop: String(x.shop),
      shop_name: x.shop_name ? String(x.shop_name) : null,
      tittel: x.tittel ? String(x.tittel) : null,
      pris_ore: Number(x.pris_ore),
      frakt_ore: x.frakt_ore == null ? null : Number(x.frakt_ore),
      condition: x.condition ? String(x.condition) : null,
      collector_number: x.collector_number ? String(x.collector_number) : null,
      salg_ore: Number(x.salg_ore),
      marked_ore: Number(x.marked_ore || 0),
      avvik_pct: Number(x.avvik_pct),
      usikker: !!Number(x.usikker),
      url: x.url ? String(x.url) : null,
      forst_sett: String(x.forst_sett),
      sist_sett: String(x.sist_sett),
      borte_at: x.borte_at ? String(x.borte_at) : null,
    })),
  };
}

// Vaktelista er utledet, så den kan sjekkes uten å kjøre noe mot Kortjakt.
// Nyttig før du slår jobben på: da ser du hvor mange kort den vil følge.
export async function vaktelisteSammendrag() {
  const o = await hentKuppOppsett();
  const liste = await vaktelisten(o);
  const perNatt = Math.max(1, o.per_natt);
  return {
    oppsett: o,
    antall: liste.length,
    runde_dager: Math.ceil(liste.length / perNatt),
    oppslag_per_natt: Math.min(liste.length, perNatt),
    tid_per_natt_min: Math.round((Math.min(liste.length, perNatt) * o.pause_ms) / 60000),
  };
}

// ── egne priser ──────────────────────────────────────────────────────────────
// Dine egne priser kommer fra Mystore, ikke fra Kortjakt.
//
// Første utgave leste dem ut av Kortjakt-svarene, fordi Korthaien ligger i
// sammenligningen deres og prisen fulgte med gratis. Det var riktig så lenge
// Kortjakt var åpen. Da den fikk innlogging, falt begrunnelsen bort — og da
// er det uansett bedre å lese egne tall fra egen kilde: hele katalogen i
// stedet for de 9 328 i rotasjon, hver natt i stedet for hver uke, og ingen
// avhengighet til en tjeneste som kan stenge igjen.
//
// price fra Mystore er prisen kunden ser, med moms. Den sammenlignes mot det
// salgspris.ts mener kortet er verdt i Near Mint.
//
// Lista er en arbeidsliste. Du huker av et kort når du har sett på det, og da
// skal det forsvinne — ikke for alltid, men til det er noe nytt å vurdere.
// Derfor lagres prisen kortet hadde da du huket av, og merket gjelder bare så
// lenge prisen står stille. Endrer den seg, er premisset et annet, og raden
// kommer tilbake til ny vurdering.
//
// Det gir en bieffekt som er verdt å kjenne til: et kort du med vilje priser
// lavt — signert, skadet, lokkevare — blir borte for godt når du huker det av,
// nettopp fordi prisen aldri endrer seg.

export type EgenRad = {
  card_id: string;
  finish: string;
  name: string;
  set_code: string;
  set_name: string | null;
  collector_number: string | null;
  rarity: string | null;
  product_name: string | null;
  antall: number;
  pris_ore: number;
  salg_ore: number;
  marked_ore: number;
  // Positivt = du tar mindre enn kortet er verdt. Negativt = du tar mer.
  avvik_ore: number;
  avvik_pct: number;
  ferdig: boolean;
  ferdig_at: string | null;
};

export async function egenliste(
  opts: {
    retning?: "under" | "over" | "begge";
    minKr?: number;
    minPct?: number;
    visFerdige?: boolean;
  } = {}
) {
  const o = await hentKuppOppsett();
  const salg = await hentSalgsOppsett();
  const retning = opts.retning || "under";
  const minØre = Math.max(0, Math.round((opts.minKr ?? 0) * 100));
  const minPct = opts.minPct ?? o.egen_pct;

  // Bare det som faktisk ligger i hylla med en pris. Et utsolgt produkt kan
  // ingen kjøpe billig, og et uten pris er ikke til salgs.
  const r = await db().execute(`
    SELECT m.card_id, m.finish, m.qty, m.pris_ore, m.product_name,
           c.name, c.set_code, c.collector_number, c.rarity, c.usd, c.usd_foil,
           COALESCE(s.visningsnavn, s.name) AS set_name,
           f.pris_ore AS ferdig_pris, f.rettet_at
      FROM mystore_stock m
      JOIN cards c ON c.id = m.card_id
      LEFT JOIN sets s ON s.code = c.set_code
      LEFT JOIN kupp_rettet f ON f.card_id = m.card_id AND f.finish = m.finish
     WHERE m.qty > 0 AND m.pris_ore IS NOT NULL AND m.pris_ore > 0
  `);

  const rader = r.rows as any[];
  const manuell = await hentManuellSalgIBolker([...new Set(rader.map((x) => String(x.card_id)))]);
  const manuellUsd = await manuelleDollarpriser();

  const ut: EgenRad[] = [];
  let under = 0;
  let over = 0;
  let ferdige = 0;

  for (const x of rader) {
    const finish = String(x.finish);
    const nøkkel = `${x.card_id}:${finish}`;
    const salgOre = salgsprisØre(
      x,
      finish,
      "NM" as any,
      salg,
      manuell.get(nøkkel) ?? null,
      manuellUsd.get(nøkkel) ?? null
    );
    // Uten salgspris finnes det ingen fasit å måle mot. Det er ikke det samme
    // som at prisen er riktig, så kortet holdes utenfor i stedet for å telle
    // som et avvik på hundre prosent.
    if (!salgOre || salgOre <= 0) continue;

    const pris = Number(x.pris_ore);
    const avvikØre = salgOre - pris;
    const avvikPct = Math.round((avvikØre / salgOre) * 100);
    if (Math.abs(avvikPct) < minPct) continue;
    if (Math.abs(avvikØre) < minØre) continue;

    // Merket gjelder bare prisen det ble satt på. Står prisen stille, har du
    // sett på kortet og raden hviler. Er den endret, er det noe nytt.
    const ferdig = x.ferdig_pris != null && Number(x.ferdig_pris) === pris;
    if (ferdig) ferdige++;
    else if (avvikØre > 0) under++;
    else over++;

    if (ferdig && !opts.visFerdige) continue;
    if (retning === "under" && avvikØre <= 0) continue;
    if (retning === "over" && avvikØre >= 0) continue;

    const usd = finish === "foil" ? x.usd_foil : x.usd;
    ut.push({
      card_id: String(x.card_id),
      finish,
      name: String(x.name),
      set_code: String(x.set_code),
      set_name: x.set_name ? String(x.set_name) : null,
      collector_number: x.collector_number == null ? null : String(x.collector_number),
      rarity: x.rarity ? String(x.rarity) : null,
      product_name: x.product_name ? String(x.product_name) : null,
      antall: Number(x.qty),
      pris_ore: pris,
      salg_ore: salgOre,
      marked_ore: Math.round(Number(usd || 0) * salg.usd_nok * 100),
      avvik_ore: avvikØre,
      avvik_pct: avvikPct,
      ferdig,
      ferdig_at: ferdig && x.rettet_at ? String(x.rettet_at) : null,
    });
  }

  // Kroner, ikke prosent. Et kort priset 87 % for lavt der differansen er
  // seksti kroner, haster mindre enn ett priset 30 % for lavt med 2 400 i
  // differanse — og prosenten setter det første øverst.
  ut.sort((a, b) => Math.abs(b.avvik_ore) - Math.abs(a.avvik_ore));

  const synk = await db().execute(
    "SELECT MAX(synced_at) AS siste, COUNT(*) AS n FROM mystore_stock WHERE pris_ore IS NOT NULL"
  );
  const s = (synk.rows[0] || {}) as any;

  return {
    oppsett: o,
    status: {
      for_lavt: under,
      for_hoyt: over,
      ferdige,
      med_pris: Number(s.n || 0),
      sist_synket: s.siste ? String(s.siste) : null,
    },
    rader: ut.slice(0, 500),
  };
}

// Prisen lagres sammen med merket. Uten den ville et avhuket kort blitt borte
// for alltid, også når du retter prisen til noe annet feil.
export async function settRettet(
  cardId: string,
  finish: string,
  prisØre: number,
  på: boolean
): Promise<void> {
  if (!på) {
    await db().execute({
      sql: "DELETE FROM kupp_rettet WHERE card_id = ? AND finish = ?",
      args: [cardId, finish],
    });
    return;
  }
  await db().execute({
    sql: `INSERT INTO kupp_rettet (card_id, finish, pris_ore, rettet_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(card_id, finish) DO UPDATE SET
            pris_ore = excluded.pris_ore, rettet_at = excluded.rettet_at`,
    args: [cardId, finish, Math.round(prisØre), new Date().toISOString()],
  });
}
