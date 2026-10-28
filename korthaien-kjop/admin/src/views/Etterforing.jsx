import { useState } from "react";
import { api } from "../api.js";

// ─────────────────────────────────────────────────────────────────────────────
// ETTERFØRING FRA MYSTORE
// ─────────────────────────────────────────────────────────────────────────────
// Etter en ny synk fra Mystore: kortene som fikk feil eller ingen beholdning
// ved overgangen, med differansen som kan føres inn. Du ser lista før noe
// skjer, og kan ta bort rader. Kort du har rettet for hånd etter overgangen,
// er merket og ikke valgt.

const penTid = (t) =>
  t ? new Date(t).toLocaleString("nb-NO", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "aldri";

export default function Etterforing({ onFeil, onMelding }) {
  const [data, setData] = useState(null);
  const [valgt, setValgt] = useState(new Set());
  const [laster, setLaster] = useState(false);
  const [jobber, setJobber] = useState(false);
  const [filter, setFilter] = useState("");

  const nøkkel = (r) => `${r.card_id}:${r.finish}`;

  async function hent() {
    setLaster(true);
    try {
      const d = await api.etterforing();
      setData(d);
      setValgt(new Set(d.rader.filter((r) => !r.manuelt).map(nøkkel)));
    } catch (e) {
      onFeil(e);
    }
    setLaster(false);
  }

  async function før() {
    const rader = data.rader.filter((r) => valgt.has(nøkkel(r)));
    if (!rader.length) return;
    if (!confirm(`Føre ${rader.length} rader inn i lageret?`)) return;
    setJobber(true);
    try {
      const r = await api.etterfor(rader.map((x) => ({ card_id: x.card_id, finish: x.finish })));
      onMelding(`Ført inn: ${r.rader} rader, +${r.pluss} og −${r.minus} kort.`);
      await hent();
    } catch (e) {
      onFeil(e);
    }
    setJobber(false);
  }

  const synlige = (data?.rader || []).filter((r) => {
    const q = filter.trim().toLowerCase();
    return !q || r.name.toLowerCase().includes(q) || r.set_name.toLowerCase().includes(q) || r.set_code.toLowerCase() === q;
  });
  const vekslAlle = (på) => {
    const ny = new Set(valgt);
    for (const r of synlige) (på ? ny.add(nøkkel(r)) : ny.delete(nøkkel(r)));
    setValgt(ny);
  };

  return (
    <div className="panel">
      <header><h3>Etterføring fra Mystore</h3></header>
      <div className="krop">
        <p className="dempet" style={{ marginTop: 0, maxWidth: "75ch" }}>
          Kort som fikk for få eller ingen ved overgangen, fordi synken ikke hentet hele Mystore. Kjør en ny
          synk fra Mystore først, og hent så lista. Den viser forskjellen mellom Mystore og det som ble ført inn
          — salg, innkjøp og rettelser etter overgangen røres ikke, og det du har lagt inn fra Kobling telles
          ikke to ganger.
        </p>
        <button className="knapp" onClick={hent} disabled={laster}>
          {laster ? "Regner…" : data ? "Hent på nytt" : "Vis forskjeller"}
        </button>

        {data && (
          <>
            <p style={{ margin: "12px 0 8px" }}>
              Mystore sist synket {penTid(data.sist_synket)}. <b>{data.rader.length}</b> kort med forskjell:
              {" "}+{data.pluss} kort som mangler i lageret, −{data.minus} kort for mye.
            </p>
            {data.rader.length > 0 && (
              <>
                <div className="rad-flex" style={{ marginBottom: 8 }}>
                  <input placeholder="Filtrer på kort eller sett" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ width: 240 }} />
                  <button className="knapp liten" onClick={() => vekslAlle(true)}>Velg alle viste</button>
                  <button className="knapp liten" onClick={() => vekslAlle(false)}>Fjern alle viste</button>
                  <button className="knapp primar" style={{ marginLeft: "auto" }} disabled={jobber || !valgt.size} onClick={før}>
                    {jobber ? "Fører inn…" : `Før inn ${valgt.size} valgte`}
                  </button>
                </div>
                <div style={{ maxHeight: 520, overflowY: "auto" }}>
                  <table>
                    <thead>
                      <tr>
                        <th></th><th>Kort</th><th>Sett</th><th>#</th><th>Utgave</th>
                        <th className="h">Mystore</th><th className="h">Ført inn</th><th className="h">Endring</th><th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {synlige.slice(0, 1000).map((r) => (
                        <tr key={nøkkel(r)}>
                          <td>
                            <input
                              type="checkbox"
                              checked={valgt.has(nøkkel(r))}
                              onChange={(e) => {
                                const ny = new Set(valgt);
                                e.target.checked ? ny.add(nøkkel(r)) : ny.delete(nøkkel(r));
                                setValgt(ny);
                              }}
                            />
                          </td>
                          <td title={r.produkt ? `Mystore-produkt: ${r.produkt}` : undefined}>{r.name}</td>
                          <td className="dempet" style={{ fontSize: 12.5 }}>{r.set_name}</td>
                          <td className="tall">{r.collector_number}</td>
                          <td>{r.finish === "foil" ? <span className="merkelapp m-vent">foil</span> : "vanlig"}</td>
                          <td className="h tall">{r.mystore}</td>
                          <td className="h tall">{r.overgang + r.etterfort}</td>
                          <td className="h tall" style={{ fontWeight: 700, color: r.endring > 0 ? "var(--ok)" : "var(--feil)" }}>
                            {r.endring > 0 ? `+${r.endring}` : r.endring}
                          </td>
                          <td>
                            {r.manuelt && (
                              <span className="merkelapp m-av" title="Du har endret dette kortet for hånd etter overgangen — sjekk før du fører inn">
                                rettet for hånd
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {synlige.length > 1000 && <p className="dempet">Viser 1000 av {synlige.length}. Filtrer for å se resten.</p>}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
