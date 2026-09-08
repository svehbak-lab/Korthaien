import { useState, useEffect } from "react";
import { api } from "../api.js";

const KOLONNER = [
  { id: "collector_number", navn: "Nr.", bredde: 50 },
  { id: "name", navn: "Kort" },
  { id: "rarity", navn: "Raritet", bredde: 90 },
  { id: "usd", navn: "USD", h: true, bredde: 70 },
  { id: "stock_nonfoil", navn: "På lager", h: true, bredde: 80 },
  { id: "ledig_nonfoil", navn: "Kan selges", h: true, bredde: 90 },
  { id: "want_nonfoil", navn: "Vil ha", h: true, bredde: 70 },
  { id: "stock_foil", navn: "Foil lager", h: true, bredde: 85 },
  { id: "want_foil", navn: "Vil ha foil", h: true, bredde: 85 },
];

// Rariteten sorteres etter verdi, ikke alfabetisk — «common» før «mythic»
// er ikke rekkefølgen noen leter etter.
const RARITET_RANG = { common: 0, uncommon: 1, rare: 2, mythic: 3, special: 4, bonus: 5 };
const RARITETER = [
  ["common", "Common"],
  ["uncommon", "Uncommon"],
  ["rare", "Rare"],
  ["mythic", "Mythic"],
];

