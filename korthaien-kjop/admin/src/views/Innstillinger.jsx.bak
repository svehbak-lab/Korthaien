import { useState, useEffect } from "react";
import { api, CONDITIONS, CONDITION_NAVN, kroner } from "../api.js";

export default function Innstillinger({ onFeil, onMelding }) {
  const [s, setS] = useState(null);
  const [lagrer, setLagrer] = useState(false);

  useEffect(() => {
    api.innstillinger().then(setS).catch(onFeil);
  }, []);

  if (!s) return <p className="dempet">Henter innstillinger…</p>;

  const endre = (felt, verdi) => setS({ ...s, [felt]: verdi });

  async function lagre() {
    setLagrer(true);
    try {
      setS(await api.lagreInnstillinger(s));
      onMelding("Innstillingene er lagret.");
    } catch (e) {
      onFeil(e);
    } finally {
      setLagrer(false);
    }
  }

  async function kjør(navn, beskrivelse) {
    try {
      const r = await api.jobb(navn);
      onMelding(r.melding || `${beskrivelse} er ferdig.`);
    } catch (e) {
      onFeil(e);
    }
  }

  // Regneeksempel så du ser hva en endring faktisk gjør med utbetalingen.
  const eksempel = 5 * s.usd_nok * (s.buy_pct / 100);

  return (
    <>
      <div className="panel">
        <header><h3>Pris</h3></header>
        <div className="krop">
          <div className="rad-flex" style={{ gap: 24, marginBottom: 12 }}>
            <Felt navn="Dollarkurs">
              <input
                type="number" step="0.1" min="0" value={s.usd_nok}
                onChange={(e) => endre("usd_nok", parseFloat(e.target.value) || 0)}
              />
            </Felt>
            <Felt navn="Andel av markedspris">
              <input
                type="number" min="0" max="100" value={s.buy_pct}
                onChange={(e) => endre("buy_pct", parseInt(e.target.value) || 0)}
              />
              <span className="dempet"> %</span>
            </Felt>
            <Felt navn="Minste linjebeløp">
              <input
                type="number" min="0" value={s.min_buy_nok}
                onChange={(e) => endre("min_buy_nok", parseInt(e.target.value) || 0)}
              />
              <span className="dempet"> kr</span>
            </Felt>
          </div>
          <p className="dempet" style={{ margin: 0 }}>
            Et kort til $5 gir kunden {kroner(eksempel)} i Near Mint. Kort som havner
            under minstebeløpet tilbys ikke.
          </p>
        </div>
      </div>

      <div className="panel">
        <header><h3>Standard for nye sett</h3></header>
        <div className="krop">
          <div className="rad-flex" style={{ gap: 20 }}>
            {CONDITIONS.map((c) => {
              const valgt = (s.default_conditions || []).includes(c);
              return (
                <div key={c} className="rad-flex" style={{ gap: 6 }}>
                  <label className="rad-flex" style={{ gap: 5 }}>
                    <input
                      type="checkbox"
                      checked={valgt}
                      onChange={() =>
                        endre(
                          "default_conditions",
                          valgt
                            ? s.default_conditions.filter((x) => x !== c)
                            : [...s.default_conditions, c].sort(
                                (a, b) => CONDITIONS.indexOf(a) - CONDITIONS.indexOf(b)
                              )
                        )
                      }
                    />
                    {CONDITION_NAVN[c]}
                  </label>
                  <input
                    type="number" min="0" max="200" style={{ width: 58 }}
                    value={s.default_ladder?.[c] ?? ""}
                    onChange={(e) =>
                      endre("default_ladder", { ...s.default_ladder, [c]: parseInt(e.target.value) || 0 })
                    }
                  />
                  <span className="dempet">%</span>
                </div>
              );
            })}
          </div>
          <p className="dempet" style={{ marginBottom: 0 }}>
            Gjelder sett som ikke har egne regler. Endringer her rører ikke sett du
            allerede har satt opp.
          </p>
        </div>
      </div>

      <div className="panel">
        <header><h3>Ordre</h3></header>
        <div className="krop">
          <Felt navn="Kunden må sende innen">
            <input
              type="number" min="1" value={s.order_expiry_days}
              onChange={(e) => endre("order_expiry_days", parseInt(e.target.value) || 1)}
            />
            <span className="dempet"> dager</span>
          </Felt>
          <p className="dempet">
            Går fristen ut, frigjøres kortene til andre selgere og ordren havner i arkivet.
          </p>
          <Felt navn="Adressen kunden sender til">
            <textarea
              rows={4}
              value={s.ship_to}
              onChange={(e) => endre("ship_to", e.target.value)}
            />
          </Felt>
        </div>
      </div>

      <div className="rad-flex" style={{ marginBottom: 24 }}>
        <button className="knapp primar" onClick={lagre} disabled={lagrer}>
          {lagrer ? "Lagrer…" : "Lagre innstillinger"}
        </button>
      </div>

      <div className="panel">
        <header><h3>Vedlikehold</h3></header>
        <div className="krop">
          <div className="rad-flex">
            <button className="knapp" onClick={() => kjør("import", "Prisimporten")}>
              Hent priser fra Scryfall
            </button>
            <button className="knapp" onClick={() => kjør("mystore", "Lagersynken")}>
              Synk beholdning fra Mystore
            </button>
            <button className="knapp" onClick={() => kjør("expire", "Opprydningen")}>
              Rydd utløpte ordrer
            </button>
          </div>
          <p className="dempet" style={{ marginBottom: 0 }}>
            Disse går automatisk hver natt. Kjør dem manuelt når du har endret noe og
            ikke vil vente. Prisimporten tar noen minutter og går i bakgrunnen.
          </p>
        </div>
      </div>
    </>
  );
}

function Felt({ navn, children }) {
  return (
    <label style={{ display: "block", marginBottom: 10 }}>
      <div className="dempet" style={{ marginBottom: 4 }}>{navn}</div>
      {children}
    </label>
  );
}
