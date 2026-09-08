# Korthaien Kjøp — backend

Innkjøpsside der kunder selger kort til deg mot store credit. Dette er
serverdelen: katalog, priser, kvoter, ordrer og admin-API. Frontend kommer
som neste steg.

## Kom i gang

```bash
npm install
cp .env.eksempel .env      # sett ADMIN_PASSWORD og SESSION_SECRET
npm run seed               # litt testdata så du kan klikke rundt med en gang
npm run dev
```

Serveren svarer på `http://localhost:3000`. `npm test` kjører testene.

Når du er klar for ekte data:

```bash
npm run import     # henter hele Scryfall-katalogen (tar noen minutter)
npm run mystore    # speiler beholdningen din
```

## Hvorfor server, og ikke bare en frontend som KARDEX

KARDEX har API-nøkkelen i nettleseren og regner ut priser på klienten. Det går
an når du er eneste bruker. Her kommer det fremmede inn, og da må pris, kvote
og ordrevalidering skje på server. En kunde som endrer tallene i nettleseren
skal ikke oppnå noe, og Mystore-nøkkelen skal aldri forlate serveren.

## Slik henger det sammen

**Pris.** `usd × kurs × 70 % × condition-prosent`, avrundet til hele kroner.
$5 blir 37 kr i NM med kurs 10,6. Prosentsatsen og kursen settes i admin.

**Condition.** Hvert sett har sin egen liste over hva du tar imot og sin egen
trapp. Beta kan stå på NM og EX, mens resten bare tar NM. En condition uten
sats i trappen gir pris 0 og kjøpes ikke — det er med vilje, for et fallback
til full pris ville betalt Good-kort som Near Mint.

**Kvote.** `ønsket − beholdning i Mystore − reservert i aktive ordrer`. Vil du
ha 8 Invasion-kort og har 2, kan kunden selge deg 6. Antallet settes per sett,
og kan overstyres per kort. Foil arver aldri settets antall, siden det er en
annen vare med helt annen verdi.

**Reservasjon.** En ordre holder kvoten fra den sendes inn til kortene er
lagerført i Mystore. Uten dette kunne to kunder solgt deg det samme siste
eksemplaret. Ordrer som ikke kommer i posten utløper etter 14 dager og
frigjør kvoten automatisk.

Ordreløpet er derfor `pending → received → stocked`. Mottatte ordrer holder
fortsatt på kvoten, fordi Mystore ikke vet om kortene ennå. Først når du
merker dem lagerført overtar beholdningen tellingen.

**Utgavevalg.** En bulklinje som «4 Lightning Bolt» treffer mange trykk.
Systemet gjetter aldri. Linjer med flere mulige utgaver får status `velg`, og
kunden må peke på riktig trykk med settnavn, nummer og bilde foran seg. Bare
linjer med nøyaktig ett mulig treff løses automatisk. Kunden ser dessuten bare
utgaver du faktisk vil ha, så lista er kortere enn den kunne vært.

Bulkparseren takler `4 Bolt`, `4x Bolt`, `Bolt x4`, `Bolt (MH2) 138`,
`Bolt [INV]` og `Bolt foil`. Maks 50 linjer per innliming.

## API

Publikum:

| | |
|---|---|
| `GET /api/sets` | sett du kjøper fra |
| `GET /api/search?q=&set=&rarity=` | søk, kun kort du vil ha |
| `POST /api/bulk` | `{tekst}` → linjer med status og utgavevalg |
| `POST /api/orders` | send inn ordre, får ordrenr og instruksjoner |
| `GET /api/orders/:ordrenr` | kvittering |

Admin (krever innlogging via `POST /api/admin/login`):

| | |
|---|---|
| `GET /api/admin/orders?arkiv=0\|1` | aktive eller arkiverte ordrer |
| `PATCH /api/admin/orders/:id` | status og notat |
| `PATCH /api/admin/lines/:id` | juster antall, pris eller condition ved mottak |
| `GET/PUT /api/admin/sets[/:kode]` | antall, conditions og trapp per sett |
| `GET /api/admin/cards?set=` | alle kort i et sett med ønsket antall og beholdning |
| `PUT /api/admin/cards/:id/want` | overstyr antall for enkeltkort |
| `GET/PUT /api/admin/settings` | kurs, prosent, adresse, utløpsfrist |
| `POST /api/admin/jobs/import\|mystore\|expire` | kjør jobbene manuelt |

## Deploy

`render.yaml` setter opp tre tjenester: web-API, nattlig Scryfall-import og
Mystore-synk hver fjerde time. Databasen er Turso i produksjon og en lokal
fil under utvikling.

Frontend legges på Vercel med `kortsalg.korthaien.no` som domene, og
`CORS_ORIGIN` må peke dit.

## Admin

Ligger i `admin/`. Egen Vite-app som snakker med dette API-et.

```bash
cd admin
npm install
npm run dev        # http://localhost:5173, proxyer /api til port 3000
```

Logg inn med `ADMIN_PASSWORD`. Fire skjermer: ordrer med mottakskontroll,
sett med antall og condition-trapp, enkeltkort, og innstillinger.

**Cookien.** Legger du admin og API på ulike domener (vercel.app mot
onrender.com), er forespørslene «cross-site» og en vanlig sesjonscookie
sendes ikke. Sett `COOKIE_CROSS_SITE=1` da. Bedre er å legge begge under
korthaien.no — `admin.korthaien.no` og `api.korthaien.no` — for da virker
cookien som normalt, og du er upåvirket av at nettlesere stenger
tredjepartscookies.

## Ikke bygget ennå

- Kundesiden
- E-post med ordrebekreftelse. Ordren opprettes og instruksjonene returneres,
  men ingenting sendes ut. Resend eller Postmark er enkleste vei.
- Kobling mot store credit i Mystore. Utbetaling skjer manuelt inntil videre.
- Rate limiting på de åpne endepunktene. Bør på plass før siden er offentlig,
  ellers kan søket brukes til å skrape hele innkjøpslista di.
