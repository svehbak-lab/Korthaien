import { useState, useEffect } from "react";
import { api, CONDITIONS, CONDITION_NAVN } from "../api.js";
import { Historikk } from "./Kort.jsx";

// ─────────────────────────────────────────────────────────────────────────────
// HURTIGREDIGERING
// ─────────────────────────────────────────────────────────────────────────────
// Én jobb: endre hvor mange kort du har. Ikke innkjøpsregler, ikke priser,
// ikke koblinger — bare tall i hyller.
//
// Du oppgir beholdningen, ikke differansen. Serveren regner ut bevegelsen, så
// du slipper å regne i hodet når du sitter med en bunke foran deg. Skriver du
// 4 der det står 7, går tre ut av lageret.
//
// Arbeidsflyten er tab nedover og lagring når feltet forlates. Ingen henting
// underveis: tabellen ville blitt bygget om mens du taster, og fokus ville
// hoppet til toppen.

const RARITETER = [
  ["mythic", "Mythic"],
  ["rare", "Rare"],
  ["uncommon", "Uncommon"],
  ["common", "Common"],
  ["special", "Special"],
];

// Innstillingene overlever både settbytte og at du går ut og inn igjen. De
// er dine vaner, ikke en del av settet du ser på, og skal ikke nullstilles
// hver gang du åpner siden.
//
// Nettleserlagring kan kaste — privat vindu, blokkert lagring — og da skal
// siden virke likevel. Derfor try/catch begge veier.
const NOKKEL = "korthaien.hurtig";
const STANDARD = { sett: "", finish: "nonfoil", conditions: [...CONDITIONS], rariteter: [] };

function lesHusket() {
  try {
    const rå = localStorage.getItem(NOKKEL);
    if (!rå) return STANDARD;
    const h = JSON.parse(rå);
    return {
      sett: typeof h.sett === "string" ? h.sett : "",
      finish: h.finish === "foil" ? "foil" : "nonfoil",
      // Ukjente verdier siles bort: lagret en eldre versjon noe vi ikke har
      // lenger, skal det ikke bli en kolonne som ikke finnes.
      conditions: Array.isArray(h.conditions)
        ? CONDITIONS.filter((c) => h.conditions.includes(c))
        : [...CONDITIONS],
      rariteter: Array.isArray(h.rariteter)
        ? RARITETER.map(([v]) => v).filter((v) => h.rariteter.includes(v))
        : [],
    };
  } catch {
    return STANDARD;
  }
}

function husk(innstillinger) {
  try {
    localStorage.setItem(NOKKEL, JSON.stringify(innstillinger));
  } catch {
    /* Uten lagring virker siden som før, den husker bare ikke. */
  }
}

