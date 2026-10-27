import { useState, useEffect } from "react";
import {
  api, leggTil, settAntall, settCondition, byttTilbud, antallKort, tilLinjer,
  lagre, tøm, gjenopprett, LEVETID_TIMER,
} from "./api.js";
import Søk from "./views/Sok.jsx";
import Bulk from "./views/Bulk.jsx";
import { Kurv, Gjennomgang, Skjema, Kvittering } from "./views/Kasse.jsx";
import Oppslag from "./views/Oppslag.jsx";
import Vilkår from "./views/Vilkar.jsx";
import Tilstander from "./views/Tilstander.jsx";
import { Topp, Bunn } from "./views/Ramme.jsx";

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
  // Kontoen i butikken. Etter overgangen må kunden være innlogget for å
  // sende inn — men kan legge i kurven og se prisene uten.
  const [meg, setMeg] = useState({ lastet: false, kunde: null });
  useEffect(() => {
    api.meg().then((r) => setMeg({ lastet: true, kunde: r.kunde })).catch(() => setMeg({ lastet: true, kunde: null }));
  }, []);

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
      .finally(() => {
        if (avbrutt) return;
        setKlar(true);
        // Tilbake fra innloggingen i butikken: rett til skjemaet igjen.
        const p = new URLSearchParams(window.location.search);
        if (p.get("steg") === "skjema") {
          window.history.replaceState(null, "", window.location.pathname);
          setSteg("skjema");
        }
      });
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
    <div className="kh" data-tema={config?.tema || "dagens"}>
      <Topp
        config={config}
        meg={meg}
        antallSelg={antallKort(kurv)}
        onSelgKurv={() => { setSteg(tomKurv ? "velg" : "gjennomgang"); window.scrollTo(0, 0); }}
      />

      <main className="ark">
        {steg === "velg" && (
          <div className="sidehode">
            <div>
              <h1>Selg kortene dine til Korthaien</h1>
              <p className="ingress">
                Søk opp kortene eller lim inn hele lista. Du ser prisen med én gang,
                og hvor mange jeg har plass til. Oppgjøret er butikkreditt på kontoen din.
              </p>
            </div>
            <button className="knapp blank ingen-print" onClick={() => setSteg("oppslag")}>
              Finn ordren min
            </button>
          </div>
        )}
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
          // Guiden har eksempelbilder i to spalter og trenger hele bredden.
          // Kurven er uansett tom mens man leser den.
          <div className={fane === "guide" ? undefined : "todelt"}>
            <div>
              <div className="faner" role="tablist">
                <button role="tab" aria-selected={fane === "sok"} onClick={() => setFane("sok")}>
                  Søk etter kort
                </button>
                <button role="tab" aria-selected={fane === "bulk"} onClick={() => setFane("bulk")}>
                  Lim inn liste
                </button>
                {/* Guiden hører hjemme på samme linje, men ikke i samme rekke
                    som de to måtene å legge inn kort på. Den skyves til høyre
                    så det leses som to grupper. */}
                <button
                  role="tab"
                  aria-selected={fane === "guide"}
                  onClick={() => setFane("guide")}
                  style={{ marginLeft: "auto" }}
                >
                  Tilstandsguide
                </button>
              </div>

              {fane === "sok" && (
                <Søk
                  kurv={kurv}
                  onLegg={legg}
                  onFeil={visFeil}
                  onTilstander={() => setFane("guide")}
                />
              )}
              {fane === "bulk" && <Bulk kurv={kurv} onLegg={legg} onFeil={visFeil} />}
              {fane === "guide" && <Tilstander onTilbake={() => setFane("sok")} />}
            </div>

            {fane !== "guide" && <Kurv
              kurv={kurv}
              minOrdreØre={config?.min_order_ore}
              onAntall={(k, n) => setKurv((c) => settAntall(c, k, n))}
              onCondition={(k, c) => setKurv((v) => settCondition(v, k, c))}
              onVidere={() => { setSteg("gjennomgang"); window.scrollTo(0, 0); }}
            />}
          </div>
        )}

        {steg === "gjennomgang" && (
          <Gjennomgang
            kurv={kurv}
            minOrdreØre={config?.min_order_ore}
            onAntall={(k, n) => setKurv((c) => settAntall(c, k, n))}
            onCondition={(k, c) => setKurv((v) => settCondition(v, k, c))}
            onBytt={(k, t) => setKurv((v) => byttTilbud(v, k, t))}
            onTilbake={() => setSteg("velg")}
            onVidere={() => { setSteg("skjema"); window.scrollTo(0, 0); }}
          />
        )}

        {steg === "skjema" && (
          <Skjema
            kurv={kurv}
            config={config}
            meg={meg}
            sender={sender}
            onTilbake={() => setSteg("gjennomgang")}
            onVilkår={() => { setSteg("vilkar"); window.scrollTo(0, 0); }}
            onSend={send}
          />
        )}

        {steg === "kvittering" && ordre && (
          <Kvittering ordre={ordre} onNy={() => { setOrdre(null); setSteg("velg"); }} />
        )}

        {steg === "oppslag" && <Oppslag onFeil={visFeil} onTilbake={() => setSteg("velg")} />}

        {steg === "vilkar" && <Vilkår config={config} onTilbake={() => setSteg("velg")} />}

        {steg !== "velg" && steg !== "kvittering" && steg !== "oppslag" && steg !== "vilkar" && tomKurv && (
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
      <Bunn
        config={config}
        onVilkår={() => { setSteg("vilkar"); window.scrollTo(0, 0); }}
        onOppslag={() => { setSteg("oppslag"); window.scrollTo(0, 0); }}
      />
    </div>
  );
}
