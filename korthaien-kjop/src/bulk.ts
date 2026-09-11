import { db, normaliser, CONDITIONS, type Condition } from "./db.js";

// ─────────────────────────────────────────────────────────────────────────────
// BULKINNLEGGING
// ─────────────────────────────────────────────────────────────────────────────
// Kunden limer inn en liste. Vi tolker antall, navn, eventuell settkode,
// tilstand og finish, og slår opp mot katalogen — men bare blant kort jeg
// faktisk vil ha.
//
// Det viktige: en linje som «4 Lightning Bolt» treffer titalls trykk. Vi
// gjetter aldri. Linjen får status «velg utgave», og kunden må peke på riktig
// trykk med settnavn og bilde foran seg. Bare linjer med nøyaktig ett mulig
// treff løses automatisk.
//
// Formatene folk faktisk limer inn:
//   4 Lightning Bolt                        håndskrevet
//   4x Lightning Bolt                       Archidekt
//   4 Lightning Bolt (M10) 146              Moxfield
//   1 Fable of the Mirror-Breaker (NEO) 144 *F*
//   4 Lightning Bolt [Magic 2010]           settnavn i klamme
//   4<tab>Lightning Bolt<tab>M10<tab>NM     regneark
//   "4","Lightning Bolt","Magic 2010"       CSV-eksport
//   3. Lightning Bolt                       nummerert liste
//   4 stk Lightning Bolt NM
//   Lightning Bolt x4 foil
//   4 Lightning Bolt - Near Mint - kr 12    kopi fra nettbutikk

export type BulkLinje = {
  linje: number;
  rå: string;
  qty: number;
  navn: string;
  settHint: string | null;
  // Et navn i klamme eller parentes som er for langt til å være en kode.
  // Slås opp mot settnavnindeksen senere, der databasen er tilgjengelig.
  settNavnHint: string | null;
  // Et løst ord bakerst som kan være en settkode — men som like gjerne kan
  // være en del av kortnavnet. «Lightning Bolt» ville mistet «Bolt» om vi
  // stolte på det her. Derfor er det bare et forslag: oppslaget prøver hele
  // navnet først, og faller tilbake på dette bare hvis det bommer.
  settGjett: string | null;
  nummerHint: string | null;
  foil: boolean;
  condHint: Condition | null;
  feil?: string;
};

export const MAX_LINJER = 50;

// ── tilstand ─────────────────────────────────────────────────────────────────
// Folk skriver tilstand på engelsk butikkstandard. Skalaen min har fire trinn,
// så flere av dem faller sammen. Vi legger oss alltid på det laveste trinnet
// som passer — å tolke «Lightly Played» som Near Mint ville gitt kunden en for
// høy pris på skjermen og en skuffelse ved mottak.
const COND_ORD: [RegExp, Condition][] = [
  [/^(near\s*mint|nm\s*[-/]?\s*m|nm|mint)$/i, "NM"],
  [/^(lightly\s*played|slightly\s*played|excellent|ex\+?|sp|lp)$/i, "EX"],
  [/^(moderately\s*played|very\s*good|vg\+?|mp|gd)$/i, "VG"],
  [/^(heavily\s*played|damaged|poor|played|good|hp|pl|po|dmg)$/i, "G"],
];

// Enkeltbokstavene M og G er for korte til å skilles fra kortnavn, så de
// godtas bare som eget felt eller aller sist på linjen.
const COND_ALENE: Record<string, Condition> = { m: "NM", g: "G" };

export function tolkCondition(s: string): Condition | null {
  const rent = (s || "").trim().toLowerCase().replace(/[.,;:]+$/, "");
  if (!rent) return null;
  if (COND_ALENE[rent]) return COND_ALENE[rent];
  for (const [re, c] of COND_ORD) if (re.test(rent)) return c;
  return null;
}

const FOIL = /(\*f\*|\bfoils?\b|\bpremium\b|\bholo\b)/i;
const IKKE_FOIL = /(\*n\*|\bnonfoil\b|\bnon-foil\b)/i;

// Overskriftsrader fra regneark og CSV-eksport.
const OVERSKRIFT = /^\s*"?(count|quantity|qty|antall|amount|name|navn|card)"?\s*[,;\t]/i;

