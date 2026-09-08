import { useState, useEffect, useMemo } from "react";
import { api, CONDITIONS, CONDITION_NAVN } from "../api.js";

export default function Sett({ onFeil, onVelgSett }) {
  const [data, setData] = useState(null);
  const [søk, setSøk] = useState("");
  const [baretPå, setBaretPå] = useState(false);
  const [åpen, setÅpen] = useState(null);

  async function last() {
    try {
      setData(await api.sett());
    } catch (e) {
      onFeil(e);
    }
  }
  useEffect(() => {
    last();
  }, []);

  const synlige = useMemo(() => {
    if (!data) return [];
    const q = søk.trim().toLowerCase();
    return data.sett.filter((s) => {
      if (baretPå && !Number(s.enabled)) return false;
      if (!q) return true;
      return String(s.name).toLowerCase().includes(q) || String(s.code).toLowerCase().includes(q);
    });
  }, [data, søk, baretPå]);

  if (!data) return <p className="dempet">Henter sett…</p>;

  const påSlått = data.sett.filter((s) => Number(s.enabled)).length;

  return (
    <>
      <div className="rad-flex" style={{ marginBottom: 14 }}>
        <input
          type="text"
          placeholder="Søk etter sett"
          value={søk}
          onChange={(e) => setSøk(e.target.value)}
          style={{ width: 260 }}
        />
        <label className="rad-flex" style={{ gap: 6 }}>
          <input type="checkbox" checked={baretPå} onChange={(e) => setBaretPå(e.target.checked)} />
          Bare sett jeg kjøper fra
        </label>
        <span className="dempet" style={{ marginLeft: "auto" }}>
          {påSlått} av {data.sett.length} sett er slått på
        </span>
      </div>

      <div className="panel">
        <table>
          <thead>
            <tr>
              <th style={{ width: 30 }}></th>
              <th>Sett</th>
              <th>Utgitt</th>
              <th className="h">Antall jeg vil ha</th>
              <th>Tar imot</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {synlige.slice(0, 300).map((s) => (
              <SettRad
                key={s.code}
                sett={s}
                standard={data.standard}
                åpen={åpen === s.code}
                onVeksle={() => setÅpen(åpen === s.code ? null : s.code)}
                onLagret={last}
                onFeil={onFeil}
                onVelgSett={onVelgSett}
              />
            ))}
          </tbody>
        </table>
        {!synlige.length && <div className="tom">Ingen sett passer søket.</div>}
        {synlige.length > 300 && (
          <div className="krop dempet">Viser de 300 første. Søk for å snevre inn.</div>
        )}
      </div>
    </>
  );
}

function SettRad({ sett, standard, åpen, onVeksle, onLagret, onFeil, onVelgSett }) {
  const lagretConds = parse(sett.conditions, standard.conditions);
  const lagretTrapp = parse(sett.ladder, standard.ladder);

  const [på, setPå] = useState(!!Number(sett.enabled));
  const [antall, setAntall] = useState(Number(sett.wanted_default || 0));
  const [conds, setConds] = useState(lagretConds);
  const [trapp, setTrapp] = useState(lagretTrapp);
  const [lagrer, setLagrer] = useState(false);

  async function lagre() {
    setLagrer(true);
    try {
      // Vi sender bare satser for de conditionene settet faktisk tar imot.
      // En sats uten condition ville aldri blitt brukt, og en condition uten
      // sats gir pris null — begge deler blir forvirrende senere.
      const renTrapp = {};
      for (const c of conds) renTrapp[c] = Number(trapp[c] ?? standard.ladder[c] ?? 100);
      await api.lagreSett(sett.code, {
        enabled: på,
        wanted_default: antall,
        conditions: conds,
        ladder: renTrapp,
      });
      onLagret();
    } catch (e) {
      onFeil(e);
    } finally {
      setLagrer(false);
    }
  }

  function veksleCond(c) {
    setConds((f) => (f.includes(c) ? f.filter((x) => x !== c) : [...f, c].sort((a, b) => CONDITIONS.indexOf(a) - CONDITIONS.indexOf(b))));
  }

  return (
    <>
      <tr>
        <td>
          <input
            type="checkbox"
            checked={på}
            onChange={(e) => setPå(e.target.checked)}
            aria-label={`Kjøp fra ${sett.name}`}
          />
        </td>
        <td>
          {sett.name} <span className="kode dempet">{String(sett.code).toUpperCase()}</span>
        </td>
        <td className="dempet">{(sett.released_at || "").slice(0, 4) || "—"}</td>
        <td className="h">
          <input
            type="number"
            min="0"
            value={antall}
            onChange={(e) => setAntall(Math.max(0, parseInt(e.target.value) || 0))}
            disabled={!på}
          />
        </td>
        <td>
          {på ? (
            <span className="dempet">{conds.join(", ") || "ingen"}</span>
          ) : (
            <span className="dempet">—</span>
          )}
        </td>
        <td className="h">
          <div className="rad-flex" style={{ justifyContent: "flex-end" }}>
            <button className="knapp liten" onClick={onVeksle}>
              {åpen ? "Lukk" : "Conditions"}
            </button>
            <button className="knapp liten" onClick={() => onVelgSett(sett.code)}>
              Enkeltkort
            </button>
            <button className="knapp liten primar" onClick={lagre} disabled={lagrer}>
              Lagre
            </button>
          </div>
        </td>
      </tr>

      {åpen && (
        <tr>
          <td colSpan={6} style={{ background: "var(--papir)" }}>
            <div className="rad-flex" style={{ gap: 20, padding: "6px 0" }}>
              {CONDITIONS.map((c) => {
                const valgt = conds.includes(c);
                return (
                  <div key={c} className="rad-flex" style={{ gap: 6 }}>
                    <label className="rad-flex" style={{ gap: 5 }}>
                      <input type="checkbox" checked={valgt} onChange={() => veksleCond(c)} />
                      {CONDITION_NAVN[c]}
                    </label>
                    <input
                      type="number"
                      min="0"
                      max="200"
                      style={{ width: 58 }}
                      value={trapp[c] ?? standard.ladder[c] ?? ""}
                      disabled={!valgt}
                      onChange={(e) => setTrapp({ ...trapp, [c]: parseInt(e.target.value) || 0 })}
                      title={`Prosent av kjøpsprisen for ${CONDITION_NAVN[c]}`}
                    />
                    <span className="dempet">%</span>
                  </div>
                );
              })}
            </div>
            <p className="dempet" style={{ margin: "4px 0 8px" }}>
              Prosenten regnes av kjøpsprisen. Fjerner du haken, kjøpes ikke kort i den
              tilstanden fra dette settet i det hele tatt.
            </p>
          </td>
        </tr>
      )}
    </>
  );
}

function parse(v, fallback) {
  if (!v) return fallback;
  try {
    return JSON.parse(v) ?? fallback;
  } catch {
    return fallback;
  }
}
