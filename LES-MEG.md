# Rate limiting

Den siste tekniske tingen som faktisk stopper lansering.

## Installer

```
node oppdater.mjs
```

Start backend på nytt. Grensene gjelder med én gang, ingen synk eller import
nødvendig.

## Hvorfor

`/api/search` er hele innkjøpslista di. Hvilke sett du kjøper fra, hvilke kort
du mangler, og nøyaktig hva du betaler for hvert av dem. En konkurrent kunne
hentet ut alt på noen minutter og lagt seg like over.

## Grensene

Per IP-adresse, med to vinduer for hver regel:

| | Per minutt | Per døgn |
|---|---|---|
| Søk og settliste | 60 | 2000 |
| Bulkinnlegging | 10 | 200 |
| Innsending av ordre | 3 | 20 |
| Admin-innlogging | 5 | 50 |

Det korte vinduet stopper støt, det lange stopper jevn tapping. Med bare det
korte ville en tålmodig skraper gått under radaren ved å vente ett sekund
mellom hvert kall.

En ekte kunde møter dem aldri. Den som limer inn 50 linjer og bruker et
kvarter på å velge utgaver, ligger langt under 60 søk i minuttet.

Innlogging begrenses hardere. Ett passord uten brukernavn er en fristende ting
å gjette på, og fem forsøk i minuttet gjør det upraktisk.

## En detalj som må være riktig på Render

`app.set("trust proxy", 1)` er lagt inn. Bak Render kommer alle forespørsler
fra proxyen, og den ekte adressen ligger i `X-Forwarded-For`. Uten dette ville
alle kunder sett ut som én adresse — og den første som søkte litt mye, ville
låst ute alle andre.

## Hva dette ikke løser

Grensene er per adresse. Noen med tilgang til mange adresser kan fortsatt
hente ut lista over tid. Det gjør jobben dyr nok til at tilfeldig skraping
stopper, men det er ikke et forsvar mot en målrettet konkurrent.

Skulle det bli aktuelt, er neste steg å kreve innlogging for søk. Det koster
konvertering, så jeg ville ventet til du ser at det trengs.

Tellingen ligger i minnet. Ved omstart av backend nullstilles den. Det er et
bevisst valg: alternativet ville lagt en databaseskriving på hver eneste
forespørsel, og omstart skjer sjelden nok til at det ikke er et hull verdt å
tette.

## Testet

Syv tester på logikken, pluss en kjøring mot ekte server: søk nummer 61 fikk
429 med `Retry-After: 60`, en annen adresse var upåvirket, og innloggingen
stoppet på forsøk seks.