// Pris bakerst: «- kr 12,50», «$0.50», «12,50 NOK», «49,-».
const PRISHALE =
  /\s*[-–—|,;]?\s*(?:(?:kr|nok|usd|eur|\$|€|£)\s*\d+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?\s*(?:kr|nok|usd|eur|,-))\s*$/i;

// Klammer med innhold vi ikke bruker: «[Maybeboard{noPrice}]», «(Deck)».
// Slike merkelapper står alltid bakerst, så vi tar resten av linjen med. Å
// telle klammer riktig er ikke verdt det når «{noPrice}» ligger inni «[...]».
const SKROT = /\s*[[({][^[({]*?(maybeboard|sideboard|commander|deck|main(?:board)?|list)[^\n]*$/i;

export function parseBulk(tekst: string): BulkLinje[] {
  const linjer = String(tekst || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !OVERSKRIFT.test(l))
    .slice(0, MAX_LINJER);

  return linjer.map((rå, i) => tolkLinje(rå, i + 1));
}

function tolkLinje(rå: string, nr: number): BulkLinje {
  const r: BulkLinje = {
    linje: nr,
    rå,
    qty: 1,
    navn: "",
    settHint: null,
    settNavnHint: null,
    settGjett: null,
    nummerHint: null,
    foil: false,
    condHint: null,
  };

  const felt = tilFelt(rå);
  // Flere felt betyr regneark eller CSV. Da kjenner vi kolonnene igjen på
  // innholdet, og slipper å gjette ut fra ordstilling.
  let s = felt.length > 1 ? fraFelt(felt, r) : felt[0] || "";

  s = s.replace(SKROT, " ");

  // Foil-markering før alt annet — «*F*» ville ellers blitt spist av
  // opprydding, og «foil» er et ord vi ikke vil ha stående i kortnavnet.
  if (IKKE_FOIL.test(s)) {
    s = s.replace(IKKE_FOIL, " ");
  } else if (FOIL.test(s)) {
    r.foil = true;
    s = s.replace(FOIL, " ");
  }

  s = s.replace(PRISHALE, "");

  // Listemarkør: «- Bolt», «• Bolt», «3. Bolt». Tallet i en nummerert liste er
  // linjenummeret, ikke antallet — «3.» og «3)» leses derfor ikke som tre
  // eksemplarer, mens «3 Bolt» og «3x Bolt» gjør det.
  s = s.replace(/^\s*(?:[-–—*•·]|\d{1,3}[.)])\s+/, "");

  // Settkode eller settnavn i parentes/klamme: «(M10) 146», «[Magic 2010]».
  const iKlamme = s.match(/[([]\s*([^\])]{1,40}?)\s*[)\]]\s*(\d{1,4}[a-z]?)?/);
  // «Bolt (4)» er et antall, ikke et sett. Vi lar det stå og plukkes opp av
  // antallsleddet under.
  if (iKlamme && !/^\d{1,3}$/.test(iKlamme[1].trim())) {
    const inni = iKlamme[1].trim();
    if (/^[A-Za-z0-9]{2,6}$/.test(inni)) r.settHint = inni.toLowerCase();
    else if (inni.length >= 3) r.settNavnHint = inni;
    if (iKlamme[2]) r.nummerHint = iKlamme[2].toLowerCase();
    s = s.replace(iKlamme[0], " ");
  }

  if (!r.condHint) s = trekkUtCondition(s, r);
  s = trekkUtAntall(s, r);

  // Samlernummer bakerst: «#146», eller bare «146» etter navnet.
  const nummer = s.match(/[\s#]+#?(\d{1,4}[a-z]?)\s*$/);
  if (nummer && !r.nummerHint) {
    r.nummerHint = nummer[1].toLowerCase();
    s = s.slice(0, nummer.index);
  }

  const rest = s
    .replace(/\s{2,}/g, " ")
    .replace(/[,;|\s]+$/, "")
    .trim();

  // Et kort ord bakerst kan være en settkode uten parentes. Vi fjerner det
  // ikke fra navnet — bare noterer det som forslag, og lar oppslaget avgjøre.
  const bakerst = rest.match(/\s([A-Za-z0-9]{2,5})$/);
  if (bakerst && !r.settHint) r.settGjett = bakerst[1].toLowerCase();

  r.navn = rest;

  if (!r.navn) r.feil = "Fant ikke noe kortnavn på linjen";
  else if (r.qty < 1) r.feil = "Antall må være minst 1";
  else if (r.qty > 99) r.feil = "Maks 99 av samme kort per linje";

  return r;
}

// ── felt ─────────────────────────────────────────────────────────────────────
// Tabulator og semikolon er trygge skilletegn. Komma er det ikke — «Ragavan,
// Nimble Pilferer» er ett kortnavn. Vi splitter derfor bare på komma når
// linjen ser ut som en CSV-rad: feltene står i anførselstegn, eller det første
// feltet er et tall og det er minst to komma.
function tilFelt(rå: string): string[] {
  const s = rå;
  if (/[\t;]/.test(s)) return del(s, /[\t;]/);
  if (/^\s*"[^"]*"\s*,/.test(s)) return del(s, /,/);
  if ((s.match(/,/g) || []).length >= 2 && /^\s*\d{1,3}\s*,/.test(s)) return del(s, /,/);
  return [s.trim()];
}

function del(s: string, skille: RegExp): string[] {
  return s
    .split(skille)
    .map((f) => f.trim().replace(/^"|"$/g, "").trim())
    .filter(Boolean);
}

// Kolonnene kommer i ulik rekkefølge fra ulike kilder, så vi kjenner dem igjen
// på innholdet i stedet for på plassen: rene tall er antall, en kjent tilstand
// er tilstand, og feltet med flest bokstaver er kortnavnet.
function fraFelt(felt: string[], r: BulkLinje): string {
  const rest: string[] = [];
  let taltAntall = false;
  for (const f of felt) {
    if (!taltAntall && !rest.length && /^\d{1,3}$/.test(f)) {
      r.qty = parseInt(f, 10);
      taltAntall = true;
      continue;
    }
    const c = tolkCondition(f);
    if (c && !r.condHint) {
      r.condHint = c;
      continue;
    }
    if (/^(foil|ja|yes|true)$/i.test(f) && rest.length) {
      r.foil = true;
      continue;
    }
    rest.push(f);
  }
  if (!rest.length) return "";

  let navnIdx = 0;
  for (let i = 1; i < rest.length; i++) {
    if (bokstaver(rest[i]) > bokstaver(rest[navnIdx])) navnIdx = i;
  }
  for (let i = 0; i < rest.length; i++) {
    if (i === navnIdx) continue;
    const f = rest[i];
    if (/^\d{1,4}[a-z]?$/i.test(f) && !r.nummerHint) r.nummerHint = f.toLowerCase();
    else if (/^[A-Za-z0-9]{2,6}$/.test(f) && !r.settHint) r.settHint = f.toLowerCase();
    else if (f.length >= 3 && !r.settNavnHint) r.settNavnHint = f;
  }
  return rest[navnIdx];
}

const bokstaver = (s: string) => (s.match(/[A-Za-zÆØÅæøå]/g) || []).length;

// ── deler av en enkelt streng ────────────────────────────────────────────────
function trekkUtCondition(s: string, r: BulkLinje): string {
  // Bare bakerst, og bare når ordet står for seg selv. «Good-Fortune Unicorn»
  // skal ikke miste halve navnet fordi «Good» også er en tilstand.
  const bak = s.match(
    /[\s,;|/-]+((?:near\s*mint|lightly\s*played|slightly\s*played|moderately\s*played|heavily\s*played|very\s*good|[A-Za-z]{1,3})\+?)\s*$/i
  );
  if (!bak) return s;
  const c = tolkCondition(bak[1]);
  if (!c) return s;
  const uten = s.slice(0, bak.index).trim();
  // Blir det ikke noe navn igjen, var det ikke en tilstand likevel.
  if (uten.length < 2) return s;
  r.condHint = c;
  return uten;
}

function trekkUtAntall(s: string, r: BulkLinje): string {
  // Foran: «4 Bolt», «4x Bolt», «4 x Bolt», «4 stk Bolt».
  const foran = s.match(/^\s*(\d{1,3})\s*(?:[xX*]|stk|pcs)?\s+/);
  if (foran) {
    r.qty = parseInt(foran[1], 10);
    return s.slice(foran[0].length);
  }
  // «4x Bolt» uten mellomrom etter x.
  const tett = s.match(/^\s*(\d{1,3})[xX]\s*/);
  if (tett) {
    r.qty = parseInt(tett[1], 10);
    return s.slice(tett[0].length);
  }
  // Bak: «Bolt x4», «Bolt (4)».
  const bak = s.match(/[\s,]+[xX*]\s*(\d{1,3})\s*$/) || s.match(/\s+\((\d{1,3})\)\s*$/);
  if (bak) {
    r.qty = parseInt(bak[1], 10);
    return s.slice(0, bak.index);
  }
  return s;
}

// ── oppslag mot katalogen ────────────────────────────────────────────────────
export type Kandidat = {
  card_id: string;
  name: string;
  set_code: string;
  set_name: string;
  collector_number: string | null;
  rarity: string | null;
  image_uri: string | null;
  usd: number | null;
  usd_foil: number | null;
  has_foil: boolean;
  has_nonfoil: boolean;
  er_token: boolean;
  released_at: string | null;
};

const VELG = `SELECT c.id AS card_id, c.name, c.set_code, COALESCE(s.visningsnavn, s.name) AS set_name,
                     c.collector_number, c.rarity, c.image_uri, c.usd, c.usd_foil,
                     c.has_foil, c.has_nonfoil, c.er_token, c.released_at
                FROM cards c LEFT JOIN sets s ON s.code = c.set_code
               WHERE c.er_token = 0`;

export async function finnKandidater(
  navn: string,
  settHint: string | null,
  nummerHint: string | null
): Promise<Kandidat[]> {
  const norm = normaliser(navn);
  if (!norm) return [];

  const args: any[] = [norm, norm, norm];
  let sql = `${VELG} AND (c.name_norm = ? OR c.front_norm = ? OR c.back_norm = ?)`;
  if (settHint) {
    sql += " AND c.set_code = ?";
    args.push(settHint);
  }
  if (nummerHint) {
    sql += " AND lower(c.collector_number) = ?";
    args.push(nummerHint);
  }
  sql += " ORDER BY c.released_at DESC LIMIT 60";

  let r = await db().execute({ sql, args });

  // Samlernummeret er det som oftest er feil — folk skriver nummeret fra et
  // annet trykk. Settet stemmer som regel, så vi slipper nummeret først.
  if (r.rows.length === 0 && nummerHint && settHint) {
    r = await db().execute({
      sql: `${VELG} AND (c.name_norm = ? OR c.front_norm = ? OR c.back_norm = ?)
                     AND c.set_code = ? ORDER BY c.released_at DESC LIMIT 60`,
      args: [norm, norm, norm, settHint],
    });
  }

  // Settkoden kan være ukjent — en butikkode som ikke finnes hos Scryfall,
  // for eksempel. Da er navnet mer å stole på enn hintet.
  if (r.rows.length === 0 && settHint) {
    r = await db().execute({
      sql: `${VELG} AND (c.name_norm = ? OR c.front_norm = ? OR c.back_norm = ?)
             ORDER BY c.released_at DESC LIMIT 60`,
      args: [norm, norm, norm],
    });
  }

  // Ingen eksakt navnetreff — prøv prefiks, så kunden slipper å skrive
  // «Ragavan, Nimble Pilferer» i sin helhet.
  if (r.rows.length === 0 && !settHint) {
    r = await db().execute({
      sql: `${VELG} AND (c.name_norm LIKE ? OR c.front_norm LIKE ? OR c.back_norm LIKE ?)
             ORDER BY c.released_at DESC LIMIT 60`,
      args: [norm + "%", norm + "%", norm + "%"],
    });
  }

  return r.rows.map(radTilKandidat);
}

export function radTilKandidat(x: any): Kandidat {
  return {
    card_id: String(x.card_id),
    name: String(x.name),
    set_code: String(x.set_code),
    set_name: String(x.set_name || x.set_code),
    collector_number: x.collector_number ? String(x.collector_number) : null,
    rarity: x.rarity ? String(x.rarity) : null,
    image_uri: x.image_uri ? String(x.image_uri) : null,
    usd: x.usd === null ? null : Number(x.usd),
    usd_foil: x.usd_foil === null ? null : Number(x.usd_foil),
    has_foil: !!Number(x.has_foil),
    has_nonfoil: !!Number(x.has_nonfoil),
    er_token: !!Number(x.er_token),
    released_at: x.released_at ? String(x.released_at) : null,
  };
}

export { CONDITIONS };
