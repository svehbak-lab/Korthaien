# Settfamilier

## Installer

```
node oppdater.mjs
cd korthaien-kjop
npm run sett
npm run mystore
```

`npm run sett` henter bare settlista og tar sekunder. Ingen ny kortimport
trengs — de 105 000 kortene ligger allerede riktig.

## Hva analysen viste

Fire av de fem gruppene var samme problem: Scryfall splitter én utgivelse i
flere sett.

| Din kategori | Scryfall-settene |
|---|---|
| Strixhaven | `stx` + `sta` (Mystical Archive) + `astx` (Art Series) |
| The Brothers' War | `bro` + `brr` (Retro Artifacts) + `brc` (Commander) + `abro` |
| March of the Machine | `mom` + `mul` (Multiverse Legends) + `mat` |

Tallene bekreftet det: STX hadde 98 % av navnene i `sta`, BRO 61 % i `brr`,
MOM 54 % i `mul`. Det var aldri feilkoblinger — bare bonusark som Scryfall
regner som egne sett, mens butikken din holder dem samlet.

Kategoriene dine er altså riktige. Det er oppslaget som var for smalt.

## Hva som er endret

Synken søker nå i hele familien: hovedsettet pluss alle sett som peker på det
gjennom Scryfalls `parent_set_code`. Ved likhet vinner hovedsettet, deretter
eldste barn.

Familiene vedlikeholdes ikke for hånd. Scryfall oppgir forelderen selv, så
kommende utgivelser med bonusark virker uten oppsett.

## Overlappsadvarslene løser seg selv

Analysen advarte om at 324 navn fantes i flere sett. De aller fleste av dem
var `plst` (The List) og `sld` (Secret Lair Drop), som inneholder reprints fra
hele Magics historie.

De er ikke barn av noe hovedsett, så de faller utenfor familiesøket
automatisk. Det er riktig: et Strixhaven-kort i butikken din er et
Strixhaven-kort, ikke en tilfeldig List-reprint med samme navn.

## To du må rette selv

CMB1 og SPG er ekte feilkoblinger, ikke familier.

CMB1 viste 714 av 714 i The List, og Mystery Booster dukket ikke opp i det
hele tatt. Kategorien din inneholder altså The List-kort. SPG peker mot Time
Spiral. Begge rettes i Kobling-fanen — én kategori hver, og alle produktene
følger med.

Kjør `npm run analyser cmb1 spg` etter synken for å se om tallene har endret
seg først.

## Testet

Fem tester: at kort fra bonusark finnes under hovedsettet, at hovedsettets
egne kort fortsatt finnes, at The List ikke forstyrrer selv når navnet
kolliderer, at kort utenfor familien ikke gir treff, og at sett uten barn
oppfører seg som før.
