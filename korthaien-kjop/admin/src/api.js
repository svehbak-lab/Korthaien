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

// PDF-ene hentes med fetch og ikke en vanlig lenke: admin og API ligger på
// ulike domener, og sesjonscookien følger bare med når vi ber om det.
export async function lastNedPdf(sti, filnavn) {
  const r = await fetch(BASE + sti, { credentials: "include" });
  if (r.status === 401) throw new UtloggetFeil();
  if (!r.ok) {
    const t = await r.text();
    let feil = `Serveren svarte ${r.status}`;
    try { feil = JSON.parse(t).feil || feil; } catch {}
    throw new Error(feil);
  }
  const url = URL.createObjectURL(await r.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = filnavn;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// Bilder du har lastet opp ligger bak API-et. Adressen må ha API-ets
// domene foran seg, ellers spør nettleseren admin-domenet om bildet.
export const bildeUrl = (id) => `${BASE}/api/bilder/${id}`;

// Opplasting: selve filen som kropp, ikke JSON — et bilde på et par
// megabyte blir en tredjedel større som base64.
export async function importerKunder(fil) {
  const r = await fetch(`${BASE}/api/admin/kunder/import`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "text/csv" },
    body: await fil.text(),
  });
  if (r.status === 401) throw new UtloggetFeil();
  const data = await r.json().catch(() => null);
  if (!r.ok) throw new Error(data?.feil || `Serveren svarte ${r.status}`);
  return data;
}

export async function importerRabattkoder(tekst) {
  const r = await fetch(`${BASE}/api/admin/rabattkoder/import`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "text/plain" },
    body: tekst,
  });
  if (r.status === 401) throw new UtloggetFeil();
  const data = await r.json().catch(() => null);
  if (!r.ok) throw new Error(data?.feil || `Serveren svarte ${r.status}`);
  return data;
}

export const bildeFraLenke = (url) => kall("/api/admin/bilder/fra-lenke", { method: "POST", body: { url } });

