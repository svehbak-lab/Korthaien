import { useState, useEffect } from "react";
import { api, UtloggetFeil } from "./api.js";
import Ordrer from "./views/Ordrer.jsx";
import Sett from "./views/Sett.jsx";
import Kort from "./views/Kort.jsx";
import Kobling from "./views/Kobling.jsx";
import Innstillinger from "./views/Innstillinger.jsx";

const SIDER = [
  { id: "ordrer", navn: "Ordrer" },
  { id: "sett", navn: "Sett" },
  { id: "kort", navn: "Enkeltkort" },
  { id: "kobling", navn: "Kobling" },
  { id: "innstillinger", navn: "Innstillinger" },
];

export default function App() {
  const [innlogget, setInnlogget] = useState(null);
  const [side, setSide] = useState("ordrer");
  const [valgtSett, setValgtSett] = useState(null);
  const [feil, setFeil] = useState("");
  const [melding, setMelding] = useState("");
  const [antallOrdrer, setAntallOrdrer] = useState(null);
  const [antallUkoblede, setAntallUkoblede] = useState(null);

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
        <h1 className="tittel">{SIDER.find((s) => s.id === side).navn}</h1>
        <p className="undertittel">{FORKLARING[side]}</p>

        {feil && <div className="varsel feil">{feil}</div>}
        {melding && <div className="varsel ok">{melding}</div>}

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
        {side === "kort" && (
          <Kort
            sett={valgtSett}
            onFeil={håndterFeil}
            onByttSett={() => setSide("sett")}
          />
        )}
        {side === "kobling" && <Kobling onFeil={håndterFeil} onAntall={setAntallUkoblede} />}
        {side === "innstillinger" && <Innstillinger onFeil={håndterFeil} onMelding={visMelding} />}
      </main>
    </div>
  );
}

const FORKLARING = {
  ordrer:
    "Kortene ligger i samme rekkefølge som kunden ble bedt om å sortere bunken, så du kan gå gjennom stabelen og lista i takt.",
  sett: "Slå på settene du kjøper fra, og bestem hvor mange du vil ha og hvilke tilstander du tar imot.",
  kort: "Overstyr enkeltkort. Tomt felt betyr at kortet følger settregelen.",
  kobling:
    "Produkter i Mystore som ikke lot seg koble til et kort. Beholdningen deres regnes som 0, og da kan kunder selge deg kort du har fra før.",
  innstillinger: "Pris, frister og adressen kunden sender til.",
};

function Innlogging({ onInn }) {
  const [passord, setPassord] = useState("");
  const [feil, setFeil] = useState("");
  const [venter, setVenter] = useState(false);

  async function send(e) {
    e.preventDefault();
    setVenter(true);
    setFeil("");
    try {
      await api.loggInn(passord);
      onInn();
    } catch (err) {
      setFeil(err.message);
      setPassord("");
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
          autoFocus
          autoComplete="current-password"
        />
        {feil && <div className="varsel feil" style={{ marginBottom: 12 }}>{feil}</div>}
        <button className="knapp primar" disabled={venter || !passord}>
          {venter ? "Logger inn…" : "Logg inn"}
        </button>
      </form>
    </div>
  );
}
