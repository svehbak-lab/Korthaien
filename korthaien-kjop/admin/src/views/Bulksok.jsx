import { useState } from "react";
import { kunde as kapi, kroner } from "../api.js";
import { useHandel } from "./Handel.jsx";

// ─────────────────────────────────────────────────────────────────────────────
// BULKSØK
// ─────────────────────────────────────────────────────────────────────────────
// Lim inn en deckliste eller en kube, se hva som er på lager. Settet i lista
// betyr ingenting: for hvert kort foreslås den billigste utgaven på lager.
// Er det for få av den, fylles resten med neste billigste. Hver linje kan
// byttes til en annen utgave som finnes.

// Pris og tilstand først: det er det man velger på. Settnavnet kan være langt.
const tekstFor = (a) =>
  `${kroner(a.enhet_ore)} · ${a.condition}${a.finish === "foil" ? " · FOIL" : ""}${a.utgave ? ` · ${a.utgave}` : ""} · ` +
  `${a.set_name}${a.collector_number ? ` #${a.collector_number}` : ""} (${a.tilgjengelig} på lager)`;

// Fordeler ønsket antall på utgavene, billigst først.
function fordel(t) {
  let igjen = t.antall;
  const valg = [];
  for (let i = 0; i < t.alternativer.length && igjen > 0; i++) {
    const n = Math.min(igjen, t.alternativer[i].tilgjengelig);
    if (n > 0) {
      valg.push({ alt: i, antall: n, med: true });
      igjen -= n;
    }
  }
  return valg;
}

