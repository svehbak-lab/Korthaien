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

## Kundesiden

Ligger i `kunde/`. Egen Vite-app, ingen innlogging.

```bash
cd kunde
npm install
npm run dev        # http://localhost:5180
```

To måter å legge inn kort: søk med filter på sett og raritet, eller innliming
av inntil 50 linjer. Bulkparseren takler `4 Bolt`, `4x Bolt`, `Bolt x4`,
`Bolt (MH2) 138` og `Bolt foil`.

Linjer som treffer flere trykk får ikke et gjett. De vises som et bilderutenett
der kunden peker ut utgaven hen faktisk har — kunsten er det som skiller
trykkene fra hverandre, ikke settkoden.

Før innsending går kunden gjennom lista sortert på sett og kortnavn, i samme
rekkefølge som kortene skal ligge i pakken. Kvoten håndheves både i grensesnittet
og på nytt på server, siden en annen kunde kan ha tatt plassen i mellomtiden.

## Kategorier uten forelder

Rundt 280 kategorier har verken settnavn eller forelder i Mystore. En kategori
som bare heter «Common», uten noe over seg, forteller ingenting — og
informasjonen finnes ikke i API-et, den er ikke skjult.

`npm run gjett` løser dette ved å se på innholdet. Den henter en stikkprøve på
inntil 100 produkter fra hver kategori og teller hvor mange av navnene som
finnes i hvert sett. Ligger det 80 kort der og 78 finnes i Invasion, er
kategorien Invasion.

Terskelen er bevisst streng: minst åtte kort, minst 75 prosent treff, og beste
kandidat må være halvannen gang bedre enn nest beste. Et kort som Lightning
Bolt finnes i femti sett, så enkelttreff sier lite — det er fordelingen over
hele utvalget som avgjør. Kategorier som ikke når terskelen kobles ikke, men
kandidatene lagres og vises i Kobling med andelen synlig, så du ser hva
konklusjonen bygger på.

Kjøres også fra admin med knappen «Kjør analysen».

Kategorier som allerede er analysert hoppes over, så en avbrutt kjøring
fortsetter der den slapp. `npm run gjett -- --pa-nytt` tar dem om igjen, noe
som er nyttig etter at du har koblet flere kategorier manuelt — jo tettere
katalogen er, jo bedre treffer analysen.

## Mystore struperegulerer

Mystore svarer 429 når kallene kommer for tett. Klienten holder en
minsteavstand mellom forespørslene og øker den permanent hvis den likevel blir
avvist — det er billigere å gå litt saktere enn å bli stengt ute midt i en
jobb. Ved 429 ventes det så lenge serveren ber om, ellers doblende opp til ett
minutt, med inntil seks forsøk.

Blir en jobb avbrutt likevel, er alt som er gjort lagret. Vent noen minutter og
kjør på nytt.

## Dobbeltsidige kort

Scryfall lagrer flip-, transform-, adventure- og splittkort med begge navn:
«Akki Lavarunner // Tok-Tok, Volcano Born», «Bonecrusher Giant // Stomp».
Butikker og kunder bruker forsiden alene.

Kolonnene `front_norm` og `back_norm` holder hver sin halvdel, og oppslag
prøver alle tre former. Splittkort listes ofte én gang per halvdel i butikker —
«Determined (Bound/Determined)» — så baksiden må være søkbar for seg. Innholdet
i parentesen normaliseres dessuten likt som Scryfalls «Bound // Determined»,
og brukes som ekstra nøkkel. Det
gjelder både Mystore-synken og kundesidens søk og bulkinnlegging — en kunde
som skriver «Bonecrusher Giant» skal finne kortet sitt.

Har du en database fra før, fylles kolonnen ved oppstart. Du kan også kjøre
`npm run reindeks` manuelt. Full import trengs ikke.

## Settfamilier

Scryfall splitter én utgivelse i flere sett. «The Brothers' War» blir `bro`,
`brr` (Retro Artifacts), `brc` (Commander) og `abro` (Art Series). Strixhaven
blir `stx` pluss `sta` (Mystical Archive). Butikker holder dem samlet under
hovedsettet, slik kundene tenker om dem — kortet lå tross alt i samme pakke.

