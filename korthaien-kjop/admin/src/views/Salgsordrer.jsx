import { useState, useEffect } from "react";
import { api, kroner } from "../api.js";

// ─────────────────────────────────────────────────────────────────────────────
// SALGSORDRER
// ─────────────────────────────────────────────────────────────────────────────
// Dashbordet du pakker og sender fra. Øverst tallene for denne og forrige
// måned, så ordrene som venter. Den eldste betalte ordren står først i
// «Til pakking» — den har ventet lengst.
//
// Linjene står i samme rekkefølge som kjøpsordrene: sett, raritet, navn.
// Hakene i plukklisten er bare her på skjermen, til hjelp mens du plukker.

const FANER = [
  // Tre steg er alt som trengs: inn, sendt, eller kansellert. «Pakket»
  // finnes ikke i menyen; en ordre som eventuelt står slik, er ikke
  // behandlet ferdig og ligger sammen med de andre.
  { id: "pakkes", navn: "Ikke behandlet", status: ["betalt", "pakket"] },
  { id: "sendt", navn: "Sendt", status: ["sendt"] },
  { id: "kansellert", navn: "Kansellert", status: ["kansellert"] },
  { id: "apen", navn: "Åpne kasser", status: ["apen", "utlopt"] },
];

const STATUS = {
  apen: "I kassen",
  betalt: "Ikke behandlet",
  pakket: "Ikke behandlet",
  sendt: "Sendt",
  kansellert: "Kansellert",
  utlopt: "Forlatt",
};