export async function lastOppBilde(fil) {
  const r = await fetch(`${BASE}/api/admin/bilder`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": fil.type },
    body: fil,
  });
  if (r.status === 401) throw new UtloggetFeil();
  const data = await r.json().catch(() => null);
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
  døpOmSett: (kode, visningsnavn) =>
    kall(`/api/admin/sets/${kode}/navn`, { method: "PUT", body: { visningsnavn } }),
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
  leggTilAnnet: (ordreId, linje) =>
    kall(`/api/admin/orders/${ordreId}/annet`, { method: "POST", body: linje }),
  testEpost: (id, hvilken) =>
    kall(`/api/admin/orders/${id}/testepost`, { method: "POST", body: { hvilken } }),
  byttKort: (linjeId, card_id, finish) =>
    kall(`/api/admin/lines/${linjeId}`, { method: "PATCH", body: { card_id, finish } }),
  ordreLogg: (id) => kall(`/api/admin/orders/${id}/logg`),
  angreFjerning: (id) => kall(`/api/admin/lines/${id}?angre=1`, { method: "DELETE" }),
  lagreKreditt: (id, felt) => kall(`/api/admin/orders/${id}/kreditt`, { method: "PUT", body: felt }),
  butikk: (f) => {
    // Tomme felter sendes ikke — de ville blitt lest som filtre på tom streng.
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(f)) {
      if (v === "" || v === null || v === undefined || v === false) continue;
      p.set(k, v === true ? "1" : String(v));
    }
    return kall(`/api/admin/butikk?${p}`);
  },
  butikkKort: (id) => kall(`/api/admin/butikk/kort/${id}`),
  kontakt: (felt) => kall("/api/kontakt", { method: "POST", body: felt }),
  nyesteSett: (antall) => kall(`/api/admin/butikk/nyeste?antall=${antall || 5}`),
  salgspriser: () => kall("/api/admin/salgspriser"),
  lagreSalgspriser: (intervaller) =>
    kall("/api/admin/salgspriser", { method: "PUT", body: { intervaller } }),
  salgsprisSett: (sett) => kall(`/api/admin/salgspriser/${encodeURIComponent(sett)}`),
  settSalgspris: (id, finish, nm_ore) =>
    kall(`/api/admin/salgspris/${id}`, { method: "PUT", body: { finish, nm_ore } }),
  lager: (sett) => kall(`/api/admin/lager?sett=${encodeURIComponent(sett)}`),
  settLager: (id, felt) => kall(`/api/admin/lager/${id}`, { method: "PUT", body: felt }),
  lagerHistorikk: (id, finish) =>
    kall(`/api/admin/lager/${id}/historikk${finish ? `?finish=${finish}` : ""}`),
  lagerSammendrag: () => kall("/api/admin/lager-sammendrag"),
  statistikk: () => kall("/api/admin/statistikk"),
  lagerrapport: () => kall("/api/admin/lagerrapport"),
  lagerhistorikk: () => kall("/api/admin/lagerhistorikk"),
  kupp: ({ minAvvik = 0, visBorte = false } = {}) =>
    kall(`/api/admin/kupp?minAvvik=${minAvvik}&visBorte=${visBorte ? 1 : 0}`),
  kuppVakteliste: () => kall("/api/admin/kupp/vakteliste"),
  kuppEgne: () => kall("/api/admin/kupp/egne"),
  settKuppRettet: (felt) => kall("/api/admin/kupp/rettet", { method: "POST", body: felt }),
  settKuppOppsett: (endringer) =>
    kall("/api/admin/kupp/oppsett", { method: "POST", body: endringer }),
  settGrunnsett: (kode, grunnsett_til) =>
    kall(`/api/admin/sets/${encodeURIComponent(kode)}/grunnsett`, {
      method: "PUT",
      body: { grunnsett_til },
    }),
  lagreKortConditions: (id, conditions) =>
    kall(`/api/admin/cards/${id}/conditions`, { method: "PUT", body: { conditions } }),
  lagrePris: (id, finish, usd) =>
    kall(`/api/admin/cards/${id}/pris`, { method: "PUT", body: { finish, usd } }),
  nullstillPris: (id, finish) =>
    kall(`/api/admin/cards/${id}/pris?finish=${finish}`, { method: "DELETE" }),
  koble: (felt) => kall("/api/admin/mystore/link", { method: "POST", body: felt }),

  frakt: () => kall("/api/admin/frakt"),
  leggTilFrakt: (f) => kall("/api/admin/frakt", { method: "POST", body: f }),
  endreFrakt: (id, f) => kall(`/api/admin/frakt/${id}`, { method: "PUT", body: f }),
  slåAvFrakt: (id) => kall(`/api/admin/frakt/${id}`, { method: "DELETE" }),

  kreditt: (q) => kall(`/api/admin/kreditt?q=${encodeURIComponent(q || "")}`),
  salgsrapport: (fra, til) => kall(`/api/admin/rapporter/salg?fra=${fra}&til=${til}`),

  // Salgsordrer i admin.
  salgsordrer: (status) => kall(`/api/admin/salg/ordrer?status=${status}`),
  salgsordre: (nr) => kall(`/api/admin/salg/ordrer/${encodeURIComponent(nr)}`),
  endreSalgsordre: (nr, felt) => kall(`/api/admin/salg/ordrer/${encodeURIComponent(nr)}`, { method: "PATCH", body: felt }),
  kansellerSalgsordre: (nr, grunn, maate) =>
    kall(`/api/admin/salg/ordrer/${encodeURIComponent(nr)}/kanseller`, { method: "POST", body: { grunn, maate } }),
  salgsstatistikk: () => kall("/api/admin/salg/statistikk"),
  kredittKonto: (epost) => kall(`/api/admin/kreditt/${encodeURIComponent(epost)}`),
  bokførKreditt: (felt) => kall("/api/admin/kreditt", { method: "POST", body: felt }),

  produkter: (o = {}) =>
    kall("/api/admin/produkter?" + new URLSearchParams(
      Object.entries(o).filter(([, v]) => v !== undefined && v !== "")
    )),
  frigiKvote: (id) => kall(`/api/admin/orders/${id}/frigi`, { method: "POST" }),
  settinfo: (kode) => kall(`/api/admin/butikk/sett/${encodeURIComponent(kode)}`),
  leggTilProdukt: (p) => kall("/api/admin/produkter", { method: "POST", body: p }),
  endreProdukt: (id, p) => kall(`/api/admin/produkter/${id}`, { method: "PUT", body: p }),
  slåAvProdukt: (id) => kall(`/api/admin/produkter/${id}`, { method: "DELETE" }),

  rabattkoder: () => kall("/api/admin/rabattkoder"),
  nyRabattkode: (felt) => kall("/api/admin/rabattkoder", { method: "POST", body: felt }),
  rabattkodeBevegelser: (id) => kall(`/api/admin/rabattkoder/${id}/bevegelser`),
  justerRabattkode: (id, felt) => kall(`/api/admin/rabattkoder/${id}/saldo`, { method: "POST", body: felt }),
  endreRabattkode: (id, felt) => kall(`/api/admin/rabattkoder/${id}`, { method: "PATCH", body: felt }),
  kunder: (q, side) => kall(`/api/admin/kunder?q=${encodeURIComponent(q || "")}&side=${side || 0}`),
  innstillinger: () => kall("/api/admin/settings"),
  overgang: () => kall("/api/admin/overgang"),
  kjørOvergang: () => kall("/api/admin/overgang", { method: "POST", body: { bekreft: "OVERGANG" } }),
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

