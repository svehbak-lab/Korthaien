import { useState, useEffect, useMemo } from "react";
import { api, CONDITIONS, CONDITION_NAVN } from "../api.js";

export default function Sett({ onFeil, onVelgSett }) {
  const [data, setData] = useState(null);
  const [søk, setSøk] = useState("");
  const [filter, setFilter] = useState("alle");
  const [valgte, setValgte] = useState(new Set());
  const [endringer, setEndringer] = useState({});
  const [lagrer, setLagrer] = useState(false);

  async function last() {
    try {
      setData(await api.sett());
      setEndringer({});
    } catch (e) {
      onFeil(e);
    }
  }
  useEffect(() => {
    last();
  }, []);

  // Nesten tusen rader med skjemafelter på én gang gjør siden treg. Vi viser
  // en bolk om gangen i stedet, og tilbakestiller når filteret endres.
  const [tak, setTak] = useState(300);
  useEffect(() => setTak(300), [søk, filter]);

  const synlige = useMemo(() => {
    if (!data) return [];
    const q = søk.trim().toLowerCase();
    return data.sett.filter((s) => {
      if (filter === "på" && !Number(s.enabled)) return false;
      if (filter === "av" && Number(s.enabled)) return false;
      if (!q) return true;
      return (
        String(s.name).toLowerCase().includes(q) ||
        String(s.scryfall_navn || "").toLowerCase().includes(q) ||
        String(s.code).toLowerCase().includes(q)
      );
    });
  }, [data, søk, filter]);

  if (!data) return <p className="dempet">Henter sett…</p>;

  const påSlått = data.sett.filter((s) => Number(s.enabled)).length;
  const alleValgt = synlige.length > 0 && synlige.every((s) => valgte.has(s.code));

  function veksleValg(kode) {
    setValgte((v) => {
      const n = new Set(v);
      n.has(kode) ? n.delete(kode) : n.add(kode);
      return n;
    });
  }

  function veksleAlle() {
    setValgte((v) => {
      const n = new Set(v);
      if (alleValgt) synlige.forEach((s) => n.delete(s.code));
      else synlige.forEach((s) => n.add(s.code));
      return n;
    });
  }

  // Endringer på enkeltrader samles opp og lagres samlet. Å lagre hver
  // avkrysning for seg ville gitt ett kall per klikk.
  function endre(kode, felt) {
    setEndringer((e) => ({ ...e, [kode]: { ...(e[kode] || {}), ...felt } }));
  }

  async function lagreEndringer() {
    const koder = Object.keys(endringer);
    if (!koder.length) return;
    setLagrer(true);
    try {
      for (const kode of koder) {
        const rad = data.sett.find((s) => s.code === kode);
        const e = endringer[kode];
        const conds = e.conditions ?? parse(rad.conditions, data.standard.conditions);
        await api.lagreSett(kode, {
          enabled: e.enabled ?? !!Number(rad.enabled),
          wanted_default: e.wanted_default ?? Number(rad.wanted_default || 0),
          wanted_foil: e.wanted_foil ?? Number(rad.wanted_foil || 0),
          conditions: conds,
          ladder: Object.fromEntries(
            conds.map((c) => [c, parse(rad.ladder, data.standard.ladder)[c] ?? data.standard.ladder[c] ?? 100])
          ),
        });
      }
      await last();
    } catch (e) {
      onFeil(e);
    } finally {
      setLagrer(false);
    }
  }

  async function masse(felt) {
    if (!valgte.size) return;
    setLagrer(true);
    try {
      await api.masseSett({ codes: [...valgte], ...felt });
      await last();
    } catch (e) {
      onFeil(e);
    } finally {
      setLagrer(false);
    }
  }

  const antallEndringer = Object.keys(endringer).length;

  return (
    <>
      <div className="rad-flex" style={{ marginBottom: 12 }}>
        <input
          type="text"
          placeholder="Søk etter sett"
          value={søk}
          onChange={(e) => setSøk(e.target.value)}
          style={{ width: 240 }}
        />
        {[["alle", "Alle"], ["på", "Kjøper fra"], ["av", "Ikke aktive"]].map(([v, l]) => (
          <button key={v} className={`knapp liten ${filter === v ? "primar" : ""}`} onClick={() => setFilter(v)}>
            {l}
          </button>
        ))}
        <span className="dempet" style={{ marginLeft: "auto" }}>
          {påSlått} av {data.sett.length} sett er slått på
        </span>
        {antallEndringer > 0 && (
          <button className="knapp primar" onClick={lagreEndringer} disabled={lagrer}>
            Lagre {antallEndringer} endring{antallEndringer === 1 ? "" : "er"}
          </button>
        )}
      </div>

      {valgte.size > 0 && <Massefelt antall={valgte.size} standard={data.standard} onBruk={masse} onTøm={() => setValgte(new Set())} lagrer={lagrer} />}

      <div className="panel">
        <table>
          <thead>
            <tr>
              <th style={{ width: 28 }}>
                <input type="checkbox" checked={alleValgt} onChange={veksleAlle} aria-label="Velg alle synlige" />
              </th>
              <th style={{ width: 34 }}>På</th>
              <th>Sett</th>
              <th style={{ width: 54 }}>Utgitt</th>
              <th className="h" style={{ width: 70 }}>Antall</th>
              <th className="h" style={{ width: 70 }}>Foil</th>
              <th style={{ width: 210 }}>Tar imot</th>
              <th style={{ width: 90 }}></th>
            </tr>
          </thead>
          <tbody>
            {synlige.slice(0, tak).map((s) => (
              <SettRad
                key={s.code}
                sett={s}
                standard={data.standard}
                endring={endringer[s.code]}
                valgt={valgte.has(s.code)}
                onVelg={() => veksleValg(s.code)}
                onEndre={(felt) => endre(s.code, felt)}
                onVelgSett={onVelgSett}
                onDøpt={last}
              />
            ))}
          </tbody>
        </table>
        {!synlige.length && <div className="tom">Ingen sett passer søket.</div>}
        {synlige.length > tak && (
          <div className="krop rad-flex">
            <button className="knapp" onClick={() => setTak(tak + 300)}>
              Vis 300 til
            </button>
            <button className="knapp blank" onClick={() => setTak(synlige.length)}>
              Vis alle {synlige.length}
            </button>
            <span className="dempet">
              Viser {tak} av {synlige.length}. «Velg alle synlige» tar med alle{" "}
              {synlige.length} uansett hva som vises.
            </span>
          </div>
        )}
      </div>
    </>
  );
}

