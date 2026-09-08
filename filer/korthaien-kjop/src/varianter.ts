// ─────────────────────────────────────────────────────────────────────────────
// VARIANTER
// ─────────────────────────────────────────────────────────────────────────────
// Scryfall gir hver versjon av et kort sin egen rad med eget samlernummer og
// egen pris. «Bold Plagiarist» i Commander Legends finnes som nr. 40 (vanlig)
// og nr. 641 (extended art). Butikken har begge som separate produkter, men
// skiller dem med et tilleggsord i navnet: «Bold Plagiarist (Extended Art)».
//
// Uten variantmatching tar oppslaget én av radene vilkårlig. Da kan et kort
// som teller som koblet ligge på feil versjon med feil pris — og ingenting
// varsler om det, siden koblingen ser vellykket ut.

export type Variant = "vanlig" | "extended" | "borderless" | "showcase" | "retro" | "etched" | "fullart";

// Fra Scryfall. Rekkefølgen betyr noe: et kort kan ha flere kjennetegn
// samtidig, og vi vil ha det mest spesifikke.
export function variantFraScryfall(k: {
  border_color?: string;
  frame_effects?: string[];
  finishes?: string[];
  full_art?: boolean;
  textless?: boolean;
}): Variant {
  const rammer = new Set(k.frame_effects || []);
  if (rammer.has("etched") || (k.finishes || []).includes("etched")) return "etched";
  if (k.border_color === "borderless") return "borderless";
  if (rammer.has("showcase")) return "showcase";
  if (rammer.has("extendedart")) return "extended";
  if (rammer.has("legendary") && k.border_color === "borderless") return "borderless";
  // Retro-rammen brukes for gamle kortdesign i nye sett, f.eks. Retro
  // Artifacts i The Brothers' War.
  if (rammer.has("showcase") || k.frame_effects?.includes("shatteredglass")) return "showcase";
  if (k.full_art) return "fullart";
  return "vanlig";
}

// Fra butikkens produktnavn. Tilleggsordet står i parentes, og skrivemåten
// varierer — «Extended Art», «extended art», «Borderless».
const MØNSTRE: [RegExp, Variant][] = [
  [/\bextended\s*art\b/i, "extended"],
  [/\bborderless\b/i, "borderless"],
  [/\bshowcase\b/i, "showcase"],
  [/\betched\b/i, "etched"],
  [/\bretro(\s*frame)?\b/i, "retro"],
  [/\bfull\s*art\b/i, "fullart"],
];

export function variantFraNavn(navn: string): Variant {
  for (const [re, v] of MØNSTRE) if (re.test(navn)) return v;
  return "vanlig";
}

// Samlernummer lagt inn i navnet: «Island 267», «Mountain 274 (foil)».
// Basic lands finnes i mange like utgaver, og nummeret er det eneste som
// skiller dem — Scryfall kaller dem alle bare «Island».
//
// Vi krever at tallet står sist, etter et ord. «Fire // Ice 220» teller,
// «Ajani's Pridemate» gjør ikke — der er det ingen tall.
const NUMMER_BAK = /^(.*?[a-zæøå])\s+(\d{1,4})([a-z]?)\s*$/i;

export function skillUtNummer(navn: string): { navn: string; nummer: string | null } {
  const m = navn.match(NUMMER_BAK);
  if (!m) return { navn, nummer: null };
  // Et tall som er en del av kortnavnet skal ikke strippes. Kort som slutter
  // på siffer er sjeldne, men de finnes.
  if (/\b(ii|iii|iv|v|vi|vii|viii|ix|x)\s*$/i.test(m[1])) return { navn, nummer: null };
  return { navn: m[1].trim(), nummer: (m[2] + (m[3] || "")).toLowerCase() };
}

// Revised og andre eldre sett skiller basic lands med bokstav: «Swamp A»,
// «Forest B». Scryfall gir dem ulike samlernumre i stigende rekkefølge, så
// bokstaven kan oversettes til en posisjon.
const BOKSTAV_BAK = /^(.*?[a-zæøå])\s+([a-e])\s*$/i;
const BASIC = /^(plains|island|swamp|mountain|forest|wastes)$/i;

export function skillUtBokstav(navn: string): { navn: string; posisjon: number | null } {
  const m = navn.match(BOKSTAV_BAK);
  if (!m) return { navn, posisjon: null };
  const rent = m[1].trim();
  // Bare for basic lands. «Ajani A» ville ellers blitt tolket som variant.
  if (!BASIC.test(rent)) return { navn, posisjon: null };
  return { navn: rent, posisjon: m[2].toLowerCase().charCodeAt(0) - 97 };
}