export default function Bulksok({ onKurv }) {
  const h = useHandel();
  const [tekst, setTekst] = useState("");
  const [kunFoil, setKunFoil] = useState(false);
  const [svar, setSvar] = useState(null);
  const [rader, setRader] = useState([]);
  const [søker, setSøker] = useState(false);
  const [feil, setFeil] = useState("");
  const [lagt, setLagt] = useState(null);

  async function søk(e) {
    e.preventDefault();
    setSøker(true);
    setFeil("");
    setLagt(null);
    try {
      const r = await kapi.bulksok(tekst, kunFoil);
      setSvar(r);
      setRader(r.treff.map((t) => fordel(t)));
    } catch (err) {
      setFeil(err.message);
    }
    setSøker(false);
  }

  const endre = (ti, vi, felt) =>
    setRader((rs) => rs.map((v, i) => (i !== ti ? v : v.map((x, j) => (j === vi ? { ...x, ...felt } : x)))));

  const valgte = svar
    ? svar.treff.flatMap((t, ti) => (rader[ti] || []).filter((v) => v.med && v.antall > 0).map((v) => ({ t, a: t.alternativer[v.alt], antall: v.antall })))
    : [];
  const sum = valgte.reduce((n, x) => n + x.a.enhet_ore * x.antall, 0);
  const antallKort = valgte.reduce((n, x) => n + x.antall, 0);

  function leggAlle() {
    for (const { t, a, antall } of valgte) {
      h.legg(
        {
          card_id: a.card_id, finish: a.finish, condition: a.condition, navn: t.navn, set_name: a.set_name,
          collector_number: a.collector_number, image_uri: a.image_uri, enhet_ore: a.enhet_ore, maks: a.tilgjengelig,
        },
        antall
      );
    }
    setLagt(antallKort);
  }

  const ok = svar ? svar.treff.filter((t) => t.status === "ok") : [];
  const mangler = svar ? svar.treff.filter((t) => t.status !== "ok") : [];

  return (
    <>
      <h1 style={{ marginBottom: 6 }}>Bulksøk</h1>
      <p className="dempet" style={{ marginTop: 0, maxWidth: "70ch" }}>
        Lim inn en deckliste eller en kube — én linje per kort, som «4 Lightning Bolt». Settet spiller ingen rolle:
        du får den billigste utgaven vi har på lager, og kan bytte til en annen.
      </p>

      <form className="panel" onSubmit={søk}>
        <div className="krop skjema">
          <textarea
            rows={8} value={tekst} onChange={(e) => setTekst(e.target.value)}
            placeholder={"4 Lightning Bolt\n4 Counterspell\n1 Sol Ring\n2 Delver of Secrets"}
            style={{ fontFamily: "ui-monospace, monospace" }}
          />
          <div className="rad-flex">
            <label className="rad-flex" style={{ gap: 6 }}>
              <input type="checkbox" checked={kunFoil} onChange={(e) => setKunFoil(e.target.checked)} />
              Kun foils
            </label>
            <button className="knapp primar" disabled={søker || !tekst.trim()} style={{ marginLeft: "auto" }}>
              {søker ? "Søker…" : "Søk"}
            </button>
          </div>
          {feil && <div className="varsel feil">{feil}</div>}
        </div>
      </form>

      {svar && (
        <>
          <div className="rad-flex" style={{ margin: "18px 0 10px" }}>
            <b>{ok.length} av {svar.treff.length} kort på lager</b>
            {mangler.length > 0 && <span className="dempet">· {mangler.length} ikke på lager</span>}
          </div>

          {ok.length > 0 && (
            <div className="panel">
              <table className="bulksok-tabell">
                <thead>
                  <tr>
                    <th style={{ width: 36 }} />
                    <th style={{ width: 80 }}>Antall</th>
                    <th>Kort</th>
                    <th>Utgave</th>
                    <th className="h">Pris</th>
                    <th className="h">Sum</th>
                  </tr>
                </thead>
                <tbody>
                  {svar.treff.map((t, ti) =>
                    t.status !== "ok" ? null : (rader[ti] || []).map((v, vi) => {
                      const a = t.alternativer[v.alt];
                      const totaltValgt = (rader[ti] || []).reduce((n, x) => n + (x.med ? x.antall : 0), 0);
                      return (
                        <tr key={`${ti}-${vi}`} style={{ opacity: v.med ? 1 : 0.45 }}>
                          <td><input type="checkbox" checked={v.med} onChange={(e) => endre(ti, vi, { med: e.target.checked })} aria-label="Ta med" /></td>
                          <td>
                            <select value={v.antall} onChange={(e) => endre(ti, vi, { antall: Number(e.target.value) })}>
                              {Array.from({ length: a.tilgjengelig + 1 }, (_, n) => <option key={n} value={n}>{n}</option>)}
                            </select>
                          </td>
                          <td>
                            {vi === 0 ? <b>{t.navn}</b> : <span className="dempet">↳ resten</span>}
                            {vi === 0 && totaltValgt < t.antall && (
                              <div style={{ fontSize: 12, color: "var(--advarsel)" }}>
                                Ville ha {t.antall}, {totaltValgt} på lager
                              </div>
                            )}
                            {vi === 0 && a.rarity && <div className="dempet" style={{ fontSize: 12 }}>{a.rarity}</div>}
                          </td>
                          <td>
                            <select
                              value={v.alt}
                              onChange={(e) => {
                                const ny = Number(e.target.value);
                                endre(ti, vi, { alt: ny, antall: Math.min(v.antall || 1, t.alternativer[ny].tilgjengelig) });
                              }}
                              style={{ maxWidth: 420, width: "100%" }}
                            >
                              {t.alternativer.map((x, i) => (
                                <option key={i} value={i}>{i === 0 ? "Billigst: " : ""}{tekstFor(x)}</option>
                              ))}
                            </select>
                          </td>
                          <td className="h tall pris">{kroner(a.enhet_ore)}</td>
                          <td className="h tall">{kroner(a.enhet_ore * (v.med ? v.antall : 0))}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
              <div className="krop rad-flex" style={{ justifyContent: "flex-end", gap: 14 }}>
                <span>{antallKort} kort</span>
                <span className="pris-stor">{kroner(sum)}</span>
                {lagt != null ? (
                  <>
                    <span style={{ color: "var(--ok)" }}>{lagt} kort lagt i kurven ✓</span>
                    <button type="button" className="knapp primar" onClick={onKurv}>Til handlekurven</button>
                  </>
                ) : (
                  <button type="button" className="knapp primar" disabled={!antallKort} onClick={leggAlle}>
                    Legg {antallKort} kort i handlekurven
                  </button>
                )}
              </div>
            </div>
          )}

          {mangler.length > 0 && (
            <div className="panel">
              <header><h3>Ikke på lager</h3></header>
              <div className="krop">
                <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
                  {mangler.map((t) => (
                    <li key={t.linjer[0]}>
                      {t.antall} {t.navn}
                      <span className="dempet">
                        {t.status === "ukjent" ? " — fant ikke kortet, sjekk stavemåten" : kunFoil ? " — ingen foil på lager" : " — ikke på lager nå"}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}
