import { db } from "./db.js";
import { hentSalgsOppsett, salgsprisØre } from "./salgspris.js";

// ─────────────────────────────────────────────────────────────────────────────
// STATISTIKK OG LAGERRAPPORT
// ─────────────────────────────────────────────────────────────────────────────
// Begge tallene regnes ut når de spørres om, ikke lagres. For ordrene er det
// et krav: totalen på en ordre endrer seg når du justerer linjer ved mottak,
// og da skal statistikken følge etter. Et lagret månedstall ville frosset det
// kunden først ble forespeilet, ikke det du faktisk betalte.
//
// Konsekvensen er at tidligere måneder kan endre seg i ettertid. Behandler du
// en gammel ordre i dag, blir forrige måneds sum en annen enn i går. For
// driftstall er det riktig — men det betyr at tallene ikke kan avstemmes mot
// noe du noterte tidligere.

const TELLER_MED = ["pending", "received", "stocked"];
const AVLYST = ["cancelled", "expired"];

export type Måned = {
  mnd: string; // "2026-09"
  antall: number;
  sum_ore: number;
  avlyst: number;
  avlyst_ore: number;
  // Antall kort, ikke antall linjer. En linje er «4 stk Lightning Bolt i NM»,
  // og det er fire kort — det er volumet du håndterer, ikke antall rader.
  kort: number;
  avlyst_kort: number;
};

// Måneden en ordre hører til avgjøres av norsk tid, ikke UTC. En ordre som
// kommer inn 1. mai kl. 01:30 norsk tid er lagret som 30. april i basen, og
// ville havnet i feil måned med en ren strftime. Sommertid gjør at et fast
// timetillegg er feil halve året, så vi lar Intl gjøre jobben.
export function osloMåned(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "ukjent";
  const deler = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Oslo",
    year: "numeric",
    month: "2-digit",
  }).format(d);
  return deler.slice(0, 7);
}

type Rad = { created_at: string; status: string; total_ore: number; kort?: number };

// Skilt ut som egen funksjon fordi den er verdt å teste for seg: det er her
// måneden bestemmes og de avlyste holdes utenfor omsetningen.
export function grupper(rader: Rad[]): Måned[] {
  const kart = new Map<string, Måned>();
  for (const r of rader) {
    const mnd = osloMåned(r.created_at);
    let m = kart.get(mnd);
    if (!m) {
      m = { mnd, antall: 0, sum_ore: 0, avlyst: 0, avlyst_ore: 0, kort: 0, avlyst_kort: 0 };
      kart.set(mnd, m);
    }
    const ore = Number(r.total_ore || 0);
    const kort = Number(r.kort || 0);
    if (TELLER_MED.includes(r.status)) {
      m.antall++;
      m.sum_ore += ore;
      m.kort += kort;
    } else if (AVLYST.includes(r.status)) {
      m.avlyst++;
      m.avlyst_ore += ore;
      m.avlyst_kort += kort;
    }
  }
  return [...kart.values()].sort((a, b) => (a.mnd < b.mnd ? 1 : -1));
}

const nullMåned = (mnd: string): Måned =>
  ({ mnd, antall: 0, sum_ore: 0, avlyst: 0, avlyst_ore: 0, kort: 0, avlyst_kort: 0 });

export function summer(måneder: Måned[], prefiks: string): Måned {
  const ut = nullMåned(prefiks);
  for (const m of måneder) {
    if (!m.mnd.startsWith(prefiks)) continue;
    ut.antall += m.antall;
    ut.sum_ore += m.sum_ore;
    ut.avlyst += m.avlyst;
    ut.avlyst_ore += m.avlyst_ore;
    ut.kort += m.kort;
    ut.avlyst_kort += m.avlyst_kort;
  }
  return ut;
}

export function forrigeMåned(mnd: string): string {
  const [år, m] = mnd.split("-").map(Number);
  return m === 1 ? `${år - 1}-12` : `${år}-${String(m - 1).padStart(2, "0")}`;
}

