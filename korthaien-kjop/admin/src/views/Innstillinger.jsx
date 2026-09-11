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
                <UsdFelt
                  verdi={s.min_usd?.[r] ?? 0}
                  onEndret={(v) => endre("min_usd", { ...(s.min_usd || {}), [r]: v })}
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

      <Salgspriser onFeil={onFeil} onMelding={onMelding} />

      <SalgsTrapp s={s} endre={endre} />

      <Sikkerhet onFeil={onFeil} onMelding={onMelding} />
    </>
  );
}

// Feltet holder teksten som tekst mens du skriver. Gjøres den om til tall ved
// hvert tastetrykk, blir «0,» til 0, og kommaet forsvinner før du rekker å
// skrive sifferet etter. Tallet lagres når du forlater feltet.
function UsdFelt({ verdi, onEndret }) {
  const [tekst, setTekst] = useState(String(verdi ?? 0));
  useEffect(() => setTekst(String(verdi ?? 0)), [verdi]);

  function lagre() {
    const n = Number(tekst.replace(",", "."));
    const gyldig = Number.isFinite(n) && n >= 0 ? n : 0;
    setTekst(String(gyldig));
    if (gyldig !== verdi) onEndret(gyldig);
  }

  return (
    <input
      type="text"
      inputMode="decimal"
      value={tekst}
      onChange={(e) => setTekst(e.target.value.replace(/[^\d.,]/g, ""))}
      onBlur={lagre}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      style={{ width: 68, textAlign: "right" }}
    />
  );
}

