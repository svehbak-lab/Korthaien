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
  frame?: string;
  frame_effects?: string[];
  finishes?: string[];
  full_art?: boolean;
  textless?: boolean;
  released_at?: string;
}): Variant {
  const rammer = new Set(k.frame_effects || []);
  if (rammer.has("etched") || (k.finishes || []).includes("etched")) return "etched";
  if (k.border_color === "borderless") return "borderless";
  if (rammer.has("showcase")) return "showcase";
  if (rammer.has("extendedart")) return "extended";
  if (rammer.has("shatteredglass")) return "showcase";
  // Retrorammen er ikke en frame_effect hos Scryfall — den finnes ikke i den
  // listen i det hele tatt. Den er `frame: "1997"`, den klassiske rammen fra
  // Mirage, brukt på et kort utgitt lenge etter at den moderne rammen kom i
  // 2003. Et ekte 1997-kort er ingen variant, det er bare gammelt, så det er
  // utgivelsesdatoen som skiller de to.
  //
  // Uten denne linjen kunne funksjonen aldri returnere "retro", mens
  // produktnavnet «(Retro Frame)» gjorde det hver gang. De to sidene kunne
  // ikke møtes, og retroproduktene kolliderte med grunnkortene sine fra
  // første synk.
  if (k.frame === "1997" && (k.released_at || "") >= "2004-01-01") return "retro";
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
  return { navn: m[1].trim(), nummer: normaliserNummer(m[2] + (m[3] || "")) };
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

// ── nummer i parentes ────────────────────────────────────────────────────────
// Matcheren kastet parentesene før den lette etter samlernummeret, og da var
// nummeret allerede borte: «Zombie Army Token (009)» ble «Zombie Army Token»,
// «Swamp (0277)» ble «Swamp». Produktet med nummer og produktet uten ble
// identiske, begge landet på samme kort, og det andre havnet som uløst.
//
// Derfor leses nummeret ut av parentesen først, på samme måte som varianten.
//
// Formene som faktisk finnes i butikken:
//   (009)            token nummerert med ledende nuller
//   (#297)           firkanttegn foran
//   (250 A)          nummer og bokstav, gamle basic lands
//   (333 - Manga)    nummer med en kvalifikator etter
//
// Og like viktig, formene som IKKE er numre og må gå klar:
//   (Extended Art)  (FOIL)  (Bound/Determined)  (Not Tournament Legal)
// Derfor er mønsteret forankret i begge ender. Begynner innholdet med noe
// annet enn et tall, er det ikke et nummer.
// Etter tallet kan det stå én bokstav — da er den en del av nummeret,
// som på gamle basic lands: «(250 A)» er samlernummer 250a. Står det noe
// annet, er det en beskrivelse: «(#371 Mothra, Supersonic Queen)» er
// nummer 371, og resten er kortets alternative navn.
//
// Skillet er «én bokstav og så slutt» mot «hva som helst etter et
// skilletegn». Uten det andre alternativet mistet hele Godzilla-serien i
// Ikoria nummeret sitt og ble koblet på navn i stedet.
const I_PARENTES = /^#?\s*(\d{1,4})(?:\s*([a-z]))?(?:\s*[-–—\s].*)?$/i;

// Scryfall skriver «16», butikken skriver «0016». Uten dette sammenligner vi
// to skrivemåter av samme tall og får aldri treff.
export function normaliserNummer(n: string): string {
  return n.toLowerCase().replace(/^0+(?=\d)/, "");
}

// Første parentes som inneholder et nummer og ikke noe annet. Et navn kan ha
// flere — «Forest (#297) (Retro Frame)» — og bare den ene er et nummer.
export function nummerFraParentes(navn: string): string | null {
  for (const m of navn.matchAll(/\(([^)]*)\)/g)) {
    const t = m[1].trim();
    const n = t.match(I_PARENTES);
    if (n) return normaliserNummer(n[1] + (n[2] || ""));
  }
  return null;
}

