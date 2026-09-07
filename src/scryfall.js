// ─────────────────────────────────────────────────────────────────────────────
// SCRYFALL — oppslag med utgavepresisjon
// ─────────────────────────────────────────────────────────────────────────────
// Tidligere slo App.jsx opp kort med fuzzy navnesøk fordi set_code alltid var
// tom. Fuzzy navnesøk returnerer en vilkårlig utgave, som ga feil markedspris
// for alt som er trykket flere ganger. Denne modulen utleder settkode fra
// SKU eller kategorinavn, validerer den mot Scryfalls faktiske settliste, og
// merker hvert treff med hvor sikkert det er.

const SETS_KEY = "kardex_sets_v1";
const CARD_CACHE_KEY = "kardex_sf_cache_v1";
const SETS_TTL = 7 * 24 * 60 * 60 * 1000; // 7 dager
const CARD_TTL = 24 * 60 * 60 * 1000; // 1 døgn
const MIN_DELAY = 110; // Scryfall ber om 50–100 ms mellom kall

// ── treffkvalitet ────────────────────────────────────────────────────────────
export const MATCH = {
  EXACT: "exact", // settkode + samlernummer — kan ikke bomme
  SET_NAME: "set_name", // settkode + kortnavn — riktig utgave, nummer ukjent
  FUZZY: "fuzzy", // kun navn — utgave er et gjett
  NONE: "none",
};

export const MATCH_LABEL = {
  [MATCH.EXACT]: "Eksakt",
  [MATCH.SET_NAME]: "Sett + navn",
  [MATCH.FUZZY]: "Usikker utgave",
  [MATCH.NONE]: "Ikke funnet",
};