// Masseoperasjoner. Å sette samme antall på hundre sett ett og ett er ikke
// arbeid noen skal gjøre for hånd.
function Massefelt({ antall, standard, onBruk, onTøm, lagrer }) {
  const [verdi, setVerdi] = useState(8);
  const [conds, setConds] = useState(standard.conditions);

  return (
    <div className="panel" style={{ background: "var(--aksent-svak)", borderColor: "#ccd8f7" }}>
      <div className="krop">
        <div className="rad-flex">
          <strong>{antall} sett valgt</strong>
          <span className="dempet">Bruk på alle:</span>

          <div className="rad-flex" style={{ gap: 5 }}>
            <input
              type="number"
              min="0"
              value={verdi}
              onChange={(e) => setVerdi(Math.max(0, parseInt(e.target.value) || 0))}
            />
            <button className="knapp liten" disabled={lagrer} onClick={() => onBruk({ wanted_default: verdi, enabled: true })}>
              Vanlige, slå på
            </button>
            <button className="knapp liten" disabled={lagrer} onClick={() => onBruk({ wanted_foil: verdi })}
              title="Foil kjøpes ikke automatisk — antallet må settes eksplisitt">
              Foil
            </button>
          </div>

          <div className="rad-flex" style={{ gap: 4 }}>
            {CONDITIONS.map((c) => (
              <button
                key={c}
                className={`knapp liten ${conds.includes(c) ? "primar" : ""}`}
                onClick={() =>
                  setConds((f) =>
                    f.includes(c)
                      ? f.filter((x) => x !== c)
                      : [...f, c].sort((a, b) => CONDITIONS.indexOf(a) - CONDITIONS.indexOf(b))
                  )
                }
                title={CONDITION_NAVN[c]}
              >
                {c}
              </button>
            ))}
            <button className="knapp liten" disabled={lagrer || !conds.length} onClick={() => onBruk({ conditions: conds })}>
              Sett tilstander
            </button>
          </div>

          <button className="knapp liten" disabled={lagrer} onClick={() => onBruk({ enabled: false })}>
            Slå av
          </button>
          <button className="knapp liten" onClick={onTøm} style={{ marginLeft: "auto" }}>
            Fjern merking
          </button>
        </div>
        <p className="dempet" style={{ margin: "8px 0 0" }}>
          Hver knapp endrer bare sitt eget felt. «Sett tilstander» rører ikke antallet,
          og omvendt.
        </p>
      </div>
    </div>
  );
}