// ── oppgitt behandling ───────────────────────────────────────────────────────
// Butikken og Scryfall bruker ulike ord om samme kort. «Shao Jun (Showcase)»
// i Assassin's Creed er `borderless` hos Scryfall — settet har ikke et eneste
// kort med varianten `showcase`. Produktet og kortet kan altså være enige om
// at dette ikke er standardutgaven, og likevel ikke finne hverandre.
//
// Derfor spør vi ikke hva ordet betyr, bare om det er der. Står det noe i
// parentesen som ikke er foilmerking eller et nummer, sier produktet at dette
// er en annen utgave enn grunnkortet — og da er grunnkortet feil svar,
// uansett hvilket ord butikken bruker.
//
// Det gjør regelen uavhengig av ordlister som aldri blir ferdige: Promo Pack,
// Prerelease Foil, Schematic Art og hva de nå finner på neste gang.
export function oppgirBehandling(navn: string): boolean {
  for (const m of navn.matchAll(/\(([^)]*)\)/g)) {
    const t = m[1].trim();
    if (!t) continue;
    // Splittkort gjentar hele navnet i parentes: «Determined
    // (Bound/Determined)». Det er en opplysning om kortet, ikke en utgave.
    if (t.includes("/")) continue;
    // «(009)», «(#297)», «(250 A)» — samlernummer, håndteres et annet sted.
    if (I_PARENTES.test(t)) continue;
    // «(Foil)», «(FOIL)», «(Non-foil)» — finish, ikke utgave.
    // «(Not Tournament Legal)» og «(Oversized)» sier hva slags sett kortet er
    // fra — Collector's Edition, World Championship Decks, Vanguard — ikke at
    // det er en annen utgave i settet. Der er kortet grunnutgaven.
    const rest = t
      .replace(/\bnon[\s-]?foil\b/gi, "")
      .replace(/\bfoil\b/gi, "")
      .replace(/\bnot\s*tournament\s*legal\b/gi, "")
      .replace(/\boversized\b/gi, "")
      .replace(/[,\s]+/g, "");
    if (!rest) continue;
    return true;
  }
  return false;
}

// ── displaykort ──────────────────────────────────────────────────────────────
// «Display Commander» er en egen utgave: den tykke displayversjonen av
// commanderen, som Scryfall merker «thick». Produktet skal kobles dit og
// ingen andre steder. Uten dette gjaldt den vanlige regelen — navnet oppgir
// en behandling, så velg en annen utgave enn grunnkortet — og «The Wise
// Mothman (Display Commander)» landet på Pip-Boy-showcasen #343.
export function erDisplayProdukt(navn: string): boolean {
  return /\bdisplay\s*commanders?\b/i.test(navn);
}

// Scroll-showcase er en egen utgave (promo-typen «scroll» hos Scryfall), men
// har samme variant som vanlig showcase. Produktet må si «scroll» for å
// kobles dit; ellers skal det aldri havne der.
export function erScrollProdukt(navn: string): boolean {
  return /\bscroll\b/i.test(navn);
}

// Utgaven i klartekst, til plukkliste og ordrebekreftelse. Tom for vanlige
// kort. Uten den sto Gandalf the Grey bare som «#322», og showcase,
// scroll-showcase og vanlig så like ut når kortene skulle plukkes.
const UTGAVE: Record<string, string> = {
  extended: "Extended Art", borderless: "Borderless", showcase: "Showcase",
  retro: "Retro Frame", etched: "Etched", fullart: "Full Art",
};
export function utgaveNavn(k: { variant?: unknown; er_scroll?: unknown; er_display?: unknown }): string {
  if (Number(k.er_display)) return "Display Commander";
  const v = UTGAVE[String(k.variant || "")] || "";
  return Number(k.er_scroll) ? (v === "Showcase" ? "Scroll Showcase" : `${v} Scroll`.trim()) : v;
}
