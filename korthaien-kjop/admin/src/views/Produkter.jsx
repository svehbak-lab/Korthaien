import { useState, useEffect, useRef } from "react";
import { api, kroner, lastOppBilde, bildeFraLenke, bildeUrl } from "../api.js";
import SettStabel from "./SettStabel.jsx";

// ─────────────────────────────────────────────────────────────────────────────
// EGNE PRODUKTER
// ─────────────────────────────────────────────────────────────────────────────
// Sealed og komplette sett — det du selger som ikke kommer fra Scryfall.
//
// Kortene legges inn av importen og telles i Hurtigredigering. Disse legger
// du inn selv, og derfor ser siden annerledes ut: et skjema med navn, pris,
// antall og bilde, i stedet for et rutenett av tall.
//
// Én pris per produkt. En forseglet boks har ingen tilstand å velge mellom,
// og et felt som alltid står på NM er et felt som bare er i veien.

const TYPER = [
  { id: "sealed", navn: "Sealed" },
  { id: "komplettsett", navn: "Komplette sett" },
];

const TOM = {
  type: "sealed", navn: "", pris_kr: "", antall: "0",
  beskrivelse: "", bilde_url: "", set_code: "", sortering: "0", foil: false, antall_kort: "",
};

const tilØre = (kr) => Math.round((parseFloat(String(kr).replace(",", ".")) || 0) * 100);
const tilKr = (ore) => (ore === null || ore === undefined ? "" : String(ore / 100));