export async function ordreStatistikk() {
  // Ordretallet er lavt nok til at hele tabellen kan grupperes i JS. Det
  // gjør at måneden kan avgjøres i norsk tid, som SQLite ikke kan på egen
  // hånd uten å anta sommertid.
  const r = await db().execute(
    `SELECT o.created_at, o.status, o.total_ore,
            COALESCE(SUM(l.qty), 0) AS kort
       FROM orders o LEFT JOIN order_lines l ON l.order_id = o.id
      GROUP BY o.id
      ORDER BY o.created_at DESC`
  );
  const måneder = grupper(r.rows as any[]);

  const nå = osloMåned(new Date().toISOString());
  const forrige = forrigeMåned(nå);
  const år = nå.slice(0, 4);

  return {
    denneMåneden: måneder.find((m) => m.mnd === nå) || nullMåned(nå),
    forrigeMåned: måneder.find((m) => m.mnd === forrige) || nullMåned(forrige),
    hittilIÅr: summer(måneder, år),
    måneder,
    år: [...new Set(måneder.map((m) => m.mnd.slice(0, 4)))]
      .sort()
      .reverse()
      .map((å) => summer(måneder, å)),
  };
}

// ── lagerrapport ─────────────────────────────────────────────────────────────
// Radene sendes flate, én per sett, raritet og finish. Klienten summerer dem
// selv — ellers ville settlinjene og totalen sluttet å stemme i det du hukte
// av foil eller vanlig.

export type LagerRad = {
  rarity: string;
  finish: string;
  antall: number;
  verdi_ore: number;
  // Kort på lager uten salgspris. De har antall, men ingen verdi, og må
  // telles for seg — ellers ser lageret mindre verdt ut enn det er.
  uten_pris: number;
};

export type LagerSett = {
  set_code: string;
  set_name: string;
  released_at: string | null;
  rader: LagerRad[];
  grunnsett: Grunnsett | null;
};

// Ett eksemplar av hvert kort i standardsettet — det du ville fått om du
// kjøpte settet komplett. Hvilke kort som hører til grunnsettet kan ikke
// utledes trygt: Scryfalls variantmerking er ikke konsekvent nok, og
// bonusark og Commander-sett ligger blandet inn. Derfor oppgir du selv det
// høyeste samlernummeret per sett, og alt over regnes som varianter.
export type Grunnsett = {
  til: number;
  // Antall kort funnet i intervallet. Spriker det mot «til», har settet hull
  // eller samlernumre som ikke er rene tall — da er summen for lav.
  antall: number;
  // Scryfalls markedspris, omregnet med samme kurs som resten av systemet.
  marked_ore: number;
  // Din egen utsalgspris i Near Mint. Det er dette tallet som sier hva du
  // kan forvente å selge settet for.
  salg_ore: number;
  uten_pris: number;
};

const RARITET_REKKEFØLGE = ["mythic", "rare", "uncommon", "common", "special", "bonus", "ukjent"];

