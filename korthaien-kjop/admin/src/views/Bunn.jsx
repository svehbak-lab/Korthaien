import { useState, useEffect } from "react";
import { api, kroner } from "../api.js";

// ─────────────────────────────────────────────────────────────────────────────
// BUNNEN
// ─────────────────────────────────────────────────────────────────────────────
// Fire spalter og en juridisk linje, slik Card Kingdom har det.
//
// Lenker som ikke fører noe sted er verre enn ingen lenke: de lover en side
// som ikke finnes, og kunden finner det ut først etter å ha trykket. Derfor
// er de som mangler merket «kommer» og ikke klikkbare. Lista over hva som
// mangler står da på sida selv, og ikke i hodet til noen.

const BUYLIST = "https://kortsalg.korthaien.no";

// hvor: en intern skjerm, eller en adresse ut. Mangler begge, er punktet
// ikke bygget ennå.
const SPALTER = [
  {
    navn: "Kundeservice",
    punkter: [
      { tekst: "Kontakt oss", skjerm: "kontakt" },
      { tekst: "Frakt og levering", skjerm: "frakt" },
      { tekst: "Retur og angrerett", skjerm: "retur" },
    ],
  },
  {
    navn: "Min konto",
    punkter: [
      { tekst: "Logg inn", skjerm: "konto" },
      { tekst: "Finn ordren min", url: BUYLIST },
      { tekst: "Mine salg til Korthaien", url: BUYLIST },
      { tekst: "Ønskeliste" },
    ],
  },
  {
    navn: "Verktøy",
    punkter: [
      { tekst: "Selg kortene dine", url: BUYLIST },
      { tekst: "Selg MTGO-tix", skjerm: "tix" },
      { tekst: "Lim inn hele lista", url: BUYLIST },
      { tekst: "Tilstandsguide", url: BUYLIST },
      { tekst: "Alle sett", skjerm: "sett" },
    ],
  },
  {
    navn: "Korthaien",
    punkter: [
      { tekst: "Om oss", skjerm: "omoss" },
      { tekst: "Butikkreditt", skjerm: "kreditt" },
      { tekst: "Kontakt oss", skjerm: "kontakt" },
    ],
  },
];

