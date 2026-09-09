import { useState } from "react";
import { api, leggTil, settAntall, antallKort, tilLinjer } from "./api.js";
import Søk from "./views/Sok.jsx";
import Bulk from "./views/Bulk.jsx";
import { Kurv, Gjennomgang, Skjema, Kvittering } from "./views/Kasse.jsx";

export default function App() {
  const [steg, setSteg] = useState("velg");       // velg → gjennomgang → skjema → kvittering
  const [fane, setFane] = useState("sok");
  const [kurv, setKurv] = useState({});
  const [ordre, setOrdre] = useState(null);
  const [feil, setFeil] = useState("");
  const [sender, setSender] = useState(false);

  function visFeil(e) {
    setFeil(e.message);
    setTimeout(() => setFeil(""), 7000);
  }

  function legg(tilbud, cond, pris, antall = 1) {
    setKurv((k) => leggTil(k, tilbud, cond, pris, antall));
  }

  async function send(kontakt) {
    setSender(true);
    try {
      const svar = await api.sendOrdre({ ...kontakt, linjer: tilLinjer(kurv) });
      setOrdre(svar);
      setKurv({});
      setSteg("kvittering");
      window.scrollTo(0, 0);
    } catch (e) {
      // Kvoten kan ha blitt tatt av en annen kunde mens denne holdt på.
      visFeil(e);
      if (e.data?.avvist?.length) setSteg("gjennomgang");
    } finally {
      setSender(false);
    }
  }

  const tomKurv = antallKort(kurv) === 0;

  return (
    <>
      <header className="topp">
        <div className="inni">
          <b>Korthaien</b>
          <span>Selg kortene dine</span>
        </div>
      </header>

      <main className="ark">
        {feil && <div className="varsel feil">{feil}</div>}

        {steg === "velg" && (
          <div className="todelt">
            <div>
              <h1>Selg Magic-kort til Korthaien</h1>
              <p className="ingress">
                Søk opp kortene dine eller lim inn hele lista. Du ser med én gang
                hva du får i butikkreditt, og hvor mange jeg har plass til.
              </p>

              <div className="faner" role="tablist">
                <button role="tab" aria-selected={fane === "sok"} onClick={() => setFane("sok")}>
                  Søk etter kort
                </button>
                <button role="tab" aria-selected={fane === "bulk"} onClick={() => setFane("bulk")}>
                  Lim inn liste
                </button>
              </div>

              {fane === "sok"
                ? <Søk kurv={kurv} onLegg={legg} onFeil={visFeil} />
                : <Bulk kurv={kurv} onLegg={legg} onFeil={visFeil} />}
            </div>

            <Kurv
              kurv={kurv}
              onAntall={(k, n) => setKurv((c) => settAntall(c, k, n))}
              onVidere={() => { setSteg("gjennomgang"); window.scrollTo(0, 0); }}
            />
          </div>
        )}

        {steg === "gjennomgang" && (
          <Gjennomgang
            kurv={kurv}
            onAntall={(k, n) => setKurv((c) => settAntall(c, k, n))}
            onTilbake={() => setSteg("velg")}
            onVidere={() => { setSteg("skjema"); window.scrollTo(0, 0); }}
          />
        )}

        {steg === "skjema" && (
          <Skjema
            kurv={kurv}
            sender={sender}
            onTilbake={() => setSteg("gjennomgang")}
            onSend={send}
          />
        )}

        {steg === "kvittering" && ordre && (
          <Kvittering ordre={ordre} onNy={() => { setOrdre(null); setSteg("velg"); }} />
        )}

        {steg !== "velg" && steg !== "kvittering" && tomKurv && (
          <p className="dempet">Kurven er tom. <button className="knapp blank" onClick={() => setSteg("velg")}>Legg til kort</button></p>
        )}
      </main>
    </>
  );
}
