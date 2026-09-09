const BASE = import.meta.env.VITE_API_URL || "";

async function kall(sti, opts = {}) {
  const r = await fetch(BASE + sti, {
    headers: opts.body ? { "Content-Type": "application/json" } : undefined,
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const tekst = await r.text();
  const data = tekst ? JSON.parse(tekst) : null;
  if (!r.ok) {
    const feil = new Error(data?.feil || `Noe gikk galt (${r.status})`);
    feil.data = data;
    throw feil;
  }
  return data;
}

export const api = {
  config: () => kall("/api/config"),
  sett: () => kall("/api/sets"),
  søk: (p) => kall("/api/search?" + new URLSearchParams(p)),
  bulk: (tekst) => kall("/api/bulk", { method: "POST", body: { tekst } }),
  tilbud: (linjer) => kall("/api/quote", { method: "POST", body: { linjer } }),
  sendOrdre: (ordre) => kall("/api/orders", { method: "POST", body: ordre }),
  ordre: (nr, epost) =>
    kall("/api/orders/" + encodeURIComponent(nr) + "?" + new URLSearchParams({ epost })),
};

// Alt kommer fra serveren i øre. Ørene vises bare når de finnes — «122 kr»
// leser bedre enn «122,00 kr», men et kort til sju øre må ikke se ut som null.
export function kroner(øre) {
  const n = Math.round(Number(øre) || 0);
  const hele = Math.trunc(n / 100);
  const rest = Math.abs(n % 100);
  const tall = new Intl.NumberFormat("nb-NO").format(hele);
  if (!rest) return tall + " kr";
  return (n < 0 && hele === 0 ? "-" : "") + tall + "," + String(rest).padStart(2, "0") + " kr";
}

// Oppgjøret er butikkreditt, aldri kontanter. Det skal stå på hver eneste
// pris, ikke bare i vilkårene — ingen skal rekke å tro noe annet.
export function kreditt(øre) {
  return "Store credit: " + kroner(øre);
}

export const COND_NAVN = { NM: "Near Mint", EX: "Excellent", VG: "Very Good", G: "Good" };

// ── kurv ─────────────────────────────────────────────────────────────────────
// Nøkkelen er kort + finish + condition, men kvoten deles på tvers av
// conditions: har jeg plass til 6 Lightning Bolt, gjelder det uansett om
// kunden legger inn 3 NM og 3 EX.
export const nøkkel = (t, cond) => `${t.card_id}:${t.finish}:${cond}`;
const kvoteNøkkel = (t) => `${t.card_id}:${t.finish}`;

export function brukt(kurv, tilbud) {
  const k = kvoteNøkkel(tilbud);
  return Object.values(kurv)
    .filter((l) => kvoteNøkkel(l.tilbud) === k)
    .reduce((n, l) => n + l.qty, 0);
}

export function ledig(kurv, tilbud) {
  return Math.max(0, tilbud.available - brukt(kurv, tilbud));
}

export function prisFor(tilbud, cond) {
  return tilbud.conditions.find((c) => c.condition === cond)?.ore ?? 0;
}

export function leggTil(kurv, tilbud, cond, antall = 1) {
  const plass = ledig(kurv, tilbud);
  if (plass <= 0) return kurv;
  const n = Math.min(antall, plass);
  const k = nøkkel(tilbud, cond);
  const fins = kurv[k];
  return {
    ...kurv,
    [k]: fins ? { ...fins, qty: fins.qty + n } : { tilbud, condition: cond, qty: n },
  };
}

export function settAntall(kurv, k, antall) {
  const linje = kurv[k];
  if (!linje) return kurv;
  if (antall <= 0) {
    const { [k]: _, ...resten } = kurv;
    return resten;
  }
  // Andre linjer med samme kort spiser av samme kvote.
  const andre = brukt(kurv, linje.tilbud) - linje.qty;
  const tak = Math.max(0, linje.tilbud.available - andre);
  return { ...kurv, [k]: { ...linje, qty: Math.min(antall, tak) } };
}

// Bytte av tilstand er et bytte av nøkkel. Finnes linjen fra før, slås de
// sammen — ellers ville kurven fått to linjer med samme kort og tilstand.
export function settCondition(kurv, k, cond) {
  const linje = kurv[k];
  if (!linje || linje.condition === cond) return kurv;
  const { [k]: _, ...uten } = kurv;
  return leggTil(uten, linje.tilbud, cond, linje.qty);
}

export function total(kurv) {
  return Object.values(kurv).reduce((n, l) => n + prisFor(l.tilbud, l.condition) * l.qty, 0);
}

export function antallKort(kurv) {
  return Object.values(kurv).reduce((n, l) => n + l.qty, 0);
}

// Samme sortering som ordrebekreftelsen: sett, så kortnavn. Kunden ser lista i
// den rekkefølgen hen skal legge bunken, hele veien fra kurv til kvittering.
export function sortert(kurv) {
  return Object.entries(kurv)
    .map(([k, l]) => ({ k, ...l }))
    .sort(
      (a, b) =>
        a.tilbud.set_name.localeCompare(b.tilbud.set_name, "nb") ||
        a.tilbud.name.localeCompare(b.tilbud.name, "nb") ||
        a.condition.localeCompare(b.condition)
    );
}

export function tilLinjer(kurv) {
  return Object.values(kurv).map((l) => ({
    card_id: l.tilbud.card_id,
    finish: l.tilbud.finish,
    condition: l.condition,
    qty: l.qty,
  }));
}

// ── lagring ──────────────────────────────────────────────────────────────────
// Kurven overlever at fanen lukkes, men ikke lenge. Priser og kvoter beveger
// seg, og en kurv fra i går er mest av alt en kilde til skuffelse i kassen.
// Seks timer holder for én økt uten å love noe vi ikke kan holde.
const LAGER = "korthaien-kjop-kurv";
export const LEVETID_TIMER = 6;

export function lagre(kurv) {
  try {
    const linjer = tilLinjer(kurv);
    if (!linjer.length) return localStorage.removeItem(LAGER);
    localStorage.setItem(LAGER, JSON.stringify({ tid: Date.now(), linjer }));
  } catch {
    // Privat modus og full disk gir unntak her. Kurven virker fortsatt i
    // denne fanen — den overlever bare ikke en refresh.
  }
}

export function tøm() {
  try {
    localStorage.removeItem(LAGER);
  } catch {}
}

function lest() {
  try {
    const rå = localStorage.getItem(LAGER);
    if (!rå) return null;
    const d = JSON.parse(rå);
    if (!d?.linjer?.length) return null;
    if (Date.now() - d.tid > LEVETID_TIMER * 3600_000) {
      localStorage.removeItem(LAGER);
      return null;
    }
    return d;
  } catch {
    return null;
  }
}

// Gjenoppretting henter alltid dagens priser og kvoter. Det lagrede er bare
// hvilke kort kunden hadde valgt — aldri hva de kostet.
export async function gjenopprett() {
  const d = lest();
  if (!d) return null;

  const tilbud = await api.tilbud(d.linjer.map((l) => ({ card_id: l.card_id })));
  const kart = new Map(tilbud.map((t) => [`${t.card_id}:${t.finish}`, t]));

  let kurv = {};
  const endringer = [];
  for (const l of d.linjer) {
    const t = kart.get(`${l.card_id}:${l.finish}`);
    if (!t) {
      endringer.push("Ett kort kjøpes ikke lenger, eller kvoten er blitt full.");
      continue;
    }
    // Tilstanden kan ha blitt tatt bort fra settet siden sist.
    const cond = t.conditions.some((c) => c.condition === l.condition)
      ? l.condition
      : t.conditions[0]?.condition;
    if (!cond) continue;
    if (cond !== l.condition) {
      endringer.push(`${t.name}: ${l.condition} tas ikke imot lenger, satt til ${cond}.`);
    }
    const før = antallKort(kurv);
    kurv = leggTil(kurv, t, cond, l.qty);
    const fikk = antallKort(kurv) - før;
    if (fikk < l.qty) {
      endringer.push(`${t.name}: jeg tar inntil ${fikk} stk. nå, ikke ${l.qty}.`);
    }
  }

  if (!antallKort(kurv)) {
    tøm();
    return null;
  }
  return { kurv, endringer, alder: Date.now() - d.tid };
}

export function dato(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("nb-NO", { day: "2-digit", month: "short", year: "numeric" });
}
