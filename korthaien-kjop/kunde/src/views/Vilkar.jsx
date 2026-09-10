import { kroner } from "../api.js";

// ─────────────────────────────────────────────────────────────────────────────
// VILKÅR OG PERSONVERN
// ─────────────────────────────────────────────────────────────────────────────
// Siden samler inn navn, e-post og telefon. Da skal det stå hva som skjer med
// det. Teksten henter adressen og beløpsgrensene fra innstillingene, slik at
// den ikke kan komme i utakt med det systemet faktisk gjør.

export default function Vilkår({ config, onTilbake }) {
  const minste = config?.min_order_ore ? kroner(config.min_order_ore) : "200 kr";
  const frist = config?.order_expiry_days ?? 14;

  return (
    <>
      <h1>Vilkår og personvern</h1>
      <p className="ingress">
        Kort om hvordan innkjøpet fungerer, og hva som skjer med opplysningene du
        legger igjen. Sist oppdatert {new Date().toLocaleDateString("nb-NO", {
          day: "numeric", month: "long", year: "numeric",
        })}.
      </p>

      <div className="panel">
        <h2 style={{ marginTop: 0 }}>Hvem du selger til</h2>
        <p className="adresse" style={{ whiteSpace: "pre-line", margin: 0 }}>
          {config?.ship_to || "Korthaien"}
        </p>
        <p style={{ margin: "14px 0 0" }}>
          Korthaien Svein-Harald Bakke, enkeltpersonforetak.<br />
          Organisasjonsnummer 914 503 493.
        </p>
        <p style={{ marginBottom: 0 }}>
          Kontakt: <a href="mailto:korthaien@gmail.com">korthaien@gmail.com</a>
        </p>
      </div>

      <div className="panel">
        <h2 style={{ marginTop: 0 }}>Slik fungerer innkjøpet</h2>

        <h3>Summen er et anslag</h3>
        <p>
          Prisene på siden bygger på markedsdata og den tilstanden du selv oppgir.
          Når pakken kommer fram, går jeg gjennom hvert enkelt kort og kontrollerer
          antall og tilstand. Stemmer det ikke med det du oppga, justeres linjen, og
          du får en e-post som forklarer nøyaktig hva som ble endret. Det er summen
          etter gjennomgangen som gjelder.
        </p>

        <h3>Oppgjøret er butikkreditt</h3>
        <p>
          Du får en rabattkode på korthaien.no, ikke penger. Koden sendes på e-post
          når kortene er mottatt og godkjent, og har en fast verdi tilsvarende
          summen på ordren.
        </p>

        <h3>Minstesum og frakt</h3>
        <p>
          Minste ordre er {minste}. Du betaler portoen for å sende kortene til meg.
          Pakk dem forsvarlig — kort som blir skadet i posten, vurderes etter den
          tilstanden de har ved ankomst.
        </p>

        <h3>Frist</h3>
        <p>
          Pakken må være sendt innen {frist} dager fra du legger inn salget. Etter det
          frigjøres kortene til andre selgere, og prisene i ordren gjelder ikke lenger.
          Kommer pakken fram etter fristen, tar jeg kontakt før noe avgjøres.
        </p>

        <h3>Hvis noe i pakken avviker</h3>
        <p>
          Viser det seg at et kort er en annen utgave enn du trodde, eller at det
          ligger noen kort i pakken som ikke står i ordren, kjøper jeg dem som regel
          likevel. De legges til ordren til riktig pris for den utgaven de faktisk er,
          og du får en e-post som viser hva som ble lagt til og hva det utgjorde.
          Skulle det være noe jeg ikke kan kjøpe i det hele tatt, tar jeg kontakt før
          jeg gjør noe.
        </p>

        <h3>Sortering</h3>
        <p>
          Bekreftelsen viser kortene sortert på sett og deretter alfabetisk. Legg
          bunken i samme rekkefølge før du sender — det gjør mottaket raskere, og du
          får oppgjøret fortere.
        </p>
      </div>

      <div className="panel">
        <h2 style={{ marginTop: 0 }}>Personvern</h2>

        <h3>Hva jeg lagrer</h3>
        <p>
          Navn, e-postadresse og telefonnummer, sammen med kortene i ordren og
          eventuell melding du skriver. Ikke noe mer. Jeg ber aldri om fødselsnummer,
          kortopplysninger eller kontonummer, og du skal ikke oppgi det.
        </p>

        <h3>Hvorfor</h3>
        <p>
          For å kunne behandle salget: sende deg bekreftelse og rabattkode, og ta
          kontakt hvis noe i pakken avviker fra ordren. Telefonnummeret brukes bare
          når e-post ikke fører fram. Opplysningene brukes ikke til markedsføring, og
          du får ikke nyhetsbrev av å selge kort til meg.
        </p>

        <h3>Hvem andre ser det</h3>
        <p>
          Tjenesten kjører hos Render og Turso, og e-post sendes gjennom Resend. Alle
          tre lagrer data innenfor EU eller EØS, og behandler opplysningene bare på
          mine vegne. Ingenting selges eller deles videre til andre.
        </p>

        <h3>Hvor lenge</h3>
        <p>
          Ordrer med oppgjør oppbevares så lenge regnskapsloven krever. Ordrer som
          aldri ble noe av — kansellerte og utløpte — slettes etter ett år.
        </p>

        <h3>Rettighetene dine</h3>
        <p>
          Du kan be om innsyn i det jeg har lagret om deg, få rettet feil, eller be om
          at opplysningene slettes. Send en e-post til{" "}
          <a href="mailto:korthaien@gmail.com">korthaien@gmail.com</a>, så ordner jeg
          det. Mener du at jeg behandler opplysninger feil, kan du klage til
          Datatilsynet.
        </p>

        <h3>Ordren din</h3>
        <p>
          Du kan hente fram ordren igjen med ordrenummeret og e-postadressen din, uten
          å opprette konto. Rabattkoden vises ikke der — den finnes bare i e-posten
          til deg, slik at ingen andre kan bruke den.
        </p>
      </div>

      <div className="rad-flex ingen-print">
        <button className="knapp primar" onClick={onTilbake}>Tilbake</button>
      </div>
    </>
  );
}