export default function Produkter({ onFeil, onMelding }) {
  const [produkter, setProdukter] = useState(null);
  const [ny, setNy] = useState(TOM);
  const [redigerer, setRedigerer] = useState(null);
  const [jobber, setJobber] = useState(false);

  async function last() {
    try {
      const r = await api.produkter();
      setProdukter(r.produkter || []);
    } catch (e) {
      onFeil(e);
      setProdukter([]);
    }
  }
  useEffect(() => {
    last();
  }, []);

  function felter(p) {
    return {
      type: p.type,
      navn: p.navn,
      pris_ore: tilØre(p.pris_kr),
      antall: parseInt(p.antall, 10) || 0,
      beskrivelse: p.beskrivelse,
      bilde_url: p.bilde_url,
      set_code: p.set_code,
      foil: !!p.foil,
      antall_kort: parseInt(p.antall_kort, 10) || null,
      sortering: parseInt(p.sortering, 10) || 0,
    };
  }

  async function leggTil() {
    if (!ny.navn.trim()) return;
    setJobber(true);
    try {
      await api.leggTilProdukt(felter(ny));
      // Typen står igjen. Legger du inn fire bokser etter hverandre, skal du
      // slippe å velge «Sealed» fire ganger.
      setNy({ ...TOM, type: ny.type });
      await last();
      onMelding("Produktet er lagt inn.");
    } catch (e) {
      onFeil(e);
    } finally {
      setJobber(false);
    }
  }

  async function lagre(p) {
    setJobber(true);
    try {
      await api.endreProdukt(p.id, felter(p));
      setRedigerer(null);
      await last();
      onMelding("Lagret.");
    } catch (e) {
      onFeil(e);
    } finally {
      setJobber(false);
    }
  }

  async function slåAv(p) {
    if (!confirm(`Slå av «${p.navn}»? Den forsvinner fra butikken, men blir stående her.`)) return;
    try {
      await api.slåAvProdukt(p.id);
      await last();
    } catch (e) {
      onFeil(e);
    }
  }

  if (!produkter) return <p className="dempet">Henter produkter…</p>;

  return (
    <>
      <VisSealed onFeil={onFeil} onMelding={onMelding} />
      <div className="panel">
        <header><h3>Nytt produkt</h3></header>
        <div className="krop">
          <div className="rad-flex" style={{ alignItems: "flex-end", gap: 14, flexWrap: "wrap" }}>
            <label>
              <div className="dempet" style={{ fontSize: 12, marginBottom: 3 }}>Type</div>
              <select value={ny.type} onChange={(e) => setNy({ ...ny, type: e.target.value })}>
                {TYPER.map((t) => <option key={t.id} value={t.id}>{t.navn}</option>)}
              </select>
            </label>
            <label style={{ flex: 1, minWidth: 220 }}>
              <div className="dempet" style={{ fontSize: 12, marginBottom: 3 }}>Navn</div>
              <input
                type="text" value={ny.navn} placeholder="Bloomburrow samlerboosterboks"
                onChange={(e) => setNy({ ...ny, navn: e.target.value })}
                style={{ width: "100%" }}
              />
            </label>
            <label>
              <div className="dempet" style={{ fontSize: 12, marginBottom: 3 }}>Pris per stk (kr)</div>
              <input
                type="text" inputMode="decimal" value={ny.pris_kr} placeholder="3490"
                onChange={(e) => setNy({ ...ny, pris_kr: e.target.value })}
                style={{ width: 90, textAlign: "right" }}
              />
            </label>
            <label>
              <div className="dempet" style={{ fontSize: 12, marginBottom: 3 }}>Antall</div>
              <input
                type="number" min="0" value={ny.antall}
                onChange={(e) => setNy({ ...ny, antall: e.target.value })}
                style={{ width: 70, textAlign: "right" }}
              />
            </label>
            <label>
              <div className="dempet" style={{ fontSize: 12, marginBottom: 3 }}>Settkode</div>
              <input
                type="text" value={ny.set_code} placeholder="blb"
                onChange={(e) => setNy({ ...ny, set_code: e.target.value })}
                style={{ width: 80 }}
              />
            </label>
            {ny.type === "komplettsett" && (
              <>
                <label>
                  <div className="dempet" style={{ fontSize: 12, marginBottom: 3 }}>Antall kort</div>
                  <input
                    type="text" inputMode="numeric" value={ny.antall_kort} placeholder="auto"
                    title="La stå tomt for å regne ut av settet. Fyll inn hvis tallet blir feil."
                    onChange={(e) => setNy({ ...ny, antall_kort: e.target.value.replace(/\D/g, "") })}
                    style={{ width: 70, textAlign: "right" }}
                  />
                </label>
                <label className="rad-flex" style={{ gap: 6, paddingBottom: 6 }}>
                  <input type="checkbox" checked={ny.foil} onChange={(e) => setNy({ ...ny, foil: e.target.checked })} />
                  Foil
                </label>
              </>
            )}
            <button className="knapp primar" disabled={jobber || !ny.navn.trim()} onClick={leggTil}>
              Legg til
            </button>
          </div>

          <div className="rad-flex" style={{ gap: 14, marginTop: 12, flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 260 }}>
              <div className="dempet" style={{ fontSize: 12, marginBottom: 3 }}>Bilde</div>
              {ny.type === "komplettsett" && !ny.bilde_url ? (
                <div className="rad-flex" style={{ gap: 10, alignItems: "flex-start" }}>
                  <div style={{ width: 110, flex: "none" }}>
                    <SettStabel setCode={ny.set_code} setNavn={null} foil={ny.foil} />
                  </div>
                  <span className="dempet" style={{ fontSize: 12.5 }}>
                    Bildet tegnes av seg selv ut fra settkoden og foil-haken, med settnavn og antall kort.
                    Vil du heller bruke et eget bilde, last det opp under.
                    <span style={{ display: "block", marginTop: 6 }}>
                      <BildeFelt verdi={ny.bilde_url} onEndre={(u) => setNy((x) => ({ ...x, bilde_url: u }))} onFeil={onFeil} />
                    </span>
                  </span>
                </div>
              ) : (
                <BildeFelt verdi={ny.bilde_url} onEndre={(u) => setNy((x) => ({ ...x, bilde_url: u }))} onFeil={onFeil} />
              )}
            </div>
            <label style={{ flex: 2, minWidth: 260 }}>
              <div className="dempet" style={{ fontSize: 12, marginBottom: 3 }}>Beskrivelse</div>
              <input
                type="text" value={ny.beskrivelse} placeholder="Forseglet, 12 samlerboosterpakker"
                onChange={(e) => setNy({ ...ny, beskrivelse: e.target.value })}
                style={{ width: "100%" }}
              />
            </label>
          </div>

          <p className="dempet" style={{ margin: "10px 0 0" }}>
            Settkoden er valgfri og kobler produktet til et sett, slik at det
            kan vises sammen med kortene fra samme sett. Uten bilde vises
            navnet alene — det ser tynt ut i butikken, men det virker.
          </p>
        </div>
      </div>

      {TYPER.map((t) => {
        const mine = produkter.filter((p) => p.type === t.id);
        return (
          <div className="panel" key={t.id}>
            <header>
              <h3>{t.navn}</h3>
              <span className="dempet">{mine.length} produkter</span>
            </header>

            {mine.length === 0 ? (
              <div className="tom">
                <b>Ingen {t.navn.toLowerCase()} ennå</b>
                Legg inn det første over, så dukker seksjonen opp i butikken.
              </div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 60 }}>Rekke</th>
                    <th>Navn</th>
                    <th style={{ width: 70 }}>Sett</th>
                    <th className="h" style={{ width: 100 }}>Pris per stk</th>
                    <th className="h" style={{ width: 80 }}>Antall</th>
                    <th>Beskrivelse</th>
                    <th style={{ width: 150 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {mine.map((p) =>
                    redigerer?.id === p.id ? (
                      <tr key={p.id}>
                        <td>
                          <input
                            type="number" value={redigerer.sortering} style={{ width: 54 }}
                            onChange={(e) => setRedigerer({ ...redigerer, sortering: e.target.value })}
                          />
                        </td>
                        <td>
                          <input
                            type="text" value={redigerer.navn} style={{ width: "100%" }}
                            onChange={(e) => setRedigerer({ ...redigerer, navn: e.target.value })}
                          />
                        </td>
                        <td>
                          <input
                            type="text" value={redigerer.set_code || ""} style={{ width: 58 }}
                            onChange={(e) => setRedigerer({ ...redigerer, set_code: e.target.value })}
                          />
                          {redigerer.type === "komplettsett" && (
                            <>
                              <label className="rad-flex" style={{ gap: 4, fontSize: 12, marginTop: 4 }}>
                                <input type="checkbox" checked={!!redigerer.foil} onChange={(e) => setRedigerer({ ...redigerer, foil: e.target.checked })} />
                                Foil
                              </label>
                              <label style={{ display: "block", fontSize: 12, marginTop: 4 }}>
                                <span className="dempet">Antall kort</span>
                                <input
                                  type="text" inputMode="numeric" value={redigerer.antall_kort ?? ""} placeholder={redigerer.set_antall ? String(redigerer.set_antall) : "auto"}
                                  title="La stå tomt for å regne ut av settet."
                                  onChange={(e) => setRedigerer({ ...redigerer, antall_kort: e.target.value.replace(/\D/g, "") })}
                                  style={{ width: 58, display: "block" }}
                                />
                              </label>
                            </>
                          )}
                        </td>
                        <td className="h">
                          <input
                            type="text" inputMode="decimal" value={redigerer.pris_kr}
                            onChange={(e) => setRedigerer({ ...redigerer, pris_kr: e.target.value })}
                            style={{ width: 78, textAlign: "right" }}
                          />
                        </td>
                        <td className="h">
                          <input
                            type="number" min="0" value={redigerer.antall}
                            onChange={(e) => setRedigerer({ ...redigerer, antall: e.target.value })}
                            style={{ width: 62, textAlign: "right" }}
                          />
                        </td>
                        <td>
                          <input
                            type="text" value={redigerer.beskrivelse || ""} style={{ width: "100%" }}
                            onChange={(e) => setRedigerer({ ...redigerer, beskrivelse: e.target.value })}
                          />
                          <div style={{ marginTop: 8 }}>
                            <BildeFelt
                              verdi={redigerer.bilde_url || ""}
                              onEndre={(u) => setRedigerer((x) => ({ ...x, bilde_url: u }))}
                              onFeil={onFeil}
                            />
                          </div>
                        </td>
                        <td>
                          <button className="knapp liten primar" disabled={jobber} onClick={() => lagre(redigerer)}>
                            Lagre
                          </button>
                          <button className="knapp liten" onClick={() => setRedigerer(null)} style={{ marginLeft: 6 }}>
                            Avbryt
                          </button>
                        </td>
                      </tr>
                    ) : (
                      <tr key={p.id}>
                        <td className="dempet">{p.sortering}</td>
                        <td>
                          <span className="rad-flex" style={{ gap: 8, display: "inline-flex" }}>
                            {p.bilde_url
                              ? <img src={p.bilde_url} alt="" style={{ width: 32, height: 32, objectFit: "contain", borderRadius: 4 }} />
                              : p.type === "komplettsett" && p.set_code
                                ? <span style={{ width: 32, flex: "none" }}><SettStabel setCode={p.set_code} foil={p.foil} liten /></span>
                                : <span className="dempet" style={{ width: 32, fontSize: 10, textAlign: "center" }}>uten bilde</span>}
                            {p.navn}
                            {p.foil && <span style={{ background: "#f5d020", color: "#3b2f05", fontSize: 10.5, fontWeight: 700, padding: "0 6px", borderRadius: 3 }}>FOIL</span>}
                          </span>
                          {p.antall === 0 && (
                            <span className="merkelapp m-av" style={{ marginLeft: 8 }}>utsolgt</span>
                          )}
                        </td>
                        <td className="dempet">{p.set_code || "—"}</td>
                        <td className="h tall">{kroner(p.pris_ore)}</td>
                        <td className="h tall">{p.antall}</td>
                        <td className="dempet">{p.beskrivelse || "—"}</td>
                        <td>
                          <button
                            className="knapp handling"
                            style={{ marginLeft: 0 }}
                            onClick={() => setRedigerer({ ...p, pris_kr: tilKr(p.pris_ore) })}
                          >
                            Endre
                          </button>
                          <button className="knapp handling" onClick={() => slåAv(p)}>
                            Slå av
                          </button>
                        </td>
                      </tr>
                    )
                  )}
                </tbody>
              </table>
            )}
          </div>
        );
      })}
    </>
  );
}