Synken søker derfor i hele familien: hovedsettet pluss alle sett som peker på
det gjennom Scryfalls `parent_set_code`. Ved likhet vinner hovedsettet, deretter
eldste barn.

Familiene vedlikeholdes ikke for hånd. Scryfall oppgir forelderen selv, så nye
utgivelser med bonusark virker uten at noe må settes opp.

Merk at «The List» og «Secret Lair Drop» ikke er barn av noe hovedsett. De
inneholder reprints fra hele Magics historie og faller derfor utenfor
familiesøket av seg selv — som de skal.

```
npm run sett     # oppdaterer bare settlista, tar sekunder
```

## Analyser en gruppe

```
npm run analyser              # de fem største gruppene
npm run analyser cmb1 bro     # bestemte settkoder
```

Når mange produkter under samme settkode ikke finner kortet sitt, er det som
regel én årsak og ikke mange. Kommandoen viser hvilke sett kortene faktisk
tilhører, om noen navn finnes i flere av dem, og hvilke navn som ikke finnes i
katalogen i det hele tatt.

Den er rent lesende og endrer ingenting. Svaret bruker du i Kobling-fanen: én
kategorikobling flytter alle produktene i grenen.

Normaliseringen skjer i JavaScript, ikke i SQL, siden SQLite ikke kan gjøre
den — et oppslag uten normalisering ville bommet på nøyaktig de samme kortene
som synken bommer på, og gitt et misvisende svar.

## Skrivefeilrapport

```
npm run skrivefeil
```

Skriver `skrivefeil.csv` med alle ukoblede produkter, delt i tre grupper:

- **skrivefeil** — ett tegn fra et entydig kort i samme sett. «Horrible Awry»
  mot «Horribly Awry». Disse kobles automatisk av `npm run rydd`.
- **forslag** — entydig treff, men lenger unna. «Dawn Angel» mot «Dawn
  Evangel» er to tegn. Kobles ikke automatisk; du ser dem over og retter i
  Mystore.
- **token** — tokens og emblemer. Scryfall legger dem i egne token-sett, ikke
  i settet de ble trykt sammen med, så de finnes ikke i katalogen uansett hvor
  riktig navnet er.
- **ukjent** — ingen nær match. Trolig alternative utgaver, promoer og
  spesialtrykk.

Sortert med de mest sannsynlige først, og innenfor hver gruppe etter hvor mange
du har på lager — der en feil koster mest.

Rettelsene hører hjemme i Mystore, ikke i uskarp matching her. Uskarpt nok til
å fange skrivefeil er også uskarpt nok til å koble feil kort, og da får du feil
beholdning uten å merke det.

## Opprydding

```
npm run rydd
```

Godtar de entydige skrivefeilforslagene og merker tokens som ikke-kort, slik at
Kobling-fanen bare inneholder det som trenger et menneske.

Et forslag godtas bare når det er entydig. Ligger to kort like nær, er
forslaget et gjett og ikke en rettelse — de havner i gruppen «tvetydig» og
vurderes for hånd.

Alt som gjøres merkes med kilde i `mystore_links`. `npm run rydd -- --angre`
fjerner alle automatiske koblinger og lar de manuelle stå.

Det som blir igjen skrives til `gjenstaende.csv`, gruppert per sett. Mange fra
samme sett betyr som regel én årsak — feil settkobling — og ikke hundre
uavhengige feil.

## Ikke bygget ennå
- E-post med ordrebekreftelse. Ordren opprettes og instruksjonene vises på
  skjermen, men ingenting sendes ut. Kunden blir derfor bedt om å skrive ut
  eller notere ordrenummeret. Resend eller Postmark er enkleste vei videre.
- Kobling mot store credit i Mystore. Utbetaling skjer manuelt inntil videre.
- Rate limiting på de åpne endepunktene. Bør på plass før siden er offentlig,
  ellers kan søket brukes til å skrape hele innkjøpslista di.