export async function lagerrapport(): Promise<{
  sett: LagerSett[];
  butikk: { kort: number; verdi_ore: number };
  ukoblet: { produkter: number; kort: number };
  serienummererte: { kort: number; eksemplarer: number; navn: string[] };
}> {
  const opp = await hentSalgsOppsett();

  // Beholdningen leses fra Mystore-speilet, ikke fra lager_bevegelser.
  // Bevegelsene ble fylt én gang som åpningsbeholdning og har stått stille
  // siden, så rapporten viste et øyeblikksbilde fra den dagen. Speilet
  // oppdateres av nattsynken og er i takt med butikken.
  //
  // Mystore fører ikke tilstand på produktnivå, så alt prises som Near Mint.
  // Det stemmer for praktisk talt hele lageret.
  const r = await db().execute(`
    SELECT m.card_id, m.finish, m.qty AS n,
           c.rarity, c.set_code, c.usd, c.usd_foil,
           COALESCE(s.visningsnavn, s.name) AS set_name, s.released_at
      FROM mystore_stock m
      JOIN cards c ON c.id = m.card_id
      LEFT JOIN sets s ON s.code = c.set_code
     WHERE m.qty > 0
  `);

  // Begge overstyringstabellene er små nok til å hentes i sin helhet. Ett
  // oppslag per kort mot en database i Frankfurt ville tatt minutter.
  const manuellSalg = new Map<string, number>();
  const ms = await db().execute("SELECT card_id, finish, nm_ore FROM card_sale_prices");
  for (const x of ms.rows as any[]) manuellSalg.set(`${x.card_id}:${x.finish}`, Number(x.nm_ore));

  const manuellUsd = new Map<string, number>();
  const mp = await db().execute("SELECT card_id, finish, usd FROM card_prices");
  for (const x of mp.rows as any[]) manuellUsd.set(`${x.card_id}:${x.finish}`, Number(x.usd));

  const sett = new Map<string, LagerSett>();

  for (const x of r.rows as any[]) {
    const kode = String(x.set_code);
    let s = sett.get(kode);
    if (!s) {
      s = {
        set_code: kode,
        set_name: String(x.set_name || kode),
        released_at: x.released_at ? String(x.released_at) : null,
        rader: [],
        grunnsett: null,
      };
      sett.set(kode, s);
    }

    const finish = String(x.finish);
    const rarity = String(x.rarity || "ukjent");
    let rad = s.rader.find((d) => d.rarity === rarity && d.finish === finish);
    if (!rad) {
      rad = { rarity, finish, antall: 0, verdi_ore: 0, uten_pris: 0 };
      s.rader.push(rad);
    }

    const antall = Number(x.n);
    const nøkkel = `${x.card_id}:${finish}`;
    const stk = salgsprisØre(
      x,
      finish,
      "NM" as any,
      opp,
      manuellSalg.get(nøkkel) ?? null,
      manuellUsd.get(nøkkel) ?? null
    );

    rad.antall += antall;
    if (stk > 0) rad.verdi_ore += stk * antall;
    else rad.uten_pris += antall;
  }

  for (const s of sett.values()) {
    s.rader.sort((a, b) => {
      const i = RARITET_REKKEFØLGE.indexOf(a.rarity) - RARITET_REKKEFØLGE.indexOf(b.rarity);
      return i !== 0 ? i : a.finish.localeCompare(b.finish);
    });
  }

  await leggTilGrunnsett(sett, opp);

  // Hva lageret er priset til hos deg, ikke hva modellen mener det er
  // verdt. De to er ulike tall, og uten begge er det lett å tro at man ser
  // det ene når man ser det andre — prisjusteringer i butikken flytter ikke
  // modellens sum i det hele tatt.
  //
  // Bare koblede produkter med pris er med. Tilbehør, esker og de ukoblede
  // ligger utenfor, så dette er verdien av kortlageret, ikke av butikken.
  const b = await db().execute(
    `SELECT SUM(qty) AS kort, SUM(pris_ore * qty) AS ore
       FROM mystore_stock WHERE qty > 0 AND pris_ore IS NOT NULL`
  );
  const br = (b.rows[0] || {}) as any;

  // Produkter som har kort på lager, men ingen kobling. Normalt null — og
  // det er nettopp derfor tallet er verdt å vise: enhver verdi over null
  // betyr at noe nytt har kommet inn uten å finne kortet sitt. Uten
  // varselet oppdages de tilfeldig i kupplista, uker senere.
  const uk = await db().execute(
    "SELECT COUNT(*) AS produkter, SUM(stock) AS kort FROM mystore_unmatched WHERE stock > 0"
  );
  const ukr = (uk.rows[0] || {}) as any;

  // Beholdning ført på en serienummerert utgave. Den skal nesten aldri
  // finnes: serieutgaver er holdt utenfor kjøpslista, prisingen og
  // kupplista, så et kort som havner her er usynlig i alt annet enn
  // butikken — der det til gjengjeld står til en pris som gjelder et
  // eksemplar du sannsynligvis ikke har.
  //
  // Kobleren gjetter ikke lenger på dem, men det som allerede er ført, står
  // der til noen ser det. Derfor står tallet her i stedet for å bli
  // oppdaget den dagen noen kjøper kortet.
  const se = await db().execute(
    `SELECT COUNT(*) AS kort, COALESCE(SUM(m.qty), 0) AS eksemplarer
       FROM mystore_stock m JOIN cards c ON c.id = m.card_id
      WHERE m.qty > 0 AND c.er_serialized = 1`
  );
  const ser = (se.rows[0] || {}) as any;

  // Navnene, så varselet kan si hvilke kort det gjelder i stedet for bare
  // hvor mange. Fem er nok til å kjenne dem igjen.
  const senavn = Number(ser.kort || 0)
    ? await db().execute(
        `SELECT DISTINCT c.name FROM mystore_stock m JOIN cards c ON c.id = m.card_id
          WHERE m.qty > 0 AND c.er_serialized = 1 ORDER BY c.name LIMIT 5`
      )
    : { rows: [] as any[] };

  return {
    sett: [...sett.values()].sort((a, b2) =>
      (b2.released_at || "").localeCompare(a.released_at || "") || a.set_name.localeCompare(b2.set_name)
    ),
    butikk: {
      kort: Number(br.kort || 0),
      verdi_ore: Number(br.ore || 0),
    },
    ukoblet: {
      produkter: Number(ukr.produkter || 0),
      kort: Number(ukr.kort || 0),
    },
    serienummererte: {
      kort: Number(ser.kort || 0),
      eksemplarer: Number(ser.eksemplarer || 0),
      navn: (senavn.rows as any[]).map((x) => String(x.name)),
    },
  };
}