// Én hake: skal sealed og komplette sett vises i butikken? Slått av,
// forsvinner menyen, forsiden og sidene for dem. Produktene blir stående her.
function VisSealed({ onFeil, onMelding }) {
  const [på, setPå] = useState(null);
  useEffect(() => {
    api.innstillinger().then((s) => setPå(s.vis_sealed !== false)).catch(onFeil);
  }, []);
  if (på === null) return null;
  return (
    <div className="panel">
      <div className="krop rad-flex">
        <label className="rad-flex" style={{ gap: 8, fontWeight: 600 }}>
          <input
            type="checkbox"
            checked={på}
            onChange={async (e) => {
              const ny = e.target.checked;
              setPå(ny);
              try {
                await api.lagreInnstillinger({ vis_sealed: ny });
                onMelding(ny ? "Sealed vises i butikken." : "Sealed er skjult i butikken.");
              } catch (err) {
                setPå(!ny);
                onFeil(err);
              }
            }}
          />
          Vis sealed og komplette sett i butikken
        </label>
        <span className="dempet" style={{ fontSize: 13 }}>
          Slått av, forsvinner de fra menyen og forsiden. Produktene under blir liggende.
        </span>
      </div>
    </div>
  );
}

// Bildet til et produkt. Last opp en fil, eller lim inn en lenke — da
// henter vi bildet og lagrer en kopi hos oss med en gang. En lenke til en
// annen side kan forsvinne når som helst; kopien gjør ikke det.
const VÅR = /\/api\/bilder\/\d+$/;
function BildeFelt({ verdi, onEndre, onFeil }) {
  const [lenke, setLenke] = useState("");
  const [jobber, setJobber] = useState(false);
  const fil = useRef(null);
  const lånt = verdi && !VÅR.test(verdi);

  async function hent(url) {
    setJobber(true);
    try {
      const r = await bildeFraLenke(url);
      onEndre(bildeUrl(r.id));
      setLenke("");
    } catch (e) {
      onFeil(e);
    } finally {
      setJobber(false);
    }
  }
  async function lastOpp(e) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setJobber(true);
    try {
      const r = await lastOppBilde(f);
      onEndre(bildeUrl(r.id));
    } catch (err) {
      onFeil(err);
    } finally {
      setJobber(false);
    }
  }

  return (
    <div className="rad-flex" style={{ gap: 10, alignItems: "flex-start" }}>
      {verdi ? (
        <img src={verdi} alt="" style={{ width: 56, height: 56, objectFit: "contain", borderRadius: 6, background: "var(--papir)", flex: "none" }} />
      ) : (
        <div style={{ width: 56, height: 56, borderRadius: 6, border: "1px dashed var(--strek)", flex: "none" }} />
      )}
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
        <div className="rad-flex" style={{ gap: 6 }}>
          <input ref={fil} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={lastOpp} />
          <button type="button" className="knapp liten" disabled={jobber} onClick={() => fil.current?.click()}>
            {jobber ? "Lagrer…" : "Last opp bilde…"}
          </button>
          {verdi && <button type="button" className="knapp liten" onClick={() => onEndre("")}>Fjern</button>}
          {lånt && (
            <button type="button" className="knapp liten primar" disabled={jobber} onClick={() => hent(verdi)} title="Lagre en kopi, så bildet ikke forsvinner om siden fjerner det">
              Lagre kopi hos oss
            </button>
          )}
        </div>
        <div className="rad-flex" style={{ gap: 6 }}>
          <input
            type="text" value={lenke} onChange={(e) => setLenke(e.target.value)}
            placeholder="…eller lim inn lenke til bildet"
            style={{ flex: 1, minWidth: 0 }}
          />
          <button type="button" className="knapp liten" disabled={jobber || !lenke.trim()} onClick={() => hent(lenke.trim())}>Hent</button>
        </div>
        {lånt && <span style={{ fontSize: 12, color: "var(--advarsel)" }}>Bildet ligger på en annen side og kan forsvinne.</span>}
      </div>
    </div>
  );
}
