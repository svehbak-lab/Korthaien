import { useState, useEffect } from "react";
import { api, UtloggetFeil } from "./api.js";
import Ordrer from "./views/Ordrer.jsx";
import Salgsordrer from "./views/Salgsordrer.jsx";
import Sett from "./views/Sett.jsx";
import Kort from "./views/Kort.jsx";
import Hurtig from "./views/Hurtig.jsx";
import Produkter from "./views/Produkter.jsx";
import Kobling from "./views/Kobling.jsx";
import Butikk from "./views/Butikk.jsx";
import Lagerrapport from "./views/Lagerrapport.jsx";
import Kupp from "./views/Kupp.jsx";
import Innstillinger from "./views/Innstillinger.jsx";

const SIDER = [
  { id: "salgsordrer", navn: "Salgsordrer" },
  { id: "ordrer", navn: "Kjøpsordrer" },
  { id: "sett", navn: "Kjøpsliste" },
  // Enkeltkort byttet plass med Hurtigredigering. Enkeltkort-siden handler om
  // innkjøp — hva du tar imot, hvor mange du vil ha, hva du betaler — og den
  // naas der den hoerer hjemme: fra Sett. Lageret er en annen jobb, og gjoeres
  // ofte nok til aa fortjene sin egen inngang.
  { id: "hurtig", navn: "Hurtigredigering" },
  // Sealed og komplette sett. Egen inngang fordi de legges inn for haand og
  // ikke av importen — og fordi de ikke er kort, og ikke skal se ut som det.
  { id: "produkter", navn: "Produkter" },
  // Kobling er ute av menyen. Visningen og ruten staar igjen, saa den er en
  // linje unna aa komme tilbake — men merk at tellingen av ukoblede
  // produkter forsvinner med den. Varselet i Lagerrapport fanger fortsatt
  // det som koster penger: produkter som har beholdning uten aa vaere koblet.
  // Midlertidig: forhåndsvisning av butikken. Flyttes ut når salgssiden bygges.
  { id: "butikk", navn: "Butikk" },
  { id: "lagerrapport", navn: "Lagerrapport" },
  { id: "kupp", navn: "Kupp" },
  // Het Innstillinger. Admin sier bedre hva det er: ett sted for alt du
  // styrer selv. Fanene gjoer at det kan vokse uten aa bli en lang liste.
  { id: "innstillinger", navn: "Admin" },
];

