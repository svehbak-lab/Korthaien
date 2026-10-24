import { useState, useEffect } from "react";
import { api, kroner, lastNedPdf } from "../api.js";

// ─────────────────────────────────────────────────────────────────────────────
// RAPPORTER
// ─────────────────────────────────────────────────────────────────────────────
// Én periode, én kjøring, to PDF-er. Salgslisten har en linje per salg;
// oppsummeringen er én side med salg med og uten mva — den er bilaget i
// regnskapet. Begge leser de samme radene, så tallene kan ikke spri.
//
// Et salg teller på betalingsdatoen. Kortene er uten mva (avansemetoden,
// momsen beregnes senere); frakten er med mva.

const iso = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function forvalg() {
  const nå = new Date();
  const å = nå.getFullYear();
  const m = nå.getMonth();
  return [
    { navn: "Denne måneden", fra: iso(new Date(å, m, 1)), til: iso(new Date(å, m + 1, 0)) },
    { navn: "Forrige måned", fra: iso(new Date(å, m - 1, 1)), til: iso(new Date(å, m, 0)) },
    // Mva-terminene er to måneder: jan–feb, mar–apr osv.
    {
      navn: "Denne mva-terminen",
      fra: iso(new Date(å, m - (m % 2), 1)),
      til: iso(new Date(å, m - (m % 2) + 2, 0)),
    },
    {
      navn: "Forrige mva-termin",
      fra: iso(new Date(å, m - (m % 2) - 2, 1)),
      til: iso(new Date(å, m - (m % 2), 0)),
    },
    { navn: "I år", fra: iso(new Date(å, 0, 1)), til: iso(new Date(å, 11, 31)) },
    { navn: "I fjor", fra: iso(new Date(å - 1, 0, 1)), til: iso(new Date(å - 1, 11, 31)) },
  ];
}

const norsk = (d) => d.split("-").reverse().join(".");

export default function Rapporter({ onFeil }) {
  const valg = forvalg();
  const [fra, setFra] = useState(valg[1].fra);
  const [til, setTil] = useState(valg[1].til);
  const [rapport, setRapport] = useState(null);
  const [henter, setHenter] = useState(false);
  const [laster, setLaster] = useState("");

  const gyldig = fra && til && fra <= til;

  useEffect(() => {
    if (!gyldig) return;
    let avbrutt = false;
    setHenter(true);
    api
      .salgsrapport(fra, til)
      .then((r) => !avbrutt && setRapport(r))
      .catch((e) => !avbrutt && onFeil(e))
      .finally(() => !avbrutt && setHenter(false));
    return () => {
      avbrutt = true;
    };
  }, [fra, til]);

  async function pdf(type) {
    setLaster(type);
    try {
      const navn = type === "oppsummering" ? "salgsoppsummering" : "salgsliste";
      await lastNedPdf(`/api/admin/rapporter/salg.pdf?fra=${fra}&til=${til}&type=${type}`, `${navn}_${fra}_${til}.pdf`);
    } catch (e) {
      onFeil(e);
    } finally {
      setLaster("");
    }
  }

  const sum = rapport?.sum;

  return (
    <div className="panel">
      <header>
        <h3>Salgsrapport</h3>
      </header>
      <div className="krop">
        <div className="rad-flex" style={{ marginBottom: 10 }}>
          <label className="rad-flex" style={{ gap: 6 }}>
            Fra
            <input type="date" value={fra} onChange={(e) => setFra(e.target.value)} />
          </label>
          <label className="rad-flex" style={{ gap: 6 }}>
            Til
            <input type="date" value={til} onChange={(e) => setTil(e.target.value)} />
          </label>
          {!gyldig && <span style={{ color: "var(--feil)" }}>Fra-datoen må være før til-datoen.</span>}
        </div>
        <div className="rad-flex" style={{ marginBottom: 16 }}>
          {valg.map((v) => (
            <button
              key={v.navn}
              className="knapp liten"
              aria-pressed={fra === v.fra && til === v.til}
              style={fra === v.fra && til === v.til ? { borderColor: "var(--aksent)", color: "var(--aksent)" } : undefined}
              onClick={() => {
                setFra(v.fra);
                setTil(v.til);
              }}
            >
              {v.navn}
            </button>
          ))}
        </div>

        {sum && gyldig && (
          <>
            <table style={{ maxWidth: 460, marginBottom: 16 }}>
              <tbody>
                <tr>
                  <td>Salg med mva <span className="dempet">(frakt, inkl. 25 % mva)</span></td>
                  <td className="h tall">{kroner(sum.med_mva_ore)}</td>
                </tr>
                <tr>
                  <td className="dempet" style={{ paddingLeft: 24 }}>herav mva</td>
                  <td className="h tall dempet">{kroner(sum.herav_mva_ore)}</td>
                </tr>
                <tr>
                  <td>Salg uten mva <span className="dempet">(kort, avansemetoden)</span></td>
                  <td className="h tall">{kroner(sum.uten_mva_ore)}</td>
                </tr>
                <tr>
                  <td><b>Totalt</b> <span className="dempet">· {rapport.rader.length} salg</span></td>
                  <td className="h tall"><b>{kroner(sum.totalt_ore)}</b></td>
                </tr>
              </tbody>
            </table>

            <div className="rad-flex" style={{ marginBottom: 18 }}>
              <button className="knapp primar" disabled={!!laster} onClick={() => pdf("oppsummering")}>
                {laster === "oppsummering" ? "Lager PDF…" : "Oppsummering (PDF)"}
              </button>
              <button className="knapp" disabled={!!laster} onClick={() => pdf("liste")}>
                {laster === "liste" ? "Lager PDF…" : "Salgsliste (PDF)"}
              </button>
              <span className="dempet">
                {norsk(fra)}–{norsk(til)}. Oppsummeringen er bilaget; salgslisten viser hvert salg.
              </span>
            </div>

            {rapport.rader.length ? (
              <div style={{ maxHeight: 420, overflow: "auto", border: "1px solid var(--strek)", borderRadius: 6 }}>
                <table>
                  <thead>
                    <tr>
                      <th>Dato</th>
                      <th>Ordrenr</th>
                      <th>Kunde</th>
                      <th className="h">Uten mva</th>
                      <th className="h">Med mva</th>
                      <th className="h">Sum</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rapport.rader.map((r) => (
                      <tr key={r.ordrenr}>
                        <td className="tall">{norsk(r.dato)}</td>
                        <td className="kode">{r.ordrenr}</td>
                        <td>{r.kunde}</td>
                        <td className="h tall">{kroner(r.uten_mva_ore)}</td>
                        <td className="h tall">{kroner(r.med_mva_ore)}</td>
                        <td className="h tall">{kroner(r.uten_mva_ore + r.med_mva_ore)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="dempet" style={{ margin: 0 }}>
                {henter
                  ? "Henter…"
                  : "Ingen salg i perioden. Salgene kommer hit når kassen i den nye butikken er i drift."}
              </p>
            )}
          </>
        )}
        {!sum && gyldig && <p className="dempet">Henter…</p>}
      </div>
    </div>
  );
}
