#!/usr/bin/env node
// De to admin-filene som manglet: api.js og App.jsx.
//
// Det forrige scriptet avbrøt i admin-delen etter at backend var skrevet,
// og etterlot halve jobben gjort. Denne gjør bare resten — og hvis et anker
// ikke treffer, skriver den ut hvordan linjene faktisk ser ut hos deg i
// stedet for å bare si at den ga opp.
//
//   node fiks-admin.mjs
//
// Idempotent. Skriver backup som .bak.<tidsstempel>.

import { readFileSync, writeFileSync, existsSync, copyFileSync } from "node:fs";
import { join } from "node:path";

const ROT = existsSync("admin/src/App.jsx")
  ? "."
  : existsSync("korthaien-kjop/admin/src/App.jsx")
    ? "korthaien-kjop"
    : null;

if (!ROT) {
  console.error("Fant ikke admin/src/App.jsx. Kjør fra /workspaces/Korthaien eller korthaien-kjop/.");
  process.exit(1);
}

const STEMPEL = new Date().toISOString().replace(/[:.]/g, "-");
let endret = 0;

const les = (rel) => readFileSync(join(ROT, rel), "utf8");

function skriv(rel, innhold) {
  const p = join(ROT, rel);
  copyFileSync(p, `${p}.bak.${STEMPEL}`);
  writeFileSync(p, innhold);
  endret++;
}

// Viser hvordan fila faktisk ser ut der ankeret skulle vært, så en bom kan
// rettes uten enda en runde fram og tilbake.
function visLinjer(rel, ord) {
  console.error(`  Linjene i ${rel} som nevner «${ord}»:`);
  const linjer = les(rel).split(/\r?\n/);
  let funnet = 0;
  linjer.forEach((l, i) => {
    if (l.toLowerCase().includes(ord.toLowerCase())) {
      console.error(`    ${String(i + 1).padStart(4)}: ${JSON.stringify(l)}`);
      funnet++;
    }
  });
  if (!funnet) console.error("    (ingen)");
}

// ── api.js ───────────────────────────────────────────────────────────────────
{
  const rel = "admin/src/api.js";
  const s = les(rel);
  if (s.includes("kuppVakteliste")) {
    console.log("– api.js: allerede på plass");
  } else {
    const m = s.match(/^([ \t]*)lagerrapport:[^\n]*$/m);
    if (!m) {
      console.error("! api.js: fant ingen linje som begynner med «lagerrapport:».");
      visLinjer(rel, "lagerrapport");
      process.exit(1);
    }
    const sp = m[1];
    const tillegg = [
      "kupp: ({ minAvvik = 0, visBorte = false } = {}) =>",
      "  kall(`/api/admin/kupp?minAvvik=${minAvvik}&visBorte=${visBorte ? 1 : 0}`),",
      'kuppVakteliste: () => kall("/api/admin/kupp/vakteliste"),',
      "settKuppOppsett: (endringer) =>",
      '  kall("/api/admin/kupp/oppsett", { method: "POST", body: endringer }),',
    ]
      .map((l) => sp + l)
      .join("\n");
    skriv(rel, s.slice(0, m.index + m[0].length) + "\n" + tillegg + s.slice(m.index + m[0].length));
    console.log("✓ api.js: kupp, kuppVakteliste og settKuppOppsett");
  }
}

// ── App.jsx ──────────────────────────────────────────────────────────────────
{
  const rel = "admin/src/App.jsx";
  let s = les(rel);
  if (s.includes("import Kupp from")) {
    console.log("– App.jsx: allerede på plass");
  } else {
    const mangler = [];

    // 1. importen
    let m = s.match(/^import Lagerrapport from [^\n]*$/m);
    if (m) {
      const i = m.index + m[0].length;
      s = s.slice(0, i) + '\nimport Kupp from "./views/Kupp.jsx";' + s.slice(i);
    } else mangler.push("import-linjen for Lagerrapport");

    // 2. menyvalget
    m = s.match(/^([ \t]*)\{\s*id:\s*["']lagerrapport["'][^\n]*$/m);
    if (m) {
      const i = m.index + m[0].length;
      s = s.slice(0, i) + `\n${m[1]}{ id: "kupp", navn: "Kupp" },` + s.slice(i);
    } else mangler.push("menylinjen med id lagerrapport");

    // 3. visningen. I stedet for å gjette hvilke props linjen har — og hva
    // feilbehandleren heter — kopieres hele linjen og navnene byttes ut.
    // Første forsøk brukte \w for navnet, og \w matcher ikke å i håndterFeil.
    m = s.match(/^([ \t]*)\{side === ["']lagerrapport["'] && <Lagerrapport[^\n]*$/m);
    if (m) {
      const kopi = m[0].replace(/["']lagerrapport["']/, '"kupp"').replace(/<Lagerrapport\b/, "<Kupp");
      const i = m.index + m[0].length;
      s = s.slice(0, i) + "\n" + kopi + s.slice(i);
    } else mangler.push("linjen som viser <Lagerrapport>");

    if (mangler.length) {
      console.error(`! App.jsx: fant ikke ${mangler.join(", ")}.`);
      visLinjer(rel, "lagerrapport");
      console.error("\n  Ingenting er skrevet. Send utskriften over, så retter jeg ankeret.");
      process.exit(1);
    }
    skriv(rel, s);
    console.log("✓ App.jsx: import, menyvalg og visning");
  }
}

console.log(`\n${endret} filer endret.`);
if (endret) console.log(`Backup: *.bak.${STEMPEL}`);
console.log("\nSjekk:  grep -n Kupp korthaien-kjop/admin/src/App.jsx korthaien-kjop/admin/src/api.js");
