import { useState, useEffect, useMemo } from "react";
import { api, kroner } from "../api.js";

const RARITET_NAVN = {
  mythic: "Mythic",
  rare: "Rare",
  uncommon: "Uncommon",
  common: "Common",
  special: "Special",
  bonus: "Bonus",
  ukjent: "Uten raritet",
};

const tom = () => ({ antall: 0, verdi_ore: 0, uten_pris: 0 });

function legg(sum, rad) {
  sum.antall += rad.antall;
  sum.verdi_ore += rad.verdi_ore;
  sum.uten_pris += rad.uten_pris;
  return sum;
}

export default function Lagerrapport({ onFeil }) {
  const [data, setData] = useState(null);
  const [laster, setLaster] = useState(true);
  const [vanlig, setVanlig] = useState(true);
  const [foil, setFoil] = useState(true);
  const [åpne, setÅpne] = useState(() => new Set());

  useEffect(() => {
    api.lagerrapport()
      .then(setData)
      .catch(onFeil)
      .finally(() => setLaster(false));
  }, []);

  // Summene regnes her og ikke på serveren, slik at settlinjene og totalen
  // alltid viser det avkryssingene faktisk sier.
  const sett = useMemo(() => {
    if (!data) return [];
    return data.sett
      .map((s) => {
        const rader = s.rader.filter(
          (r) => (r.finish === "foil" ? foil : vanlig)
        );
        return { ...s, rader, sum: rader.reduce(legg, tom()) };
      })
      .filter((s) => s.sum.antall > 0);
  }, [data, vanlig, foil]);

  const total = useMemo(() => sett.map((s) => s.sum).reduce(legg, tom()), [sett]);

  if (laster) return <p className="dempet">Regner ut lagerverdi…</p>;
  if (!data) return null;

  if (!data.sett.length) {
    return (
      <div className="panel">
        <div className="tom">
          <b>Ingenting på lager ennå</b>
          Kort kommer inn her når du gjør opp en kjøpsordre.
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="panel" style={{ marginBottom: 16, padding: "16px 18px" }}>
        <div className="rad-flex" style={{ gap: 32, flexWrap: "wrap" }}>
          <div>
            <div className="dempet" style={{ fontSize: 12 }}>Kort på lager</div>
            <div style={{ fontSize: 24, fontWeight: 700, lineHeight: 1.2 }}>
              {total.antall.toLocaleString("nb-NO")}
            </div>
          </div>
          <div>
            <div className="dempet" style={{ fontSize: 12 }}>Samlet salgsverdi</div>
            <div style={{ fontSize: 24, fontWeight: 700, lineHeight: 1.2 }}>
              {kroner(total.verdi_ore)}
            </div>
          </div>

          <div style={{ marginLeft: "auto", alignSelf: "center" }}>
            <label style={{ marginRight: 14 }}>
              <input type="checkbox" checked={vanlig} onChange={(e) => setVanlig(e.target.checked)} />{" "}
              Vanlig
            </label>
            <label>
              <input type="checkbox" checked={foil} onChange={(e) => setFoil(e.target.checked)} /> Foil
            </label>
          </div>
        </div>

        {total.uten_pris > 0 && (
          <div className="dempet" style={{ fontSize: 12, marginTop: 10 }}>
            {total.uten_pris.toLocaleString("nb-NO")} kort har ingen salgspris og teller ikke i
            verdien. Sett en manuell pris på dem, eller la dem stå — de er med i antallet.
          </div>
        )}
      </div>

      {!vanlig && !foil && (
        <div className="varsel info">Huk av vanlig eller foil for å se noe.</div>
      )}

      <table className="tabell" style={{ width: "100%" }}>
        <thead>
          <tr>
            <th>Sett</th>
            <th style={{ textAlign: "right", width: 120 }}>Antall</th>
            <th style={{ textAlign: "right", width: 150 }}>Salgsverdi</th>
            <th style={{ textAlign: "right", width: 110 }}>Uten pris</th>
          </tr>
        </thead>
        <tbody>
          {sett.map((s) => (
            <SettRad
              key={s.set_code}
              sett={s}
              åpen={åpne.has(s.set_code)}
              onKlikk={() =>
                setÅpne((f) => {
                  const ny = new Set(f);
                  ny.has(s.set_code) ? ny.delete(s.set_code) : ny.add(s.set_code);
                  return ny;
                })
              }
            />
          ))}
        </tbody>
      </table>
    </>
  );
}

function SettRad({ sett, åpen, onKlikk }) {
  return (
    <>
      <tr
        onClick={onKlikk}
        style={{ cursor: "pointer", fontWeight: 600 }}
        aria-expanded={åpen}
      >
        <td>
          <span className="dempet" style={{ display: "inline-block", width: 18 }}>
            {åpen ? "−" : "+"}
          </span>
          {sett.set_name}
          <span className="kode dempet"> {sett.set_code.toUpperCase()}</span>
        </td>
        <td style={{ textAlign: "right" }}>{sett.sum.antall.toLocaleString("nb-NO")}</td>
        <td style={{ textAlign: "right" }}>{kroner(sett.sum.verdi_ore)}</td>
        <td style={{ textAlign: "right" }} className="dempet">
          {sett.sum.uten_pris || ""}
        </td>
      </tr>

      {åpen &&
        sett.rader.map((r) => (
          <tr key={`${r.rarity}:${r.finish}`} className="dempet">
            <td style={{ paddingLeft: 36 }}>
              {RARITET_NAVN[r.rarity] || r.rarity}
              {r.finish === "foil" && (
                <span className="merkelapp m-foil" style={{ marginLeft: 6 }}>Foil</span>
              )}
            </td>
            <td style={{ textAlign: "right" }}>{r.antall.toLocaleString("nb-NO")}</td>
            <td style={{ textAlign: "right" }}>{kroner(r.verdi_ore)}</td>
            <td style={{ textAlign: "right" }}>{r.uten_pris || ""}</td>
          </tr>
        ))}
    </>
  );
}