// Kundene sier «Beta», ikke «Limited Edition Beta». Scryfall-navnet blir
// stående i basen, så nattens import kan fortsette å oppdatere det uten å
// røre ditt eget.
function Navn({ sett, onDøpt }) {
  const [redigerer, setRedigerer] = useState(false);
  const [v, setV] = useState(sett.visningsnavn || "");

  async function lagre() {
    if ((v.trim() || null) !== (sett.visningsnavn || null)) {
      await api.døpOmSett(sett.code, v.trim());
      onDøpt();
    }
    setRedigerer(false);
  }

  if (redigerer) {
    return (
      <input
        type="text"
        value={v}
        placeholder={sett.scryfall_navn}
        autoFocus
        onChange={(e) => setV(e.target.value)}
        onBlur={lagre}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") { setV(sett.visningsnavn || ""); setRedigerer(false); }
        }}
        style={{ width: "100%", maxWidth: 240 }}
      />
    );
  }

  return (
    <span
      onDoubleClick={() => setRedigerer(true)}
      title="Dobbeltklikk for å gi settet ditt eget navn"
      style={{ cursor: "text" }}
    >
      {sett.name} <span className="kode dempet">{String(sett.code).toUpperCase()}</span>
      {sett.visningsnavn && (
        <span className="dempet" style={{ fontSize: 12, display: "block" }}>
          {sett.scryfall_navn}
        </span>
      )}
    </span>
  );
}

function SettRad({ sett, standard, endring, valgt, onVelg, onEndre, onVelgSett, onDøpt }) {
  const på = endring?.enabled ?? !!Number(sett.enabled);
  const antall = endring?.wanted_default ?? Number(sett.wanted_default || 0);
  const foil = endring?.wanted_foil ?? Number(sett.wanted_foil || 0);
  const conds = endring?.conditions ?? parse(sett.conditions, standard.conditions);
  const endret = !!endring;

  return (
    <tr style={endret ? { background: "var(--aksent-svak)" } : undefined}>
      <td>
        <input type="checkbox" checked={valgt} onChange={onVelg} aria-label={`Merk ${sett.name}`} />
      </td>
      <td>
        <input
          type="checkbox"
          checked={på}
          onChange={(e) => onEndre({ enabled: e.target.checked })}
          aria-label={`Kjøp fra ${sett.name}`}
        />
      </td>
      <td>
        <Navn sett={sett} onDøpt={onDøpt} />
      </td>
      <td className="dempet">{(sett.released_at || "").slice(0, 4) || "—"}</td>
      <td className="h">
        <input
          type="number"
          min="0"
          value={antall}
          disabled={!på}
          onChange={(e) => onEndre({ wanted_default: Math.max(0, parseInt(e.target.value) || 0) })}
        />
      </td>
      <td className="h">
        {/* Foil har eget antall. 0 betyr at foil ikke kjøpes fra settet, selv
            om vanlige kort gjør det — prisene er helt forskjellige. */}
        <input
          type="number"
          min="0"
          value={foil}
          disabled={!på}
          title="Antall foil-eksemplarer. 0 = kjøper ikke foil fra dette settet."
          onChange={(e) => onEndre({ wanted_foil: Math.max(0, parseInt(e.target.value) || 0) })}
        />
      </td>
      <td>
        {/* Tilstandene er knapper, ikke et nedtrekk. Du ser hva settet tar imot
            uten å åpne noe, og endrer det med ett klikk. */}
        <div className="rad-flex" style={{ gap: 3 }}>
          {CONDITIONS.map((c) => (
            <button
              key={c}
              className={`knapp liten ${conds.includes(c) ? "primar" : ""}`}
              disabled={!på}
              title={`${CONDITION_NAVN[c]} — ${standard.ladder[c] ?? 100} % av kjøpsprisen`}
              onClick={() =>
                onEndre({
                  conditions: conds.includes(c)
                    ? conds.filter((x) => x !== c)
                    : [...conds, c].sort((a, b) => CONDITIONS.indexOf(a) - CONDITIONS.indexOf(b)),
                })
              }
            >
              {c}
            </button>
          ))}
        </div>
      </td>
      <td className="h">
        <button className="knapp liten" onClick={() => onVelgSett(sett.code)}>
          Enkeltkort
        </button>
      </td>
    </tr>
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