// Egen trapp for salg. Den bestemmer hvor mye mindre du tar for et slitt
// kort — ikke hvor mye mindre du betaler, som er kjøpstrappens jobb.
function SalgsTrapp({ s, endre }) {
  const trapp = s.salg_trapp || { NM: 100, EX: 85, VG: 70, G: 55 };
  return (
    <div className="panel">
      <div className="krop">
        <h2 style={{ marginTop: 0 }}>Salgstrapp og avrunding</h2>
        <p className="dempet">
          Near Mint er grunnprisen. De andre tilstandene regnes som en andel av
          den. Trappen er egen for salg, slik at du kan justere marginen på slitte
          kort uten å endre hva du betaler for dem.
        </p>
        <div className="rad-flex">
          {CONDITIONS.map((c) => (
            <Felt key={c} navn={c}>
              <input
                type="number" min="0" max="100" value={trapp[c] ?? 0}
                onChange={(e) => endre("salg_trapp", { ...trapp, [c]: parseInt(e.target.value) || 0 })}
                style={{ width: 64, textAlign: "right" }}
              />
              <span className="dempet"> %</span>
            </Felt>
          ))}
          <Felt navn="Over intervallene">
            <span className="dempet">× </span>
            <input
              type="text" inputMode="decimal" value={s.salg_faktor ?? 1}
              onChange={(e) => endre("salg_faktor", Number(String(e.target.value).replace(",", ".")) || 0)}
              style={{ width: 64, textAlign: "right" }}
            />
            <span className="dempet"> markedspris</span>
          </Felt>
          <Felt navn="Avrunding">
            <select
              value={s.salg_avrunding ?? 100}
              onChange={(e) => endre("salg_avrunding", parseInt(e.target.value))}
            >
              <option value={1}>Ingen</option>
              <option value={100}>Hele kroner</option>
              <option value={500}>Nærmeste 5 kr</option>
            </select>
          </Felt>
        </div>
      </div>
    </div>
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

// ─────────────────────────────────────────────────────────────────────────────
// SALGSPRISER
// ─────────────────────────────────────────────────────────────────────────────
// Utsalgsprisen avledes av markedsprisen, ikke satt kort for kort. Endrer du
// et intervall, følger alle kortene i det intervallet etter.
export function Salgspriser({ onFeil, onMelding }) {
  const [rader, setRader] = useState(null);
  const [advarsler, setAdvarsler] = useState([]);
  const [lagrer, setLagrer] = useState(false);

  useEffect(() => {
    api.salgspriser()
      .then((r) => { setRader(r.intervaller); setAdvarsler(r.advarsler); })
      .catch(onFeil);
  }, []);

  function endre(i, felt, verdi) {
    setRader((r) => r.map((rad, j) => (j === i ? { ...rad, [felt]: verdi } : rad)));
  }

  async function lagre() {
    setLagrer(true);
    try {
      const rene = rader.map((r) => ({
        rarity: r.rarity,
        usd_fra: Number(String(r.usd_fra).replace(",", ".")) || 0,
        usd_til:
          r.usd_til === "" || r.usd_til === null ? null : Number(String(r.usd_til).replace(",", ".")),
        pris_ore: Math.round((Number(String(r.pris_kr).replace(",", ".")) || 0) * 100),
      }));
      const svar = await api.lagreSalgspriser(rene);
      setAdvarsler(svar.advarsler);
      onMelding(`${svar.antall} intervaller lagret.`);
    } catch (e) {
      onFeil(e);
    } finally {
      setLagrer(false);
    }
  }

  if (!rader) return null;
  const medKroner = rader.map((r) => ({ ...r, pris_kr: r.pris_kr ?? (r.pris_ore / 100) }));

  return (
    <div className="panel">
      <div className="krop">
        <h2 style={{ marginTop: 0 }}>Utsalgspriser</h2>
        <p className="dempet">
          Prisen er flat innenfor hvert intervall: et rare til 0,20 og et til 0,80
          koster det samme. En egen regel for en raritet slår regelen for «alle».
          Kort som er dyrere enn alle intervallene prises av markedet, ganget med
          faktoren under.
        </p>

        {advarsler.length > 0 && (
          <div className="varsel info">
            <b>Se over intervallene.</b>
            <ul style={{ margin: "6px 0 0", paddingLeft: 20 }}>
              {advarsler.map((a, i) => <li key={i}>{a}</li>)}
            </ul>
          </div>
        )}

        <table>
          <thead>
            <tr>
              <th style={{ width: 120 }}>Raritet</th>
              <th className="h" style={{ width: 90 }}>Fra $</th>
              <th className="h" style={{ width: 90 }}>Til $</th>
              <th className="h" style={{ width: 100 }}>Pris kr</th>
              <th style={{ width: 50 }}></th>
            </tr>
          </thead>
          <tbody>
            {medKroner.map((r, i) => (
              <tr key={i}>
                <td>
                  <select value={r.rarity} onChange={(e) => endre(i, "rarity", e.target.value)}>
                    {["common", "uncommon", "rare", "mythic", "special", "alle"].map((x) => (
                      <option key={x} value={x}>{x}</option>
                    ))}
                  </select>
                </td>
                <td className="h">
                  <input
                    type="text" inputMode="decimal" value={r.usd_fra}
                    onChange={(e) => endre(i, "usd_fra", e.target.value.replace(/[^\d.,]/g, ""))}
                    style={{ width: 70, textAlign: "right" }}
                  />
                </td>
                <td className="h">
                  <input
                    type="text" inputMode="decimal"
                    value={r.usd_til === null ? "" : r.usd_til}
                    placeholder="og opp"
                    onChange={(e) => endre(i, "usd_til", e.target.value.replace(/[^\d.,]/g, ""))}
                    style={{ width: 70, textAlign: "right" }}
                  />
                </td>
                <td className="h">
                  <input
                    type="text" inputMode="decimal" value={r.pris_kr}
                    onChange={(e) => endre(i, "pris_kr", e.target.value.replace(/[^\d.,]/g, ""))}
                    style={{ width: 80, textAlign: "right" }}
                  />
                </td>
                <td className="h">
                  <button
                    className="knapp handling"
                    onClick={() => setRader((x) => x.filter((_, j) => j !== i))}
                  >
                    Fjern
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="rad-flex" style={{ marginTop: 12 }}>
          <button
            className="knapp"
            onClick={() =>
              setRader((r) => [...r, { rarity: "rare", usd_fra: 0, usd_til: "", pris_kr: 10 }])
            }
          >
            + Nytt intervall
          </button>
          <button className="knapp primar" onClick={lagre} disabled={lagrer}>
            {lagrer ? "Lagrer…" : "Lagre intervallene"}
          </button>
          <span className="dempet">
            Tomt «til»-felt betyr «og oppover».
          </span>
        </div>
      </div>
    </div>
  );
}