export default function App() {
  const [innlogget, setInnlogget] = useState(null);
  // Lenker tilbake fra Stripe, Google og «glemt passord» skal lande i
  // butikken, der kunden var — ikke på ordrelista i admin.
  const [side, setSide] = useState(() =>
    /[?&](kasse|nyttpassord|innlogging|bekreft)=/.test(window.location.search) ? "butikk" : "salgsordrer"
  );
  const [antallSalg, setAntallSalg] = useState(null);
  const [valgtSett, setValgtSett] = useState(null);
  const [feil, setFeil] = useState("");
  const [melding, setMelding] = useState("");
  const [antallOrdrer, setAntallOrdrer] = useState(null);
  const [antallUkoblede, setAntallUkoblede] = useState(null);
  const [adminfane, setAdminfane] = useState("innkjop");

  useEffect(() => {
    api.meg().then(() => setInnlogget(true)).catch(() => setInnlogget(false));
  }, []);

  function håndterFeil(e) {
    if (e instanceof UtloggetFeil) {
      setInnlogget(false);
      return;
    }
    setFeil(e.message);
    setTimeout(() => setFeil(""), 6000);
  }

  function visMelding(t) {
    setMelding(t);
    setTimeout(() => setMelding(""), 4000);
  }

  if (innlogget === null) return null;
  if (!innlogget) return <Innlogging onInn={() => setInnlogget(true)} />;

  return (
    <div className="skall">
      <aside className="rail">
        <div className="merke">
          <b>Korthaien Kjøp</b>
          <span>Innkjøp fra kunder</span>
        </div>
        <nav>
          {SIDER.map((s) => (
            <button
              key={s.id}
              aria-current={side === s.id}
              onClick={() => setSide(s.id)}
            >
              {s.navn}
              {s.id === "salgsordrer" && antallSalg > 0 && <span className="antall">{antallSalg}</span>}
              {s.id === "ordrer" && antallOrdrer > 0 && <span className="antall">{antallOrdrer}</span>}
              {s.id === "kobling" && antallUkoblede > 0 && <span className="antall">{antallUkoblede}</span>}
            </button>
          ))}
        </nav>
        <div className="bunn">
          <button
            className="knapp liten"
            onClick={async () => {
              await api.loggUt().catch(() => {});
              setInnlogget(false);
            }}
          >
            Logg ut
          </button>
        </div>
      </aside>

      <main className="hoved">
        {/* Butikken har sin egen topp med logo og meny. En admin-overskrift
            over den ser ut som om siden begynner to ganger. */}
        {side !== "butikk" && (
          <>
            <h1 className="tittel">{SIDER.find((s) => s.id === side).navn}</h1>
            <p className="undertittel">{FORKLARING[side]}</p>
          </>
        )}

        {feil && <div className="varsel feil">{feil}</div>}
        {melding && <div className="varsel ok">{melding}</div>}

        {side === "salgsordrer" && <Salgsordrer onFeil={håndterFeil} onMelding={visMelding} onAntall={setAntallSalg} />}
        {side === "ordrer" && <Ordrer onFeil={håndterFeil} onAntall={setAntallOrdrer} />}
        {side === "sett" && (
          <Sett
            onFeil={håndterFeil}
            onVelgSett={(kode) => {
              setValgtSett(kode);
              setSide("kort");
            }}
          />
        )}
        {side === "hurtig" && <Hurtig onFeil={håndterFeil} />}
        {side === "produkter" && <Produkter onFeil={håndterFeil} onMelding={visMelding} />}
        {/* Naas fra Sett, ikke fra menyen. */}
        {side === "kort" && (
          <Kort
            sett={valgtSett}
            onFeil={håndterFeil}
            onByttSett={() => setSide("sett")}
          />
        )}
        {side === "kobling" && <Kobling onFeil={håndterFeil} onAntall={setAntallUkoblede} />}
        {side === "butikk" && <Butikk onFeil={håndterFeil} />}
        {side === "lagerrapport" && <Lagerrapport onFeil={håndterFeil} />}
        {side === "kupp" && <Kupp onFeil={håndterFeil} />}
        {side === "innstillinger" && (
          <>
            {/* Fanene bor her og ikke inne i Innstillinger, saa de staar
                paa samme sted uansett hvilken fane som er valgt. */}
            <div className="faner" role="tablist" style={{ marginBottom: 18 }}>
              {ADMINFANER.map((f) => (
                <button
                  key={f.id}
                  role="tab"
                  aria-selected={adminfane === f.id}
                  onClick={() => setAdminfane(f.id)}
                >
                  {f.navn}
                </button>
              ))}
            </div>
            <Innstillinger fane={adminfane} onFeil={håndterFeil} onMelding={visMelding} />
          </>
        )}
      </main>
    </div>
  );
}

// Fanene i Admin. Innkjoep, Utsalg og Innlogging er det siden alltid har
// handlet om - den sa det bare ikke. Frakt og Kreditt er nye, og det som
// kommer senere faar sin egen fane i stedet for aa bli nok en bolk nedover.
const ADMINFANER = [
  { id: "innkjop", navn: "Innkjøp" },
  { id: "utsalg", navn: "Utsalg" },
  { id: "frakt", navn: "Frakt" },
  { id: "kreditt", navn: "Kreditt" },
  { id: "rapporter", navn: "Rapporter" },
  { id: "utseende", navn: "Utseende" },
  { id: "innlogging", navn: "Innlogging" },
];

