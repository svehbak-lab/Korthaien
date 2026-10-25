import { useState, useEffect } from "react";
import { kunde as kapi } from "../api.js";
import { useHandel } from "./Handel.jsx";

// ─────────────────────────────────────────────────────────────────────────────
// ØNSKELISTE
// ─────────────────────────────────────────────────────────────────────────────
// På kortsiden: «Varsle meg når den er på lager», for denne utgaven eller
// hvilken som helst. På «Min side»: lista, med status og mulighet til å fjerne.

export function Ønske({ kort, onLoggInn }) {
  const h = useHandel();
  const [åpen, setÅpen] = useState(false);
  const [hvilken, setHvilken] = useState("alle");
  const [finish, setFinish] = useState("alle");
  const [lagt, setLagt] = useState(false);
  const [feil, setFeil] = useState("");

  if (!h.kunde) {
    return (
      <button type="button" className="knapp" style={{ width: "100%", marginTop: 8 }} onClick={onLoggInn}>
        ♡ Varsle meg når den er inne
        <div className="dempet" style={{ fontSize: 11.5 }}>Logg inn for å bruke ønskelista</div>
      </button>
    );
  }
  if (lagt) {
    return <div style={{ marginTop: 10, fontSize: 13, color: "var(--ok)" }}>♥ Lagt på ønskelista. Du får e-post når den er på lager.</div>;
  }
  if (!åpen) {
    return (
      <button type="button" className="knapp" style={{ width: "100%", marginTop: 8 }} onClick={() => setÅpen(true)}>
        ♡ Legg på ønskelista
      </button>
    );
  }
  return (
    <div className="onske-valg">
      <label><input type="radio" checked={hvilken === "alle"} onChange={() => setHvilken("alle")} /> Hvilken som helst utgave</label>
      <label><input type="radio" checked={hvilken === "denne"} onChange={() => setHvilken("denne")} /> Bare {kort.set_name}</label>
      <select value={finish} onChange={(e) => setFinish(e.target.value)} style={{ width: "100%", marginTop: 4 }}>
        <option value="alle">Vanlig eller foil</option>
        <option value="nonfoil">Bare vanlig</option>
        <option value="foil">Bare foil</option>
      </select>
      {feil && <div style={{ color: "var(--feil)", fontSize: 12 }}>{feil}</div>}
      <button
        type="button" className="knapp primar" style={{ width: "100%", marginTop: 6 }}
        onClick={async () => {
          try {
            await kapi.leggOnske({ card_id: kort.id, hvilken, finish });
            setLagt(true);
          } catch (e) {
            setFeil(e.message);
          }
        }}
      >
        Varsle meg når den er inne
      </button>
      {!h.kunde.bekreftet && (
        <div className="dempet" style={{ fontSize: 11.5, marginTop: 4 }}>Bekreft e-postadressen din for å få e-post.</div>
      )}
    </div>
  );
}

const FINISH = { alle: "", foil: " · bare foil", nonfoil: " · bare vanlig" };

export function Ønskeliste() {
  const [liste, setListe] = useState(null);
  useEffect(() => {
    kapi.onskeliste().then((r) => setListe(r.onsker)).catch(() => setListe([]));
  }, []);
  if (!liste) return <p className="dempet">Henter…</p>;
  if (!liste.length) {
    return (
      <div className="panel"><div className="tom">
        <b>Ønskelista er tom</b>
        Åpne et kort og trykk «Legg på ønskelista», så får du e-post når det er på lager.
      </div></div>
    );
  }
  return (
    <div className="panel">
      <table>
        <thead><tr><th>Kort</th><th>Status</th><th /></tr></thead>
        <tbody>
          {liste.map((ø) => (
            <tr key={ø.id}>
              <td>
                <b>{ø.navn}</b>
                <div className="dempet" style={{ fontSize: 12.5 }}>
                  {ø.card_id ? `${ø.set_name || ""}${ø.collector_number ? ` #${ø.collector_number}` : ""}` : "Hvilken som helst utgave"}
                  {FINISH[ø.finish] || ""}
                </div>
              </td>
              <td>
                {ø.på_lager > 0
                  ? <a href={`?kort=${encodeURIComponent(ø.kort_id)}`} style={{ color: "var(--ok)", fontWeight: 600 }}>På lager ({ø.på_lager}) →</a>
                  : <span className="dempet">Venter</span>}
              </td>
              <td className="h">
                <button className="knapp liten" onClick={async () => setListe((await kapi.fjernOnske(ø.id)).onsker)}>Fjern</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