export default function Hurtig({ onFeil }) {
  const start = lesHusket();
  const [alle, setAlle] = useState([]);
  const [sett, setSett] = useState(start.sett);
  const [finish, setFinish] = useState(start.finish);
  const [conditions, setConditions] = useState(start.conditions);
  const [rariteter, setRariteter] = useState(start.rariteter);
  const [søk, setSøk] = useState("");

  const [data, setData] = useState(null);
  const [laster, setLaster] = useState(false);
  const [utkast, setUtkast] = useState({});
  const [lagret, setLagret] = useState({});
  const [historikk, setHistorikk] = useState(null);

  useEffect(() => {
    husk({ sett, finish, conditions, rariteter });
  }, [sett, finish, conditions, rariteter]);

  useEffect(() => {
    api.sett().then((r) => setAlle(r.sett || [])).catch(onFeil);
  }, []);

  useEffect(() => {
    if (!sett) {
      setData(null);
      return;
    }
    let avbrutt = false;
    setLaster(true);
    setUtkast({});
    api
      .lager(sett)
      .then((r) => !avbrutt && setData(r.kort || []))
      .catch((e) => !avbrutt && onFeil(e))
      .finally(() => !avbrutt && setLaster(false));
    return () => {
      avbrutt = true;
    };
  }, [sett]);

  const vekslet = (liste, verdi) =>
    liste.includes(verdi) ? liste.filter((x) => x !== verdi) : liste.concat(verdi);

  async function lagre(kortId, cond, tekst) {
    const n = Math.max(0, parseInt(String(tekst).trim()) || 0);
    const kort = (data || []).find((k) => k.id === kortId);
    const nå = kort?.lager?.[`${finish}:${cond}`] ?? 0;
    if (n === nå) return;
    try {
      await api.settLager(kortId, { finish, condition: cond, antall: n });
      // Tallet oppdateres her i stedet for ved å hente alt på nytt. En ny
      // henting ville bygget tabellen om mens du taber videre.
      setData((d) =>
        d.map((k) =>
          k.id === kortId ? { ...k, lager: { ...k.lager, [`${finish}:${cond}`]: n } } : k
        )
      );
      const nøkkel = `${kortId}:${cond}`;
      setLagret((s) => ({ ...s, [nøkkel]: true }));
      setTimeout(() => setLagret((s) => ({ ...s, [nøkkel]: false })), 1400);
    } catch (e) {
      onFeil(e);
    }
  }

  const q = søk.trim().toLowerCase();
  const synlige = (data || []).filter((k) => {
    if (finish === "foil" ? !Number(k.has_foil) : !Number(k.has_nonfoil)) return false;
    if (rariteter.length && !rariteter.includes(String(k.rarity || ""))) return false;
    if (q && !String(k.name).toLowerCase().includes(q)) return false;
    return true;
  });

  const kolonner = CONDITIONS.filter((c) => conditions.includes(c));
  const iSettet = synlige.reduce(
    (n, k) => n + kolonner.reduce((m, c) => m + (k.lager?.[`${finish}:${c}`] || 0), 0),
    0
  );

  return (
    <>
      {/* Skallet skriver sidenavnet selv — her står bare forklaringen. */}
      <p className="undertittel">
        Endre hvor mange kort du har. Tallet du skriver er beholdningen, ikke et
        tillegg — skriver du 4 der det står 7, går tre ut av lageret. Tab hopper
        til neste felt, og lagringen skjer når feltet forlates.
      </p>

      <div className="panel">
        <div className="krop">
          {/* Sett til venstre, egenskapene til høyre. Det til venstre velger
              hvilke kort du ser, det til høyre hvilke tall du redigerer. */}
          <div className="rad-flex" style={{ alignItems: "flex-start", gap: 24 }}>
            <div style={{ flex: "0 0 auto" }}>
              <label className="dempet" style={{ display: "block", fontSize: 12, marginBottom: 3 }}>
                Sett
              </label>
              <select
                value={sett}
                onChange={(e) => setSett(e.target.value)}
                style={{ minWidth: 230 }}
              >
                <option value="">Velg sett …</option>
                {alle.map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.visningsnavn || s.name} ({String(s.code).toUpperCase()})
                  </option>
                ))}
              </select>
            </div>

            <div style={{ flex: "0 0 auto" }}>
              <label className="dempet" style={{ display: "block", fontSize: 12, marginBottom: 3 }}>
                Søk i settet
              </label>
              <input
                type="text"
                value={søk}
                onChange={(e) => setSøk(e.target.value)}
                placeholder="Kortnavn"
                style={{ width: 170 }}
              />
            </div>

            <div style={{ marginLeft: "auto" }}>
              <div className="dempet" style={{ fontSize: 12, marginBottom: 4 }}>
                Tilstander som vises
              </div>
              <div className="rad-flex" style={{ gap: 6 }}>
                {CONDITIONS.map((c) => (
                  <label key={c} className="rad-flex" style={{ gap: 5, fontSize: 13 }}>
                    <input
                      type="checkbox"
                      checked={conditions.includes(c)}
                      onChange={() => setConditions((x) => vekslet(x, c))}
                    />
                    <span title={CONDITION_NAVN[c]}>{c}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>

          <div className="rad-flex" style={{ marginTop: 12, gap: 14 }}>
            <span className="dempet" style={{ fontSize: 12 }}>Raritet</span>
            {RARITETER.map(([v, navn]) => (
              <label key={v} className="rad-flex" style={{ gap: 5, fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={rariteter.includes(v)}
                  onChange={() => setRariteter((x) => vekslet(x, v))}
                />
                {navn}
              </label>
            ))}
            {rariteter.length > 0 && (
              <button className="knapp liten" onClick={() => setRariteter([])}>
                Alle rariteter
              </button>
            )}

            <span className="dempet" style={{ marginLeft: 18, fontSize: 12 }}>Utgave</span>
            {[
              ["nonfoil", "Vanlige"],
              ["foil", "Foil"],
            ].map(([v, navn]) => (
              <button
                key={v}
                className={`knapp liten ${finish === v ? "primar" : ""}`}
                onClick={() => setFinish(v)}
              >
                {navn}
              </button>
            ))}

            <span className="dempet" style={{ marginLeft: "auto" }}>
              {sett && !laster && `${synlige.length} kort · ${iSettet} stk. i hylla`}
            </span>
          </div>
        </div>
      </div>

      {!sett && (
        <div className="panel">
          <div className="tom">
            <b>Velg et sett</b>
            Innstillingene dine over huskes til neste gang, også når du bytter sett.
          </div>
        </div>
      )}

      {sett && laster && <p className="dempet">Henter lageret…</p>}

      {sett && !laster && !kolonner.length && (
        <div className="panel">
          <div className="tom">
            <b>Ingen tilstander er valgt</b>
            Huk av minst én oppe til høyre, så får du en kolonne å skrive i.
          </div>
        </div>
      )}

      {sett && !laster && kolonner.length > 0 && (
        <div className="panel">
          <table>
            <thead>
              <tr>
                <th style={{ width: 50 }}>Nr.</th>
                <th>Kort</th>
                <th style={{ width: 90 }}>Raritet</th>
                {kolonner.map((c) => (
                  <th key={c} className="h" style={{ width: 74 }} title={CONDITION_NAVN[c]}>
                    {c}
                  </th>
                ))}
                <th style={{ width: 70 }}></th>
              </tr>
            </thead>
            <tbody>
              {synlige.map((k) => (
                <tr key={k.id}>
                  <td className="kode dempet">{k.collector_number}</td>
                  <td>
                    {k.name}
                    {k.variant && k.variant !== "vanlig" && (
                      <span className="dempet"> · {k.variant}</span>
                    )}
                    {Number(k.er_token) === 1 && (
                      <span className="merkelapp m-vent" style={{ marginLeft: 6 }}>token</span>
                    )}
                  </td>
                  <td className="dempet">{k.rarity || "—"}</td>
                  {kolonner.map((c) => {
                    const nøkkel = `${k.id}:${c}`;
                    const verdi = utkast[nøkkel] ?? String(k.lager?.[`${finish}:${c}`] ?? 0);
                    return (
                      <td key={c} className="h">
                        <input
                          type="text"
                          inputMode="numeric"
                          value={verdi}
                          onChange={(e) =>
                            setUtkast((u) => ({ ...u, [nøkkel]: e.target.value.replace(/[^\d]/g, "") }))
                          }
                          onBlur={(e) => lagre(k.id, c, e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") e.currentTarget.blur();
                            if (e.key === "Escape") {
                              setUtkast((u) => ({ ...u, [nøkkel]: undefined }));
                              e.currentTarget.blur();
                            }
                          }}
                          style={{
                            width: 56,
                            textAlign: "right",
                            borderColor: lagret[nøkkel] ? "var(--ok)" : undefined,
                            // Null er det vanlige. Da skal tallet ikke rope.
                            color: Number(verdi) ? "inherit" : "var(--dempet)",
                          }}
                        />
                      </td>
                    );
                  })}
                  <td className="h">
                    <button
                      className="knapp handling"
                      onClick={() =>
                        api
                          .lagerHistorikk(k.id, finish)
                          .then((h) => setHistorikk({ kort: k, rader: h }))
                          .catch(onFeil)
                      }
                    >
                      Historikk
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {!synlige.length && (
            <div className="tom">
              Ingen kort passer filteret
              {finish === "foil" ? " — finnes noen av dem i foil?" : "."}
            </div>
          )}
        </div>
      )}

      {historikk && <Historikk data={historikk} onLukk={() => setHistorikk(null)} />}
    </>
  );
}