// Sett du ikke har et eneste kort fra finnes ikke i bevegelsene, men det er
// nettopp dem du vurderer å kjøpe. De legges til her, med tomt lager.
async function leggTilGrunnsett(sett: Map<string, LagerSett>, opp: any) {
  // Ett sett om gangen, ikke én join over hele katalogen. Filteret på
  // samlernummer kan ikke bruke indeks — CAST må regnes per rad — så over
  // 100 000 kort ble spørringen aldri ferdig. Per sett treffer den
  // idx_cards_set, og nummerfiltreringen gjøres på de få hundre radene her.
  const r = await db().execute(`
    SELECT r.set_code, r.grunnsett_til AS til,
           COALESCE(s.visningsnavn, s.name) AS set_name, s.released_at
      FROM set_rules r LEFT JOIN sets s ON s.code = r.set_code
     WHERE r.grunnsett_til IS NOT NULL AND r.grunnsett_til > 0
  `);
  if (!r.rows.length) return;

  const manuellSalg = new Map<string, number>();
  const ms = await db().execute(
    "SELECT card_id, nm_ore FROM card_sale_prices WHERE finish = 'nonfoil'"
  );
  for (const x of ms.rows as any[]) manuellSalg.set(String(x.card_id), Number(x.nm_ore));

  // Din egen dollarpris på kort der Scryfall er upålitelig — typisk
  // reservelistekort. Uten denne teller Beta og Unlimited som «uten pris»
  // enda du har priset dem, og markedskolonnen blir tilsvarende for lav.
  const manuellUsd = new Map<string, number>();
  const mp = await db().execute(
    "SELECT card_id, usd FROM card_prices WHERE finish = 'nonfoil'"
  );
  for (const x of mp.rows as any[]) manuellUsd.set(String(x.card_id), Number(x.usd));

  for (const rad of r.rows as any[]) {
    const kode = String(rad.set_code);
    const til = Number(rad.til);

    const k = await db().execute({
      sql: `SELECT id, collector_number, rarity, usd, usd_foil
              FROM cards
             WHERE set_code = ? AND er_token = 0 AND er_serialized = 0`,
      args: [kode],
    });

    // Ett kort per nummer. Scryfall gir enkelte trykk et suffiks — «7†» er
    // Play Boost-utgaven av nummer 7, samme kort med egen pris. Uten dette
    // ville de telt som ekstra kort i grunnsettet. Korteste nummer vinner,
    // så «7» slår «7†» og «120» slår «120a».
    const valgt = new Map<number, any>();
    for (const x of k.rows as any[]) {
      const cn = String(x.collector_number || "");
      const n = parseInt(cn, 10);
      if (!Number.isFinite(n) || n < 1 || n > til) continue;
      const før = valgt.get(n);
      if (!før || cn.length < String(før.collector_number).length) valgt.set(n, x);
    }
    if (!valgt.size) continue;

    let s2 = sett.get(kode);
    if (!s2) {
      s2 = {
        set_code: kode,
        set_name: String(rad.set_name || kode),
        released_at: rad.released_at ? String(rad.released_at) : null,
        rader: [],
        grunnsett: null,
      };
      sett.set(kode, s2);
    }

    const g = { til, antall: 0, marked_ore: 0, salg_ore: 0, uten_pris: 0 };
    for (const x of valgt.values()) {
      g.antall++;
      // Manuell dollarpris slår Scryfall, som ellers i systemet.
      const egenUsd = manuellUsd.get(String(x.id)) ?? null;
      const usd = egenUsd ?? Number(x.usd || 0);
      g.marked_ore += Math.round(usd * opp.usd_nok * 100);
      const salg = salgsprisØre(
        x, "nonfoil", "NM" as any, opp, manuellSalg.get(String(x.id)) ?? null, egenUsd
      );
      if (salg > 0) g.salg_ore += salg;
      else g.uten_pris++;
    }
    s2.grunnsett = g;
  }
}

