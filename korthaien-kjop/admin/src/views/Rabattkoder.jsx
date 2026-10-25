import { useState, useEffect } from "react";
import { api, kroner, dato, importerRabattkoder } from "../api.js";

// ─────────────────────────────────────────────────────────────────────────────
// RABATTKODER
// ─────────────────────────────────────────────────────────────────────────────
// Gavekort (saldo som brukes ned over flere kjøp) og kampanjekoder (prosent av
// kortene). Ingen av dem er knyttet til en konto: den som har koden, kan
// bruke den i kassen — også uten å logge inn.

const tilØre = (kr) => Math.round((parseFloat(String(kr).replace(",", ".")) || 0) * 100);
const GRUNNER = { opprettet: "Opprettet", kjop: "Brukt", refusjon: "Tilbake fra kansellert ordre", manuell: "Endret for hånd" };

export default function Rabattkoder({ onFeil, onMelding }) {
  const [data, setData] = useState(null);
  const [åpen, setÅpen] = useState(null);
  const [visBrukte, setVisBrukte] = useState(false);

  async function last() {
    try {
      setData(await api.rabattkoder());
    } catch (e) {
      onFeil(e);
    }
  }
  useEffect(() => { last(); }, []);

  if (!data) return <p className="dempet">Henter rabattkoder…</p>;

  if (åpen) {
    const k = data.koder.find((x) => x.id === åpen);
    if (k) return <Kode k={k} onLukk={() => { setÅpen(null); last(); }} onEndret={last} onFeil={onFeil} onMelding={onMelding} />;
  }

  const brukt = (k) => !k.aktiv || (k.type === "saldo" && k.saldo_ore <= 0) || (k.gyldig_til && k.gyldig_til < new Date().toISOString().slice(0, 10));
  const synlige = data.koder.filter((k) => visBrukte || !brukt(k));
  const skjulte = data.koder.length - data.koder.filter((k) => !brukt(k)).length;

  return (
    <>
      <NyKode forslag={data.forslag} onLaget={last} onFeil={onFeil} onMelding={onMelding} />

      <div className="panel">
        <header>
          <h3>Koder</h3>
          {skjulte > 0 && (
            <label className="dempet" style={{ marginLeft: "auto", fontSize: 13, display: "flex", gap: 6, alignItems: "center" }}>
              <input type="checkbox" checked={visBrukte} onChange={(e) => setVisBrukte(e.target.checked)} />
              Vis brukte og avslåtte ({skjulte})
            </label>
          )}
        </header>
        <table>
          <thead>
            <tr>
              <th>Kode</th>
              <th>Type</th>
              <th className="h">Igjen / rabatt</th>
              <th className="h">Brukt</th>
              <th>Siste dag</th>
              <th>Merknad</th>
            </tr>
          </thead>
          <tbody>
            {synlige.map((k) => (
              <tr key={k.id} style={{ cursor: "pointer", opacity: brukt(k) ? 0.55 : 1 }} onClick={() => setÅpen(k.id)}>
                <td>
                  <span className="kode" style={{ fontWeight: 600 }}>{k.kode}</span>
                  {!k.aktiv && <span className="merkelapp m-av" style={{ marginLeft: 6 }}>av</span>}
                </td>
                <td>{k.type === "saldo" ? "Gavekort" : "Prosent"}</td>
                <td className="h tall">
                  {k.type === "saldo" ? kroner(k.saldo_ore) : `${k.prosent} %`}
                  {k.holdt > 0 && <div className="dempet" style={{ fontSize: 11.5 }}>i en åpen kasse</div>}
                </td>
                <td className="h tall">
                  {k.brukt}{k.maks_bruk != null ? ` av ${k.maks_bruk}` : ""}
                </td>
                <td>{k.gyldig_til ? dato(k.gyldig_til) : <span className="dempet">—</span>}</td>
                <td className="dempet">{k.merknad || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!synlige.length && <div className="tom"><b>Ingen koder ennå</b>Lag en over, eller lim inn kodene fra Mystore under.</div>}
      </div>

      <Import onFerdig={last} onFeil={onFeil} onMelding={onMelding} />
    </>
  );
}

function NyKode({ forslag, onLaget, onFeil, onMelding }) {
  const tom = { type: "saldo", kode: "", beløp: "", prosent: "", gyldig_til: "", maks_bruk: "", merknad: "" };
  const [f, setF] = useState(tom);
  const [jobber, setJobber] = useState(false);
  const endre = (k, v) => setF((x) => ({ ...x, [k]: v }));

  async function lag() {
    setJobber(true);
    try {
      const r = await api.nyRabattkode({
        kode: f.kode || forslag,
        type: f.type,
        saldo_ore: tilØre(f.beløp),
        prosent: Number(f.prosent),
        gyldig_til: f.gyldig_til || null,
        maks_bruk: f.maks_bruk === "" ? null : Number(f.maks_bruk),
        merknad: f.merknad,
      });
      onMelding(`Koden ${r.kode.kode} er laget.`);
      setF(tom);
      onLaget();
    } catch (e) {
      onFeil(e);
    } finally {
      setJobber(false);
    }
  }

  const klar = f.type === "saldo" ? tilØre(f.beløp) > 0 : Number(f.prosent) >= 1 && Number(f.prosent) <= 100;

  return (
    <div className="panel">
      <header><h3>Ny kode</h3></header>
      <div className="krop">
        <div className="rad-flex" style={{ gap: 6, marginBottom: 12 }}>
          {[["saldo", "Gavekort (beløp)"], ["prosent", "Kampanje (prosent)"]].map(([v, n]) => (
            <button key={v} className={`knapp liten ${f.type === v ? "primar" : ""}`} onClick={() => endre("type", v)}>{n}</button>
          ))}
        </div>
        <div className="rad-flex" style={{ alignItems: "flex-end", gap: 14, flexWrap: "wrap" }}>
          <label>
            <div className="dempet" style={{ fontSize: 12, marginBottom: 3 }}>Kode</div>
            <input
              value={f.kode} onChange={(e) => endre("kode", e.target.value.toUpperCase())}
              placeholder={forslag} style={{ width: 150, fontFamily: "ui-monospace, monospace" }}
            />
          </label>
          {f.type === "saldo" ? (
            <label>
              <div className="dempet" style={{ fontSize: 12, marginBottom: 3 }}>Beløp (kr)</div>
              <input inputMode="decimal" value={f.beløp} onChange={(e) => endre("beløp", e.target.value)} style={{ width: 100, textAlign: "right" }} />
            </label>
          ) : (
            <>
              <label>
                <div className="dempet" style={{ fontSize: 12, marginBottom: 3 }}>Prosent av kortene</div>
                <input inputMode="numeric" value={f.prosent} onChange={(e) => endre("prosent", e.target.value)} style={{ width: 80, textAlign: "right" }} />
              </label>
              <label>
                <div className="dempet" style={{ fontSize: 12, marginBottom: 3 }}>Maks antall ordrer</div>
                <input inputMode="numeric" value={f.maks_bruk} onChange={(e) => endre("maks_bruk", e.target.value)} placeholder="ubegrenset" style={{ width: 110 }} />
              </label>
            </>
          )}
          <label>
            <div className="dempet" style={{ fontSize: 12, marginBottom: 3 }}>Siste dag (valgfritt)</div>
            <input type="date" value={f.gyldig_til} onChange={(e) => endre("gyldig_til", e.target.value)} />
          </label>
          <label style={{ flex: 1, minWidth: 180 }}>
            <div className="dempet" style={{ fontSize: 12, marginBottom: 3 }}>Merknad (bare for deg)</div>
            <input value={f.merknad} onChange={(e) => endre("merknad", e.target.value)} placeholder="Premie, fredagsturnering" style={{ width: "100%" }} />
          </label>
          <button className="knapp primar" disabled={jobber || !klar} onClick={lag}>Lag kode</button>
        </div>
        <p className="dempet" style={{ margin: "10px 0 0", fontSize: 12.5 }}>
          {f.type === "saldo"
            ? "Gavekortet brukes ned: er koden på 500 kr og kjøpet 300 kr, står 200 kr igjen til neste gang."
            : "Prosenten trekkes fra kortene, ikke frakten. Én kode per ordre."}
          {" "}Står kodefeltet tomt, får koden forslaget ({forslag}) — vanskelig å gjette, lett å skrive av.
        </p>
      </div>
    </div>
  );
}

function Kode({ k, onLukk, onEndret, onFeil, onMelding }) {
  const [bev, setBev] = useState(null);
  const [modus, setModus] = useState("legg");
  const [beløp, setBeløp] = useState("");
  const [notat, setNotat] = useState("");
  const [gyldig, setGyldig] = useState(k.gyldig_til || "");
  const [jobber, setJobber] = useState(false);

  async function lastBev() {
    try {
      setBev((await api.rabattkodeBevegelser(k.id)).bevegelser || []);
    } catch (e) {
      onFeil(e);
    }
  }
  useEffect(() => { lastBev(); }, [k.id]);

  async function gjør(fn, melding) {
    setJobber(true);
    try {
      await fn();
      if (melding) onMelding(melding);
      await onEndret();
      await lastBev();
    } catch (e) {
      onFeil(e);
    } finally {
      setJobber(false);
    }
  }

  return (
    <>
      <button className="knapp liten" style={{ marginBottom: 12 }} onClick={onLukk}>← Alle koder</button>
      <div className="panel">
        <header>
          <h3><span className="kode">{k.kode}</span> <span className="dempet" style={{ fontWeight: 400 }}>{k.type === "saldo" ? "Gavekort" : `${k.prosent} % rabatt`}</span></h3>
          {k.type === "saldo" && <span className="sum" style={{ marginLeft: "auto" }}>{kroner(k.saldo_ore)}</span>}
        </header>
        <div className="krop">
          <div className="rad-flex" style={{ flexWrap: "wrap", gap: 14, marginBottom: 12 }}>
            <span className="dempet">Brukt på {k.brukt} {k.brukt === 1 ? "ordre" : "ordrer"}{k.maks_bruk != null ? ` av ${k.maks_bruk}` : ""}</span>
            {k.merknad && <span className="dempet">· {k.merknad}</span>}
            <span className="dempet">· laget {dato(k.created_at)}</span>
          </div>

          {k.type === "saldo" && (
            <>
              <div className="rad-flex" style={{ gap: 6, marginBottom: 10 }}>
                {[["legg", "Legg til beløp"], ["sett", "Sett saldo til"]].map(([v, n]) => (
                  <button key={v} className={`knapp liten ${modus === v ? "primar" : ""}`} onClick={() => setModus(v)}>{n}</button>
                ))}
              </div>
              <div className="rad-flex" style={{ alignItems: "flex-end", gap: 14, marginBottom: 14 }}>
                <label>
                  <div className="dempet" style={{ fontSize: 12, marginBottom: 3 }}>
                    {modus === "legg" ? "Beløp i kroner (minus for å trekke fra)" : "Ny saldo i kroner"}
                  </div>
                  <input inputMode="decimal" value={beløp} onChange={(e) => setBeløp(e.target.value)} style={{ width: 150, textAlign: "right" }} />
                </label>
                <label style={{ flex: 1, minWidth: 180 }}>
                  <div className="dempet" style={{ fontSize: 12, marginBottom: 3 }}>Grunn</div>
                  <input value={notat} onChange={(e) => setNotat(e.target.value)} style={{ width: "100%" }} />
                </label>
                <button
                  className="knapp primar"
                  disabled={jobber || String(beløp).trim() === ""}
                  onClick={() => gjør(
                    () => api.justerRabattkode(k.id, modus === "legg" ? { ore: tilØre(beløp), notat } : { saldo_ore: tilØre(beløp), notat }),
                    "Saldoen er endret."
                  ).then(() => { setBeløp(""); setNotat(""); })}
                >
                  Bokfør
                </button>
              </div>
            </>
          )}

          <div className="rad-flex" style={{ gap: 10, flexWrap: "wrap" }}>
            <label className="dempet" style={{ fontSize: 13 }}>
              Siste dag <input type="date" value={gyldig} onChange={(e) => setGyldig(e.target.value)} />
            </label>
            <button className="knapp liten" disabled={jobber || gyldig === (k.gyldig_til || "")} onClick={() => gjør(() => api.endreRabattkode(k.id, { gyldig_til: gyldig || null }), "Lagret.")}>
              Lagre dato
            </button>
            <button
              className={`knapp liten ${k.aktiv ? "fare" : ""}`}
              style={{ marginLeft: "auto" }}
              disabled={jobber}
              onClick={() => gjør(() => api.endreRabattkode(k.id, { aktiv: !k.aktiv }), k.aktiv ? "Koden er slått av." : "Koden er slått på igjen.")}
            >
              {k.aktiv ? "Slå av koden" : "Slå på igjen"}
            </button>
          </div>
        </div>

        {k.type === "saldo" && bev && bev.length > 0 && (
          <table>
            <thead>
              <tr><th style={{ width: 120 }}>Dato</th><th className="h" style={{ width: 110 }}>Endring</th><th>Hva</th></tr>
            </thead>
            <tbody>
              {bev.map((b) => (
                <tr key={b.id}>
                  <td className="dempet">{dato(b.created_at)}</td>
                  <td className="h tall" style={{ color: b.ore < 0 ? "var(--feil)" : "var(--ok)", fontWeight: 600 }}>
                    {b.ore > 0 ? "+" : ""}{kroner(b.ore)}
                  </td>
                  <td>
                    {GRUNNER[b.grunn] || b.grunn}
                    {b.ordrenr && <span className="kode"> {b.ordrenr}</span>}
                    {b.notat && b.grunn === "manuell" && <span className="dempet"> — {b.notat}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

function Import({ onFerdig, onFeil, onMelding }) {
  const [tekst, setTekst] = useState("");
  const [jobber, setJobber] = useState(false);
  const [svar, setSvar] = useState(null);
  return (
    <div className="panel">
      <header><h3>Lim inn gavekort fra Mystore</h3></header>
      <div className="krop skjema">
        <p className="dempet" style={{ margin: 0, fontSize: 13 }}>
          Én kode per linje: koden, beløpet som er igjen, og eventuelt en merknad. Skill med mellomrom,
          semikolon eller tab — rett fra Excel går fint. Koder som finnes fra før, hoppes over.
        </p>
        <textarea rows={5} value={tekst} onChange={(e) => setTekst(e.target.value)} placeholder={"PREMIE2024 250\nKH-8812;500;Turnering mars"} style={{ fontFamily: "ui-monospace, monospace" }} />
        <div className="rad-flex">
          <button
            className="knapp primar"
            disabled={jobber || !tekst.trim()}
            onClick={async () => {
              setJobber(true);
              try {
                const r = await importerRabattkoder(tekst);
                setSvar(r);
                onMelding(`${r.nye} gavekort lagt inn.`);
                if (!r.feil.length) setTekst("");
                onFerdig();
              } catch (e) {
                onFeil(e);
              } finally {
                setJobber(false);
              }
            }}
          >
            Legg inn
          </button>
          {svar && (
            <span className="dempet" style={{ fontSize: 13 }}>
              {svar.nye} nye, {svar.finnes} fantes fra før{svar.feil.length ? `, ${svar.feil.length} linjer kunne ikke leses: ${svar.feil.slice(0, 3).join(" · ")}` : ""}.
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
