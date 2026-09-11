import { useState, useEffect, useMemo } from "react";
import { api, kroner, CONDITIONS } from "../api.js";

// ─────────────────────────────────────────────────────────────────────────────
// BUTIKKVISNING
// ─────────────────────────────────────────────────────────────────────────────
// Forhåndsvisning av hvordan kundene vil se kortene. Ligger i admin inntil
// salgssiden bygges, og flyttes ut da.
//
// Hensikten er ikke pynt. Det er den eneste måten å oppdage at et intervall
// traff feil: prisene må stå ved siden av kortet, ikke i en tabell over regler.
//
// Sorteringen skjer på serveren, over hele settet. Sorterer man bare de kortene
// man allerede har hentet, får man den dyreste av de 25 første.

const FARGER = [
  { kode: "W", navn: "Hvit" },
  { kode: "U", navn: "Blå" },
  { kode: "B", navn: "Svart" },
  { kode: "R", navn: "Rød" },
  { kode: "G", navn: "Grønn" },
  { kode: "C", navn: "Fargeløs" },
];

const TYPER = ["Creature", "Instant", "Sorcery", "Artifact", "Enchantment", "Planeswalker", "Land"];

const SORTERING = [
  { id: "navn", navn: "Navn, A til Å" },
  { id: "navn_ned", navn: "Navn, Å til A" },
  { id: "pris_ned", navn: "Pris, høy til lav" },
  { id: "pris_opp", navn: "Pris, lav til høy" },
];

const TOMT = {
  q: "", rarity: "", farge: "", type: "",
  baresalg: false, prisFra: "", prisTil: "",
};

