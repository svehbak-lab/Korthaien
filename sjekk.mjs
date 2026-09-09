#!/usr/bin/env node
// Sjekker at alle filene fra alle pakkene faktisk ligger inne, og at de er
// den versjonen som gjelder nå. Kjøres fra repo-rota:  node sjekk.mjs
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";

const FASIT = {
  "korthaien-kjop/admin/src/api.js": "c0b65f805b24a1b8",
  "korthaien-kjop/admin/src/views/Innstillinger.jsx": "d723a2cae4b1eb1b",
  "korthaien-kjop/admin/src/views/Kort.jsx": "9374dfefd6b684fa",
  "korthaien-kjop/admin/src/views/Ordrer.jsx": "0c8710acf1837d0d",
  "korthaien-kjop/kunde/src/App.jsx": "76f964271568c0c0",
  "korthaien-kjop/kunde/src/api.js": "87b364182812c1cd",
  "korthaien-kjop/kunde/src/styles.css": "28532d79a2c33b33",
  "korthaien-kjop/kunde/src/views/Bulk.jsx": "af6fb36770506769",
  "korthaien-kjop/kunde/src/views/Kasse.jsx": "78d457d86e58f40c",
  "korthaien-kjop/kunde/src/views/Oppslag.jsx": "da59e44011fc6385",
  "korthaien-kjop/kunde/src/views/Sok.jsx": "2827a5bd94219928",
  "korthaien-kjop/package.json": "ce8920d5363b8a69",
  "korthaien-kjop/src/bulk.ts": "d1877086e573db2a",
  "korthaien-kjop/src/catalog.ts": "3314e48656feb5b0",
  "korthaien-kjop/src/cli.ts": "18b88728496bf9bb",
  "korthaien-kjop/src/db.ts": "ec06fb0d7c6d9513",
  "korthaien-kjop/src/hvorfor.ts": "71b5c3de84fb1163",
  "korthaien-kjop/src/orders.ts": "44a511134f4fce68",
  "korthaien-kjop/src/pricing.ts": "7940cf4af6637b8a",
  "korthaien-kjop/src/schema.sql": "f7ec4e5596c054f0",
  "korthaien-kjop/src/server.ts": "ba6cd9c4ec247ca3",
  "korthaien-kjop/test/bulkformat.test.mjs": "c7fca2397dd219c6",
  "korthaien-kjop/test/kjerne.test.mjs": "0dcb95cc5387b8dd",
  "korthaien-kjop/test/kodelekkasje.test.mjs": "db0875f5f90d46d0",
  "korthaien-kjop/test/manuellpris.test.mjs": "e2a774ce2da2419e",
  "korthaien-kjop/test/oppgjor.test.mjs": "b45b20c42a418cd4",
  "korthaien-kjop/test/ore.test.mjs": "4b184edd6be07a63",
  "korthaien-kjop/test/settandel.test.mjs": "504d47b1ab72018d"
};

let mangler = 0, feil = 0, ok = 0;
for (const [sti, sum] of Object.entries(FASIT)) {
  if (!existsSync(sti)) {
    console.log("MANGLER  " + sti);
    mangler++;
    continue;
  }
  const nå = createHash("sha256").update(readFileSync(sti)).digest("hex").slice(0, 16);
  if (nå === sum) ok++;
  else {
    console.log("UTDATERT " + sti);
    feil++;
  }
}

console.log(`\n${ok} av ${Object.keys(FASIT).length} filer er riktige.`);
if (mangler) console.log(`${mangler} mangler helt.`);
if (feil) console.log(`${feil} er en annen versjon enn den siste.`);
if (!mangler && !feil) console.log("Alle pakkene er kjørt. Ingenting mangler.");
