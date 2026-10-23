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
      { tekst: "Retur og angrerett" },
    ],
  },
  {
    navn: "Min konto",
    punkter: [
      { tekst: "Logg inn" },
      { tekst: "Finn ordren min", url: BUYLIST },
      { tekst: "Mine salg til Korthaien", url: BUYLIST },
      { tekst: "Ønskeliste" },
    ],
  },
  {
    navn: "Verktøy",
    punkter: [
      { tekst: "Selg kortene dine", url: BUYLIST },
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
// som krever dine ord — om oss, retur, spørsmål og svar — er ikke laget, og
// står som «kommer» i bunnen til teksten finnes.

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
