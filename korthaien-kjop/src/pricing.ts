import { db, hentSettings, type Condition, type Ladder, type Settings } from "./db.js";

// ─────────────────────────────────────────────────────────────────────────────
// PRIS
// ─────────────────────────────────────────────────────────────────────────────
// Kunden får en andel av Scryfall-prisen omregnet til NOK, justert for
// condition. Trappen settes per sett; settene som ikke har egen trapp følger
// standarden. Alt regnes på server — klienten får aldri bestemme en pris.

export type SetRule = {
  set_code: string;
  enabled: boolean;
  wanted_default: number;
  conditions: Condition[];
  ladder: Ladder;
};

export function beregnPris(
  usd: number,
  condition: Condition,
  regel: Pick<SetRule, "ladder">,
  s: Pick<Settings, "usd_nok" | "buy_pct" | "min_buy_nok">
): number {
  if (!usd || usd <= 0) return 0;
  const condPct = regel.ladder[condition];
  // En condition uten sats i trappen kjøpes ikke. Å falle tilbake på 100 %
  // her ville betydd at et Good-kort ble betalt som Near Mint.
  if (condPct === undefined || condPct === null) return 0;
  const nok = usd * s.usd_nok * (s.buy_pct / 100) * (condPct / 100);
  const rundet = Math.round(nok);
  if (rundet < s.min_buy_nok) return 0;
  return rundet;
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
      conditions: settings.default_conditions,
      ladder: settings.default_ladder,
    };
  }
  return {
    set_code: setCode,
    enabled: !!Number(rad.enabled),
    wanted_default: Number(rad.wanted_default || 0),
    conditions: trygtJson(rad.conditions, settings.default_conditions),
    ladder: trygtJson(rad.ladder, settings.default_ladder),
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
      conditions: trygtJson(rad.conditions, settings.default_conditions),
      ladder: trygtJson(rad.ladder, settings.default_ladder),
    });
  }
  return kart;
}

export function standardRegel(setCode: string, s: Settings): SetRule {
  return {
    set_code: setCode,
    enabled: false,
    wanted_default: 0,
    conditions: s.default_conditions,
    ladder: s.default_ladder,
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