// ─────────────────────────────────────────────────────────────────────────────
// KUNDEN
// ─────────────────────────────────────────────────────────────────────────────
// Rutene butikken bruker på vegne av kunden. De er offentlige og bruker
// kundens egen cookie, ikke admins — så de kan flyttes med butikken.
// En 401 her betyr at kunden ikke er logget inn, ikke at admin er utlogget.
async function kundekall(sti, opts = {}) {
  const r = await fetch(BASE + sti, {
    credentials: "include",
    headers: opts.body ? { "Content-Type": "application/json" } : undefined,
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const tekst = await r.text();
  const data = tekst ? JSON.parse(tekst) : null;
  if (!r.ok) {
    const feil = new Error(data?.feil || `Serveren svarte ${r.status}`);
    feil.data = data;
    feil.status = r.status;
    throw feil;
  }
  return data;
}

export const kunde = {
  meg: () => kundekall("/api/konto/meg"),
  registrer: (felt) => kundekall("/api/konto/registrer", { method: "POST", body: felt }),
  loggInn: (email, passord) => kundekall("/api/konto/logg-inn", { method: "POST", body: { email, passord } }),
  loggUt: () => kundekall("/api/konto/logg-ut", { method: "POST" }),
  profil: (felt) => kundekall("/api/konto/profil", { method: "PUT", body: felt }),
  passord: (gammelt, nytt) => kundekall("/api/konto/passord", { method: "PUT", body: { gammelt, nytt } }),
  glemt: (email) => kundekall("/api/konto/glemt", { method: "POST", body: { email } }),
  nyttPassord: (token, passord) => kundekall("/api/konto/nytt-passord", { method: "POST", body: { token, passord } }),
  bekreft: (token) => kundekall("/api/konto/bekreft", { method: "POST", body: { token } }),
  sendBekreftelse: () => kundekall("/api/konto/send-bekreftelse", { method: "POST" }),
  googleUrl: () => `${BASE}/api/konto/google`,
  ordrer: () => kundekall("/api/konto/ordrer"),
  onskeliste: () => kundekall("/api/konto/onskeliste"),
  leggOnske: (felt) => kundekall("/api/konto/onskeliste", { method: "POST", body: felt }),
  fjernOnske: (id) => kundekall(`/api/konto/onskeliste/${id}`, { method: "DELETE" }),
  ordre: (nr) => kundekall(`/api/konto/ordrer/${encodeURIComponent(nr)}`),
  kreditt: () => kundekall("/api/konto/kreditt"),

  oppsett: () => kundekall("/api/butikk/oppsett"),
  // Det offentlige butikkvinduet: katalog, kortsider, sett og sealed uten innlogging.
  foretak: () => kundekall("/api/butikk/foretak"),
  katalog: (f) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(f)) {
      if (v === "" || v === null || v === undefined || v === false) continue;
      p.set(k, v === true ? "1" : String(v));
    }
    return kundekall(`/api/butikk/katalog?${p}`);
  },
  kort: (id) => kundekall(`/api/butikk/kort/${encodeURIComponent(id)}`),
  nyesteSett: (antall) => kundekall(`/api/butikk/nyeste?antall=${antall || 5}`),
  settinfo: (kode) => kundekall(`/api/butikk/sett/${encodeURIComponent(kode)}`),
  settliste: () => kundekall("/api/butikk/settliste"),
  produkter: (o = {}) =>
    kundekall("/api/butikk/produkter?" + new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined && v !== ""))),
  frakt: () => kundekall("/api/butikk/frakt"),
  kontakt: (felt) => kundekall("/api/kontakt", { method: "POST", body: felt }),
  kurv: (linjer) => kundekall("/api/butikk/kurv", { method: "POST", body: { linjer } }),
  kasse: (felt) => kundekall("/api/butikk/kasse", { method: "POST", body: felt }),
  rabattkode: (kode) => kundekall("/api/butikk/rabattkode", { method: "POST", body: { kode } }),
  bulksok: (tekst, kun_foil) => kundekall("/api/butikk/bulksok", { method: "POST", body: { tekst, kun_foil } }),
  avbryt: (nr, m) => kundekall(`/api/butikk/kasse/${encodeURIComponent(nr)}/avbryt`, { method: "POST", body: { m } }),
  toppbanner: () => kundekall("/api/butikk/toppbanner"),
  kvittering: (nr, m) => kundekall(`/api/butikk/ordre/${encodeURIComponent(nr)}?m=${encodeURIComponent(m)}`),
};
