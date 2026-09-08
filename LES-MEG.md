# Skrivefeilforslag, og bedre grunnlag i koblingen

## Bruk

```
node oppdater.mjs
cd korthaien-kjop
npm run mystore
npm run rydd
```

Start backend på nytt etterpå for admin-endringene.

Forslagslista havner i `gjenstaende.csv`, med de mest sannsynlige øverst.

## Taket var for stramt

«Dawn Angel» er to tegn fra «Dawn Evangel» — åpenbart samme kort for et
menneske. Det gamle taket ga ett tillatt tegn for et navn på ni, så forslaget
ble aldri laget. Kortet endte i «ukjent» uten noen antydning om hva det var.

Taket er nå en fjerdedel av navnelengden. «Dawn Angel» fanges, uten at grensen
blir meningsløs for korte navn.

## To grupper i stedet for én

**skrivefeil** er ett tegn fra et entydig kort. Disse kobles automatisk av
`npm run rydd`, som før.

**forslag** er entydige treff lenger unna. De kobles ikke automatisk — du ser
dem i CSV-en med forslag og avstand, og retter i Mystore. Det er den lista du
ba om.

Skillet er med vilje. Ett tegn er nesten alltid en skrivefeil. To eller tre kan
være et helt annet kort, og en automatisk kobling der ville gitt deg feil
beholdning uten noe varsel.

## «100 %» skjulte et tynt grunnlag

Du fant at fire sett viste 100 % på samme kategori, noe som ikke går an. Årsaken
var at andelen ble regnet av de få navnene som lot seg slå opp — er de fleste
feilstavet, står du igjen med en håndfull vanlige kort som finnes overalt.

Forslagene viser nå treff av antall i stedet for prosent: «Ultimate Masters
3/3» sier tydelig at grunnlaget er tre kortnavn. «The List 412/512» er noe helt
annet, og skal se annerledes ut.

## Du kan endre kategorier som allerede har sett

Kobling-fanen viste bare kategorier uten sett, så CMB1 og SPG var utilgjengelige.
Nå finnes et søkefelt og en avkrysning for «Vis også kategorier som allerede har
sett», pluss en kolonne som viser hva de er koblet til.

## Rekkefølgen for kategorien med 1254 kort

Skrivefeilmatchingen sammenligner mot kort i **samme sett**, så den trenger at
settet er riktig først. For den kategorien betyr det:

1. Koble kategorien til riktig sett i Kobling
2. `npm run mystore`
3. `npm run rydd`

Da får skrivefeilene et sett å sammenlignes mot, og de fleste løser seg selv.
Å gjøre det i motsatt rekkefølge gir ingenting.

## Testet

Syv tester, blant annet at «Dawn Angel» nå gir forslag med avstand 2, at ett
tegn fortsatt kobles automatisk mens to ikke gjør det, og at CSV-en åpner
riktig i norsk Excel.
