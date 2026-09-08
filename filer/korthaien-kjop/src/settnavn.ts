import { normaliser } from "./db.js";

// ─────────────────────────────────────────────────────────────────────────────
// SETTNAVN
// ─────────────────────────────────────────────────────────────────────────────
// Butikken bruker hverdagsnavn, Scryfall bruker offisielle. «Modern Horizon 3»
// mot «Modern Horizons 3», «Forgotten Realms» mot «Adventures in the Forgotten
// Realms», «Alpha» mot «Limited Edition Alpha». Eksakt likhet er derfor
// ubrukelig som eneste regel.
//
// Vi prøver stadig løsere regler, men godtar bare treff som er entydige. To
// mulige sett betyr ingen match — da er det bedre å spørre deg enn å gjette
// feil, for et feilkoblet sett gir feil beholdning på hundrevis av kort.

export type SettRad = { code: string; name: string };
export type Treff = { code: string; name: string; regel: string };

const ORDENSTALL: [RegExp, string][] = [
  [/\b1st\b/g, "first"], [/\b2nd\b/g, "second"], [/\b3rd\b/g, "third"],
  [/\b4th\b/g, "fourth"], [/\b5th\b/g, "fifth"], [/\b6th\b/g, "sixth"],
  [/\b7th\b/g, "seventh"], [/\b8th\b/g, "eighth"], [/\b9th\b/g, "ninth"],
  [/\b10th\b/g, "tenth"],
];

function medOrdenstall(s: string): string {
  let ut = " " + s.toLowerCase() + " ";
  for (const [re, ord] of ORDENSTALL) ut = ut.replace(re, ord);
  return normaliser(ut);
}

// «Horizon» mot «Horizons»: fjerner flertalls-s fra hvert ord.
function utenFlertall(s: string): string {
  return s
    .toLowerCase()
    .split(/\s+/)
    .map((o) => (o.length > 3 && o.endsWith("s") ? o.slice(0, -1) : o))
    .join("");
}

// «Kamigawa: Neon Dynasty» → også søkbar som «Neon Dynasty».
function etterKolon(s: string): string | null {
  const i = s.indexOf(":");
  return i > 0 ? s.slice(i + 1).trim() : null;
}

export function byggIndeks(sett: SettRad[]) {
  return sett.map((s) => ({
    code: s.code.toLowerCase(),
    name: s.name,
    norm: normaliser(s.name),
    ordens: medOrdenstall(s.name),
    flertall: utenFlertall(s.name),
    kolon: etterKolon(s.name) ? normaliser(etterKolon(s.name)!) : null,
  }));
}

export function finnSett(navn: string, indeks: ReturnType<typeof byggIndeks>): Treff | null {
  const n = normaliser(navn);
  if (!n || n.length < 2) return null;
  const nOrdens = medOrdenstall(navn);
  const nFlertall = utenFlertall(navn);

  const regler: [string, (s: (typeof indeks)[number]) => boolean][] = [
    ["eksakt navn", (s) => s.norm === n],
    ["settkode", (s) => s.code === n],
    ["ordenstall", (s) => s.ordens === nOrdens],
    ["entall/flertall", (s) => s.flertall === nFlertall],
    ["etter kolon", (s) => s.kolon === n],
    // Løsest til slutt: navnet ditt er en del av det offisielle navnet.
    // «Alpha» i «Limited Edition Alpha», «6th Edition» i «Classic Sixth
    // Edition». Krever fire tegn, ellers ville «War» truffet et titalls sett.
    // Entydighetskravet over fanger resten.
    ["del av navnet", (s) => n.length >= 4 && s.norm.includes(n)],
    ["del av navnet, ordenstall", (s) => nOrdens.length >= 4 && s.ordens.includes(nOrdens)],
  ];

  for (const [regel, test] of regler) {
    const treff = indeks.filter(test);
    if (treff.length === 1) return { code: treff[0].code, name: treff[0].name, regel };
    // Flere treff på samme regel er tvetydig. Vi går ikke videre til en
    // løsere regel da — den ville bare gitt flere kandidater, ikke færre.
    if (treff.length > 1) return null;
  }
  return null;
}

// Forslag til kategorier som ikke lot seg koble, så du slipper å lete i 988
// sett. Rangert etter hvor mye av navnet som overlapper.
export function foreslå(navn: string, indeks: ReturnType<typeof byggIndeks>, maks = 6): SettRad[] {
  const n = normaliser(navn);
  if (!n || n.length < 3) return [];
  const poeng = indeks
    .map((s) => {
      let p = 0;
      if (s.norm.includes(n) || n.includes(s.norm)) p += 100 - Math.abs(s.norm.length - n.length);
      const ord = navn.toLowerCase().split(/\s+/).filter((o) => o.length > 2);
      for (const o of ord) if (s.norm.includes(normaliser(o))) p += 10;
      return { s, p };
    })
    .filter((x) => x.p > 0)
    .sort((a, b) => b.p - a.p)
    .slice(0, maks);
  return poeng.map((x) => ({ code: x.s.code, name: x.s.name }));
}
