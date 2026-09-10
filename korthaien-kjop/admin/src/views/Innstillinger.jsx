import { useState, useEffect } from "react";
import QRCode from "qrcode";
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
  const eksempel = Math.round(5 * s.usd_nok * (s.buy_pct / 100) * 100);

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
            <Felt navn="Minste kortbeløp">
              <input
                type="number" min="0" value={s.min_buy_ore}
                onChange={(e) => endre("min_buy_ore", parseInt(e.target.value) || 0)}
              />
              <span className="dempet"> øre</span>
            </Felt>
            <Felt navn="Minste ordrebeløp">
              <input
                type="number" min="0" step="100" value={s.min_order_ore}
                onChange={(e) => endre("min_order_ore", parseInt(e.target.value) || 0)}
              />
              <span className="dempet"> øre ({kroner(s.min_order_ore)})</span>
            </Felt>
          </div>
          <p className="dempet" style={{ margin: 0 }}>
            Et kort til $5 gir kunden {kroner(eksempel)} i Near Mint. Alle beløp regnes
            i øre. Kortbeløpet er bunnen per kort — står den på 1, får kunden sju øre
            for et kort som er verdt sju øre, i stedet for null. Ordrebeløpet er bunnen
            for hele sendingen, og sjekkes på det som faktisk blir godkjent.
          </p>

          <h3 style={{ marginBottom: 2 }}>Minste markedspris per sjeldenhet</h3>
          <p className="dempet" style={{ margin: "0 0 10px" }}>
            Kort som ligger under terskelen kjøpes ikke, og vises ikke på kundesiden.
            Terskelen gjelder Scryfall-prisen i dollar — eller din egen, der du har
            satt en. Står den på 0, er det ingen grense. Sett common og uncommon til
            0,5 for å slippe å motta bulk du ikke tjener på å håndtere.
          </p>
          <div className="rad-flex">
            {["common", "uncommon", "rare", "mythic"].map((r) => (
              <Felt key={r} navn={r}>
                <span className="dempet">$ </span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={s.min_usd?.[r] ?? 0}
                  onChange={(e) =>
                    endre("min_usd", {
                      ...(s.min_usd || {}),
                      [r]: Number(String(e.target.value).replace(",", ".")) || 0,
                    })
                  }
                  style={{ width: 68, textAlign: "right" }}
                />
              </Felt>
            ))}
          </div>
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

      <Sikkerhet onFeil={onFeil} onMelding={onMelding} />
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

