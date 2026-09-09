import { useState, useEffect } from "react";
import { api, kroner, dato, dagerTil, CONDITIONS } from "../api.js";

const STATUS = {
  pending: { navn: "Venter i posten", klasse: "m-vent" },
  received: { navn: "Mottatt", klasse: "m-mottatt" },
  stocked: { navn: "Lagerført", klasse: "m-lager" },
  cancelled: { navn: "Kansellert", klasse: "m-av" },
  expired: { navn: "Utløpt", klasse: "m-av" },
};

export default function Ordrer({ onFeil, onAntall }) {
  const [arkiv, setArkiv] = useState(false);
  const [ordrer, setOrdrer] = useState([]);
  const [åpen, setÅpen] = useState(null);
  const [laster, setLaster] = useState(true);

  async function last() {
    setLaster(true);
    try {
      const d = await api.ordrer(arkiv);
      setOrdrer(d);
      if (!arkiv) onAntall(d.length);
    } catch (e) {
      onFeil(e);
    } finally {
      setLaster(false);
    }
  }

  useEffect(() => {
    last();
  }, [arkiv]);

  if (laster) return <p className="dempet">Henter ordrer…</p>;

  return (
    <>
      <div className="rad-flex" style={{ marginBottom: 14 }}>
        <button className={`knapp ${!arkiv ? "primar" : ""}`} onClick={() => setArkiv(false)}>
          Aktive
        </button>
        <button className={`knapp ${arkiv ? "primar" : ""}`} onClick={() => setArkiv(true)}>
          Arkiv
        </button>
        <button className="knapp" onClick={last}>Oppdater</button>
      </div>

      {!ordrer.length && (
        <div className="panel">
          <div className="tom">
            <b>{arkiv ? "Arkivet er tomt" : "Ingen ordrer venter"}</b>
            {arkiv ? "Ordrer havner her når de er lagerført." : "Nye salg dukker opp her med én gang de sendes inn."}
          </div>
        </div>
      )}

      {ordrer.map((o) => (
        <Ordre
          key={o.id}
          ordre={o}
          åpen={åpen === o.id}
          onVeksle={() => setÅpen(åpen === o.id ? null : o.id)}
          onEndret={last}
          onFeil={onFeil}
        />
      ))}
    </>
  );
}