const FORKLARING = {
  salgsordrer:
    "Ordrer fra butikken. Kortene står i samme rekkefølge som i kjøpsordrene — sett, raritet, navn — så du kan plukke i én runde.",
  lagerrapport:
    "Hva du har på lager, og hva det er verdt til utsalgspris. Trykk på et sett for å se rariteter.",
  ordrer:
    "Kortene ligger i samme rekkefølge som kunden ble bedt om å sortere bunken, så du kan gå gjennom stabelen og lista i takt.",
  sett: "Kjøpslista: settene du kjøper fra. Bestem hvor mange du vil ha og hvilke tilstander du tar imot.",
  kort: "Overstyr enkeltkort. Tomt felt betyr at kortet følger settregelen.",
  produkter:
    "Sealed og komplette sett — det du selger som ikke er et enkeltkort. Én pris per produkt, og de dukker opp i butikken så snart antallet er over null.",
  // Kobling staar ikke i menyen lenger, men forklaringen blir staaende saa
  // den foelger med hvis den settes inn igjen.
  kobling:
    "Produkter i Mystore som ikke lot seg koble til et kort. Beholdningen deres regnes som 0, og da kan kunder selge deg kort du har fra før.",
  innstillinger: "Alt du styrer selv. Velg en fane.",
};

function Innlogging({ onInn }) {
  const [passord, setPassord] = useState("");
  const [kode, setKode] = useState("");
  // Vi spør ikke om koden før serveren sier at den trengs. De fleste vet ikke
  // om totrinns er slått på, og et tomt kodefelt på første skjerm ser ut som
  // noe man har glemt.
  const [trengerKode, setTrengerKode] = useState(false);
  const [feil, setFeil] = useState("");
  const [venter, setVenter] = useState(false);

  async function send(e) {
    e.preventDefault();
    setVenter(true);
    setFeil("");
    try {
      await api.loggInn(passord, trengerKode ? kode : undefined);
      onInn();
    } catch (err) {
      if (err.data?.trengerKode) {
        setTrengerKode(true);
        // Passordet beholdes, ellers må du skrive det på nytt for hver kode.
        setFeil(kode ? err.message : "");
        setKode("");
      } else {
        setFeil(err.message);
        setPassord("");
        setKode("");
        setTrengerKode(false);
      }
    } finally {
      setVenter(false);
    }
  }

  return (
    <div className="login">
      <form onSubmit={send}>
        <h1>Korthaien Kjøp</h1>
        <p>Logg inn for å se ordrer og innkjøpsregler.</p>
        <input
          type="password"
          value={passord}
          onChange={(e) => setPassord(e.target.value)}
          placeholder="Passord"
          autoFocus={!trengerKode}
          autoComplete="current-password"
          readOnly={trengerKode}
        />
        {trengerKode && (
          <>
            <input
              type="text"
              inputMode="numeric"
              value={kode}
              onChange={(e) => setKode(e.target.value.replace(/[^\dA-Za-z-]/g, ""))}
              placeholder="Engangskode"
              autoFocus
              // Gjør at iPhone tilbyr koden fra Nøkkelring rett over tastaturet.
              autoComplete="one-time-code"
              style={{ letterSpacing: "0.18em", textAlign: "center" }}
            />
            <p className="dempet" style={{ fontSize: 13, margin: "0 0 12px" }}>
              Sekssifret kode fra telefonen. Har du ikke tilgang til den, kan du
              bruke en av reservekodene dine.
            </p>
          </>
        )}
        {feil && <div className="varsel feil" style={{ marginBottom: 12 }}>{feil}</div>}
        <button className="knapp primar" disabled={venter || !passord || (trengerKode && !kode)}>
          {venter ? "Logger inn…" : trengerKode ? "Bekreft" : "Logg inn"}
        </button>
      </form>
    </div>
  );
}
