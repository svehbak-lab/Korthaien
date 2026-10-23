import { useState, useEffect } from "react";
import { api } from "../api.js";

// ─────────────────────────────────────────────────────────────────────────────
// UTSEENDE
// ─────────────────────────────────────────────────────────────────────────────
// Butikkens tema. Ligger i innstillingene og ikke i nettleseren: det er
// butikkens utseende, ikke ditt. Bytter du her, ser kundene det samme.
//
// Hvert valg har en liten prøve tegnet i sitt eget tema, så du ser forskjellen
// uten å måtte velge først. Prøven bruker de samme klassene som butikken, så
// den kan ikke komme i utakt med den.

const TEMAER = [
  {
    id: "dagens",
    navn: "Dagens",
    om: "Dyp sjøgrønn og messing, system-skrift. Det butikken ser ut som nå.",
  },
  {
    id: "avis",
    navn: "Avis",
    om: "Avispapir og trykksverte. Fraunces i navn og priser, doble streker under toppen, rødt bare til «Selg dine kort». Ingen runde hjørner — trykksverte kaster ikke skygge.",
  },
  {
    id: "katalog",
    navn: "Katalog",
    om: "En varefortegnelse. Tall og koder i IBM Plex Mono, så sifrene står rett under hverandre nedover lista. Den tåler tusenvis av linjer best.",
  },
  {
    id: "pergament",
    navn: "Pergament",
    om: "Blekkblått og pergament med fiber i papiret, gull til prisen, EB Garamond til kortnavnene. Cinzel én gang, i ordmerket, aldri i en liste.",
  },
];

export default function Utseende({ onFeil, onMelding }) {
  const [valgt, setValgt] = useState(null);
  const [jobber, setJobber] = useState(false);

  useEffect(() => {
    api.innstillinger().then((s) => setValgt(s.tema || "dagens")).catch(onFeil);
  }, []);

  async function velg(id) {
    const forrige = valgt;
    setValgt(id);
    setJobber(true);
    try {
      await api.lagreInnstillinger({ tema: id });
      onMelding("Temaet er byttet. Åpne Butikk for å se det.");
    } catch (e) {
      setValgt(forrige);
      onFeil(e);
    } finally {
      setJobber(false);
    }
  }

  if (!valgt) return <p className="dempet">Henter…</p>;

  return (
    <div className="panel">
      <header><h3>Butikkens utseende</h3></header>
      <div className="krop">
        <p className="dempet" style={{ margin: "0 0 16px" }}>
          Temaet gjelder butikken, ikke adminpanelet, og det gjelder for alle —
          det ligger i innstillingene og ikke i nettleseren din. Ingenting
          flytter seg når du bytter: et tema bytter farge, skrift og form,
          aldri plassering.
        </p>

        <div className="temavalg">
          {TEMAER.map((t) => (
            <button
              key={t.id}
              className={`temakort ${valgt === t.id ? "valgt" : ""}`}
              disabled={jobber}
              aria-pressed={valgt === t.id}
              onClick={() => velg(t.id)}
            >
              <Prove tema={t.id} />
              <div className="temanavn">
                {t.navn}
                {valgt === t.id && <span className="merkelapp m-lager">i bruk</span>}
              </div>
              <p className="dempet">{t.om}</p>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// Prøven er butikkens egne klasser i miniatyr: topplinjene, et kortnavn, en
// pris og tilstandsvelgeren. Den henter stilen fra samme sted som butikken,
// så det du ser her er det du får der.
function Prove({ tema }) {
  return (
    <div className="butikk prove" data-tema={tema}>
      <div className="b-skall-topp">
        <div className="b-linje1">
          <div className="b-midt">
            <span className="b-logo">
              <svg viewBox="88 22 128 136" fill="currentColor" aria-hidden="true">
                <path d="M95 150C125 132 172 88 208 30 186 76 182 118 196 150Z" />
              </svg>
              <span>Korthaien</span>
            </span>
          </div>
        </div>
        <div className="b-linje2">
          <div className="b-midt">
            <span className="b-navvalg">Alle sett</span>
            <span className="b-selg">Selg dine kort</span>
          </div>
        </div>
      </div>
      <div className="provekrop">
        <div className="lenke provenavn">Mana Crypt</div>
        <div className="dempet provesett">Eternal Masters · 225</div>
        <div className="tall pris-stor">1 890 kr</div>
        <div className="cond-valg">
          <button aria-pressed="true">NM</button>
          <button>EX</button>
          <button className="tom">VG</button>
        </div>
      </div>
    </div>
  );
}
