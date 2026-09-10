// Alle kall sender sesjonscookien. Uten credentials blir du logget ut ved
// hver forespørsel når admin og API ligger på ulike domener.
const BASE = import.meta.env.VITE_API_URL || "";

async function kall(sti, opts = {}) {
  const r = await fetch(BASE + sti, {
    credentials: "include",
    headers: opts.body ? { "Content-Type": "application/json" } : undefined,
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  // En 401 fra selve innloggingen betyr feil passord, ikke at sesjonen er
  // borte. Uten dette skillet får du «Sesjonen er utløpt» når du taster feil.
  if (r.status === 401 && !sti.endsWith("/login")) throw new UtloggetFeil();
  const tekst = await r.text();
  const data = tekst ? JSON.parse(tekst) : null;
  if (!r.ok) {
    // Svarkroppen henges på: innloggingen trenger å vite om serveren ber om
    // engangskode, ikke bare at det gikk galt.
    const feil = new Error(data?.feil || `Serveren svarte ${r.status}`);
    feil.data = data;
    throw feil;
  }
  return data;
}

export class UtloggetFeil extends Error {
  constructor() {
    super("Sesjonen er utløpt");
  }
}

export const api = {
  meg: () => kall("/api/admin/me"),
  loggInn: (password, kode) => kall("/api/admin/login", { method: "POST", body: { password, kode } }),
  totp: () => kall("/api/admin/totp"),
  totpStart: () => kall("/api/admin/totp/start", { method: "POST" }),
  totpBekreft: (kode) => kall("/api/admin/totp/bekreft", { method: "POST", body: { kode } }),
  totpAv: (password) => kall("/api/admin/totp", { method: "DELETE", body: { password } }),
  loggUt: () => kall("/api/admin/logout", { method: "POST" }),

  ordrer: (arkiv) => kall(`/api/admin/orders?arkiv=${arkiv ? 1 : 0}`),
  endreOrdre: (id, felt) => kall(`/api/admin/orders/${id}`, { method: "PATCH", body: felt }),
  endreLinje: (id, felt) => kall(`/api/admin/lines/${id}`, { method: "PATCH", body: felt }),
  slettLinje: (id) => kall(`/api/admin/lines/${id}`, { method: "DELETE" }),

  sett: () => kall("/api/admin/sets"),
  lagreSett: (kode, regel) => kall(`/api/admin/sets/${kode}`, { method: "PUT", body: regel }),
  masseSett: (felt) => kall("/api/admin/sets", { method: "PUT", body: felt }),

  kort: (sett) => kall(`/api/admin/cards?set=${encodeURIComponent(sett)}`),
  ukobledeISett: (sett, q = "") =>
    kall(`/api/admin/mystore/unmatched-for-set?set=${encodeURIComponent(sett)}&q=${encodeURIComponent(q)}`),
  fjernKobling: (kortId, finish) =>
    kall(`/api/admin/mystore/stock/${kortId}?finish=${finish}`, { method: "DELETE" }),
  masseØnsker: (felt) => kall("/api/admin/cards/wants", { method: "PUT", body: felt }),
  lagreØnske: (id, finish, wanted) =>
    kall(`/api/admin/cards/${id}/want`, { method: "PUT", body: { finish, wanted } }),
  nullstillØnske: (id, finish) =>
    kall(`/api/admin/cards/${id}/want?finish=${finish}`, { method: "DELETE" }),

  ukoblede: () => kall("/api/admin/mystore/unmatched"),
  kategorier: (bareUkoblede, q = "") =>
    kall(`/api/admin/mystore/categories?ukoblede=${bareUkoblede ? 1 : 0}&q=${encodeURIComponent(q)}`),
  søkSett: (q) => kall(`/api/admin/sets/search?q=${encodeURIComponent(q)}`),
  koblKategori: (id, set_code) =>
    kall(`/api/admin/mystore/categories/${id}`, { method: "PUT", body: { set_code } }),
  søkKort: (q) => kall(`/api/admin/cards/search?q=${encodeURIComponent(q)}`),
  leggTilLinje: (ordreId, linje) =>
    kall(`/api/admin/orders/${ordreId}/lines`, { method: "POST", body: linje }),
  testEpost: (id, hvilken) =>
    kall(`/api/admin/orders/${id}/testepost`, { method: "POST", body: { hvilken } }),
  ordreLogg: (id) => kall(`/api/admin/orders/${id}/logg`),
  angreFjerning: (id) => kall(`/api/admin/lines/${id}?angre=1`, { method: "DELETE" }),
  lagreKreditt: (id, felt) => kall(`/api/admin/orders/${id}/kreditt`, { method: "PUT", body: felt }),
  lagrePris: (id, finish, usd) =>
    kall(`/api/admin/cards/${id}/pris`, { method: "PUT", body: { finish, usd } }),
  nullstillPris: (id, finish) =>
    kall(`/api/admin/cards/${id}/pris?finish=${finish}`, { method: "DELETE" }),
  koble: (felt) => kall("/api/admin/mystore/link", { method: "POST", body: felt }),

  innstillinger: () => kall("/api/admin/settings"),
  lagreInnstillinger: (felt) => kall("/api/admin/settings", { method: "PUT", body: felt }),
  jobb: (navn) => kall(`/api/admin/jobs/${navn}`, { method: "POST" }),
};

export const CONDITIONS = ["NM", "EX", "VG", "G"];
export const CONDITION_NAVN = {
  NM: "Near Mint",
  EX: "Excellent",
  VG: "Very Good",
  G: "Good",
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

export function dato(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("nb-NO", { day: "2-digit", month: "short", year: "numeric" });
}

export function dagerTil(iso) {
  if (!iso) return null;
  return Math.ceil((new Date(iso) - new Date()) / 86400000);
}