// ─────────────────────────────────────────────────────────────────────────────
// TOTRINNS INNLOGGING
// ─────────────────────────────────────────────────────────────────────────────
// Admin ligger åpent på nettet. Et passord alene er én lekkasje unna at noen
// kan endre priser og lese kundenes kontaktopplysninger.
function Sikkerhet({ onFeil, onMelding }) {
  const [status, setStatus] = useState(null);
  const [oppsett, setOppsett] = useState(null);   // { hemmelighet, uri, svg }
  const [kode, setKode] = useState("");
  const [reservekoder, setReservekoder] = useState(null);
  const [avPassord, setAvPassord] = useState("");
  const [viserAv, setViserAv] = useState(false);
  const [jobber, setJobber] = useState(false);

  const last = () => api.totp().then(setStatus).catch(onFeil);
  useEffect(() => { last(); }, []);

  async function start() {
    setJobber(true);
    try {
      const r = await api.totpStart();
      // QR-koden lages i nettleseren. Hemmeligheten skal ikke innom noen
      // tredjepart for å bli tegnet opp.
      const svg = await QRCode.toString(r.uri, { type: "svg", margin: 1, width: 200 });
      setOppsett({ ...r, svg });
      setReservekoder(null);
      setKode("");
    } catch (e) { onFeil(e); } finally { setJobber(false); }
  }

  async function bekreft() {
    setJobber(true);
    try {
      const r = await api.totpBekreft(kode);
      setReservekoder(r.reservekoder);
      setOppsett(null);
      setKode("");
      await last();
    } catch (e) { onFeil(e); } finally { setJobber(false); }
  }

  async function slåAv() {
    setJobber(true);
    try {
      await api.totpAv(avPassord);
      setAvPassord("");
      setViserAv(false);
      setReservekoder(null);
      onMelding("Engangskode er slått av");
      await last();
    } catch (e) { onFeil(e); } finally { setJobber(false); }
  }

  if (!status) return null;

  return (
    <div className="panel">
      <div className="krop">
        <h2 style={{ marginTop: 0 }}>Innlogging</h2>

        {reservekoder && (
          <div className="varsel info">
            <b>Skriv ut reservekodene nå.</b> De vises bare denne ene gangen, og
            er eneste vei inn hvis du mister telefonen. Legg dem et sted som ikke
            er telefonen.
            <div className="kode" style={{ columns: 2, margin: "10px 0", fontSize: 15, lineHeight: 1.9 }}>
              {reservekoder.map((k) => <div key={k}>{k}</div>)}
            </div>
            <button className="knapp" onClick={() => window.print()}>Skriv ut</button>
          </div>
        )}

        {!status.påslått && !oppsett && (
          <>
            <p className="dempet">
              Nå holder passordet alene. Slår du på engangskode, må du i tillegg
              taste en sekssifret kode fra telefonen. Bruker du iPhone, kan koden
              ligge i Nøkkelring og fylles inn med Face ID.
            </p>
            <button className="knapp primar" onClick={start} disabled={jobber}>
              Slå på engangskode
            </button>
          </>
        )}

        {oppsett && (
          <>
            <p style={{ marginBottom: 12 }}>
              Skann koden med telefonen. På iPhone: Innstillinger, så Passord, velg
              oppføringen for korthaien og «Sett opp verifiseringskode».
            </p>
            <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "flex-start" }}>
              <div
                style={{ background: "#fff", padding: 8, borderRadius: 8, lineHeight: 0 }}
                dangerouslySetInnerHTML={{ __html: oppsett.svg }}
              />
              <div style={{ flex: 1, minWidth: 240 }}>
                <div className="dempet" style={{ fontSize: 13 }}>
                  Får du ikke skannet, skriv inn denne nøkkelen manuelt:
                </div>
                <div className="kode" style={{ wordBreak: "break-all", margin: "4px 0 14px" }}>
                  {oppsett.hemmelighet}
                </div>
                <label style={{ display: "block" }}>
                  <span className="dempet">Skriv koden appen viser, for å bekrefte</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={kode}
                    onChange={(e) => setKode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    placeholder="000000"
                    style={{ width: 120, letterSpacing: "0.2em", textAlign: "center" }}
                  />
                </label>
                <div className="rad-flex" style={{ marginTop: 10 }}>
                  <button className="knapp primar" onClick={bekreft} disabled={jobber || kode.length !== 6}>
                    Bekreft og slå på
                  </button>
                  <button className="knapp" onClick={() => setOppsett(null)} disabled={jobber}>
                    Avbryt
                  </button>
                </div>
                <p className="dempet" style={{ fontSize: 13, marginBottom: 0 }}>
                  Ingenting slås på før koden stemmer. Avbryter du her, logger du
                  inn med passord som før.
                </p>
              </div>
            </div>
          </>
        )}

        {status.påslått && (
          <>
            <p>
              <span className="merkelapp m-ok">På</span>{" "}
              Innlogging krever passord og engangskode.{" "}
              {status.reservekoder > 0
                ? `${status.reservekoder} ubrukte reservekoder igjen.`
                : "Ingen ubrukte reservekoder igjen — mister du telefonen nå, kommer du ikke inn."}
            </p>
            {status.reservekoder <= 2 && (
              <div className="varsel info">
                Få reservekoder igjen. Slå av og på igjen for å få ti nye.
              </div>
            )}
            {!viserAv ? (
              <button className="knapp" onClick={() => setViserAv(true)}>Slå av engangskode</button>
            ) : (
              <div className="rad-flex">
                <input
                  type="password"
                  value={avPassord}
                  onChange={(e) => setAvPassord(e.target.value)}
                  placeholder="Passordet ditt"
                  autoComplete="current-password"
                />
                <button className="knapp fare" onClick={slåAv} disabled={jobber || !avPassord}>
                  Slå av
                </button>
                <button className="knapp" onClick={() => { setViserAv(false); setAvPassord(""); }}>
                  Avbryt
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