function Ordre({ ordre, åpen, onVeksle, onEndret, onFeil }) {
  const s = STATUS[ordre.status] || STATUS.pending;
  const dager = dagerTil(ordre.expires_at);
  const antallKort = ordre.linjer.reduce((n, l) => n + l.qty, 0);

  async function sett(status) {
    try {
      await api.endreOrdre(ordre.id, { status });
      onEndret();
    } catch (e) {
      onFeil(e);
    }
  }

  return (
    <div className="panel">
      <header>
        <button className="knapp liten" onClick={onVeksle} aria-expanded={åpen}>
          {åpen ? "Skjul" : "Åpne"}
        </button>
        <span className="kode">{ordre.order_no}</span>
        <strong>{ordre.customer_name}</strong>
        <span className={`merkelapp ${s.klasse}`}>{s.navn}</span>
        <span className="dempet">
          {antallKort} kort · {ordre.linjer.length} linjer · {dato(ordre.created_at)}
        </span>
        {ordre.status === "pending" && dager !== null && (
          <span className="dempet" title="Reservasjonen frigjøres når fristen går ut">
            {dager > 0 ? `${dager} dager igjen` : "Fristen har gått ut"}
          </span>
        )}
        <span style={{ marginLeft: "auto" }} className="sum">{kroner(ordre.total_nok)}</span>
      </header>

      {åpen && (
        <div className="krop">
          <div className="rad-flex" style={{ marginBottom: 14 }}>
            <a href={`mailto:${ordre.email}`}>{ordre.email}</a>
            {ordre.phone && <span className="dempet">{ordre.phone}</span>}
            {ordre.note && <span className="dempet">Melding: {ordre.note}</span>}
          </div>

          <Linjer linjer={ordre.linjer} onEndret={onEndret} onFeil={onFeil} />

          <div className="spred" style={{ marginTop: 16 }}>
            <span className="dempet">
              {ordre.status === "received"
                ? "Kvoten holdes til du merker ordren lagerført."
                : ordre.status === "pending"
                ? "Kortene er ikke kommet ennå."
                : ""}
            </span>
            <div className="rad-flex">
              {ordre.status === "pending" && (
                <>
                  <button className="knapp fare" onClick={() => sett("cancelled")}>Kanseller</button>
                  <button className="knapp primar" onClick={() => sett("received")}>Merk mottatt</button>
                </>
              )}
              {ordre.status === "received" && (
                <>
                  <button className="knapp" onClick={() => sett("pending")}>Angre mottak</button>
                  <button className="knapp primar" onClick={() => sett("stocked")}>Lagerført i Mystore</button>
                </>
              )}
              {["stocked", "cancelled", "expired"].includes(ordre.status) && (
                <button className="knapp" onClick={() => sett("pending")}>Åpne på nytt</button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Kortene ligger sortert på sett og navn, i samme rekkefølge som kunden ble
// bedt om å sortere bunken. Gå gjennom stabelen og lista i takt.
function Linjer({ linjer, onEndret, onFeil }) {
  return (
    <table className="kontroll">
      <thead>
        <tr>
          <th>Kort</th>
          <th>Utgave</th>
          <th>Cond.</th>
          <th className="h">Bestilt</th>
          <th className="h">Mottatt</th>
          <th className="h">Stk.pris</th>
          <th className="h">Sum</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {linjer.map((l) => (
          <Linje key={l.id} linje={l} onEndret={onEndret} onFeil={onFeil} />
        ))}
      </tbody>
    </table>
  );
}

function Linje({ linje, onEndret, onFeil }) {
  const [mottatt, setMottatt] = useState(linje.qty_received ?? linje.qty);
  const [pris, setPris] = useState(linje.unit_nok);
  const [cond, setCond] = useState(linje.condition);
  const [lagrer, setLagrer] = useState(false);

  const endret =
    mottatt !== (linje.qty_received ?? linje.qty) || pris !== linje.unit_nok || cond !== linje.condition;
  const avvik = mottatt !== linje.qty;

  async function lagre() {
    setLagrer(true);
    try {
      await api.endreLinje(linje.id, { qty_received: mottatt, unit_nok: pris, condition: cond });
      onEndret();
    } catch (e) {
      onFeil(e);
    } finally {
      setLagrer(false);
    }
  }

  async function slett() {
    if (!confirm(`Fjerne ${linje.card_name} fra ordren?`)) return;
    try {
      await api.slettLinje(linje.id);
      onEndret();
    } catch (e) {
      onFeil(e);
    }
  }

  return (
    <tr data-avvik={avvik ? "true" : "false"}>
      <td>
        <div>{linje.card_name}</div>
        <div className="sett">{linje.set_name}</div>
      </td>
      <td>
        <span className="kode">{linje.set_code.toUpperCase()}</span>{" "}
        {linje.collector_number && <span className="kode dempet">#{linje.collector_number}</span>}
        {linje.finish === "foil" && <span className="merkelapp m-vent" style={{ marginLeft: 6 }}>Foil</span>}
      </td>
      <td>
        <select value={cond} onChange={(e) => setCond(e.target.value)}>
          {CONDITIONS.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </td>
      <td className="h">{linje.qty}</td>
      <td className="h">
        <input
          type="number"
          min="0"
          value={mottatt}
          onChange={(e) => setMottatt(Math.max(0, parseInt(e.target.value) || 0))}
        />
      </td>
      <td className="h">
        <input
          type="number"
          className="pris"
          min="0"
          value={pris}
          onChange={(e) => setPris(Math.max(0, parseInt(e.target.value) || 0))}
        />
      </td>
      <td className="h tall">{kroner(mottatt * pris)}</td>
      <td className="h">
        <div className="rad-flex" style={{ justifyContent: "flex-end" }}>
          {endret && (
            <button className="knapp liten primar" onClick={lagre} disabled={lagrer}>
              Lagre
            </button>
          )}
          <button className="knapp liten fare" onClick={slett} title="Fjern linjen">
            Fjern
          </button>
        </div>
      </td>
    </tr>
  );
}
