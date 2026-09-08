#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// KORTHAIEN KJØP — kundesiden
// ─────────────────────────────────────────────────────────────────────────────
// Kjøres fra rota av Korthaien-repoet:
//     node oppdater.mjs
//
// Legger til korthaien-kjop/kunde/ og retter tre ting i backend.
// Idempotent, tar .bak av alt den endrer.
// Angre:  node oppdater.mjs --angre

import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, readdirSync, unlinkSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const HER = dirname(fileURLToPath(import.meta.url));
const ROT = process.cwd();
const ANGRE = process.argv.includes("--angre");

const g = (s) => `\x1b[32m${s}\x1b[0m`;
const gul = (s) => `\x1b[33m${s}\x1b[0m`;
const r = (s) => `\x1b[31m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const hash = (b) => createHash("sha256").update(b).digest("hex");

function sjekkRepo() {
  const pkgSti = join(ROT, "korthaien-kjop", "package.json");
  if (!existsSync(pkgSti)) {
    console.error(r("✗ Fant ikke korthaien-kjop/package.json her."));
    console.error(dim(`  Du står i: ${ROT}`));
    console.error(dim("  Kjør scriptet fra rota av Korthaien-repoet, ikke inne i korthaien-kjop."));
    process.exit(1);
  }
  if (JSON.parse(readFileSync(pkgSti, "utf8")).name !== "korthaien-kjop") {
    console.error(r("✗ korthaien-kjop/package.json ser ikke riktig ut."));
    process.exit(1);
  }
}

function angre() {
  let n = 0;
  const gå = (kat) => {
    for (const e of readdirSync(kat, { withFileTypes: true })) {
      const sti = join(kat, e.name);
      if (e.isDirectory()) {
        if (["node_modules", ".git", "dist"].includes(e.name)) continue;
        gå(sti);
      } else if (e.name.endsWith(".bak")) {
        copyFileSync(sti, sti.slice(0, -4));
        unlinkSync(sti);
        console.log(`${g("↩")} ${dim(relative(ROT, sti.slice(0, -4)))}`);
        n++;
      }
    }
  };
  gå(ROT);
  console.log(n ? `\n${g("✓")} ${n} fil(er) tilbakestilt.` : gul("Ingen .bak-filer å gjenopprette."));
  console.log(dim("Mappen korthaien-kjop/kunde/ ble ikke slettet — fjern den selv om du vil."));
}

const tall = { ny: 0, endret: 0, uendret: 0 };

function skriv(relSti, innhold) {
  const mål = join(ROT, relSti);
  if (existsSync(mål)) {
    if (hash(readFileSync(mål)) === hash(Buffer.from(innhold))) {
      tall.uendret++;
      return;
    }
    const bak = mål + ".bak";
    if (!existsSync(bak)) copyFileSync(mål, bak);
    writeFileSync(mål, innhold);
    console.log(`${g("✎")} ${relSti}`);
    tall.endret++;
    return;
  }
  mkdirSync(dirname(mål), { recursive: true });
  writeFileSync(mål, innhold);
  console.log(`${g("+")} ${relSti}`);
  tall.ny++;
}

// filer/ speiler mappestrukturen i repoet, så vi kopierer tre til tre.
function speil(fraKat, tilRel) {
  for (const e of readdirSync(fraKat, { withFileTypes: true })) {
    const fra = join(fraKat, e.name);
    if (e.isDirectory()) speil(fra, join(tilRel, e.name));
    else skriv(join(tilRel, e.name), readFileSync(fra, "utf8"));
  }
}

sjekkRepo();

if (ANGRE) {
  angre();
  process.exit(0);
}

console.log(`\n  Korthaien Kjøp — settfamilier`);
console.log(dim(`  ${ROT}\n`));

speil(join(HER, "filer"), ".");

console.log(`\n${g("✓")} Ferdig — ${tall.ny} nye, ${tall.endret} endret, ${tall.uendret} uendret.\n`);
console.log("  Så, i denne rekkefølgen:");
console.log(dim("    npm run sett       # henter familiekoblingene, tar sekunder"));
console.log(dim("    npm run mystore    # kobler på nytt med familiene"));
console.log(dim("  Angre:  node oppdater.mjs --angre\n"));
