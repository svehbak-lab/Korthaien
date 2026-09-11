import { db, hentSettings, type Condition, type Ladder, type Settings } from "./db.js";

// ─────────────────────────────────────────────────────────────────────────────
// PRIS
// ─────────────────────────────────────────────────────────────────────────────
// Kunden får en andel av Scryfall-prisen omregnet til NOK, justert for
// condition. Trappen settes per sett; settene som ikke har egen trapp følger
// standarden. Alt regnes på server — klienten får aldri bestemme en pris.
//
// Enheten er øre hele veien inn til visningen. Se beregnØre.

export type SetRule = {
  set_code: string;
  enabled: boolean;
  wanted_default: number;
  // Foil er en egen vare med egen pris, og settes derfor for seg. 0 betyr
  // at foil ikke kjøpes fra settet.
  wanted_foil: number;
  conditions: Condition[];
  ladder: Ladder;
  // Andel av markedsprisen for Near Mint fra dette settet. null = følg den
  // globale satsen i Innstillinger.
  buy_pct: number | null;
};

export function beregnØre(
  usd: number,
  condition: Condition,
  regel: { ladder: Ladder; buy_pct?: number | null },
  s: Pick<Settings, "usd_nok" | "buy_pct" | "min_buy_ore">
): number {
  if (!usd || usd <= 0) return 0;
  const condPct = regel.ladder[condition];
  // En condition uten sats i trappen kjøpes ikke. Å falle tilbake på 100 %
  // her ville betydd at et Good-kort ble betalt som Near Mint.
  if (condPct === undefined || condPct === null) return 0;
  // Alt regnes i øre. Kroner som desimaltall ville gitt avrundingsdrift over
  // en ordre på mange linjer, og et kort til ti øre ville blitt null.
  // Settets egen sats slår den globale. Trappen er relativ til den, så et
  // sett på 80 % med NM 100 i trappen betaler 80 % av markedsprisen for NM.
  const andel = regel.buy_pct === null || regel.buy_pct === undefined ? s.buy_pct : regel.buy_pct;
  const øre = usd * s.usd_nok * (andel / 100) * (condPct / 100) * 100;
  const rundet = Math.round(øre);
  if (rundet < s.min_buy_ore) return 0;
  return rundet;
}

// Manuell dollarpris slår Scryfall for akkurat dette kortet. Alt annet er
// uendret: kurs, buy_pct og trappen for settet gjelder som før, så NM, EX, VG
// og G følger av det ene tallet du skriver inn.
export function prisØre(
  kort: { usd?: number | null; usd_foil?: number | null; rarity?: string | null; er_token?: number | boolean | null },
  finish: string,
  condition: Condition,
  regel: { ladder: Ladder; buy_pct?: number | null; conditions?: Condition[] },
  s: Pick<Settings, "usd_nok" | "buy_pct" | "min_buy_ore"> & { min_usd?: Record<string, number> },
  manuellUsd?: number | null,
  egneConditions?: Condition[] | null
): number {
  // Hvilke tilstander som godtas avgjøres her, ikke bare i grensesnittet.
  // Ellers kunne en ordre sendt rett mot API-et be om en tilstand du ikke
  // tar imot, og få pris på den fordi trappen tilfeldigvis har en sats.
  // Tokens selges, men kjøpes aldri inn. Sjekken ligger her og ikke i søket,
  // så den også gjelder en ordre sendt rett mot API-et.
  if (kort.er_token) return 0;

  const godtatt = egneConditions?.length ? egneConditions : regel.conditions;
  if (godtatt && !godtatt.includes(condition)) return 0;
  const usd = manuellUsd && manuellUsd > 0 ? manuellUsd : prisenFor(kort, finish);
  // Terskelen gjelder markedsprisen, ikke utbetalingen. Ligger kortet under,
  // kjøpes det ikke — da slipper du å håndtere bulk du ikke tjener på. Sjekken
  // ligger her og ikke i søket, slik at den også gjelder for en ordre sendt
  // rett mot API-et.
  const terskel = s.min_usd?.[String(kort.rarity || "").toLowerCase()] ?? 0;
  if (terskel > 0 && usd < terskel) return 0;
  return beregnØre(usd, condition, regel, s);
}

