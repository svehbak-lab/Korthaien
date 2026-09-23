import { useState, useEffect } from "react";
import { api, kroner } from "../api.js";

const MND = [
  "januar", "februar", "mars", "april", "mai", "juni",
  "juli", "august", "september", "oktober", "november", "desember",
];

function navnPåMåned(mnd) {
  const [år, m] = mnd.split("-");
  return `${MND[Number(m) - 1]} ${år}`;
}

// Tallene ligger over ordrelista og ikke bak en egen fane. Statistikk du må
// klikke deg inn på, er statistikk du ikke ser — her leser du den hver gang
// du er innom for å behandle en ordre.
export default function Statistikk({ onFeil }) {
  const [data, setData] = useState(null);
  const [åpen, setÅpen] = useState(false);

  useEffect(() => {
    api.statistikk().then(setData).catch(onFeil);
  }, []);

  if (!data) return null;

  const { denneMåneden, forrigeMåned, hittilIÅr } = data;
  const avlyst = hittilIÅr.avlyst;

  return (
    <div className="panel" style={{ marginBottom: 16, padding: "16px 18px" }}>
      <div className="rad-flex" style={{ gap: 32, flexWrap: "wrap" }}>
        <Tall merke="Denne måneden" m={denneMåneden} />
        <Tall merke="Forrige måned" m={forrigeMåned} />
        <Tall merke="Hittil i år" m={hittilIÅr} />
        <button
          className="knapp liten"
          style={{ marginLeft: "auto", alignSelf: "center" }}
          onClick={() => setÅpen(!åpen)}
        >
          {åpen ? "Skjul historikk" : "Vis historikk"}
        </button>
      </div>

      {avlyst > 0 && (
        <div className="dempet" style={{ fontSize: 12, marginTop: 10 }}>
          I tillegg {avlyst} {avlyst === 1 ? "ordre" : "ordrer"} kansellert eller utløpt i år,
          til sammen {kroner(hittilIÅr.avlyst_ore)}. Ikke medregnet i tallene over.
        </div>
      )}

      {åpen && <Historikk data={data} />}
    </div>
  );
}

function Tall({ merke, m }) {
  return (
    <div>
      <div className="dempet" style={{ fontSize: 12 }}>{merke}</div>
      <div style={{ fontSize: 24, fontWeight: 700, lineHeight: 1.2 }}>{kroner(m.sum_ore)}</div>
      <div className="dempet" style={{ fontSize: 12 }}>
        {m.antall} {m.antall === 1 ? "ordre" : "ordrer"}
      </div>
    </div>
  );
}

function Historikk({ data }) {
  if (!data.måneder.length) {
    return <p className="dempet" style={{ marginTop: 14 }}>Ingen ordrer ennå.</p>;
  }

  // Månedene grupperes under året sitt, med årssummen som overskrift. Da ser
  // du både utviklingen gjennom året og året som helhet uten å regne selv.
  const perÅr = new Map();
  for (const m of data.måneder) {
    const år = m.mnd.slice(0, 4);
    if (!perÅr.has(år)) perÅr.set(år, []);
    perÅr.get(år).push(m);
  }

  return (
    <div style={{ marginTop: 16 }}>
      {[...perÅr.entries()].map(([år, måneder]) => {
        const sum = data.år.find((x) => x.mnd === år);
        return (
          <div key={år} style={{ marginBottom: 18 }}>
            <div className="rad-flex" style={{ justifyContent: "space-between", fontWeight: 700 }}>
              <span>{år}</span>
              <span>
                {sum?.antall ?? 0} {sum?.antall === 1 ? "ordre" : "ordrer"} — {kroner(sum?.sum_ore ?? 0)}
              </span>
            </div>
            <table className="tabell" style={{ width: "100%", marginTop: 6 }}>
              <tbody>
                {måneder.map((m) => (
                  <tr key={m.mnd}>
                    <td>{navnPåMåned(m.mnd)}</td>
                    <td style={{ textAlign: "right", width: 110 }} className="dempet">
                      {m.antall} {m.antall === 1 ? "ordre" : "ordrer"}
                    </td>
                    <td style={{ textAlign: "right", width: 130 }}>{kroner(m.sum_ore)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}
