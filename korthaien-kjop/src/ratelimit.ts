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
//
// Reglene skiller på hva kallet gjør, ikke bare på hvor mange de er:
//
//   søk    ett kall per søk i søkefeltet
//   bulk   ett kall per innliming, uansett om lista har 5 eller 50 linjer
//   pris   ett kall per endring i kurven — altså per kort kunden legger inn
//   ordre  innsending
//
// «pris» lå tidligere under «bulk» og delte kvote med den. En kunde med 112
// kort brukte da opp døgnkvoten midt i sin første ordre, fikk beskjed om at
// han hadde nådd en grense, og kom ikke videre. Kurvaktivitet er det motsatte
// av skraping — den som fyller en kurv har tenkt å selge, ikke å hente ut
// prislista — så den har fått sin egen, romslige regel.

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
  søk: { navn: "søk", perMinutt: 60, perDøgn: 3000 },
  bulk: { navn: "bulk", perMinutt: 15, perDøgn: 400 },
  pris: { navn: "pris", perMinutt: 90, perDøgn: 5000 },
  ordre: { navn: "ordre", perMinutt: 3, perDøgn: 20 },
  innlogging: { navn: "innlogging", perMinutt: 5, perDøgn: 50 },
} as const;

const MINUTT = 60_000;
const DØGN = 24 * 60 * 60_000;
// Taket hindrer at kartet vokser fritt hvis noen sender forespørsler fra
// tusenvis av adresser. Da kastes de eldste — de er uansett utløpt snart.
const MAKS_NØKLER = 20_000;

// Har adressen sendt inn en ordre, er det ikke en konkurrent som henter
// prislista. Da heves taket resten av døgnet. Vi merker på forsøket og ikke
// på et fullført salg: ordre-regelen slipper uansett bare gjennom 20 i
// døgnet, så det er ingen vei inn for en skraper her.
const KUNDE_FAKTOR = 4;

const korte = new Map<string, Vindu>();
const lange = new Map<string, Vindu>();
const kunder = new Map<string, number>();

function tell(kart: Map<string, Vindu>, nøkkel: string, varighet: number): Vindu {
  const nå = Date.now();
  const v = kart.get(nøkkel);
  if (!v || v.utløper <= nå) {
    if (kart.size >= MAKS_NØKLER) rydd(kart, nå);
    const nytt = { antall: 1, utløper: nå + varighet };
    kart.set(nøkkel, nytt);
    return nytt;
  }
  v.antall++;
  return v;
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

export function merkKunde(ip: string) {
  if (kunder.size >= MAKS_NØKLER) {
    const nå = Date.now();
    for (const [k, t] of kunder) if (t <= nå) kunder.delete(k);
  }
  kunder.set(ip, Date.now() + DØGN);
}

export function erKunde(ip: string): boolean {
  const til = kunder.get(ip);
  if (!til) return false;
  if (til <= Date.now()) {
    kunder.delete(ip);
    return false;
  }
  return true;
}

const sekunderIgjen = (v: Vindu) => Math.max(1, Math.ceil((v.utløper - Date.now()) / 1000));

// «Prøv igjen om en time» stemte nesten aldri: døgnvinduet starter ved første
// forespørsel, så det kunne være hva som helst mellom ett minutt og et døgn
// igjen. Kunden fortjener klokkeslettet.
function klokkeslett(v: Vindu): string {
  return new Date(v.utløper).toLocaleTimeString("no-NO", {
    timeZone: "Europe/Oslo",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function grense(regel: Regel) {
  return (req: Request, res: Response, next: NextFunction) => {
    const ip = hentIp(req);
    const nøkkel = `${regel.navn}:${ip}`;
    const faktor = erKunde(ip) ? KUNDE_FAKTOR : 1;

    const minutt = tell(korte, nøkkel, MINUTT);
    if (minutt.antall > regel.perMinutt * faktor) {
      res.setHeader("Retry-After", String(sekunderIgjen(minutt)));
      return res.status(429).json({
        feil: "For mange forespørsler på kort tid. Vent et minutt og prøv igjen.",
      });
    }

    // Døgnvinduet telles først når minuttgrensen er passert. Ellers brenner
    // en utålmodig kunde opp dagskvoten på kall han aldri fikk svar på.
    const døgn = tell(lange, nøkkel, DØGN);
    if (døgn.antall > regel.perDøgn * faktor) {
      res.setHeader("Retry-After", String(sekunderIgjen(døgn)));
      return res.status(429).json({
        feil:
          `Du har nådd dagens grense. Den nullstilles kl. ${klokkeslett(døgn)}. ` +
          "Trenger du å legge inn mer før det, send en e-post til korthaien@gmail.com.",
      });
    }

    if (regel.navn === "ordre" && req.method === "POST") merkKunde(ip);

    next();
  };
}

// Bare for tester — grensene er i minnet, og en test skal ikke arve tellingen
// fra den forrige.
export function nullstill() {
  korte.clear();
  lange.clear();
  kunder.clear();
}

export function status() {
  return { korteNøkler: korte.size, langeNøkler: lange.size, kunder: kunder.size };
}
