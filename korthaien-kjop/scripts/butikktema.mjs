// ─────────────────────────────────────────────────────────────────────────────
// BUTIKKENS TEMA TIL SALGSSIDEN
// ─────────────────────────────────────────────────────────────────────────────
// Salgssiden (kunde/) skal se ut som butikken: samme topp, samme bunn, samme
// farger og skrifter i det temaet som er valgt under Admin → Utseende.
//
// Temaene bor i admin/src/styles.css. I stedet for å kopiere dem for hånd —
// og glemme å kopiere neste gang et tema endres — leses de herfra ved hver
// bygging av salgssiden og skrives til kunde/src/butikktema.css:
//
//   1. Temavariablene: :root, .butikk og .butikk[data-tema="…"], bare
//      linjene som begynner med «--».
//   2. Reglene for toppen og bunnen (.b-linje1, .b-selg, .b-bunn …), med
//      eventuelle @media rundt seg.
//
// .butikk blir .kh, roten på salgssiden. Alt annet i admin blir liggende.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HER = dirname(fileURLToPath(import.meta.url));
const KILDE = join(HER, "..", "admin", "src", "styles.css");
const MÅL = join(HER, "..", "kunde", "src", "butikktema.css");

const css = readFileSync(KILDE, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

// Toppen og bunnen. Ordgrensen på slutten hindrer at .b-selg også tar
// .b-selgx, og at .b-kurv tar .b-kurvbilde om det skulle dukke opp.
const DELER = /\.b-(skall-topp|linje1|linje2|midt|logo|toppsok|hoyre|toppknapp|kurv|kurvikon|kurvnavn|antall|navvalg|selg|selg-tix|selgknapper|bunn|bunnrad|bunnlenke|bunnjus)(?![\w-])/;
const TEMAROT = /^(:root|\.butikk(\[data-tema="[\w-]+"\])?)$/;

// Deler en selektorliste på komma, men ikke kommaene inne i :is(…).
function delSelektorer(s) {
  const ut = [];
  let dybde = 0, start = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "(") dybde++;
    else if (s[i] === ")") dybde--;
    else if (s[i] === "," && dybde === 0) { ut.push(s.slice(start, i).trim()); start = i + 1; }
  }
  ut.push(s.slice(start).trim());
  return ut.filter(Boolean);
}

// Blokkene på ett nivå: { hode, kropp }. @media-kropper parses på nytt.
function blokker(tekst) {
  const ut = [];
  let i = 0;
  while (i < tekst.length) {
    const åpne = tekst.indexOf("{", i);
    if (åpne === -1) break;
    const hode = tekst.slice(i, åpne).trim();
    let dybde = 1, j = åpne + 1;
    while (j < tekst.length && dybde > 0) {
      if (tekst[j] === "{") dybde++;
      else if (tekst[j] === "}") dybde--;
      j++;
    }
    ut.push({ hode, kropp: tekst.slice(åpne + 1, j - 1) });
    i = j;
  }
  return ut;
}

const tilKh = (sel) => sel.replace(/\.butikk(?![\w-])/g, ".kh");

function regel({ hode, kropp }) {
  if (hode.startsWith("@")) return null;
  const sel = delSelektorer(hode);
  // Temavariabler.
  const rot = sel.filter((x) => TEMAROT.test(x));
  if (rot.length) {
    const vars = kropp.split(";").map((d) => d.trim()).filter((d) => d.startsWith("--"));
    if (vars.length) {
      const mål = [...new Set(rot.map((x) => (x === ":root" ? ".kh" : tilKh(x))))];
      return `${mål.join(", ")} {\n  ${vars.join(";\n  ")};\n}`;
    }
  }
  // Toppen og bunnen.
  // .butikk-alene er admin-oppsettet rundt butikken; det har salgssiden ikke.
  const deler = sel.filter((x) => DELER.test(x) && /\.butikk(?![\w-])/.test(x) && !x.includes("butikk-alene"));
  if (deler.length) return `${deler.map(tilKh).join(",\n")} {${kropp}}`;
  return null;
}

const ut = [];
for (const b of blokker(css)) {
  if (b.hode.startsWith("@media")) {
    const indre = blokker(b.kropp).map(regel).filter(Boolean);
    if (indre.length) ut.push(`${b.hode} {\n${indre.join("\n")}\n}`);
  } else {
    const r = regel(b);
    if (r) ut.push(r);
  }
}

writeFileSync(
  MÅL,
  "/* Generert av scripts/butikktema.mjs fra admin/src/styles.css. Ikke rediger her —\n" +
    "   endre butikken, så følger salgssiden med ved neste bygging. */\n\n" +
    ut.join("\n\n") + "\n"
);
console.log(`butikktema.css: ${ut.length} regler fra butikken.`);
