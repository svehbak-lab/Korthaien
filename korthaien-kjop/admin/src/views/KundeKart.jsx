import { useState, useEffect, useMemo } from "react";
import { api } from "../api.js";
import fylker from "../data/norge-fylker.json";

// ─────────────────────────────────────────────────────────────────────────────
// KUNDER PER FYLKE
// ─────────────────────────────────────────────────────────────────────────────
// Et kart over Norge der fylket blir rødere jo flere kunder som bor der.
// Fylket finnes fra postnummeret (serveren slår opp kommunen). Kartet er
// Highcharts' kart over fylkene fra 2024, basert på OpenStreetMap.
//
// Fargene er en klassisk gul–oransje–rød skala. Tallene er skjeve — Oslo og
// Akershus har mange ganger så mange kunder som Finnmark — så skalaen er
// logaritmisk; ellers ville alt utenom de to største vært nesten hvitt.

const FARGER = ["#ffffb2", "#fed976", "#feb24c", "#fd8d3c", "#fc4e2a", "#e31a1c", "#b10026"];
const INGEN = "#e9ecef";

// Mercator, så Norge ser ut som Norge og ikke strekkes i bredden.
const projiser = ([lon, lat]) => [lon, -Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) * (180 / Math.PI)];

function ringer(geometri) {
  return geometri.type === "Polygon" ? [geometri.coordinates] : geometri.coordinates;
}

export default function KundeKart({ onFeil }) {
  const [data, setData] = useState(null);
  const [over, setOver] = useState(null);

  useEffect(() => {
    api.kunderPerFylke().then(setData).catch(onFeil);
  }, []);

  // Stiene regnes én gang: kartet endrer seg ikke, bare fargene.
  const { stier, boks } = useMemo(() => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const prosjektert = fylker.features.map((f) => {
      const polygoner = ringer(f.geometry).map((poly) =>
        poly.map((ring) =>
          ring.map((pt) => {
            const [x, y] = projiser(pt);
            if (x < minX) minX = x; if (x > maxX) maxX = x;
            if (y < minY) minY = y; if (y > maxY) maxY = y;
            return [x, y];
          })
        )
      );
      return { nr: f.properties.nr, navn: f.properties.navn, polygoner };
    });
    const B = 440;
    const skala = B / (maxX - minX);
    const H = (maxY - minY) * skala;
    const stier = prosjektert.map((p) => ({
      ...p,
      d: p.polygoner
        .map((poly) =>
          poly
            .map((ring) => "M" + ring.map(([x, y]) => `${((x - minX) * skala).toFixed(1)},${((y - minY) * skala).toFixed(1)}`).join("L") + "Z")
            .join("")
        )
        .join(""),
    }));
    return { stier, boks: { B, H } };
  }, []);

  if (!data) return null;

  const tall = (nr) => data.fylker[nr] || 0;
  const verdier = stier.map((s) => tall(s.nr)).filter((n) => n > 0);
  const maks = Math.max(1, ...verdier);
  const min = Math.max(1, Math.min(...(verdier.length ? verdier : [1])));
  // Logaritmisk plass mellom minste og største fylke, delt i sju trinn.
  const trinn = (n) => {
    if (!n) return -1;
    if (maks === min) return FARGER.length - 1;
    const t = (Math.log(n) - Math.log(min)) / (Math.log(maks) - Math.log(min));
    return Math.min(FARGER.length - 1, Math.floor(t * FARGER.length));
  };
  const farge = (n) => (trinn(n) < 0 ? INGEN : FARGER[trinn(n)]);
  const grense = (i) => Math.round(Math.exp(Math.log(min) + ((Math.log(maks) - Math.log(min)) * i) / FARGER.length));
  const sum = Object.values(data.fylker).reduce((a, b) => a + b, 0);
  const liste = [...stier].sort((a, b) => tall(b.nr) - tall(a.nr));

  return (
    <div className="panel">
      <header>
        <h3>Kunder per fylke</h3>
        <span className="dempet" style={{ fontSize: 12.5 }}>
          {sum.toLocaleString("nb-NO")} kunder med norsk postnummer
          {data.fylker["21"] ? ` · ${data.fylker["21"]} på Svalbard` : ""}
          {data.utland ? ` · ${data.utland} i utlandet` : ""}
          {data.ukjent ? ` · ${data.ukjent} uten gyldig postnummer` : ""}
        </span>
      </header>
      <div className="krop" style={{ display: "flex", gap: 28, flexWrap: "wrap", alignItems: "flex-start" }}>
        <svg
          viewBox={`-4 -4 ${boks.B + 8} ${boks.H + 8}`}
          style={{ width: "100%", maxWidth: 440, height: "auto", flex: "0 1 440px" }}
          role="img"
          aria-label="Kart over Norge med antall kunder per fylke"
        >
          {stier.map((s) => (
            <path
              key={s.nr}
              d={s.d}
              fill={farge(tall(s.nr))}
              stroke={over === s.nr ? "#1b2028" : "#ffffff"}
              strokeWidth={over === s.nr ? 1.6 : 0.8}
              strokeLinejoin="round"
              onMouseEnter={() => setOver(s.nr)}
              onMouseLeave={() => setOver(null)}
            >
              <title>{`${s.navn}: ${tall(s.nr).toLocaleString("nb-NO")} kunder`}</title>
            </path>
          ))}
        </svg>

        <div style={{ flex: "1 1 260px", minWidth: 240 }}>
          <table>
            <tbody>
              {liste.map((s) => (
                <tr
                  key={s.nr}
                  onMouseEnter={() => setOver(s.nr)}
                  onMouseLeave={() => setOver(null)}
                  style={{ background: over === s.nr ? "var(--aksent-svak)" : undefined }}
                >
                  <td style={{ width: 22 }}>
                    <span style={{ display: "inline-block", width: 14, height: 14, borderRadius: 3, background: farge(tall(s.nr)), border: "1px solid rgb(0 0 0 / 12%)" }} />
                  </td>
                  <td>{s.navn}</td>
                  <td className="h tall">{tall(s.nr).toLocaleString("nb-NO")}</td>
                  <td className="h tall dempet" style={{ width: 54, whiteSpace: "nowrap" }}>
                    {sum ? `${Math.round((tall(s.nr) / sum) * 100)} %` : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div style={{ marginTop: 14 }}>
            <div style={{ display: "flex", height: 12, borderRadius: 3, overflow: "hidden" }}>
              {FARGER.map((f) => <div key={f} style={{ flex: 1, background: f }} />)}
            </div>
            <div className="dempet" style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, marginTop: 3 }}>
              <span>{min}</span>
              <span>{grense(Math.round(FARGER.length / 2))}</span>
              <span>{maks}</span>
            </div>
            <div className="dempet" style={{ fontSize: 11, marginTop: 6 }}>
              Logaritmisk skala. Kart: {fylker.kilde || "OpenStreetMap"}.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