export default function Bunn({ onSkjerm }) {
  return (
    <footer className="b-bunn">
      <div className="b-midt b-bunnrad">
        {SPALTER.map((s) => (
          <nav key={s.navn}>
            <h4>{s.navn}</h4>
            <ul>
              {s.punkter.map((p) => (
                <li key={p.tekst}>
                  {p.skjerm ? (
                    <button className="b-bunnlenke" onClick={() => onSkjerm(p.skjerm)}>
                      {p.tekst}
                    </button>
                  ) : p.url ? (
                    <a className="b-bunnlenke" href={p.url}>{p.tekst}</a>
                  ) : (
                    <span className="b-bunnlenke av">
                      {p.tekst} <i>kommer</i>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>

      <div className="b-midt b-bunnjus">
        <span>
          <a href={BUYLIST}>Vilkår og personvern</a>
        </span>
        <span className="dempet">
          © {new Date().getFullYear()} Korthaien · Magic: The Gathering er et varemerke
          som tilhører Wizards of the Coast. Korthaien er ikke tilknyttet dem.
        </span>
      </div>
    </footer>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SIDENE BUNNEN PEKER TIL
// ─────────────────────────────────────────────────────────────────────────────
// De som kan skrives av data eller av beslutninger vi allerede har tatt. De
// som ikke er laget står som «kommer» i bunnen til teksten finnes — en lenke
// som ikke fører noe sted er verre enn ingen lenke.

export function Kontakt({ onFeil }) {
  const [felt, setFelt] = useState({ navn: "", epost: "", emne: "", melding: "" });
  const [sender, setSender] = useState(false);
  const [sendt, setSendt] = useState(false);

  const endre = (k, v) => setFelt((f) => ({ ...f, [k]: v }));
  const klar = felt.navn.trim() && felt.epost.includes("@") && felt.melding.trim().length >= 5;

  async function send(e) {
    e.preventDefault();
    setSender(true);
    try {
      await api.kontakt(felt);
      setSendt(true);
    } catch (err) {
      onFeil(err);
    } finally {
      setSender(false);
    }
  }

  if (sendt) {
    return (
      <div className="panel" style={{ maxWidth: 620 }}>
        <div className="krop">
          <h1 style={{ fontSize: 22, marginTop: 0 }}>Takk — meldingen er sendt</h1>
          <p className="dempet" style={{ marginBottom: 0 }}>
            Jeg svarer på adressen du oppga. Haster det, er det raskeste å sende
            e-post direkte til <a href="mailto:korthaien@gmail.com">korthaien@gmail.com</a>.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="panel" style={{ maxWidth: 620 }}>
      <div className="krop">
        <h1 style={{ fontSize: 22, marginTop: 0 }}>Kontakt oss</h1>
        <p className="dempet">
          Spørsmål om en ordre, et kort eller noe annet? Skriv her, så svarer jeg
          på e-post. Gjelder det en ordre, ta med ordrenummeret.
        </p>
        <form onSubmit={send}>
          <label style={{ display: "block", marginBottom: 10 }}>
            <div className="dempet" style={{ fontSize: 12, marginBottom: 3 }}>Navn</div>
            <input type="text" value={felt.navn} onChange={(e) => endre("navn", e.target.value)}
              style={{ width: "100%" }} />
          </label>
          <label style={{ display: "block", marginBottom: 10 }}>
            <div className="dempet" style={{ fontSize: 12, marginBottom: 3 }}>E-post</div>
            <input type="text" value={felt.epost} onChange={(e) => endre("epost", e.target.value)}
              style={{ width: "100%" }} />
          </label>
          <label style={{ display: "block", marginBottom: 10 }}>
            <div className="dempet" style={{ fontSize: 12, marginBottom: 3 }}>Hva gjelder det?</div>
            <input type="text" value={felt.emne} onChange={(e) => endre("emne", e.target.value)}
              placeholder="Ordre K-1043" style={{ width: "100%" }} />
          </label>
          <label style={{ display: "block", marginBottom: 14 }}>
            <div className="dempet" style={{ fontSize: 12, marginBottom: 3 }}>Melding</div>
            <textarea rows={7} value={felt.melding} onChange={(e) => endre("melding", e.target.value)} />
          </label>
          <button className="knapp primar" type="submit" disabled={!klar || sender}>
            {sender ? "Sender…" : "Send melding"}
          </button>
        </form>
      </div>
    </div>
  );
}

// Fraktsiden skrives av fraktalternativene i Admin. Da kan den ikke komme i
// utakt med det kunden faktisk får velge mellom i kassen.
export function Frakt({ onFeil }) {
  const [alt, setAlt] = useState(null);

  useEffect(() => {
    let avbrutt = false;
    api
      .frakt()
      .then((r) => !avbrutt && setAlt((r.alternativer || []).filter((f) => f.aktiv)))
      .catch((e) => {
        if (avbrutt) return;
        onFeil(e);
        setAlt([]);
      });
    return () => {
      avbrutt = true;
    };
  }, []);

  return (
    <div className="panel" style={{ maxWidth: 680 }}>
      <div className="krop">
        <h1 style={{ fontSize: 22, marginTop: 0 }}>Frakt og levering</h1>
        <p className="dempet">
          Du velger selv hvordan kortene sendes. Vi tvinger ingen over på
          sporing — men står det en forsikringsgrense, er det den som gjelder
          hvis sendingen blir borte.
        </p>

        {!alt && <p className="dempet">Henter…</p>}
        {alt && alt.length === 0 && (
          <p className="dempet">Fraktalternativene er ikke lagt inn ennå.</p>
        )}
        {alt && alt.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Alternativ</th>
                <th className="h" style={{ width: 110 }}>Pris</th>
                <th className="h" style={{ width: 150 }}>Forsikret til</th>
              </tr>
            </thead>
            <tbody>
              {alt.map((f) => (
                <tr key={f.id}>
                  <td>
                    {f.navn}
                    {f.beskrivelse && <span className="dempet"> · {f.beskrivelse}</span>}
                  </td>
                  <td className="h tall">{kroner(f.pris_ore)}</td>
                  <td className="h tall">
                    {f.forsikret_ore === null
                      ? <span className="dempet">uten sporing</span>
                      : kroner(f.forsikret_ore)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// RETUR OG ANGRERETT
// ─────────────────────────────────────────────────────────────────────────────
// Bygget på angrerettloven og forbrukerkjøpsloven, og på de valgene du har
// tatt i Admin → Frakt: foretaksnavn, organisasjonsnummer, returadresse og
// hvem som betaler returfrakten. Teksten følger valgene, så den kan ikke
// komme i utakt med dem.
//
// To ting loven krever, og som ikke kan løses her inne:
//
//  1. Angreskjemaet må nå kunden på et varig medium — vedlagt kvitteringen
//     som PDF, ikke som en lenke. Får de bare en lenke, forlenges fristen
//     til inntil ett år og fjorten dager. Du sa du ordner skjemaet selv.
//
//  2. Angrer kunden, skal pengene tilbake med samme betalingsmåte, ikke som
//     butikkreditt — med mindre kunden selv sier ja til kreditt i stedet.
//     Det må kassen tåle den dagen den bygges.
//
// Og: dette er skrevet av en maskin, ikke av en jurist. Få en jurist til å
// lese det før butikken åpnes.
export function Retur() {
  const [s, setS] = useState(null);

  useEffect(() => {
    let avbrutt = false;
    api.innstillinger().then((r) => !avbrutt && setS(r)).catch(() => !avbrutt && setS({}));
    return () => {
      avbrutt = true;
    };
  }, []);

  if (!s) return <p className="dempet">Henter…</p>;

  const kundenBetaler = (s.retur_frakt || "kunde") === "kunde";
  const adresse = (s.ship_to || "").trim();
  const orgnr = (s.org_nr || "").replace(/\s/g, "");
  const pentOrgnr = orgnr.length === 9
    ? `${orgnr.slice(0, 3)} ${orgnr.slice(3, 6)} ${orgnr.slice(6)}`
    : orgnr;

  return (
    <div className="panel" style={{ maxWidth: 720 }}>
      <div className="krop" style={{ lineHeight: 1.7 }}>
        <h1 style={{ fontSize: 22, marginTop: 0 }}>Retur og angrerett</h1>

        <h3 style={{ fontSize: 15, marginBottom: 4 }}>Du har 14 dagers angrerett</h3>
        <p>
          Handler du på nett, har du etter angrerettloven rett til å gå fra
          kjøpet innen 14 dager. Fristen løper fra den dagen du — eller noen du
          har pekt ut — får kortene i hendene. Du behøver ikke oppgi noen grunn.
        </p>

        <h3 style={{ fontSize: 15, marginBottom: 4 }}>Slik angrer du</h3>
        <p>
          Gi beskjed innen fristen, enten med angreskjemaet som følger
          ordrebekreftelsen, eller med en melding til{" "}
          <a href="mailto:korthaien@gmail.com">korthaien@gmail.com</a> der det
          går klart fram at du vil gå fra kjøpet. Ta med ordrenummeret. Det er
          nok at beskjeden er sendt innen de 14 dagene — den trenger ikke være
          besvart.
        </p>
        <p>
          Kortene skal sendes tilbake innen 14 dager etter at du har gitt
          beskjed, til:
        </p>
        <p style={{ whiteSpace: "pre-line", paddingLeft: 16, borderLeft: "3px solid currentColor" }}>
          {adresse || "Adressen oppgis i ordrebekreftelsen."}
        </p>
        <p>
          {kundenBetaler
            ? "Du betaler returfrakten. Det er derfor det står her, før du handler."
            : "Vi dekker returfrakten."}{" "}
          Pakk kortene så de tåler turen — en bøyd pakke er en bøyd samling.
        </p>

        <h3 style={{ fontSize: 15, marginBottom: 4 }}>Pengene tilbake</h3>
        <p>
          Du får tilbake det du betalte, inkludert den billigste frakten vi
          tilbyr, senest 14 dager etter at vi har fått beskjeden. Vi kan vente
          med utbetalingen til kortene er tilbake hos oss, eller til du har
          dokumentert at de er sendt. Pengene går tilbake med samme
          betalingsmåte du brukte, med mindre du selv ønsker butikkreditt i
          stedet. Du betaler ikke noe gebyr for å angre.
        </p>
        <p>
          Du kan undersøke kortene slik du ville gjort i en butikk. Blir de
          brukt eller skadet utover det — spilt med, sortert ut av sleeve og
          tilbake med nye merker, skrevet på — kan vi trekke fra det verdien
          har falt med.
        </p>

        <h3 style={{ fontSize: 15, marginBottom: 4 }}>Hvis noe er galt med kortene</h3>
        <p>
          Angrerett og reklamasjon er to ulike ting. Er et kort i dårligere
          stand enn oppgitt, feil kort, eller skadet i posten, er det en
          reklamasjon etter forbrukerkjøpsloven — den gjelder i to år, og helt
          uavhengig av angrefristen. Send en melding med ordrenummer og gjerne
          et bilde, så ordner vi det. Vi dekker frakten ved berettiget
          reklamasjon.
        </p>

        <h3 style={{ fontSize: 15, marginBottom: 4 }}>Henting på Løren</h3>
        <p>
          Henter du kortene selv i Oslo, gjelder angreretten likevel — kjøpet
          ble gjort på nett. Fristen løper fra dagen du hentet dem.
        </p>

        <h3 style={{ fontSize: 15, marginBottom: 4 }}>Hvis vi blir uenige</h3>
        <p>
          Si det til oss først — det meste løser seg der. Kommer vi ikke til
          enighet, kan du ta saken til Forbrukerrådet, som megler, og videre
          til Forbrukerklageutvalget.
        </p>

        <h3 style={{ fontSize: 15, marginBottom: 4 }}>Selgeren</h3>
        <p className="dempet" style={{ marginBottom: 0, whiteSpace: "pre-line" }}>
          {s.firmanavn || "Korthaien"}
          {pentOrgnr ? `\nOrganisasjonsnummer ${pentOrgnr}` : ""}
          {"\nkorthaien@gmail.com"}
          {adresse ? `\n\n${adresse}` : ""}
        </p>
      </div>
    </div>
  );
}

// Om oss. Sveins egne ord, kortet ned til ett avsnitt.
export function OmOss() {
  return (
    <div className="panel" style={{ maxWidth: 620 }}>
      <div className="krop">
        <h1 style={{ fontSize: 22, marginTop: 0 }}>Om Korthaien</h1>
        <p style={{ marginBottom: 0, lineHeight: 1.7 }}>
          Korthaien har solgt enkeltkort siden 2014, til kunder over hele
          landet. Det har alltid vært et sideprosjekt og en hobby — men når man
          liker noe, kjennes det ikke som jobb, og det å drive Korthaien er
          rett og slett gøy. De fleste kortene går i posten, men mange henter
          dem også på Løren i Oslo.
        </p>
      </div>
    </div>
  );
}

// Butikkreditt. Skrevet av beslutningene som allerede er tatt, ikke funnet
// på: kreditten utløper ikke, den dekker porto, og den er en bok med linjer
// inn og ut.
export function Kreditt() {
  return (
    <div className="panel" style={{ maxWidth: 680 }}>
      <div className="krop">
        <h1 style={{ fontSize: 22, marginTop: 0 }}>Butikkreditt</h1>
        <p>
          Selger du kort til Korthaien, blir oppgjøret butikkreditt. Kreditten
          står på e-postadressen din og kan brukes på alt i butikken.
        </p>
        <ul style={{ lineHeight: 1.8, paddingLeft: 20 }}>
          <li><b>Den utløper ikke.</b> Kreditt du fikk i fjor er like gyldig i dag.</li>
          <li><b>Den dekker også porto</b>, ikke bare kortene.</li>
          <li>
            <b>Du kan følge den.</b> Hver bevegelse inn og ut står med dato og
            grunn, så du kan se hvor saldoen kommer fra.
          </li>
          <li>Blir en ordre refundert, går beløpet tilbake til kreditten.</li>
        </ul>
        <p className="dempet" style={{ marginBottom: 0 }}>
          Vil du selge kort, finner du prisene på{" "}
          <a href={BUYLIST}>innkjøpssiden</a>. Du ser hva hvert kort er verdt med
          én gang, og hvor mange jeg har plass til.
        </p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MTGO-TIX
// ─────────────────────────────────────────────────────────────────────────────
// Tix kjøpes for butikkreditt. Det skjer ikke i en kasse: kunden tar kontakt,
// vi avtaler et tidspunkt og møtes på MTGO, tix byttes, og kreditten legges
// på kontoen. Siden sier prisen, regner ut kreditten og sender henvendelsen
// med det som trengs for å avtale tid — ingen frem-og-tilbake om brukernavn.
export function Tix({ onFeil, onKonto }) {
  const [pris, setPris] = useState(null);
  const [felt, setFelt] = useState({ navn: "", epost: "", mtgo: "", antall: "", melding: "" });
  const [sender, setSender] = useState(false);
  const [sendt, setSendt] = useState(false);

  useEffect(() => {
    let avbrutt = false;
    api.innstillinger()
      .then((r) => !avbrutt && setPris(Number(r.tix_kreditt_ore) || 1000))
      .catch(() => !avbrutt && setPris(1000));
    return () => { avbrutt = true; };
  }, []);

  const endre = (k, v) => setFelt((f) => ({ ...f, [k]: v }));
  const antall = Math.max(0, Math.floor(Number(String(felt.antall).replace(",", ".")) || 0));
  const klar = felt.navn.trim() && felt.epost.includes("@") && felt.mtgo.trim() && antall > 0;

  async function send(e) {
    e.preventDefault();
    setSender(true);
    try {
      await api.kontakt({
        navn: felt.navn.trim(),
        epost: felt.epost.trim(),
        emne: `MTGO-tix: ${antall} tix`,
        melding: [
          `Vil selge ${antall} tix (${kroner(antall * pris)} i butikkreditt).`,
          `MTGO-brukernavn: ${felt.mtgo.trim()}`,
          felt.melding.trim() ? `\n${felt.melding.trim()}` : "",
        ].join("\n"),
      });
      setSendt(true);
    } catch (err) {
      onFeil(err);
    } finally {
      setSender(false);
    }
  }

  if (pris === null) return <p className="dempet">Henter…</p>;

  if (sendt) {
    return (
      <div className="panel" style={{ maxWidth: 680 }}>
        <div className="krop">
          <h1 style={{ fontSize: 22, marginTop: 0 }}>Takk — jeg tar kontakt</h1>
          <p style={{ marginBottom: 0 }}>
            Jeg svarer på {felt.epost.trim()} med forslag til et tidspunkt vi kan møtes på MTGO.
            Kreditten legges på kontoen din når tix er byttet.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="panel" style={{ maxWidth: 720 }}>
      <div className="krop">
        <h1 style={{ fontSize: 22, marginTop: 0 }}>Selg MTGO-tix</h1>
        <p>
          Jeg kjøper Magic Online-tix for <b>{kroner(pris)} per tix</b> i butikkreditt.
          Kreditten kan brukes på alt i butikken, også frakt, og den utløper ikke.
        </p>

        <ol className="tix-steg">
          <li><b>Send en henvendelse</b> med hvor mange tix du har og MTGO-brukernavnet ditt.</li>
          <li><b>Vi avtaler et tidspunkt</b> og møtes på MTGO.</li>
          <li><b>Du trader tix til meg</b>, og kreditten legges på kontoen din med en gang.</li>
        </ol>
        <p className="dempet" style={{ fontSize: 13.5 }}>
          Kreditten følger e-postadressen. Har du ikke konto,{" "}
          <button type="button" className="lenke" style={{ font: "inherit", padding: 0 }} onClick={onKonto}>lag en</button> med samme
          adresse, så ser du saldoen og kan bruke den i kassen.
        </p>

        <form onSubmit={send} className="skjema" style={{ marginTop: 16 }}>
          <div className="tix-regn">
            <label>
              Antall tix
              <input
                inputMode="numeric" value={felt.antall} placeholder="f.eks. 120"
                onChange={(e) => endre("antall", e.target.value.replace(/[^0-9]/g, ""))}
              />
            </label>
            <div>
              <div className="dempet" style={{ fontSize: 13 }}>Du får</div>
              <div className="tix-sum">{kroner(antall * pris)}</div>
              <div className="dempet" style={{ fontSize: 12 }}>i butikkreditt</div>
            </div>
          </div>
          <label>MTGO-brukernavn<input value={felt.mtgo} onChange={(e) => endre("mtgo", e.target.value)} /></label>
          <label>Navn<input autoComplete="name" value={felt.navn} onChange={(e) => endre("navn", e.target.value)} /></label>
          <label>E-post<input type="email" autoComplete="email" value={felt.epost} onChange={(e) => endre("epost", e.target.value)} /></label>
          <label>
            Når passer det å møtes? (valgfritt)
            <textarea rows={2} value={felt.melding} onChange={(e) => endre("melding", e.target.value)} placeholder="F.eks. kvelder etter kl. 19" />
          </label>
          <div className="rad-flex">
            <button className="knapp primar" disabled={!klar || sender}>
              {sender ? "Sender…" : "Send henvendelse"}
            </button>
            <span className="dempet" style={{ fontSize: 13 }}>
              Eller send e-post til <a href="mailto:korthaien@gmail.com?subject=MTGO-tix">korthaien@gmail.com</a>.
            </span>
          </div>
        </form>
      </div>
    </div>
  );
}
