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
  { id: "pakkes", navn: "Til pakking", status: ["betalt"] },
  { id: "pakket", navn: "Pakket", status: ["pakket"] },
  { id: "sendt", navn: "Sendt", status: ["sendt"] },
  { id: "kansellert", navn: "Kansellert", status: ["kansellert"] },
  { id: "apen", navn: "Åpne kasser", status: ["apen", "utlopt"] },
];

const STATUS = {
  apen: "I kassen",
  betalt: "Betalt",
  pakket: "Pakket",
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
      onAntall?.(r.antall?.betalt || 0);
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
          <b>{fane === "pakkes" ? "Ingenting å pakke." : "Ingen ordrer her."}</b>
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
                <th className="h">Sum</th>
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
                  <td className="h tall">{kroner(Number(o.varer_ore) + Number(o.frakt_ore))}</td>
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
  const alle = o.linjer.length > 0 && plukket.size === o.linjer.length;

  return (
    <>
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
              <tr><th style={{ width: 30 }} /><th>Sett</th><th>Kort</th><th>#</th><th>Tilstand</th><th className="h">Antall</th><th className="h">Sum</th></tr>
            </thead>
            <tbody>
              {o.linjer.map((l) => {
                const ok = plukket.has(l.id);
                return (
                  <tr
                    key={l.id}
                    style={{ cursor: "pointer", opacity: ok ? 0.5 : 1 }}
                    onClick={() => {
                      const ny = new Set(plukket);
                      ok ? ny.delete(l.id) : ny.add(l.id);
                      setPlukket(ny);
                    }}
                  >
                    <td><input type="checkbox" checked={ok} readOnly /></td>
                    <td style={{ fontSize: 12.5 }}>
                      {l.set_name}
                      <div className="dempet" style={{ fontSize: 11.5 }}>{l.rarity}</div>
                    </td>
                    <td>
                      <b>{l.card_name}</b>
                      {l.finish === "foil" && <span className="merkelapp m-vent" style={{ marginLeft: 6 }}>foil</span>}
                    </td>
                    <td className="tall">{l.collector_number}</td>
                    <td>{l.condition}</td>
                    <td className="h tall" style={{ fontWeight: Number(l.antall) > 1 ? 700 : 400 }}>{l.antall}</td>
                    <td className="h tall">{kroner(l.enhet_ore * l.antall)}</td>
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
                  <tr><td>Kort</td><td className="h tall">{kroner(o.varer_ore)}</td></tr>
                  <tr><td>Frakt</td><td className="h tall">{kroner(o.frakt_ore)}</td></tr>
                  <tr><td><b>Totalt</b></td><td className="h tall"><b>{kroner(Number(o.varer_ore) + Number(o.frakt_ore))}</b></td></tr>
                  {Number(o.kreditt_ore) > 0 && <tr><td className="dempet">Kreditt</td><td className="h tall dempet">{kroner(o.kreditt_ore)}</td></tr>}
                  {Number(o.stripe_ore) > 0 && <tr><td className="dempet">Kort/Vipps</td><td className="h tall dempet">{kroner(o.stripe_ore)}</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          {etterBetaling && (
            <div className="panel">
              <header><h3>Status</h3></header>
              <div className="krop skjema">
                {o.status === "betalt" && (
                  <button className="knapp" disabled={jobber} onClick={() => endre({ status: "pakket" }, "Merket som pakket.")}>
                    {alle ? "Alt plukket — merk som pakket" : "Merk som pakket"}
                  </button>
                )}
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
                    <button className="knapp liten" disabled={jobber} onClick={() => endre({ status: "pakket" })}>
                      Angre «sendt»
                    </button>
                  </>
                )}
                {o.status === "pakket" && (
                  <button className="knapp liten" disabled={jobber} onClick={() => endre({ status: "betalt" })}>
                    Angre «pakket»
                  </button>
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
  const totalt = Number(o.varer_ore) + Number(o.frakt_ore);
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
        <p className="dempet" style={{ margin: 0, fontSize: 13 }}>Kortene legges tilbake på lager.</p>
        {Number(o.stripe_ore) > 0 && (
          <label className="rad-flex" style={{ gap: 8, alignItems: "flex-start" }}>
            <input type="radio" checked={måte === "kort"} onChange={() => setMåte("kort")} />
            <span>
              {kroner(o.stripe_ore)} tilbake til kortet/Vipps
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