// ── throttle + retry ─────────────────────────────────────────────────────────
let lastCall = 0;
async function politeFetch(url, tries = 3) {
  const wait = MIN_DELAY - (Date.now() - lastCall);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();
  try {
    const r = await fetch(url);
    if (r.status === 429 && tries > 0) {
      const retry = parseInt(r.headers.get("retry-after") || "2", 10);
      await new Promise((res) => setTimeout(res, retry * 1000));
      return politeFetch(url, tries - 1);
    }
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

// ── settliste ────────────────────────────────────────────────────────────────
function normalize(s) {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function buildIndex(sets) {
  const byCode = new Map();
  const byName = new Map();
  for (const s of sets) {
    byCode.set(s.code.toLowerCase(), s);
    const n = normalize(s.name);
    // Førstemann vinner: settlista kommer nyest først, men eldre sett med
    // samme navn (f.eks. reprint-serier) skal ikke overskrive originalen.
    if (!byName.has(n)) byName.set(n, s);
  }
  return { byCode, byName, size: sets.length };
}

let indexPromise = null;

export function loadSetIndex() {
  if (indexPromise) return indexPromise;
  indexPromise = (async () => {
    try {
      const raw = localStorage.getItem(SETS_KEY);
      if (raw) {
        const cached = JSON.parse(raw);
        if (Date.now() - cached.ts < SETS_TTL && Array.isArray(cached.sets)) {
          return buildIndex(cached.sets);
        }
      }
    } catch {}
    const data = await politeFetch("https://api.scryfall.com/sets");
    const sets = (data?.data || [])
      .filter((s) => s.code && s.name)
      .map((s) => ({ code: s.code, name: s.name, digital: !!s.digital }));
    if (!sets.length) return buildIndex([]);
    try {
      localStorage.setItem(SETS_KEY, JSON.stringify({ ts: Date.now(), sets }));
    } catch {}
    return buildIndex(sets);
  })();
  return indexPromise;
}

// ── kortcache ────────────────────────────────────────────────────────────────
function readCache() {
  try {
    const raw = localStorage.getItem(CARD_CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

let cache = null;
let cacheDirty = false;

function cacheGet(key) {
  if (cache === null) cache = readCache();
  const hit = cache[key];
  if (!hit) return null;
  if (Date.now() - hit.ts > CARD_TTL) return null;
  return hit.v;
}

function cacheSet(key, value) {
  if (cache === null) cache = readCache();
  cache[key] = { ts: Date.now(), v: value };
  cacheDirty = true;
}

export function flushCache() {
  if (!cacheDirty || cache === null) return;
  try {
    localStorage.setItem(CARD_CACHE_KEY, JSON.stringify(cache));
    cacheDirty = false;
  } catch {
    // Cachen er en optimalisering, ikke kritisk. Full localStorage → tøm og gå videre.
    try {
      localStorage.removeItem(CARD_CACHE_KEY);
      cache = {};
    } catch {}
  }
}

export function clearCache() {
  cache = {};
  cacheDirty = false;
  try {
    localStorage.removeItem(CARD_CACHE_KEY);
    localStorage.removeItem(SETS_KEY);
  } catch {}
  indexPromise = null;
}

// ── utledning av settkode ────────────────────────────────────────────────────
// Rekkefølge: eksplisitt felt → SKU → kategorinavn.
// Alt valideres mot Scryfalls faktiske settkoder, så en tilfeldig SKU-prefiks
// som ikke er et ekte sett blir forkastet i stedet for å gi feil oppslag.

const RARITY_SUFFIX = /\s*[-–—/|]\s*(mythic|rare|uncommon|common|sjelden|vanlig|mytisk)\s*$/i;

export function setFromSku(sku, index) {
  if (!sku || !index) return null;
  const tokens = String(sku).split(/[^A-Za-z0-9]+/).filter(Boolean);

  // Tilfelle 1: separerte tokens, f.eks. "MH2-138" eller "MTG-MH2-138"
  if (tokens.length > 1) {
    let code = null;
    let number = null;
    for (const t of tokens) {
      if (!code && /[A-Za-z]/.test(t) && index.byCode.has(t.toLowerCase())) {
        code = t.toLowerCase();
        continue;
      }
      if (/^\d{1,4}[a-z]?$/i.test(t)) number = t.toLowerCase();
    }
    if (code) return { set_code: code, collector_number: number || "" };
  }

  // Tilfelle 2: sammenskrevet, f.eks. "MH2138". Delingspunktet er ikke gitt —
  // "MH2138" kan leses som MH|2138 eller MH2|138. Vi prøver alle, lengste
  // gyldige settkode først, og krever at resten er et brukbart samlernummer.
  if (tokens.length === 1) {
    const t = tokens[0];
    for (let len = Math.min(6, t.length - 1); len >= 2; len--) {
      const code = t.slice(0, len).toLowerCase();
      const rest = t.slice(len).toLowerCase();
      if (!/[a-z]/.test(code)) continue;
      if (!index.byCode.has(code)) continue;
      if (!/^\d{1,4}[a-z]?$/.test(rest)) continue;
      return { set_code: code, collector_number: rest };
    }
  }

  // Tilfelle 3: kun settkode, ingen nummer
  if (tokens.length === 1 && index.byCode.has(tokens[0].toLowerCase())) {
    return { set_code: tokens[0].toLowerCase(), collector_number: "" };
  }

  return null;
}

export function setFromCategory(categoryName, index) {
  if (!categoryName || !index) return null;
  const stripped = String(categoryName).replace(RARITY_SUFFIX, "");
  for (const candidate of [stripped, categoryName]) {
    const hit = index.byName.get(normalize(candidate));
    if (hit) return { set_code: hit.code.toLowerCase(), collector_number: "" };
  }
  return null;
}

export function resolveSet(card, index) {
  if (card.set_code) {
    return {
      set_code: String(card.set_code).toLowerCase(),
      collector_number: String(card.collector_number || ""),
      set_source: "felt",
    };
  }
  const fromSku = setFromSku(card.sku, index);
  if (fromSku) {
    return {
      ...fromSku,
      collector_number: String(card.collector_number || fromSku.collector_number || ""),
      set_source: "sku",
    };
  }
  const fromCat = setFromCategory(card.category_name, index);
  if (fromCat) {
    return {
      ...fromCat,
      collector_number: String(card.collector_number || ""),
      set_source: "kategori",
    };
  }
  return {
    set_code: "",
    collector_number: String(card.collector_number || ""),
    set_source: null,
  };
}

// ── oppslag ──────────────────────────────────────────────────────────────────
export async function lookupCard(card, index) {
  const { set_code, collector_number, set_source } = resolveSet(card, index);

  // 1. Settkode + samlernummer — entydig
  if (set_code && collector_number) {
    const key = `c:${set_code}/${collector_number}`;
    const cached = cacheGet(key);
    const sf = cached !== null ? cached : await politeFetch(
      `https://api.scryfall.com/cards/${encodeURIComponent(set_code)}/${encodeURIComponent(collector_number)}`
    );
    if (cached === null) cacheSet(key, sf);
    if (sf?.id) {
      // Navnesjekk: fanger SKU-er der nummeret ikke stemmer med butikkdataene.
      const same = normalize(sf.name).startsWith(normalize(card.name).slice(0, 12));
      if (!card.name || same) return { sf, match: MATCH.EXACT, set_source };
    }
  }

  // 2. Settkode + navn — riktig utgave selv om nummeret mangler eller er feil
  if (set_code && card.name) {
    const q = `!"${card.name.replace(/"/g, "")}" set:${set_code}`;
    const key = `s:${set_code}:${normalize(card.name)}`;
    const cached = cacheGet(key);
    const data = cached !== null ? cached : await politeFetch(
      `https://api.scryfall.com/cards/search?q=${encodeURIComponent(q)}&unique=prints&order=released`
    );
    if (cached === null) cacheSet(key, data);
    const hit = data?.data?.[0];
    if (hit?.id) return { sf: hit, match: MATCH.SET_NAME, set_source };
  }

  // 3. Kun navn — utgaven er et gjett, og merkes som det
  if (card.name) {
    const key = `f:${normalize(card.name)}`;
    const cached = cacheGet(key);
    const sf = cached !== null ? cached : await politeFetch(
      `https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(card.name)}`
    );
    if (cached === null) cacheSet(key, sf);
    if (sf?.id) return { sf, match: MATCH.FUZZY, set_source };
  }

  return { sf: null, match: MATCH.NONE, set_source };
}

// ── prisuttrekk ──────────────────────────────────────────────────────────────
export function priceFrom(sf) {
  if (!sf) return { usd: 0, foil: false };
  const usd = parseFloat(sf.prices?.usd || 0);
  if (usd > 0) return { usd, foil: false };
  const foil = parseFloat(sf.prices?.usd_foil || 0);
  if (foil > 0) return { usd: foil, foil: true };
  return { usd: 0, foil: false };
}

export function imageFrom(sf) {
  return sf?.image_uris?.normal || sf?.card_faces?.[0]?.image_uris?.normal || null;
}