const MND = ["januar", "februar", "mars", "april", "mai", "juni", "juli", "august", "september", "oktober", "november", "desember"];
const mndNavn = (m) => `${MND[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
const tid = (iso) => (iso ? new Date(iso).toLocaleString("nb-NO", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");

export default function Salgsordrer({ onFeil, onMelding, onAntall }) {
  const [fane, setFane] = useState("pakkes");
  const [data, setData] = useState(null);
  const [åpen, setÅpen] = useState(null);

  async function last() {
    try {
      const r = await api.salgsordrer(fane);
      setData(r);
      onAntall?.((r.antall?.betalt || 0) + (r.antall?.pakket || 0));
    } catch (e) {
      onFeil(e);
    }
  }
  useEffect(() => {
    setData(null);
    last();
  }, [fane]);

  if (åpen) {
    return (
      <Ordre
        nr={åpen}
        onLukk={() => { setÅpen(null); last(); }}
        onFeil={onFeil}
        onMelding={onMelding}
      />
    );
  }

  return (
    <>
      <Statistikk onFeil={onFeil} />
      <div className="faner" role="tablist" style={{ marginBottom: 14 }}>
        {FANER.map((f) => {
          const n = f.status.reduce((s, st) => s + (data?.antall?.[st] || 0), 0);
          return (
            <button key={f.id} role="tab" aria-selected={fane === f.id} onClick={() => setFane(f.id)}>
              {f.navn}
              {f.id === "pakkes" && n > 0 && <span className="antall" style={{ marginLeft: 6 }}>{n}</span>}
            </button>
          );
        })}
      </div>

      {!data ? (
        <p className="dempet">Henter…</p>
      ) : !data.ordrer.length ? (
        <div className="tom">
          <b>{fane === "pakkes" ? "Ingen ubehandlede ordrer." : "Ingen ordrer her."}</b>
          {fane === "pakkes" && "Nye ordrer dukker opp her så snart de er betalt."}
        </div>
      ) : (
        <div className="panel">
          <table>
            <thead>
              <tr>
                <th>Ordre</th>
                <th>Kunde</th>
                <th>{fane === "apen" ? "Opprettet" : "Betalt"}</th>
                <th>Frakt</th>
                <th className="h">Kort</th>
                <th className="h" title="Betalt med kort/Vipps. Kreditt er ikke med.">Sum</th>
                {fane === "apen" && <th>Status</th>}
                {fane === "sendt" && <th>Sendt</th>}
              </tr>
            </thead>
            <tbody>
              {data.ordrer.map((o) => (
                <tr key={o.ordrenr} style={{ cursor: "pointer" }} onClick={() => setÅpen(o.ordrenr)}>
                  <td><button className="lenke kode">{o.ordrenr}</button></td>
                  <td>{o.kunde_navn}<div className="dempet" style={{ fontSize: 12 }}>{o.email}</div></td>
                  <td>{tid(fane === "apen" ? o.created_at : o.betalt_at)}</td>
                  <td>{o.frakt_navn}</td>
                  <td className="h tall">{o.antall_kort}</td>
                  <td className="h tall">
                    {kroner(Number(o.stripe_ore) || 0)}
                    {Number(o.kreditt_ore) + (Number(o.gavekort_ore) || 0) > 0 && (
                      <div className="dempet" style={{ fontSize: 11.5 }}>
                        + {kroner(Number(o.kreditt_ore) + (Number(o.gavekort_ore) || 0))} {Number(o.gavekort_ore) > 0 ? "kreditt/gavekort" : "kreditt"}
                      </div>
                    )}
                  </td>
                  {fane === "apen" && <td>{STATUS[o.status]}</td>}
                  {fane === "sendt" && <td>{tid(o.sendt_at)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// ── statistikk ──────────────────────────────────────────────────────────────
function Statistikk({ onFeil }) {
  const [s, setS] = useState(null);
  const [historikk, setHistorikk] = useState(false);
  useEffect(() => {
    api.salgsstatistikk().then(setS).catch(onFeil);
  }, []);
  if (!s) return null;
  return (
    <div className="panel" style={{ marginBottom: 16, padding: "16px 18px" }}>
      <div className="rad-flex" style={{ gap: 32, flexWrap: "wrap" }}>
        <Tall merke="Denne måneden" m={s.denne} />
        <Tall merke="Forrige måned" m={s.forrige} />
        <button className="knapp liten" style={{ marginLeft: "auto", alignSelf: "center" }} onClick={() => setHistorikk(!historikk)}>
          {historikk ? "Skjul historikk" : "Vis historikk"}
        </button>
      </div>
      {historikk && (
        s.historikk.length ? (
          <table style={{ marginTop: 14, maxWidth: 560 }}>
            <thead>
              <tr><th>Måned</th><th className="h">Omsetning</th><th className="h">Ordrer</th><th className="h">Kort</th></tr>
            </thead>
            <tbody>
              {s.historikk.map((m) => (
                <tr key={m.maaned}>
                  <td>{mndNavn(m.maaned)}</td>
                  <td className="h tall">{kroner(m.omsetning_ore)}</td>
                  <td className="h tall">{m.ordrer}</td>
                  <td className="h tall">{Number(m.kort).toLocaleString("nb-NO")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="dempet" style={{ marginTop: 14 }}>
            Ingen måneder logget ennå. Hver måned skrives ned når den er over, og står da fast for sammenligning.
          </p>
        )
      )}
    </div>
  );
}

function Tall({ merke, m }) {
  return (
    <div>
      <div className="dempet" style={{ fontSize: 12 }}>{merke}</div>
      <div style={{ fontSize: 24, fontWeight: 700, lineHeight: 1.2 }}>{kroner(m.omsetning_ore)}</div>
      <div className="dempet" style={{ fontSize: 12 }}>
        {m.ordrer} {m.ordrer === 1 ? "ordre" : "ordrer"} · {Number(m.kort).toLocaleString("nb-NO")} kort
      </div>
    </div>
  );
}

// ── én ordre ────────────────────────────────────────────────────────────────
function Ordre({ nr, onLukk, onFeil, onMelding }) {
  const [o, setO] = useState(null);
  const [plukket, setPlukket] = useState(new Set());
  const [spor, setSpor] = useState("");
  const [notat, setNotat] = useState("");
  const [jobber, setJobber] = useState(false);
  const [vis, setVis] = useState(null);
  const [svev, setSvev] = useState(null);
  // Retting av antall: null når du ikke retter, ellers nytt antall per linje.
  const [retting, setRetting] = useState(null);
  const [forslag, setForslag] = useState(null);
  const [rettFeil, setRettFeil] = useState("");
  const [tilbake, setTilbake] = useState(false);
  const [rettGrunn, setRettGrunn] = useState("");

  const rettLinjer = retting
    ? Object.entries(retting).map(([id, v]) => ({ id: Number(id), antall: v === "" ? NaN : Number(v) }))
    : [];
  const rettNøkkel = JSON.stringify(rettLinjer);
  useEffect(() => {
    if (!retting) return;
    setForslag(null);
    setRettFeil("");
    if (!rettLinjer.length || rettLinjer.some((l) => !Number.isInteger(l.antall))) return;
    let avbrutt = false;
    const t = setTimeout(() => {
      api
        .justerSalgsordre(nr, { linjer: rettLinjer })
        .then((r) => !avbrutt && setForslag(r.forslag))
        .catch((e) => !avbrutt && setRettFeil(e.message || String(e)));
    }, 250);
    return () => { avbrutt = true; clearTimeout(t); };
  }, [rettNøkkel]);

  async function lagreRetting() {
    setJobber(true);
    try {
      const r = await api.justerSalgsordre(nr, { linjer: rettLinjer, bekreft: true, tilbake_paa_lager: tilbake, grunn: rettGrunn });
      setO(r.ordre);
      setNotat(r.ordre.admin_notat || "");
      setRetting(null);
      setForslag(null);
      setTilbake(false);
      setRettGrunn("");
      onMelding(`Ordren er rettet. ${kroner(r.forslag.refusjon_ore)} er sendt tilbake, og kunden har fått e-post.`);
    } catch (e) {
      onFeil(e);
    }
    setJobber(false);
  }

  useEffect(() => {
    if (!vis) return;
    const lukk = (e) => e.key === "Escape" && setVis(null);
    window.addEventListener("keydown", lukk);
    return () => window.removeEventListener("keydown", lukk);
  }, [vis]);

  useEffect(() => {
    api.salgsordre(nr).then((r) => {
      setO(r.ordre);
      setSpor(r.ordre.sporingsnr || "");
      setNotat(r.ordre.admin_notat || "");
    }).catch(onFeil);
  }, [nr]);

  async function endre(felt, melding) {
    setJobber(true);
    try {
      const r = await api.endreSalgsordre(nr, felt);
      setO(r.ordre);
      if (melding) onMelding(melding);
    } catch (e) {
      onFeil(e);
    }
    setJobber(false);
  }

  if (!o) return <p className="dempet">Henter…</p>;
  const etterBetaling = ["betalt", "pakket", "sendt"].includes(o.status);

  return (
    <>
      {svev && bildeFor(svev.l) && (() => {
        // Bildet følger musa, på den siden av skjermen det er plass.
        const B = 300, H = 418;
        const x = svev.x + 24 + B > window.innerWidth ? svev.x - 24 - B : svev.x + 24;
        const y = Math.max(8, Math.min(svev.y - H / 2, window.innerHeight - H - 8));
        return (
          <img
            className="kortsvev"
            src={bildeFor(svev.l)}
            alt=""
            style={{ left: x, top: y, width: B, height: H }}
          />
        );
      })()}
      {vis && (
        <div className="kortvisning" onClick={() => setVis(null)} role="dialog" aria-label={vis.card_name}>
          <div onClick={(e) => e.stopPropagation()}>
            {bildeFor(vis, true) ? (
              <img src={bildeFor(vis, true)} alt={vis.card_name} />
            ) : (
              <div className="kortvisning-tom">Ingen bilde</div>
            )}
            <div className="kortvisning-tekst">
              <b>{vis.card_name}</b>
              <span>{vis.set_name}{vis.collector_number ? ` #${vis.collector_number}` : ""}{vis.utgave ? ` · ${vis.utgave}` : ""}{vis.finish === "foil" ? " · foil" : ""}</span>
            </div>
            <button type="button" className="knapp liten" onClick={() => setVis(null)}>Lukk</button>
          </div>
        </div>
      )}
      <button className="knapp liten" style={{ marginBottom: 12 }} onClick={onLukk}>← Alle salgsordrer</button>
      <div className="rad-flex" style={{ alignItems: "baseline", marginBottom: 10 }}>
        <h2 style={{ margin: 0 }} className="kode">{o.ordrenr}</h2>
        <span className="merkelapp m-mottatt">{STATUS[o.status]}</span>
        <span className="dempet">Betalt {tid(o.betalt_at)}</span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 300px", gap: 16, alignItems: "start" }}>
        <div className="panel">
          <header>
            <h3>Plukkliste — {o.antall_kort} kort</h3>
            <span className="dempet" style={{ marginLeft: "auto", fontSize: 12.5 }}>
              {plukket.size} av {o.linjer.length} linjer plukket
            </span>
          </header>
          <table>
            <thead>
              <tr>
                <th style={{ width: 74 }}>Antall</th><th>Kort</th><th>Sett</th><th>#</th><th>Tilstand</th>
                <th className="h" title="I hylla nå (med solgte kort som ikke er sendt). I parentes: ledig for salg.">På lager</th><th className="h">Sum</th>
              </tr>
            </thead>
            <tbody>
              {o.linjer.map((l) => {
                const ok = plukket.has(l.id);
                return (
                  <tr
                    key={l.id}
                    style={{ cursor: retting ? "default" : "pointer", opacity: ok && !retting ? 0.5 : 1 }}
                    onClick={() => {
                      if (retting) return;
                      const ny = new Set(plukket);
                      ok ? ny.delete(l.id) : ny.add(l.id);
                      setPlukket(ny);
                    }}
                  >
                    <td>
                      {retting ? (
                        <input
                          type="number"
                          min={0}
                          max={l.antall}
                          value={retting[l.id] ?? String(l.antall)}
                          onChange={(e) => setRetting((r) => ({ ...r, [l.id]: e.target.value.replace(/[^\d]/g, "") }))}
                          style={{ width: 56, padding: "4px 6px", fontSize: 15 }}
                          aria-label={`Nytt antall for ${l.card_name}`}
                        />
                      ) : (
                      <span className="rad-flex" style={{ gap: 8 }}>
                        <input type="checkbox" checked={ok} readOnly />
                        <span className="tall" style={{ fontSize: 15, fontWeight: Number(l.antall) > 1 ? 800 : 500 }}>
                          {l.antall}
                        </span>
                      </span>
                      )}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="kortnavn-knapp"
                        title="Vis kortet"
                        onClick={(e) => { e.stopPropagation(); setSvev(null); setVis(l); }}
                        onMouseEnter={(e) => setSvev({ l, x: e.clientX, y: e.clientY })}
                        onMouseMove={(e) => setSvev((v) => (v ? { ...v, x: e.clientX, y: e.clientY } : v))}
                        onMouseLeave={() => setSvev(null)}
                      >
                        {l.card_name}
                      </button>
                      {l.finish === "foil" && <span className="merkelapp m-vent" style={{ marginLeft: 6 }}>foil</span>}
                      {l.utgave && <div style={{ fontSize: 12, fontWeight: 600, color: "var(--aksent, #1d4ed8)" }}>{l.utgave}</div>}
                    </td>
                    <td style={{ fontSize: 12.5 }}>
                      {l.set_name}
                      {l.rarity && <div className="dempet" style={{ fontSize: 11.5 }}>{l.rarity}</div>}
                    </td>
                    <td className="tall">{l.collector_number}</td>
                    <td>{l.produkt ? <span className="dempet">—</span> : l.condition}</td>
                    <td className="h tall" style={{ whiteSpace: "nowrap" }}>
                      {l.paa_lager ? (
                        <>
                          {l.paa_lager.hylle}
                          <span className="dempet"> ({l.paa_lager.ledig})</span>
                        </>
                      ) : "—"}
                    </td>
                    <td className="h tall" style={{ whiteSpace: "nowrap" }}>
                      {kroner(l.enhet_ore * (retting && retting[l.id] !== undefined && retting[l.id] !== "" ? Number(retting[l.id]) : l.antall))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div>
          <div className="panel">
            <header><h3>Sendes til</h3></header>
            <div className="krop" style={{ whiteSpace: "pre-line", lineHeight: 1.55 }}>
              {[o.kunde_navn, o.adresse, `${o.postnr || ""} ${o.poststed || ""}`.trim(), o.land && o.land !== "NO" ? o.land : null]
                .filter(Boolean).join("\n")}
              <div className="dempet" style={{ fontSize: 13, marginTop: 8 }}>
                {o.email}{o.telefon ? ` · ${o.telefon}` : ""}
              </div>
              <div style={{ marginTop: 8 }}><b>{o.frakt_navn}</b></div>
              {o.kunde_notat && (
                <div style={{ marginTop: 10, padding: 8, background: "var(--aksent-svak)", borderRadius: 6, fontSize: 13.5 }}>
                  {o.kunde_notat}
                </div>
              )}
            </div>
          </div>

          <div className="panel">
            <header><h3>Betaling</h3></header>
            <div className="krop">
              <table>
                <tbody>
                  <tr><td>Kort ({o.antall_kort} stk.)</td><td className="h tall">{kroner(o.varer_ore)}</td></tr>
                  {Number(o.rabatt_ore) > 0 && (
                    <tr><td>Rabatt <span className="dempet">({o.rabattkode})</span></td><td className="h tall">−{kroner(o.rabatt_ore)}</td></tr>
                  )}
                  <tr><td>Frakt</td><td className="h tall">{kroner(o.frakt_ore)}</td></tr>
                  {Number(o.gavekort_ore) > 0 && (
                    <tr><td>Gavekort <span className="dempet">({o.rabattkode})</span></td><td className="h tall">−{kroner(o.gavekort_ore)}</td></tr>
                  )}
                  {Number(o.kreditt_ore) > 0 && (
                    <tr><td>Kreditt</td><td className="h tall">−{kroner(o.kreditt_ore)}</td></tr>
                  )}
                  <tr style={{ borderTop: "2px solid var(--strek-sterk, #9aa3b2)" }}>
                    <td>
                      <b>Totalt</b>
                      <div className="dempet" style={{ fontSize: 12 }}>
                        {Number(o.stripe_ore) > 0 ? (o.betalingsmate === "vipps" ? "(betalt med Vipps)" : o.betalingsmate === "kort" ? "(betalt med kort)" : "(betalt kort/Vipps)") : "(alt betalt med kreditt/gavekort)"}
                      </div>
                    </td>
                    <td className="h tall" style={{ fontSize: 18 }}><b>{kroner(Number(o.stripe_ore) || 0)}</b></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {etterBetaling && (
            <div className="panel">
              <header><h3>Status</h3></header>
              <div className="krop skjema">
                {o.status !== "sendt" && (
                  <>
                    <label>
                      Sporingsnummer
                      <input value={spor} onChange={(e) => setSpor(e.target.value)} placeholder="Valgfritt" />
                    </label>
                    <button
                      className="knapp primar"
                      disabled={jobber}
                      onClick={() => endre({ status: "sendt", sporingsnr: spor }, "Merket som sendt. Kunden har fått e-post.")}
                    >
                      Merk som sendt
                    </button>
                    <span className="dempet" style={{ fontSize: 12 }}>Kunden får en e-post om at pakken er på vei.</span>
                  </>
                )}
                {o.status === "sendt" && (
                  <>
                    <div>Sendt {tid(o.sendt_at)}{o.sporingsnr ? ` · ${o.sporingsnr}` : ""}</div>
                    <button className="knapp liten" disabled={jobber} onClick={() => endre({ status: "betalt" })}>
                      Angre «sendt»
                    </button>
                  </>
                )}
              </div>
            </div>
          )}

          {etterBetaling && (
            <div className="panel">
              <header><h3>Rett antall</h3></header>
              <div className="krop skjema">
                {!retting ? (
                  <>
                    <span className="dempet" style={{ fontSize: 12.5 }}>
                      Mangler du et kort? Sett ned antallet, så får kunden mellomlegget tilbake.
                    </span>
                    <button className="knapp" disabled={jobber} onClick={() => { setRetting({}); setPlukket(new Set()); }}>
                      Rett antall…
                    </button>
                  </>
                ) : (
                  <>
                    <span className="dempet" style={{ fontSize: 12.5 }}>
                      Endre antallet i plukklisten. 0 fjerner kortet fra ordren.
                    </span>
                    {rettFeil && <div className="varsel feil" style={{ margin: 0 }}>{rettFeil}</div>}
                    {forslag && (
                      <div style={{ fontSize: 13.5, lineHeight: 1.5 }}>
                        Tilbake til kunden: <b>{kroner(forslag.refusjon_ore)}</b>
                        {forslag.til_kort_ore > 0 && <div>· {kroner(forslag.til_kort_ore)} til {forslag.betalt_med === "Vipps" ? "Vipps" : "kortet"}</div>}
                        {forslag.til_kreditt_ore > 0 && <div>· {kroner(forslag.til_kreditt_ore)} som kreditt</div>}
                        {forslag.til_gavekort_ore > 0 && <div>· {kroner(forslag.til_gavekort_ore)} på gavekortet</div>}
                        <div className="dempet" style={{ fontSize: 12 }}>Frakten endres ikke. Kunden får en e-post.</div>
                      </div>
                    )}
                    <label style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                      <input type="checkbox" style={{ marginTop: 3 }} checked={tilbake} onChange={(e) => setTilbake(e.target.checked)} />
                      <span>
                        Legg kortene tilbake på lager
                        <div className="dempet" style={{ fontSize: 12 }}>Bare hvis du har dem likevel. Manglet kortet, lar du den stå av.</div>
                      </span>
                    </label>
                    <label>Grunn (bare for deg)<input value={rettGrunn} onChange={(e) => setRettGrunn(e.target.value)} placeholder="F.eks. fant ikke kortet" /></label>
                    <div className="rad-flex">
                      <button className="knapp" disabled={jobber} onClick={() => { setRetting(null); setForslag(null); setRettFeil(""); }}>
                        Avbryt
                      </button>
                      <button className="knapp primar" disabled={jobber || !forslag || forslag.refusjon_ore <= 0} onClick={lagreRetting}>
                        {jobber ? "Lagrer…" : forslag ? `Lagre og refunder ${kroner(forslag.refusjon_ore)}` : "Lagre"}
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          <div className="panel">
            <header><h3>Notat</h3></header>
            <div className="krop skjema">
              <textarea rows={3} value={notat} onChange={(e) => setNotat(e.target.value)} placeholder="Bare for deg" />
              <button className="knapp liten" disabled={jobber || notat === (o.admin_notat || "")} onClick={() => endre({ admin_notat: notat }, "Notatet er lagret.")}>
                Lagre notat
              </button>
            </div>
          </div>

          {["betalt", "pakket"].includes(o.status) && (
            <Kanseller o={o} onFerdig={(ny) => { setO(ny); onMelding("Ordren er kansellert."); }} onFeil={onFeil} />
          )}
        </div>
      </div>
    </>
  );
}

// Kansellering. Hovedregelen etter angrerettloven er at pengene går tilbake
// samme vei som de kom: kortdelen til kortet, kredittdelen som kreditt.
// Alt som kreditt bare hvis kunden har sagt ja til det.
function Kanseller({ o, onFerdig, onFeil }) {
  const [åpen, setÅpen] = useState(false);
  const [måte, setMåte] = useState(Number(o.stripe_ore) > 0 ? "kort" : "kreditt");
  const [grunn, setGrunn] = useState("");
  const [jobber, setJobber] = useState(false);
  const gavekort = Number(o.gavekort_ore) || 0;
  const totalt = Number(o.kreditt_ore) + Number(o.stripe_ore);
  if (!åpen) {
    return (
      <button className="knapp fare" style={{ width: "100%" }} onClick={() => setÅpen(true)}>
        Kanseller ordren…
      </button>
    );
  }
  return (
    <div className="panel" style={{ borderColor: "var(--feil)" }}>
      <header><h3>Kanseller {o.ordrenr}</h3></header>
      <div className="krop skjema">
        <p className="dempet" style={{ margin: 0, fontSize: 13 }}>
          Kortene legges tilbake på lager.
          {gavekort > 0 && ` ${kroner(gavekort)} går tilbake på gavekortet ${o.rabattkode}.`}
        </p>
        {Number(o.stripe_ore) > 0 && (
          <label className="rad-flex" style={{ gap: 8, alignItems: "flex-start" }}>
            <input type="radio" checked={måte === "kort"} onChange={() => setMåte("kort")} />
            <span>
              {kroner(o.stripe_ore)} tilbake til {o.betalingsmate === "vipps" ? "Vipps" : o.betalingsmate === "kort" ? "kortet" : "kortet/Vipps"}
              {Number(o.kreditt_ore) > 0 ? `, ${kroner(o.kreditt_ore)} som kreditt` : ""}
              <div className="dempet" style={{ fontSize: 12 }}>Samme vei som kunden betalte.</div>
            </span>
          </label>
        )}
        <label className="rad-flex" style={{ gap: 8, alignItems: "flex-start" }}>
          <input type="radio" checked={måte === "kreditt"} onChange={() => setMåte("kreditt")} />
          <span>
            Hele {kroner(totalt)} som kreditt
            {Number(o.stripe_ore) > 0 && (
              <div className="dempet" style={{ fontSize: 12 }}>Bare hvis kunden har sagt ja til det.</div>
            )}
          </span>
        </label>
        <label>Grunn (bare for deg)<input value={grunn} onChange={(e) => setGrunn(e.target.value)} /></label>
        <div className="rad-flex">
          <button className="knapp" onClick={() => setÅpen(false)} disabled={jobber}>Avbryt</button>
          <button
            className="knapp fare"
            disabled={jobber}
            onClick={async () => {
              setJobber(true);
              try {
                const r = await api.kansellerSalgsordre(o.ordrenr, grunn, måte);
                onFerdig(r.ordre);
              } catch (e) {
                onFeil(e);
              }
              setJobber(false);
            }}
          >
            {jobber ? "Kansellerer…" : "Kanseller"}
          </button>
        </div>
      </div>
    </div>
  );
}

// Bildet fra katalogen. Mangler det, spørres Scryfall direkte etter sett og
// nummer — da finnes det et bilde så lenge kortet finnes der.
function bildeFor(l, stort = false) {
  if (!l || l.produkt) return null;
  if (l.image_uri) return stort ? String(l.image_uri).replace("/normal/", "/large/") : l.image_uri;
  if (l.set_code && l.collector_number) {
    return `https://api.scryfall.com/cards/${encodeURIComponent(String(l.set_code).toLowerCase())}/${encodeURIComponent(l.collector_number)}?format=image&version=${stort ? "large" : "normal"}`;
  }
  return null;
}
