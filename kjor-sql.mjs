#!/usr/bin/env node
// Kjører en .sql-fil mot basen gjennom appens egen tilkobling, så du slipper
// både Turso-CLI og innliming i dashbordet.
//
//   npx tsx kjor-sql.mjs del1.sql
//
// Filen må inneholde ÉN setning (kommentarlinjer er greit). Delfilene fra
// manuelle-koblinger.sql er laget sånn.
//
// Leser .env selv, siden scriptet ikke går gjennom serveren som vanligvis
// gjør det.

import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const ROT = existsSync("src/db.ts")
  ? "."
  : existsSync("korthaien-kjop/src/db.ts")
    ? "korthaien-kjop"
    : null;

if (!ROT) {
  console.error("Fant ikke src/db.ts. Kjør fra /workspaces/Korthaien eller korthaien-kjop/.");
  process.exit(1);
}

// Enkel .env-leser. Ingen avhengigheter, og den rører ikke variabler som
// allerede er satt i miljøet.
for (const sti of [join(ROT, ".env"), ".env"]) {
  if (!existsSync(sti)) continue;
  for (const linje of readFileSync(sti, "utf8").split(/\r?\n/)) {
    const m = linje.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}

const fil = process.argv[2];
if (!fil) {
  console.error("Bruk: npx tsx kjor-sql.mjs <fil.sql>");
  process.exit(1);
}

const rå = readFileSync(resolve(fil), "utf8");
// Kommentarlinjer fjernes. De står alltid alene i disse filene, så det er
// nok å droppe linjer som begynner med --.
const sql = rå
  .split(/\r?\n/)
  .filter((l) => !/^\s*--/.test(l))
  .join("\n")
  .trim()
  .replace(/;\s*$/, "");

if (!sql) {
  console.error("Filen inneholder ingen SQL.");
  process.exit(1);
}

const { db } = await import(resolve(ROT, "src/db.ts"));
const r = await db().execute(sql);

if (r.rows?.length) {
  console.table(r.rows.map((x) => ({ ...x })));
  console.log(`${r.rows.length} rader.`);
} else if (r.rowsAffected) {
  console.log(`${r.rowsAffected} rader skrevet.`);
} else {
  console.log("Ingen rader. (For en kontrollspørring betyr det at alt er i orden.)");
}
process.exit(0);
