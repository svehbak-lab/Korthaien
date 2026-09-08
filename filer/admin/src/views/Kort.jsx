import { useState, useEffect } from "react";
import { api } from "../api.js";

// Her overstyrer du enkeltkort. Settregelen gjelder alt du ikke rører, så
// et tomt felt betyr «følg settet» — ikke «kjøp ingen».
export default function Kort({ sett, onFeil, onByttSett }) {
  const [kort, setKort] = useState(null);
  const [søk, setSøk] = useState("");

  async function last() {
    if (!sett) return;
    setKort(null);
    try {
      setKort(await api.kort(sett));
    } catch (e) {
      onFeil(e);
    }
  }
  useEffect(() => {
    last();
  }, [sett]);

  if (!sett) {
    return (
      <div className="panel">
        <div className="tom">
          <b>Velg et sett først</b>
          Gå til Sett og trykk «Enkeltkort» på settet du vil justere.
        </div>
      </div>
    );
  }

  if (!kort) return <p className="dempet">Henter kort…</p>;

  const q = søk.trim().toLowerCase();
  const synlige = q ? kort.filter((k) => String(k.name).toLowerCase().includes(q)) : kort;

  return (
    <>
      <div className="rad-flex" style={{ marginBottom: 14 }}>
        <span className="kode">{sett.toUpperCase()}</span>
        <input
          type="text"
          placeholder="Søk i settet"
          value={søk}
          onChange={(e) => setSøk(e.target.value)}
          style={{ width: 240 }}
        />
        <button className="knapp" onClick={onByttSett}>Bytt sett</button>
        <span className="dempet" style={{ marginLeft: "auto" }}>{kort.length} kort</span>
      </div>

      <div className="panel">
        <table>
          <thead>
            <tr>
              <th style={{ width: 54 }}>Nr.</th>
              <th>Kort</th>
              <th>Raritet</th>
              <th className="h">Pris USD</th>
              <th className="h">På lager</th>
              <th className="h">Vil ha</th>
              <th className="h">Foil</th>
            </tr>
          </thead>
          <tbody>
            {synlige.slice(0, 400).map((k) => (
              <KortRad key={k.id} kort={k} onFeil={onFeil} />
            ))}
          </tbody>
        </table>
        {!synlige.length && <div className="tom">Ingen kort passer søket.</div>}
      </div>
    </>
  );
}

function KortRad({ kort, onFeil }) {
  return (
    <tr>
      <td className="kode dempet">{kort.collector_number || "—"}</td>
      <td>{kort.name}</td>
      <td className="dempet">{kort.rarity || "—"}</td>
      <td className="h tall dempet">
        {kort.usd ? `$${Number(kort.usd).toFixed(2)}` : "—"}
        {kort.usd_foil ? <span> / ${Number(kort.usd_foil).toFixed(2)}</span> : null}
      </td>
      <td className="h tall dempet">
        {Number(kort.stock_nonfoil || 0)}
        {Number(kort.has_foil) ? ` / ${Number(kort.stock_foil || 0)}` : ""}
      </td>
      <td className="h">
        <ØnskeFelt kortId={kort.id} finish="nonfoil" verdi={kort.want_nonfoil} onFeil={onFeil} />
      </td>
      <td className="h">
        {Number(kort.has_foil) ? (
          <ØnskeFelt kortId={kort.id} finish="foil" verdi={kort.want_foil} onFeil={onFeil} />
        ) : (
          <span className="dempet">—</span>
        )}
      </td>
    </tr>
  );
}

function ØnskeFelt({ kortId, finish, verdi, onFeil }) {
  const [v, setV] = useState(verdi === null || verdi === undefined ? "" : String(verdi));
  const [status, setStatus] = useState("");

  async function lagre() {
    const rå = v.trim();
    try {
      if (rå === "") {
        await api.nullstillØnske(kortId, finish);
      } else {
        const n = Math.max(0, parseInt(rå) || 0);
        setV(String(n));
        await api.lagreØnske(kortId, finish, n);
      }
      setStatus("ok");
      setTimeout(() => setStatus(""), 1200);
    } catch (e) {
      setStatus("feil");
      onFeil(e);
    }
  }

  return (
    <input
      type="text"
      inputMode="numeric"
      value={v}
      placeholder={finish === "foil" ? "0" : "sett"}
      title={
        finish === "foil"
          ? "Foil arver ikke settets antall — må settes her"
          : "Tomt felt følger settregelen"
      }
      onChange={(e) => setV(e.target.value.replace(/[^\d]/g, ""))}
      onBlur={lagre}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      style={{
        width: 62,
        textAlign: "right",
        borderColor: status === "ok" ? "var(--ok)" : status === "feil" ? "var(--feil)" : undefined,
      }}
    />
  );
}
