// Skrapere som er stengt ute fra butikkens katalog. De får en melding i
// stedet for kortene, så den som har laget dem, vet hvem de kan kontakte.
//
// Gjenkjennes på adressen eller på navnet de oppgir. Bytter en av dem både
// adresse og navn, stopper kortkvoten den uansett (ratelimit.ts).
//
// MTGPriceTracker: hentet hele lageret, 100 kort om gangen, på 17 minutter
// (4. november 2026).
import type { Request, Response, NextFunction } from "express";
import { hentIp } from "./ratelimit.js";

const STENGT: { navn: string; ip?: string[]; agent?: RegExp }[] = [
  { navn: "MTGPriceTracker", ip: ["195.139.82.138"], agent: /MTGPriceTracker/i },
];

export const SKRAPERMELDING =
  "Automatisk innhenting av priser fra Korthaien er ikke tillatt. " +
  "Vil du ha prisdata fra oss, ta kontakt på korthaien@gmail.com. / " +
  "Automated price collection from Korthaien is not permitted. " +
  "For price data, contact korthaien@gmail.com.";

export function hvilkenSkraper(req: Request): string | null {
  const ip = hentIp(req);
  const agent = String(req.headers["user-agent"] || "");
  for (const s of STENGT) {
    if (s.ip?.includes(ip) || (s.agent && s.agent.test(agent))) return s.navn;
  }
  return null;
}

export function stengSkrapere(req: Request, res: Response, next: NextFunction) {
  const navn = hvilkenSkraper(req);
  if (!navn) return next();
  console.log(`Skraper stengt ute: ${navn} (${hentIp(req)}) ${req.path}`);
  res.status(403).json({ feil: SKRAPERMELDING, kontakt: "korthaien@gmail.com" });
}
