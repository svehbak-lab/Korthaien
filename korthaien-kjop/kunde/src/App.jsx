import { useState, useEffect } from "react";
import {
  api, leggTil, settAntall, settCondition, antallKort, tilLinjer,
  lagre, tøm, gjenopprett, LEVETID_TIMER,
} from "./api.js";
import Søk from "./views/Sok.jsx";
import Bulk from "./views/Bulk.jsx";
import { Kurv, Gjennomgang, Skjema, Kvittering } from "./views/Kasse.jsx";
import Oppslag from "./views/Oppslag.jsx";

export default function App() {
  const [steg, setSteg] = useState("velg");       // velg → gjennomgang → skjema → kvittering
  const [fane, setFane] = useState("sok");
  const [kurv, setKurv] = useState({});
  const [ordre, setOrdre] = useState(null);
  const [config, setConfig] = useState(null);
  const [feil, setFeil] = useState("");
  const [beskjed, setBeskjed] = useState(null);
  const [sender, setSender] = useState(false);
  const [klar, setKlar] = useState(false);

  function visFeil(e) {
    setFeil(e.message);
    setTimeout(() => setFeil(""), 9000);
  }

  useEffect(() => {
    api.config().then(setConfig).catch(() => {});
  }, []);

  // Kurven hentes fram igjen med dagens priser og kvoter, ikke gårsdagens.
  // Har noe endret seg i mellomtiden, sier vi det med én gang i stedet for å
  // la kunden oppdage det i kassen.
  useEffect(() => {
    let avbrutt = false;
    gjenopprett()
      .then((r) => {
        if (avbrutt || !r) return;
        setKurv(r.kurv);
        if (r.endringer.length) {
          setBeskjed({
            tittel: "Kurven din er hentet fram igjen, men noe har endret seg",
            punkter: r.endringer,
          });
        }
      })
      .catch(() => {})
      .finally(() => !avbrutt && setKlar(true));
    return () => {
      avbrutt = true;
    };
  }, []);

  // Lagres først etter at gjenopprettingen er ferdig — ellers ville den tomme
  // starttilstanden rukket å skrive over det som lå der.
  useEffect(() => {
    if (klar) lagre(kurv);
  }, [kurv, klar]);

  function legg(tilbud, cond, antall = 1) {
    setKurv((k) => leggTil(k, tilbud, cond, antall));
  }

  async function send(kontakt) {
    setSender(true);
    try {
      const svar = await api.sendOrdre({ ...kontakt, linjer: tilLinjer(kurv) });
      setOrdre(svar);
      setKurv({});
      tøm();
      setSteg("kvittering");
      window.scrollTo(0, 0);
    } catch (e) {
      // Kvoten kan ha blitt tatt av en annen kunde mens denne holdt på.
      visFeil(e);
      if (e.data?.avvist?.length || e.data?.min_order_ore) setSteg("gjennomgang");
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
          <button className="knapp blank ingen-print" onClick={() => setSteg("oppslag")}>
            Finn ordren min
          </button>
        </div>
      </header>

      <main className="ark">
        {feil && <div className="varsel feil">{feil}</div>}

        {beskjed && (
          <div className="varsel info">
            <b>{beskjed.tittel}</b>
            <ul style={{ margin: "6px 0 0", paddingLeft: 20 }}>
              {beskjed.punkter.map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ul>
            <button className="knapp blank" onClick={() => setBeskjed(null)}>Greit</button>
          </div>
        )}

        {steg === "velg" && (
          <div className="todelt">
            <div>
              <h1>Selg Magic-kort til Korthaien</h1>
              <p className="ingress">
                Søk opp kortene dine eller lim inn hele lista. Du ser med én gang hva
                du får i butikkreditt, og hvor mange jeg har plass til. Oppgjøret er
                en rabattkode på korthaien.no — ikke kontanter.
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
              minOrdreØre={config?.min_order_ore}
              onAntall={(k, n) => setKurv((c) => settAntall(c, k, n))}
              onCondition={(k, c) => setKurv((v) => settCondition(v, k, c))}
              onVidere={() => { setSteg("gjennomgang"); window.scrollTo(0, 0); }}
            />
          </div>
        )}

        {steg === "gjennomgang" && (
          <Gjennomgang
            kurv={kurv}
            minOrdreØre={config?.min_order_ore}
            onAntall={(k, n) => setKurv((c) => settAntall(c, k, n))}
            onCondition={(k, c) => setKurv((v) => settCondition(v, k, c))}
            onTilbake={() => setSteg("velg")}
            onVidere={() => { setSteg("skjema"); window.scrollTo(0, 0); }}
          />
        )}

        {steg === "skjema" && (
          <Skjema
            kurv={kurv}
            config={config}
            sender={sender}
            onTilbake={() => setSteg("gjennomgang")}
            onSend={send}
          />
        )}

        {steg === "kvittering" && ordre && (
          <Kvittering ordre={ordre} onNy={() => { setOrdre(null); setSteg("velg"); }} />
        )}

        {steg === "oppslag" && <Oppslag onFeil={visFeil} onTilbake={() => setSteg("velg")} />}

        {steg !== "velg" && steg !== "kvittering" && steg !== "oppslag" && tomKurv && (
          <p className="dempet">
            Kurven er tom.{" "}
            <button className="knapp blank" onClick={() => setSteg("velg")}>Legg til kort</button>
          </p>
        )}

        {steg === "velg" && !tomKurv && (
          <p className="dempet fotnote">
            Kurven ligger lagret i nettleseren din i {LEVETID_TIMER} timer. Har du mange
            kort, er det bedre å sende flere små ordrer enn å samle alt i én.
          </p>
        )}
      </main>
    </>
  );
}
