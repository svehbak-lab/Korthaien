import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import Butikk from "./views/Butikk.jsx";
import Landing from "./views/Landing.jsx";
import { kunde } from "./api.js";
import "./skrifter.js";
import "./styles.css";

// Butikken står alene (korthaien.no): adressen følger det kunden ser.
window.__butikkAlene = true;

// ─────────────────────────────────────────────────────────────────────────────
// BUTIKKEN SOM EGEN SIDE
// ─────────────────────────────────────────────────────────────────────────────
// Samme butikk som under «Butikk» i admin, men uten admin rundt: ingen meny,
// ingen innlogging. Alt den henter går mot de offentlige /api/butikk-rutene.
// Er butikken stengt, ser kundene landingssiden. Er du innlogget i admin i
// samme nettleser, ser du butikken likevel, med en stripe øverst som minner
// deg på at kundene ikke gjør det.

function Rot() {
  const [f, setF] = useState(null);
  const [feil, setFeil] = useState("");

  useEffect(() => {
    kunde.foretak().then(setF).catch(() => setF({}));
  }, []);

  if (!f) return null;
  if (f.stengt?.aktiv && !f.admin) {
    return <Landing tema={f.tema} tittel={f.stengt.tittel} tekst={f.stengt.tekst} dato={f.overgang_dato} />;
  }
  return (
    <>
      {f.stengt?.aktiv && f.admin && (
        <div className="stengt-stripe">Butikken er stengt for kunder — du ser den fordi du er innlogget i admin.</div>
      )}
      {feil && <div className="varsel feil" style={{ margin: 0, borderRadius: 0 }}>{feil}</div>}
      <main className="butikk-alene">
        <Butikk
          onFeil={(e) => {
            setFeil(e?.message || String(e));
            setTimeout(() => setFeil(""), 6000);
          }}
        />
      </main>
    </>
  );
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <Rot />
  </StrictMode>
);
