// Telling av besøkende i butikken, også dem som ikke logger inn.
//
// Butikken er en statisk side; det vi ser, er kallene den gjør mot serveren
// for kort og priser. Hver besøkende kjennes igjen på en kode av IP-adresse,
// nettleser og et hemmelig tall som byttes hver natt. Ingen IP lagres og ingen
// informasjonskapsel settes, så det trengs ikke samtykke — og etter midnatt
// kan ingen koble en rad til en person.
//
// Tellingen samles i minnet og skrives samlet hvert femte minutt: én rad per
// besøkende per dag, med antall kall. Det holder databaseforbruket nede.
import { createHash, randomBytes } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { db } from "./db.js";
import { hentIp } from "./ratelimit.js";
import { hvilkenSkraper } from "./skrapere.js";

// Flere kall enn dette på en dag er ikke et menneske som blar.
export const MAKS_TREFF_MENNESKE = 1500;

const ROBOT = /bot|crawl|spider|slurp|scrape|curl|wget|python|node-fetch|undici|axios|go-http|java\/|okhttp|httpclient|headless|phantom|puppeteer|playwright|selenium|lighthouse|pagespeed|facebookexternalhit|preview|monitor|uptime|lagervarsel|mtgprice/i;

export function osloDag(d = new Date()): string {
  return d.toLocaleDateString("sv-SE", { timeZone: "Europe/Oslo" });
}

// Ser det ut som en vanlig nettleser som kommer fra butikken?
export function erNettleser(req: Request): boolean {
  const agent = String(req.headers["user-agent"] || "");
  if (!agent || !/Mozilla\//.test(agent) || ROBOT.test(agent)) return false;
  // Nettlesere sender alltid språk. Skript glemmer det som regel.
  if (!req.headers["accept-language"]) return false;
  if (hvilkenSkraper(req)) return false;
  return true;
}

let salt: { dato: string; verdi: string } | null = null;
async function dagensSalt(dato: string): Promise<string> {
  if (salt?.dato === dato) return salt.verdi;
  // Lagres, så en omstart midt på dagen ikke teller alle på nytt. Byttes
  // når datoen skifter, og gårsdagens forsvinner.
  const r = await db().execute("SELECT value FROM settings WHERE key = 'besok_salt'");
  try {
    const lagret = r.rows[0] ? JSON.parse(String(r.rows[0].value)) : null;
    if (lagret?.dato === dato && lagret.verdi) return (salt = lagret).verdi;
  } catch {}
  salt = { dato, verdi: randomBytes(16).toString("hex") };
  await db().execute({
    sql: "INSERT INTO settings (key, value) VALUES ('besok_salt', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    args: [JSON.stringify(salt)],
  });
  return salt.verdi;
}

const kø = new Map<string, number>(); // "dato|hash" → nye treff
let saltFor = "";
let saltVerdi = "";

export async function registrer(ip: string, agent: string, nå = new Date()): Promise<void> {
  const dato = osloDag(nå);
  if (saltFor !== dato) { saltVerdi = await dagensSalt(dato); saltFor = dato; }
  const hash = createHash("sha256").update(`${saltVerdi}|${ip}|${agent}`).digest("base64url").slice(0, 22);
  const nøkkel = `${dato}|${hash}`;
  kø.set(nøkkel, (kø.get(nøkkel) || 0) + 1);
}

export async function skrivBesøk(): Promise<void> {
  if (!kø.size) return;
  const rader = [...kø.entries()];
  kø.clear();
  const sql = "INSERT INTO besok (dato, hash, treff) VALUES (?, ?, ?) ON CONFLICT(dato, hash) DO UPDATE SET treff = treff + excluded.treff";
  for (let i = 0; i < rader.length; i += 200) {
    await db().batch(
      rader.slice(i, i + 200).map(([k, n]) => {
        const [dato, hash] = k.split("|");
        return { sql, args: [dato, hash, n] };
      }),
      "write"
    );
  }
}

// Mellomvare på butikkens API. Teller og går videre — feiler tellingen,
// merker kunden ingenting.
export function tellBesøk(req: Request, _res: Response, next: NextFunction) {
  if (req.method === "GET" && erNettleser(req)) {
    registrer(hentIp(req), String(req.headers["user-agent"] || "")).catch(() => {});
  }
  next();
}

let tidtaker: NodeJS.Timeout | null = null;
export function startBesøksskriver() {
  if (tidtaker) return;
  tidtaker = setInterval(() => skrivBesøk().catch((e) => console.error("Besøkstelling:", e?.message)), 5 * 60 * 1000);
  tidtaker.unref?.();
  const avslutt = () => { skrivBesøk().catch(() => {}); };
  process.once("SIGTERM", avslutt);
  process.once("beforeExit", avslutt);
}

// Unike besøkende per dag, uten robotene.
export async function besøkPerDag(fra: string): Promise<Map<string, number>> {
  await skrivBesøk().catch(() => {});
  const r = await db().execute({
    sql: "SELECT dato, COUNT(*) AS n FROM besok WHERE dato >= ? AND treff <= ? GROUP BY dato",
    args: [fra, MAKS_TREFF_MENNESKE],
  });
  return new Map((r.rows as any[]).map((x) => [String(x.dato), Number(x.n)]));
}

// Rader eldre enn to år trengs ikke; tallet per dag er det som betyr noe.
export async function ryddBesøk(): Promise<void> {
  const grense = osloDag(new Date(Date.now() - 730 * 86400000));
  await db().execute({ sql: "DELETE FROM besok WHERE dato < ?", args: [grense] });
}
