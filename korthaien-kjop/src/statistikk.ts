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

type Rad = { created_at: string; status: string; total_ore: number };

// Skilt ut som egen funksjon fordi den er verdt å teste for seg: det er her
// måneden bestemmes og de avlyste holdes utenfor omsetningen.
export function grupper(rader: Rad[]): Måned[] {
  const kart = new Map<string, Måned>();
  for (const r of rader) {
    const mnd = osloMåned(r.created_at);
    let m = kart.get(mnd);
    if (!m) {
      m = { mnd, antall: 0, sum_ore: 0, avlyst: 0, avlyst_ore: 0 };
      kart.set(mnd, m);
    }
    const ore = Number(r.total_ore || 0);
    if (TELLER_MED.includes(r.status)) {
      m.antall++;
      m.sum_ore += ore;
    } else if (AVLYST.includes(r.status)) {
      m.avlyst++;
      m.avlyst_ore += ore;
    }
  }
  return [...kart.values()].sort((a, b) => (a.mnd < b.mnd ? 1 : -1));
}

const nullMåned = (mnd: string): Måned => ({ mnd, antall: 0, sum_ore: 0, avlyst: 0, avlyst_ore: 0 });

export function summer(måneder: Måned[], prefiks: string): Måned {
  const ut = nullMåned(prefiks);
  for (const m of måneder) {
    if (!m.mnd.startsWith(prefiks)) continue;
    ut.antall += m.antall;
    ut.sum_ore += m.sum_ore;
    ut.avlyst += m.avlyst;
    ut.avlyst_ore += m.avlyst_ore;
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
    "SELECT created_at, status, total_ore FROM orders ORDER BY created_at DESC"
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

export async function lagerrapport(): Promise<{ sett: LagerSett[] }> {
  const opp = await hentSalgsOppsett();

  const r = await db().execute(`
    SELECT b.card_id, b.finish, b.condition, SUM(b.antall) AS n,
           c.rarity, c.set_code, c.usd, c.usd_foil,
           COALESCE(s.visningsnavn, s.name) AS set_name, s.released_at
      FROM lager_bevegelser b
      JOIN cards c ON c.id = b.card_id
      LEFT JOIN sets s ON s.code = c.set_code
     GROUP BY b.card_id, b.finish, b.condition
    HAVING n > 0
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
      String(x.condition) as any,
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

  return {
    sett: [...sett.values()].sort((a, b) =>
      (b.released_at || "").localeCompare(a.released_at || "") || a.set_name.localeCompare(b.set_name)
    ),
  };
}

// Sett du ikke har et eneste kort fra finnes ikke i bevegelsene, men det er
// nettopp dem du vurderer å kjøpe. De legges til her, med tomt lager.
async function leggTilGrunnsett(sett: Map<string, LagerSett>, opp: any) {
  const r = await db().execute(`
    SELECT c.id, c.set_code, c.rarity, c.usd, c.usd_foil,
           r.grunnsett_til AS til,
           COALESCE(s.visningsnavn, s.name) AS set_name, s.released_at
      FROM cards c
      JOIN set_rules r ON r.set_code = c.set_code
      LEFT JOIN sets s ON s.code = c.set_code
     WHERE r.grunnsett_til IS NOT NULL
       AND r.grunnsett_til > 0
       AND c.er_token = 0
       AND c.er_serialized = 0
       AND CAST(c.collector_number AS INTEGER) BETWEEN 1 AND r.grunnsett_til
       -- Ett kort per nummer. Scryfall gir enkelte trykk et suffiks — «7†»
       -- er Play Boost-utgaven av nummer 7, samme kort med egen pris. Uten
       -- denne ville de telt som ekstra kort i grunnsettet.
       AND c.collector_number = (
             SELECT k.collector_number FROM cards k
              WHERE k.set_code = c.set_code
                AND k.er_token = 0 AND k.er_serialized = 0
                AND CAST(k.collector_number AS INTEGER) = CAST(c.collector_number AS INTEGER)
              ORDER BY length(k.collector_number), k.collector_number
              LIMIT 1)
  `);

  // Manuell salgspris slår intervallene, på samme måte som i resten av
  // rapporten. Uten dette ville et kort du har priset selv telle med feil sum.
  const manuellSalg = new Map<string, number>();
  const ms = await db().execute(
    "SELECT card_id, nm_ore FROM card_sale_prices WHERE finish = 'nonfoil'"
  );
  for (const x of ms.rows as any[]) manuellSalg.set(String(x.card_id), Number(x.nm_ore));

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
    if (!s.grunnsett) {
      s.grunnsett = {
        til: Number(x.til),
        antall: 0,
        marked_ore: 0,
        salg_ore: 0,
        uten_pris: 0,
      };
    }

    const g = s.grunnsett;
    g.antall++;

    const usd = Number(x.usd || 0);
    g.marked_ore += Math.round(usd * opp.usd_nok * 100);

    const salg = salgsprisØre(x, "nonfoil", "NM" as any, opp, manuellSalg.get(String(x.id)) ?? null, null);
    if (salg > 0) g.salg_ore += salg;
    else g.uten_pris++;
  }
}