// ── lagerhistorikk ───────────────────────────────────────────────────────────
// Lagerrapporten viser hva du har nå. Den sier ingenting om retningen, og
// retningen er det som avgjør om beholdningen vokser raskere enn du selger.
// Derfor én måling per dag, skrevet av lagersynken.
//
// Daglig og ikke månedlig: du kan alltid regne opp fra dager til måneder,
// aldri motsatt vei. Grafen grupperer selv etter hvor lang periode du ser på.
//
// Tallene hentes fra lagerrapport() og ikke fra egne spørringer. Ble de
// regnet ut to steder, ville grafen og rapporten før eller siden vist to
// ulike summer, og da er ingen av dem til å stole på.
//
// Begge verdiene lagres: modellens og din egen. De spriker med rundt 15 %,
// og det er utviklingen i forskjellen mellom dem som sier om prismodellen
// henger med.

export type Lagermåling = {
  dato: string;
  antall: number;
  antall_foil: number;
  verdi_ore: number;
  verdi_foil_ore: number;
  butikk_kort: number;
  butikk_ore: number;
};

// Datoen må være norsk. Serveren står i UTC, og en synk som kjører 02:30
// norsk tid ville ellers blitt bokført på dagen før.
function osloDag(d = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Oslo" }).format(d);
}

export async function lagreLagermåling(dato = osloDag()): Promise<Lagermåling> {
  const rapport = await lagerrapport();

  const m: Lagermåling = {
    dato,
    antall: 0,
    antall_foil: 0,
    verdi_ore: 0,
    verdi_foil_ore: 0,
    butikk_kort: rapport.butikk?.kort ?? 0,
    butikk_ore: rapport.butikk?.verdi_ore ?? 0,
  };
  for (const s of rapport.sett) {
    for (const r of s.rader) {
      const foil = r.finish === "foil";
      m[foil ? "antall_foil" : "antall"] += r.antall;
      m[foil ? "verdi_foil_ore" : "verdi_ore"] += r.verdi_ore;
    }
  }

  // Kjører synken to ganger samme dag, skal den siste gjelde — ikke bli en
  // ekstra rad som gjør dagen til to punkter i kurven.
  await db().execute({
    sql: `INSERT INTO lager_historikk
            (dato, antall, antall_foil, verdi_ore, verdi_foil_ore, butikk_kort, butikk_ore, malt_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(dato) DO UPDATE SET
            antall = excluded.antall,
            antall_foil = excluded.antall_foil,
            verdi_ore = excluded.verdi_ore,
            verdi_foil_ore = excluded.verdi_foil_ore,
            butikk_kort = excluded.butikk_kort,
            butikk_ore = excluded.butikk_ore,
            malt_at = excluded.malt_at`,
    args: [
      m.dato, m.antall, m.antall_foil, m.verdi_ore, m.verdi_foil_ore,
      m.butikk_kort, m.butikk_ore, new Date().toISOString(),
    ],
  });
  return m;
}

// Hele serien. Én rad per dag er lite i mange år, og filtreringen på periode
// gjøres i visningen — da kan du bytte periode og mål uten et nytt kall.
export async function lagerhistorikk(): Promise<{ rader: Lagermåling[] }> {
  const r = await db().execute(
    `SELECT dato, antall, antall_foil, verdi_ore, verdi_foil_ore, butikk_kort, butikk_ore
       FROM lager_historikk ORDER BY dato`
  );
  return {
    rader: (r.rows as any[]).map((x) => ({
      dato: String(x.dato),
      antall: Number(x.antall),
      antall_foil: Number(x.antall_foil),
      verdi_ore: Number(x.verdi_ore),
      verdi_foil_ore: Number(x.verdi_foil_ore),
      butikk_kort: Number(x.butikk_kort || 0),
      butikk_ore: Number(x.butikk_ore || 0),
    })),
  };
}