export default function Butikk({ onFeil }) {
  const [sett, setSett] = useState(null);
  const [alle, setAlle] = useState([]);
  const [data, setData] = useState(null);
  const [laster, setLaster] = useState(false);
  const [visning, setVisning] = useState("detalj");
  const [finish, setFinish] = useState("nonfoil");
  const [sortering, setSortering] = useState("navn");
  const [perSide, setPerSide] = useState(25);
  const [side, setSide] = useState(1);
  const [f, setF] = useState(TOMT);

  useEffect(() => {
    api.sett().then((r) => setAlle(r.sett.filter((s) => Number(s.enabled)))).catch(onFeil);
  }, []);

  // Endrer du et filter, må du tilbake til første side. Ellers står du på side
  // sju i et resultat med to sider og ser ingenting.
  useEffect(() => setSide(1), [sett, finish, sortering, perSide, f]);

  useEffect(() => {
    if (!sett) return;
    setLaster(true);
    const t = setTimeout(() => {
      api.butikk({ sett, finish, sortering, side, perSide, ...f })
        .then(setData)
        .catch(onFeil)
        .finally(() => setLaster(false));
    }, 250);
    return () => clearTimeout(t);
  }, [sett, finish, sortering, side, perSide, f]);

  const synlige = useMemo(() => {
    if (!data) return [];
    return data.kort
      .map((k) => ({ ...k, valgt: k.varianter.find((v) => v.finish === finish) }))
      .filter((k) => k.valgt?.tilstander.length);
  }, [data, finish]);

  const endre = (felt, verdi) => setF((x) => ({ ...x, [felt]: verdi }));

  return (
    <>
      <h1>Butikkvisning</h1>
      <p className="dempet" style={{ marginTop: -6 }}>
        Slik kundene vil se kortene. Ligger her inntil salgssiden bygges — bruk den
        til å se om intervallene gir prisene du mente.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "220px minmax(0, 1fr)", gap: 20, alignItems: "start" }}>
        <div className="panel" style={{ position: "sticky", top: 16 }}>
          <div className="krop">
            <Gruppe navn="Kortnavn">
              <input type="text" value={f.q} onChange={(e) => endre("q", e.target.value)} style={{ width: "100%" }} />
            </Gruppe>

            <Gruppe navn="Sett">
              <select value={sett || ""} onChange={(e) => setSett(e.target.value || null)} style={{ width: "100%" }}>
                <option value="">Velg sett…</option>
                {alle.map((s) => (
                  <option key={s.code} value={s.code}>{s.name}</option>
                ))}
              </select>
            </Gruppe>

            <Gruppe navn="Raritet">
              <select value={f.rarity} onChange={(e) => endre("rarity", e.target.value)} style={{ width: "100%" }}>
                <option value="">Alle</option>
                {["common", "uncommon", "rare", "mythic", "special"].map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </Gruppe>

            <Gruppe navn="Farge">
              <div className="rad-flex" style={{ gap: 3 }}>
                {FARGER.map((x) => (
                  <button
                    key={x.kode}
                    className={`knapp liten ${f.farge === x.kode ? "primar" : ""}`}
                    title={x.navn}
                    style={{ padding: "2px 8px" }}
                    onClick={() => endre("farge", f.farge === x.kode ? "" : x.kode)}
                  >
                    {x.kode}
                  </button>
                ))}
              </div>
            </Gruppe>

            <Gruppe navn="Type">
              <select value={f.type} onChange={(e) => endre("type", e.target.value)} style={{ width: "100%" }}>
                <option value="">Alle</option>
                {TYPER.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </Gruppe>

            <Gruppe navn="Pris">
              <div className="rad-flex" style={{ gap: 4 }}>
                <input
                  type="text" inputMode="numeric" value={f.prisFra} placeholder="fra"
                  onChange={(e) => endre("prisFra", e.target.value.replace(/\D/g, ""))}
                  style={{ width: 62 }}
                />
                <input
                  type="text" inputMode="numeric" value={f.prisTil} placeholder="til"
                  onChange={(e) => endre("prisTil", e.target.value.replace(/\D/g, ""))}
                  style={{ width: 62 }}
                />
              </div>
            </Gruppe>

            <label className="dempet" style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 10 }}>
              <input type="checkbox" checked={f.baresalg} onChange={(e) => endre("baresalg", e.target.checked)} />
              Vis kun kort på lager
            </label>

            <button className="knapp liten" style={{ marginTop: 12 }} onClick={() => setF(TOMT)}>
              Nullstill filtre
            </button>
          </div>
        </div>

        <div>
          {!sett && <p className="dempet">Velg et sett til venstre.</p>}

          {sett && (
            <>
              <div className="panel" style={{ paddingBottom: 0 }}>
                <div className="krop" style={{ paddingBottom: 0 }}>
                  {/* Fanene er sidenavigasjon, ikke knapper. Antallet i
                      parentes er det som gjør dem verdt å ha. */}
                  <div className="faner" role="tablist">
                    {[
                      { id: "nonfoil", navn: "Enkeltkort" },
                      { id: "foil", navn: "Foils" },
                    ].map((x) => (
                      <button
                        key={x.id}
                        role="tab"
                        aria-selected={finish === x.id}
                        onClick={() => setFinish(x.id)}
                      >
                        {x.navn}
                        {data && <span className="dempet"> ({data.antall?.[x.id] ?? 0})</span>}
                      </button>
                    ))}

                    <div style={{ marginLeft: "auto", display: "flex", gap: 2, paddingBottom: 8 }}>
                      <VisningsIkon
                        aktiv={visning === "tekst"}
                        tittel="Tekstvisning"
                        onClick={() => setVisning("tekst")}
                        strek
                      />
                      <VisningsIkon
                        aktiv={visning === "detalj"}
                        tittel="Detaljvisning"
                        onClick={() => setVisning("detalj")}
                      />
                    </div>
                  </div>

                  <div className="rad-flex" style={{ padding: "10px 0", justifyContent: "space-between" }}>
                    <span className="dempet">
                      {data
                        ? data.totalt === 0
                          ? "Ingen treff"
                          : `${(data.side - 1) * data.perSide + 1}–${Math.min(data.side * data.perSide, data.totalt)} av ${data.totalt}`
                        : ""}
                    </span>
                    <div className="rad-flex">
                      <label className="dempet">
                        Sorter{" "}
                        <select value={sortering} onChange={(e) => setSortering(e.target.value)}>
                          {SORTERING.map((x) => <option key={x.id} value={x.id}>{x.navn}</option>)}
                        </select>
                      </label>
                      <label className="dempet">
                        Vis{" "}
                        <select value={perSide} onChange={(e) => setPerSide(Number(e.target.value))}>
                          {[25, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}
                        </select>
                      </label>
                    </div>
                  </div>
                </div>
              </div>

              {laster && <p className="dempet">Henter…</p>}

              {!laster && data && (
                <>
                  <p className="dempet">
                    {data.utenPris > 0 && (
                      <>
                        {" "}
                        {data.utenPris} kort i settet har ingen pris — verken fra
                        Scryfall, intervallene eller manuelt. De ville ikke vært til
                        salgs.
                      </>
                    )}
                  </p>

                  {visning === "tekst"
                    ? synlige.map((k) => <Tekstrad key={k.id} kort={k} />)
                    : synlige.map((k) => <Detaljrad key={k.id} kort={k} />)}

                  {!synlige.length && <div className="tom">Ingen kort passer filteret.</div>}

                  {data.sider > 1 && (
                    <div className="rad-flex" style={{ justifyContent: "center", marginTop: 16 }}>
                      <button className="knapp" disabled={data.side <= 1} onClick={() => setSide(data.side - 1)}>
                        Forrige
                      </button>
                      <span className="dempet">Side {data.side} av {data.sider}</span>
                      <button
                        className="knapp"
                        disabled={data.side >= data.sider}
                        onClick={() => setSide(data.side + 1)}
                      >
                        Neste
                      </button>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}

// Gult merke, som hos Card Kingdom. Foil og vanlig er samme kort med samme
// bilde, og uten et tydelig merke er det lett å bestille feil.
function FoilMerke() {
  return (
    <span
      style={{
        display: "inline-block",
        marginTop: 5,
        background: "#f5d020",
        color: "#3b2f05",
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: "0.04em",
        padding: "1px 7px",
        borderRadius: 3,
      }}
    >
      FOIL
    </span>
  );
}

// To ikoner i stedet for ordene «Tekst» og «Detalj». Symbolene er kjente fra
// enhver nettbutikk, og de tar mindre plass enn teksten de erstatter.
function VisningsIkon({ aktiv, tittel, onClick, strek }) {
  return (
    <button
      title={tittel}
      aria-label={tittel}
      aria-pressed={aktiv}
      onClick={onClick}
      style={{
        border: "1px solid var(--strek)",
        background: aktiv ? "var(--aksent-svak)" : "var(--flate)",
        color: aktiv ? "var(--aksent)" : "var(--dempet)",
        borderRadius: 6,
        padding: "5px 8px",
        lineHeight: 0,
      }}
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
        {strek ? (
          <>
            <rect x="1" y="2" width="14" height="2" rx="1" />
            <rect x="1" y="7" width="14" height="2" rx="1" />
            <rect x="1" y="12" width="14" height="2" rx="1" />
          </>
        ) : (
          <>
            <rect x="1" y="2" width="5" height="12" rx="1" />
            <rect x="8" y="3" width="7" height="2" rx="1" />
            <rect x="8" y="7" width="7" height="2" rx="1" />
            <rect x="8" y="11" width="5" height="2" rx="1" />
          </>
        )}
      </svg>
    </button>
  );
}

function Gruppe({ navn, children }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div className="dempet" style={{ fontSize: 12.5, marginBottom: 3 }}>{navn}</div>
      {children}
    </div>
  );
}

// Tilstandene nedover, med lager og pris på samme linje. Tettere og lettere å
// skumme enn et rutenett, som er hele poenget med tekstvisning.
function Tekstrad({ kort }) {
  return (
    <div className="panel" style={{ marginBottom: 8 }}>
      <div className="krop" style={{ display: "flex", gap: 20, alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>
            {kort.name}
            {kort.variant && kort.variant !== "vanlig" && (
              <span className="merkelapp m-vent" style={{ marginLeft: 6 }}>{kort.variant}</span>
            )}
          </div>
          <div className="dempet" style={{ fontSize: 13 }}>
            {kort.set_name} · {kort.type_line || kort.rarity}
          </div>
          <div className="dempet" style={{ fontSize: 12 }}>
            Collector #: {kort.collector_number}
            {kort.mana_cost ? ` · ${kort.mana_cost}` : ""}
          </div>
          {kort.valgt.finish === "foil" && <FoilMerke />}
        </div>

        {/* Tilstand, pris, antall, og til slutt handlingen. Rekkefølgen er
            den man leser i: hva slags stand, hva koster det, har du noen,
            og kan jeg få det. */}
        <table style={{ width: 330, flex: "none" }}>
          <tbody>
            {kort.valgt.tilstander.map((t) => (
              <tr key={t.condition}>
                <td style={{ width: 38, padding: "3px 6px", fontWeight: 500 }}>{t.condition}</td>
                <td
                  className="h tall"
                  style={{ width: 80, padding: "3px 6px", color: t.lager > 0 ? "inherit" : "var(--dempet)" }}
                >
                  {kroner(t.ore)}
                </td>
                <td className="h dempet" style={{ width: 62, padding: "3px 6px", fontSize: 13 }}>
                  {t.lager > 0 ? `${t.lager} stk.` : ""}
                </td>
                <td className="h" style={{ padding: "3px 6px" }}>
                  {t.lager > 0 ? (
                    <button
                      className="knapp liten"
                      disabled
                      title="Kurven kommer når kassen bygges"
                      style={{ padding: "2px 10px" }}
                    >
                      Legg i kurven
                    </button>
                  ) : (
                    <span className="dempet" style={{ fontSize: 13 }}>Utsolgt</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Bilde til venstre, kortopplysninger i midten, og en prisboks til høyre med
// tilstandene som faner — slik Card Kingdom gjør det. Trykker du på en fane,
// bytter både prisen og antallet over og under.
function Detaljrad({ kort }) {
  const første = kort.valgt.tilstander.find((t) => t.lager > 0) || kort.valgt.tilstander[0];
  const [valgt, setValgt] = useState(første.condition);
  const t = kort.valgt.tilstander.find((x) => x.condition === valgt) || første;

  return (
    <div className="panel" style={{ marginBottom: 10 }}>
      <div className="krop" style={{ display: "flex", gap: 18, alignItems: "flex-start" }}>
        {kort.image_uri ? (
          <img
            src={kort.image_uri}
            alt={kort.name}
            loading="lazy"
            style={{ width: 130, borderRadius: 7, alignSelf: "flex-start" }}
          />
        ) : (
          <div style={{ width: 130, aspectRatio: "5 / 7", background: "var(--papir)", borderRadius: 7 }} />
        )}

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 16 }}>{kort.name}</div>
          <div style={{ fontSize: 13 }}>{kort.set_name}</div>
          <div className="dempet" style={{ fontSize: 13 }}>
            Collector #: {kort.collector_number}
          </div>
          {kort.valgt.finish === "foil" && <FoilMerke />}

          <div className="dempet" style={{ fontSize: 13, margin: "8px 0 0" }}>
            {kort.mana_cost} {kort.type_line}
            {kort.power ? ` · ${kort.power}/${kort.toughness}` : ""}
            {kort.loyalty ? ` · ${kort.loyalty}` : ""}
          </div>

          {kort.oracle_text && (
            <p style={{ whiteSpace: "pre-line", fontSize: 13.5, margin: "6px 0 0", maxWidth: "56ch" }}>
              {kort.oracle_text}
            </p>
          )}
        </div>

        <div style={{ width: 200, flex: "none", textAlign: "center" }}>
          <div className="tall" style={{ fontSize: 22, fontWeight: 700, marginBottom: 6 }}>
            {kroner(t.ore)}
          </div>

          <div style={{ display: "flex", gap: 0 }}>
            {CONDITIONS.map((c) => {
              const x = kort.valgt.tilstander.find((y) => y.condition === c);
              if (!x) return null;
              const aktiv = valgt === c;
              return (
                <button
                  key={c}
                  onClick={() => x.lager && setValgt(c)}
                  disabled={!x.lager}
                  title={x.lager ? `${x.lager} på lager` : "Utsolgt"}
                  style={{
                    flex: 1,
                    border: "1px solid var(--strek)",
                    borderRight: c === "G" ? "1px solid var(--strek)" : "none",
                    background: aktiv ? "var(--aksent-svak)" : "var(--flate)",
                    color: x.lager ? (aktiv ? "var(--aksent)" : "var(--blekk)") : "var(--strek)",
                    fontWeight: aktiv ? 600 : 400,
                    padding: "5px 0",
                    cursor: x.lager ? "pointer" : "default",
                  }}
                >
                  {c}
                </button>
              );
            })}
          </div>

          <div className="dempet" style={{ fontSize: 13, margin: "7px 0 8px" }}>
            {t.lager > 0 ? `${t.lager} tilgjengelig` : "Utsolgt"}
          </div>

          {/* Kurven finnes ikke ennå. Knappen står her fordi plasseringen er
              det som skal vurderes — den kobles opp når kassen bygges. */}
          <button
            className="knapp primar"
            style={{ width: "100%" }}
            disabled
            title="Kurven kommer når kassen bygges"
          >
            Legg i kurven
          </button>
        </div>
      </div>
    </div>
  );
}
