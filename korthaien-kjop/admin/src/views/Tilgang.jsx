import { useState, useEffect } from "react";
import { api } from "../api.js";
import Landing, { STANDARD_TITTEL, STANDARD_TEKST } from "./Landing.jsx";

// ─────────────────────────────────────────────────────────────────────────────
// TILGANG
// ─────────────────────────────────────────────────────────────────────────────
// Hvem som slipper inn i butikken: landingssiden når butikken er stengt (ferie,
// vedlikehold), og om kundene må ha konto for å handle og selge. Sto før under
// Overgang, sammen med lagerovergangen fra Mystore — den er gjort og fjernet.

export default function Tilgang({ onFeil, onMelding }) {
  return (
    <>
      <Landingsside onFeil={onFeil} onMelding={onMelding} />
      <KrevKonto onFeil={onFeil} onMelding={onMelding} />
    </>
  );
}

function Landingsside({ onFeil, onMelding }) {
  const [s, setS] = useState(null);
  const [lagrer, setLagrer] = useState(false);

  useEffect(() => {
    api
      .innstillinger()
      .then((x) =>
        setS({
          tema: x.tema,
          dato: x.overgang_dato || "",
          aktiv: !!x.stengt?.aktiv,
          tittel: x.stengt?.tittel || "",
          tekst: x.stengt?.tekst || "",
        })
      )
      .catch(onFeil);
  }, []);

  async function lagre(endring) {
    const ny = { ...s, ...endring };
    setLagrer(true);
    try {
      const r = await api.lagreInnstillinger({
        stengt: { aktiv: ny.aktiv, tittel: ny.tittel, tekst: ny.tekst },
        overgang_dato: ny.dato,
      });
      setS({ ...ny, aktiv: !!r.stengt?.aktiv, dato: r.overgang_dato || "" });
      onMelding(r.stengt?.aktiv ? "Butikken er stengt — kundene ser landingssiden." : "Landingssiden er lagret. Butikken er åpen.");
    } catch (e) {
      onFeil(e);
    } finally {
      setLagrer(false);
    }
  }

  if (!s) return null;
  const endre = (felt, v) => setS({ ...s, [felt]: v });

  return (
    <div className="panel">
      <header>
        <h3>Landingsside</h3>
        <span className={`merkelapp ${s.aktiv ? "m-vent" : "m-lager"}`} style={{ marginLeft: "auto" }}>
          {s.aktiv ? "Butikken er stengt" : "Butikken er åpen"}
        </span>
      </header>
      <div className="krop">
        <p className="dempet" style={{ marginTop: 0, maxWidth: "70ch" }}>
          Når butikken er stengt, ser kundene denne siden i stedet for butikken, og kassen tar ikke imot ordrer.
          Du ser butikken som vanlig når du er innlogget i admin — så du kan sjekke alt før du åpner.
        </p>
        <div className="skjema" style={{ maxWidth: 560 }}>
          <label>
            Overskrift
            <input value={s.tittel} maxLength={120} placeholder={STANDARD_TITTEL} onChange={(e) => endre("tittel", e.target.value)} />
          </label>
          <label>
            Tekst
            <textarea rows={4} value={s.tekst} maxLength={600} placeholder={STANDARD_TEKST} onChange={(e) => endre("tekst", e.target.value)} />
          </label>
          <label>
            Åpner
            <input type="date" value={s.dato} onChange={(e) => endre("dato", e.target.value)} />
            <span className="dempet" style={{ fontSize: 12 }}>
              Samme dato som passordmeldingen under Kunder. Vises på landingssiden til den er passert.
            </span>
          </label>
        </div>

        <div className="dempet" style={{ fontSize: 12, margin: "16px 0 6px" }}>Forhåndsvisning</div>
        <Landing forhåndsvisning tema={s.tema} tittel={s.tittel} tekst={s.tekst} dato={s.dato} />

        <div className="rad-flex" style={{ marginTop: 14 }}>
          <button className="knapp" disabled={lagrer} onClick={() => lagre({})}>Lagre tekst</button>
          {s.aktiv ? (
            <button className="knapp primar" disabled={lagrer} onClick={() => lagre({ aktiv: false })}>Åpne butikken</button>
          ) : (
            <button className="knapp primar" disabled={lagrer} onClick={() => lagre({ aktiv: true })}>Steng butikken</button>
          )}
        </div>
      </div>
    </div>
  );
}

function KrevKonto({ onFeil, onMelding }) {
  const [på, setPå] = useState(null);
  useEffect(() => {
    api.innstillinger().then((s) => setPå(!!s.krev_konto)).catch(onFeil);
  }, []);
  async function bytt(v) {
    try {
      const s = await api.lagreInnstillinger({ krev_konto: v });
      setPå(!!s.krev_konto);
      onMelding(s.krev_konto ? "Konto kreves nå for å handle og for å selge kort." : "Gjestekjøp og innsending uten konto er slått på igjen.");
    } catch (e) {
      onFeil(e);
    }
  }
  if (på === null) return null;
  return (
    <div className="panel">
      <header>
        <h3>Konto påkrevd</h3>
        <span className={`merkelapp ${på ? "m-lager" : "m-av"}`} style={{ marginLeft: "auto" }}>{på ? "På" : "Av"}</span>
      </header>
      <div className="krop">
        <p className="dempet" style={{ marginTop: 0, maxWidth: "70ch" }}>
          Når dette er på, må kundene være innlogget med bekreftet e-postadresse for å handle, og for å sende inn kort på
          salgssiden. Salgskurven kan fortsatt brukes uten konto, så folk kan se hva de får. Oppgjør for kjøpsordrer blir
          kreditt på kontoen.
        </p>
        <label className="rad-flex" style={{ gap: 8 }}>
          <input type="checkbox" checked={på} onChange={(e) => bytt(e.target.checked)} />
          Krev konto for å handle og selge
        </label>
      </div>
    </div>
  );
}
