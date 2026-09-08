import type { Request, Response, NextFunction } from "express";

// ─────────────────────────────────────────────────────────────────────────────
// RATE LIMITING
// ─────────────────────────────────────────────────────────────────────────────
// De åpne endepunktene er hele innkjøpslista: hvilke kort du mangler og hva du
// betaler for dem. Uten grenser kan en konkurrent hente ut alt sammen på noen
// minutter.
//
// Grensene er satt slik at en ekte kunde aldri møter dem. Den som limer inn 50
// linjer og bruker et kvarter på å velge utgaver, ligger langt under. Den som
// systematisk går gjennom 988 sett, gjør det ikke.

type Vindu = { antall: number; utløper: number };

// To vinduer per regel: ett kort som stopper støt, og ett langt som stopper
// jevn tapping over hele dagen. Bare det korte ville sluppet gjennom en
// skraper som går sakte nok.
export type Regel = {
  navn: string;
  perMinutt: number;
  perDøgn: number;
};

export const REGLER = {
  søk: { navn: "søk", perMinutt: 60, perDøgn: 2000 },
  bulk: { navn: "bulk", perMinutt: 10, perDøgn: 200 },
  ordre: { navn: "ordre", perMinutt: 3, perDøgn: 20 },
  innlogging: { navn: "innlogging", perMinutt: 5, perDøgn: 50 },
} as const;

const MINUTT = 60_000;
const DØGN = 24 * 60 * 60_000;
// Taket hindrer at kartet vokser fritt hvis noen sender forespørsler fra
// tusenvis av adresser. Da kastes de eldste — de er uansett utløpt snart.
const MAKS_NØKLER = 20_000;

const korte = new Map<string, Vindu>();
const lange = new Map<string, Vindu>();

function tell(kart: Map<string, Vindu>, nøkkel: string, varighet: number): number {
  const nå = Date.now();
  const v = kart.get(nøkkel);
  if (!v || v.utløper <= nå) {
    if (kart.size >= MAKS_NØKLER) rydd(kart, nå);
    kart.set(nøkkel, { antall: 1, utløper: nå + varighet });
    return 1;
  }
  v.antall++;
  return v.antall;
}

function rydd(kart: Map<string, Vindu>, nå: number) {
  for (const [k, v] of kart) if (v.utløper <= nå) kart.delete(k);
  // Fortsatt fullt? Da er trafikken reell, og vi ofrer de eldste.
  if (kart.size >= MAKS_NØKLER) {
    let n = Math.ceil(kart.size / 4);
    for (const k of kart.keys()) {
      kart.delete(k);
      if (--n <= 0) break;
    }
  }
}

// Bak Render ligger den ekte adressen i X-Forwarded-For. Uten dette ville
// alle brukere sett ut som én, og grensene rammet alle samtidig.
export function hentIp(req: Request): string {
  const videresendt = req.headers["x-forwarded-for"];
  if (typeof videresendt === "string" && videresendt) {
    return videresendt.split(",")[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || "ukjent";
}

export function grense(regel: Regel) {
  return (req: Request, res: Response, next: NextFunction) => {
    const ip = hentIp(req);
    const nøkkel = `${regel.navn}:${ip}`;

    const iMinuttet = tell(korte, nøkkel, MINUTT);
    const iDøgnet = tell(lange, nøkkel, DØGN);

    if (iMinuttet > regel.perMinutt) {
      res.setHeader("Retry-After", "60");
      return res.status(429).json({
        feil: "For mange forespørsler. Vent et minutt og prøv igjen.",
      });
    }
    if (iDøgnet > regel.perDøgn) {
      res.setHeader("Retry-After", "3600");
      return res.status(429).json({
        feil: "Du har nådd dagens grense. Ta kontakt hvis du trenger å legge inn mer.",
      });
    }
    next();
  };
}

// Bare for tester — grensene er i minnet, og en test skal ikke arve tellingen
// fra den forrige.
export function nullstill() {
  korte.clear();
  lange.clear();
}

export function status() {
  return { korteNøkler: korte.size, langeNøkler: lange.size };
}
