import { createClient, type Client } from "@libsql/client";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HER = dirname(fileURLToPath(import.meta.url));

let klient: Client | null = null;

export function db(): Client {
  if (klient) return klient;
  const url = process.env.DATABASE_URL || "file:./korthaien-kjop.db";
  klient = createClient({
    url,
    authToken: process.env.DATABASE_AUTH_TOKEN || undefined,
  });
  return klient;
}

export async function migrate(): Promise<void> {
  const sql = readFileSync(join(HER, "schema.sql"), "utf8");
  // libSQL tar én setning om gangen.
  const setninger = sql
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s && !s.split("\n").every((l) => l.trim().startsWith("--")));
  for (const s of setninger) await db().execute(s);
}

// ── innstillinger ────────────────────────────────────────────────────────────
export type Ladder = Record<string, number>;

export const CONDITIONS = ["NM", "EX", "VG", "G"] as const;
export type Condition = (typeof CONDITIONS)[number];

export const CONDITION_NAVN: Record<Condition, string> = {
  NM: "Near Mint",
  EX: "Excellent",
  VG: "Very Good",
  G: "Good",
};

export type Settings = {
  usd_nok: number;
  buy_pct: number;
  min_buy_nok: number;
  default_conditions: Condition[];
  default_ladder: Ladder;
  order_expiry_days: number;
  ship_to: string;
};

const STANDARD: Settings = {
  usd_nok: 10.6,
  buy_pct: 70,
  // Linjer under denne summen er ikke verdt håndteringen for noen av partene.
  min_buy_nok: 1,
  // NM er standard for alle sett, slik du beskrev.
  default_conditions: ["NM"],
  default_ladder: { NM: 100, EX: 85, VG: 70, G: 55 },
  order_expiry_days: 14,
  ship_to: "Korthaien\n(adresse settes i admin)",
};

export async function hentSettings(): Promise<Settings> {
  const rader = await db().execute("SELECT key, value FROM settings");
  const ut: any = { ...STANDARD };
  for (const r of rader.rows) {
    const k = String(r.key);
    if (!(k in STANDARD)) continue;
    try {
      ut[k] = JSON.parse(String(r.value));
    } catch {
      ut[k] = r.value;
    }
  }
  return ut as Settings;
}

export async function settSetting(key: keyof Settings, value: unknown): Promise<void> {
  await db().execute({
    sql: "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    args: [key, JSON.stringify(value)],
  });
}

export function normaliser(s: string): string {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}
