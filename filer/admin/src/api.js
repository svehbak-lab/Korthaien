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
  if (r.status === 401) throw new UtloggetFeil();
  const tekst = await r.text();
  const data = tekst ? JSON.parse(tekst) : null;
  if (!r.ok) throw new Error(data?.feil || `Serveren svarte ${r.status}`);
  return data;
}

export class UtloggetFeil extends Error {
  constructor() {
    super("Sesjonen er utløpt");
  }
}

export const api = {
  meg: () => kall("/api/admin/me"),
  loggInn: (password) => kall("/api/admin/login", { method: "POST", body: { password } }),
  loggUt: () => kall("/api/admin/logout", { method: "POST" }),

  ordrer: (arkiv) => kall(`/api/admin/orders?arkiv=${arkiv ? 1 : 0}`),
  endreOrdre: (id, felt) => kall(`/api/admin/orders/${id}`, { method: "PATCH", body: felt }),
  endreLinje: (id, felt) => kall(`/api/admin/lines/${id}`, { method: "PATCH", body: felt }),
  slettLinje: (id) => kall(`/api/admin/lines/${id}`, { method: "DELETE" }),

  sett: () => kall("/api/admin/sets"),
  lagreSett: (kode, regel) => kall(`/api/admin/sets/${kode}`, { method: "PUT", body: regel }),

  kort: (sett) => kall(`/api/admin/cards?set=${encodeURIComponent(sett)}`),
  lagreØnske: (id, finish, wanted) =>
    kall(`/api/admin/cards/${id}/want`, { method: "PUT", body: { finish, wanted } }),
  nullstillØnske: (id, finish) =>
    kall(`/api/admin/cards/${id}/want?finish=${finish}`, { method: "DELETE" }),

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

export function kroner(n) {
  return new Intl.NumberFormat("nb-NO").format(Math.round(n || 0)) + " kr";
}

export function dato(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("nb-NO", { day: "2-digit", month: "short", year: "numeric" });
}

export function dagerTil(iso) {
  if (!iso) return null;
  return Math.ceil((new Date(iso) - new Date()) / 86400000);
}