export default function Kort({ sett, onFeil, onByttSett }) {
  const [data, setData] = useState(null);
  const [søk, setSøk] = useState("");
  const [raritet, setRaritet] = useState("");
  const [sortering, setSortering] = useState({ kolonne: "collector_number", stigende: true });
  const [jobber, setJobber] = useState(false);

  async function last() {
    if (!sett) return;
    try {
      setData(await api.kort(sett));
    } catch (e) {
      onFeil(e);
    }
  }
  useEffect(() => {
    setData(null);
    setRaritet("");
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
  if (!data) return <p className="dempet">Henter kort…</p>;

  const regel = data.regel || {};
  const q = søk.trim().toLowerCase();

  // Ønsket antall som faktisk gjelder: kortets egen verdi hvis den finnes,
  // ellers settets. Det er dette tallet kvoten regnes av.
  const gjeldende = (k, finish) => {
    const eget = finish === "foil" ? k.want_foil : k.want_nonfoil;
    if (eget !== null && eget !== undefined) return Number(eget);
    if (!regel.enabled) return 0;
    return finish === "foil" ? Number(regel.wanted_foil || 0) : Number(regel.wanted_default || 0);
  };
  const ledig = (k, finish) => {
    const lager = Number((finish === "foil" ? k.stock_foil : k.stock_nonfoil) || 0);
    const res = Number((finish === "foil" ? k.res_foil : k.res_nonfoil) || 0);
    return Math.max(0, gjeldende(k, finish) - lager - res);
  };

  const beriket = data.kort.map((k) => ({
    ...k,
    ledig_nonfoil: ledig(k, "nonfoil"),
    ledig_foil: ledig(k, "foil"),
  }));

  const filtrert = beriket.filter((k) => {
    if (raritet && String(k.rarity || "") !== raritet) return false;
    if (q && !String(k.name).toLowerCase().includes(q)) return false;
    return true;
  });

  const synlige = [...filtrert].sort((a, b) => {
    const { kolonne, stigende } = sortering;
    const retning = stigende ? 1 : -1;
    let x = a[kolonne];
    let y = b[kolonne];
    if (kolonne === "rarity") {
      x = RARITET_RANG[String(x || "")] ?? 99;
      y = RARITET_RANG[String(y || "")] ?? 99;
    } else if (kolonne === "collector_number") {
      x = parseInt(x) || 0;
      y = parseInt(y) || 0;
    } else if (typeof x === "string" || typeof y === "string") {
      return String(x || "").localeCompare(String(y || ""), "nb") * retning;
    }
    const xt = x === null || x === undefined;
    const yt = y === null || y === undefined;
    if (xt && yt) return 0;
    if (xt) return 1;
    if (yt) return -1;
    return (Number(x) - Number(y)) * retning;
  });

  function sorter(id) {
    setSortering((s) =>
      s.kolonne === id ? { kolonne: id, stigende: !s.stigende } : { kolonne: id, stigende: true }
    );
  }

  async function settMange(finish, wanted, nullstill) {
    setJobber(true);
    try {
      await api.masseØnsker({
        set_code: sett,
        rarity: raritet || undefined,
        finish,
        wanted,
        nullstill,
      });
      await last();
    } catch (e) {
      onFeil(e);
    } finally {
      setJobber(false);
    }
  }

  const antallKoblet = data.kort.filter((k) => k.prod_nonfoil || k.prod_foil).length;

  return (
    <>
      <div className="rad-flex" style={{ marginBottom: 10 }}>
        <span className="kode">{sett.toUpperCase()}</span>
        <input
          type="text"
          placeholder="Søk i settet"
          value={søk}
          onChange={(e) => setSøk(e.target.value)}
          style={{ width: 200 }}
        />
        <button className="knapp" onClick={onByttSett}>Bytt sett</button>
        <span className="dempet" style={{ marginLeft: "auto" }}>
          {data.kort.length} kort · {antallKoblet} koblet mot Korthaien
          {!regel.enabled && " · settet er ikke slått på"}
        </span>
      </div>

      <div className="rad-flex" style={{ marginBottom: 12 }}>
        <span className="dempet">Raritet:</span>
        <button className={`knapp liten ${!raritet ? "primar" : ""}`} onClick={() => setRaritet("")}>
          Alle
        </button>
        {RARITETER.map(([v, l]) => {
          const n = beriket.filter((k) => k.rarity === v).length;
          if (!n) return null;
          return (
            <button
              key={v}
              className={`knapp liten ${raritet === v ? "primar" : ""}`}
              onClick={() => setRaritet(v)}
            >
              {l} <span className="dempet">{n}</span>
            </button>
          );
        })}
      </div>

      <Massefelt
        antall={filtrert.length}
        raritet={raritet ? RARITETER.find(([v]) => v === raritet)?.[1] : null}
        harFoil={filtrert.some((k) => Number(k.has_foil))}
        jobber={jobber}
        onSett={settMange}
      />

      <div className="panel">
        <table>
          <thead>
            <tr>
              {KOLONNER.map((k) => (
                <th
                  key={k.id}
                  className={k.h ? "h" : undefined}
                  style={{ width: k.bredde, cursor: "pointer", userSelect: "none" }}
                  onClick={() => sorter(k.id)}
                  aria-sort={
                    sortering.kolonne === k.id ? (sortering.stigende ? "ascending" : "descending") : "none"
                  }
                >
                  {k.navn}
                  <span style={{ color: sortering.kolonne === k.id ? "var(--aksent)" : "var(--strek)", marginLeft: 3 }}>
                    {sortering.kolonne === k.id ? (sortering.stigende ? "\u25b2" : "\u25bc") : "\u25b4"}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {synlige.slice(0, 500).map((k) => (
              <KortRad key={k.id} kort={k} onFeil={onFeil} />
            ))}
          </tbody>
        </table>
        {!synlige.length && <div className="tom">Ingen kort passer filteret.</div>}
        {synlige.length > 500 && (
          <div className="krop dempet">Viser 500 av {synlige.length}. Masseoperasjonen over tar likevel alle.</div>
        )}
      </div>
    </>
  );
}

function Massefelt({ antall, raritet, harFoil, jobber, onSett }) {
  const [verdi, setVerdi] = useState(8);
  const hva = raritet ? `${antall} ${raritet.toLowerCase()}` : `alle ${antall}`;

  return (
    <div className="panel" style={{ background: "var(--aksent-svak)", borderColor: "#ccd8f7" }}>
      <div className="krop">
        <div className="rad-flex">
          <strong>Sett antall for {hva} kort</strong>
          <input
            type="number"
            min="0"
            value={verdi}
            onChange={(e) => setVerdi(Math.max(0, parseInt(e.target.value) || 0))}
          />
          <button className="knapp liten primar" disabled={jobber} onClick={() => onSett("nonfoil", verdi)}>
            Vanlige
          </button>
          <button
            className="knapp liten primar"
            disabled={jobber || !harFoil}
            onClick={() => onSett("foil", verdi)}
            title={harFoil ? "Gjelder bare kort som finnes i foil" : "Ingen av kortene finnes i foil"}
          >
            Foil
          </button>
          <span className="dempet">|</span>
          <button className="knapp liten" disabled={jobber} onClick={() => onSett("nonfoil", 0, true)}>
            Følg settet igjen
          </button>
        </div>
        <p className="dempet" style={{ margin: "8px 0 0" }}>
          Gjelder kortene raritetsfilteret viser. «Følg settet igjen» fjerner
          overstyringen, så kortene bruker settets antall på nytt.
        </p>
      </div>
    </div>
  );
}

function KortRad({ kort, onFeil }) {
  return (
    <tr>
      <td className="kode dempet">{kort.collector_number || "\u2014"}</td>
      <td>{kort.name}</td>
      <td className="dempet">{kort.rarity || "\u2014"}</td>
      <td className="h tall dempet">{kort.usd ? `$${Number(kort.usd).toFixed(2)}` : "\u2014"}</td>
      <td className="h tall"><Lager qty={kort.stock_nonfoil} koblet={!!kort.prod_nonfoil} /></td>
      <td className="h tall">
        {kort.ledig_nonfoil > 0 ? kort.ledig_nonfoil : <span className="dempet">0</span>}
      </td>
      <td className="h">
        <ØnskeFelt kortId={kort.id} finish="nonfoil" verdi={kort.want_nonfoil} onFeil={onFeil} />
      </td>
      <td className="h tall">
        {Number(kort.has_foil) ? <Lager qty={kort.stock_foil} koblet={!!kort.prod_foil} /> : <span className="dempet">{"\u2014"}</span>}
      </td>
      <td className="h">
        {Number(kort.has_foil) ? (
          <ØnskeFelt kortId={kort.id} finish="foil" verdi={kort.want_foil} onFeil={onFeil} />
        ) : (
          <span className="dempet">{"\u2014"}</span>
        )}
      </td>
    </tr>
  );
}

// «0 på lager» og «ikke koblet» er to helt ulike ting: det første betyr at
// kunden kan selge deg hele kvoten, det andre at tallet ikke er til å stole
// på. Streken sier at kortet ikke finnes som produkt hos deg.
function Lager({ qty, koblet }) {
  if (!koblet) {
    return <span className="dempet" title="Ingen produkt hos Korthaien er koblet til dette kortet">–</span>;
  }
  return <span title="Koblet mot Korthaien">{Number(qty || 0)}</span>;
}

function ØnskeFelt({ kortId, finish, verdi, onFeil }) {
  const [v, setV] = useState(verdi === null || verdi === undefined ? "" : String(verdi));
  const [status, setStatus] = useState("");

  useEffect(() => {
    setV(verdi === null || verdi === undefined ? "" : String(verdi));
  }, [verdi]);

  async function lagre() {
    const rå = v.trim();
    try {
      if (rå === "") await api.nullstillØnske(kortId, finish);
      else {
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
      placeholder="sett"
      title="Tomt felt følger settregelen"
      onChange={(e) => setV(e.target.value.replace(/[^\d]/g, ""))}
      onBlur={lagre}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      style={{
        width: 56,
        textAlign: "right",
        borderColor: status === "ok" ? "var(--ok)" : status === "feil" ? "var(--feil)" : undefined,
      }}
    />
  );
}
