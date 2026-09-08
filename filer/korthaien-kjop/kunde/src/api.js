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
  sett: () => kall("/api/sets"),
  søk: (p) => kall("/api/search?" + new URLSearchParams(p)),
  bulk: (tekst) => kall("/api/bulk", { method: "POST", body: { tekst } }),
  sendOrdre: (ordre) => kall("/api/orders", { method: "POST", body: ordre }),
  ordre: (nr) => kall("/api/orders/" + encodeURIComponent(nr)),
};

export function kroner(n) {
  return new Intl.NumberFormat("nb-NO").format(Math.round(n || 0)) + " kr";
}

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

export function leggTil(kurv, tilbud, cond, pris, antall = 1) {
  const plass = ledig(kurv, tilbud);
  if (plass <= 0) return kurv;
  const n = Math.min(antall, plass);
  const k = nøkkel(tilbud, cond);
  const fins = kurv[k];
  return {
    ...kurv,
    [k]: fins
      ? { ...fins, qty: fins.qty + n }
      : { tilbud, condition: cond, pris, qty: n },
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

export function total(kurv) {
  return Object.values(kurv).reduce((n, l) => n + l.pris * l.qty, 0);
}

export function antallKort(kurv) {
  return Object.values(kurv).reduce((n, l) => n + l.qty, 0);
}

// Samme sortering som ordrebekreftelsen: sett, så kortnavn. Kunden ser
// lista i den rekkefølgen hen skal legge bunken.
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
