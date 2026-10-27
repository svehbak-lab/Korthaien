// ─────────────────────────────────────────────────────────────────────────────
// VIPPS — EGEN AVTALE (ePayment API)
// ─────────────────────────────────────────────────────────────────────────────
// Korthaiens egen Vipps-avtale, ved siden av kort hos Stripe. Kunden sendes
// til Vipps, godkjenner i appen og kommer tilbake til kvitteringen.
//
// Beløpet trekkes med en gang betalingen er godkjent, som med kort. Ingen
// webhook: statusen hentes når kunden kommer tilbake, og hvert minutt for
// åpne kasser, så en kunde som lukker nettleseren etter å ha godkjent, får
// ordren likevel.
//
// Nøklene ligger i Render: VIPPS_CLIENT_ID, VIPPS_CLIENT_SECRET,
// VIPPS_SUBSCRIPTION_KEY og VIPPS_MSN. VIPPS_TEST=1 bruker testmiljøet.

import { randomUUID } from "node:crypto";

export const harVipps = () =>
  !!(process.env.VIPPS_CLIENT_ID && process.env.VIPPS_CLIENT_SECRET && process.env.VIPPS_SUBSCRIPTION_KEY && process.env.VIPPS_MSN);

const base = () => (process.env.VIPPS_TEST === "1" ? "https://apitest.vipps.no" : "https://api.vipps.no");

export type VippsTilstand = "CREATED" | "AUTHORIZED" | "ABORTED" | "EXPIRED" | "TERMINATED";
export type VippsBetaling = {
  reference: string;
  state: VippsTilstand;
  amount: { currency: string; value: number };
  aggregate: {
    authorizedAmount: { value: number };
    capturedAmount: { value: number };
    refundedAmount: { value: number };
    cancelledAmount: { value: number };
  };
  pspReference?: string;
};

export class VippsFeil extends Error {
  constructor(public status: number, melding: string) {
    super(melding);
  }
}

// For tester: bytt ut HTTP-kallene.
let hent: typeof fetch = (...a) => fetch(...a);
export function _brukFetch(f: typeof fetch) {
  hent = f;
  token = null;
}

const fellesHoder = () => ({
  "Ocp-Apim-Subscription-Key": String(process.env.VIPPS_SUBSCRIPTION_KEY),
  "Merchant-Serial-Number": String(process.env.VIPPS_MSN),
  "Vipps-System-Name": "korthaien",
  "Vipps-System-Version": "1.0.0",
  "Vipps-System-Plugin-Name": "korthaien-butikk",
  "Vipps-System-Plugin-Version": "1.0.0",
});

// Tokenet gjelder en time eller et døgn. Hentes på nytt litt før det går ut.
let token: { verdi: string; utløper: number } | null = null;
async function tilgang(): Promise<string> {
  if (token && token.utløper > Date.now() + 60_000) return token.verdi;
  const r = await hent(`${base()}/accesstoken/get`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      client_id: String(process.env.VIPPS_CLIENT_ID),
      client_secret: String(process.env.VIPPS_CLIENT_SECRET),
      ...fellesHoder(),
    },
  });
  if (!r.ok) throw new VippsFeil(r.status, `Vipps avviste nøklene (${r.status}). Sjekk VIPPS-nøklene i Render.`);
  const d: any = await r.json();
  token = { verdi: String(d.access_token), utløper: Date.now() + (Number(d.expires_in) || 3600) * 1000 };
  return token.verdi;
}

async function kall(sti: string, opts: { metode?: string; kropp?: any; nøkkel?: string } = {}): Promise<any> {
  const r = await hent(`${base()}${sti}`, {
    method: opts.metode || "GET",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${await tilgang()}`,
      ...fellesHoder(),
      ...(opts.nøkkel ? { "Idempotency-Key": opts.nøkkel } : {}),
    },
    body: opts.kropp ? JSON.stringify(opts.kropp) : undefined,
  });
  const tekst = await r.text();
  let d: any = null;
  try {
    d = tekst ? JSON.parse(tekst) : null;
  } catch {}
  if (!r.ok) {
    const detalj = d?.detail || d?.title || tekst.slice(0, 200) || `HTTP ${r.status}`;
    throw new VippsFeil(r.status, `Vipps: ${detalj}`);
  }
  return d;
}

// Vipps tar 8–50 tegn, bare bokstaver, tall og bindestrek.
export const vippsReferanse = (ordrenr: string) => `korthaien-${ordrenr}`.replace(/[^a-zA-Z0-9-]/g, "-").slice(0, 50);

const kr = (ore: number) => ({ currency: "NOK", value: ore });

export async function lagVippsBetaling(a: {
  ordrenr: string;
  ore: number;
  returUrl: string;
  beskrivelse: string;
  telefon?: string | null;
}): Promise<{ reference: string; redirectUrl: string }> {
  const reference = vippsReferanse(a.ordrenr);
  // Norsk mobilnummer gjør at kunden slipper å taste det hos Vipps.
  const tlf = String(a.telefon || "").replace(/\D/g, "");
  const telefon = /^\d{8}$/.test(tlf) ? `47${tlf}` : /^47\d{8}$/.test(tlf) ? tlf : null;
  const d = await kall("/epayment/v1/payments", {
    metode: "POST",
    nøkkel: `opprett-${reference}`,
    kropp: {
      amount: kr(a.ore),
      paymentMethod: { type: "WALLET" },
      ...(telefon ? { customer: { phoneNumber: telefon } } : {}),
      reference,
      returnUrl: a.returUrl,
      userFlow: "WEB_REDIRECT",
      paymentDescription: a.beskrivelse.slice(0, 100),
    },
  });
  return { reference, redirectUrl: String(d.redirectUrl) };
}

export const hentVippsBetaling = (reference: string): Promise<VippsBetaling> =>
  kall(`/epayment/v1/payments/${encodeURIComponent(reference)}`);

export const trekkVipps = (reference: string, ore: number) =>
  kall(`/epayment/v1/payments/${encodeURIComponent(reference)}/capture`, {
    metode: "POST",
    nøkkel: `trekk-${reference}`,
    kropp: { modificationAmount: kr(ore) },
  });

// Nøkkelen gjør et nytt forsøk på samme refusjon trygt. Delrefusjoner (en
// rettet ordre) må ha sin egen, ellers svarer Vipps med den første.
export const refunderVipps = (reference: string, ore: number, nøkkel = `refusjon-${reference}`) =>
  kall(`/epayment/v1/payments/${encodeURIComponent(reference)}/refund`, {
    metode: "POST",
    nøkkel,
    kropp: { modificationAmount: kr(ore) },
  });

export const avbrytVipps = (reference: string) =>
  kall(`/epayment/v1/payments/${encodeURIComponent(reference)}/cancel`, {
    metode: "POST",
    nøkkel: `avbryt-${reference}-${randomUUID()}`,
  });