// ── manuelle priser ──────────────────────────────────────────────────────────
export async function hentManuellePriser(cardIds: string[]): Promise<Map<string, number>> {
  const kart = new Map<string, number>();
  const ider = [...new Set(cardIds)].filter(Boolean);
  if (!ider.length) return kart;
  for (let i = 0; i < ider.length; i += 400) {
    const del = ider.slice(i, i + 400);
    const r = await db().execute({
      sql: `SELECT card_id, finish, usd FROM card_prices
             WHERE card_id IN (${del.map(() => "?").join(",")})`,
      args: del,
    });
    for (const x of r.rows as any[]) kart.set(`${x.card_id}:${x.finish}`, Number(x.usd));
  }
  return kart;
}

export async function hentEgneConditions(cardIds: string[]): Promise<Map<string, Condition[]>> {
  const kart = new Map<string, Condition[]>();
  const ider = [...new Set(cardIds)].filter(Boolean);
  if (!ider.length) return kart;
  for (let i = 0; i < ider.length; i += 400) {
    const del = ider.slice(i, i + 400);
    const r = await db().execute({
      sql: `SELECT card_id, conditions FROM card_conditions
             WHERE card_id IN (${del.map(() => "?").join(",")})`,
      args: del,
    });
    for (const x of r.rows as any[]) {
      const c = trygtJson<Condition[]>(x.conditions, []);
      if (c.length) kart.set(String(x.card_id), c);
    }
  }
  return kart;
}

export async function hentEgneConditionsFor(cardId: string): Promise<Condition[] | null> {
  const r = await db().execute({
    sql: "SELECT conditions FROM card_conditions WHERE card_id = ?",
    args: [cardId],
  });
  if (!r.rows[0]) return null;
  const c = trygtJson<Condition[]>(r.rows[0].conditions, []);
  return c.length ? c : null;
}

export async function hentManuellPris(cardId: string, finish: string): Promise<number | null> {
  const r = await db().execute({
    sql: "SELECT usd FROM card_prices WHERE card_id = ? AND finish = ?",
    args: [cardId, finish],
  });
  return r.rows[0] ? Number(r.rows[0].usd) : null;
}

export function prisenFor(kort: { usd?: number | null; usd_foil?: number | null }, finish: string): number {
  const v = finish === "foil" ? kort.usd_foil : kort.usd;
  return typeof v === "number" && v > 0 ? v : 0;
}

// ── settregler ───────────────────────────────────────────────────────────────
export async function hentSetRule(setCode: string, s?: Settings): Promise<SetRule> {
  const settings = s || (await hentSettings());
  const r = await db().execute({
    sql: "SELECT * FROM set_rules WHERE set_code = ?",
    args: [setCode],
  });
  const rad = r.rows[0];
  if (!rad) {
    return {
      set_code: setCode,
      enabled: false,
      wanted_default: 0,
      wanted_foil: 0,
      conditions: settings.default_conditions,
      ladder: settings.default_ladder,
      buy_pct: null,
    };
  }
  return {
    set_code: setCode,
    enabled: !!Number(rad.enabled),
    wanted_default: Number(rad.wanted_default || 0),
    wanted_foil: Number(rad.wanted_foil || 0),
    conditions: trygtJson(rad.conditions, settings.default_conditions),
    ladder: trygtJson(rad.ladder, settings.default_ladder),
    buy_pct: rad.buy_pct === null || rad.buy_pct === undefined ? null : Number(rad.buy_pct),
  };
}

export async function hentAlleSetRules(s?: Settings): Promise<Map<string, SetRule>> {
  const settings = s || (await hentSettings());
  const r = await db().execute("SELECT * FROM set_rules");
  const kart = new Map<string, SetRule>();
  for (const rad of r.rows) {
    kart.set(String(rad.set_code), {
      set_code: String(rad.set_code),
      enabled: !!Number(rad.enabled),
      wanted_default: Number(rad.wanted_default || 0),
      wanted_foil: Number(rad.wanted_foil || 0),
      conditions: trygtJson(rad.conditions, settings.default_conditions),
      ladder: trygtJson(rad.ladder, settings.default_ladder),
      buy_pct: rad.buy_pct === null || rad.buy_pct === undefined ? null : Number(rad.buy_pct),
    });
  }
  return kart;
}

export function standardRegel(setCode: string, s: Settings): SetRule {
  return {
    set_code: setCode,
    enabled: false,
    wanted_default: 0,
    wanted_foil: 0,
    conditions: s.default_conditions,
    ladder: s.default_ladder,
    buy_pct: null,
  };
}

function trygtJson<T>(v: unknown, fallback: T): T {
  if (v === null || v === undefined) return fallback;
  try {
    const p = JSON.parse(String(v));
    return p ?? fallback;
  } catch {
    return fallback;
  }
}
