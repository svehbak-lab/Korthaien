import { useState, useEffect } from "react";
import { api, kroner, dato } from "../api.js";
import { Konto } from "./Kreditt.jsx";
import { Ordre as Salgsordre } from "./Salgsordrer.jsx";

// ─────────────────────────────────────────────────────────────────────────────
// ÉN KUNDE
// ─────────────────────────────────────────────────────────────────────────────
// Alt om én e-postadresse på ett sted: kontoen, kjøpene i butikken, kortene
// hen har solgt til butikken, ønskelista og kreditten. Adressen er nøkkelen,
// så gjesteordrer og salg fra kjøpssiden før kontoen fantes, kommer med.
//
// En salgsordre åpnes her, med samme visning som under Salgsordrer.

const SALGSSTATUS = {
  betalt: ["Ikke behandlet", "m-vent"],
  pakket: ["Ikke behandlet", "m-vent"],
  sendt: ["Sendt", "m-ok"],
  kansellert: ["Kansellert", "m-av"],
};
const KJØPSSTATUS = {
  pending: ["Venter i posten", "m-vent"],
  received: ["Mottatt", "m-mottatt"],
  stocked: ["Lagerført", "m-ok"],
  cancelled: ["Kansellert", "m-av"],
  expired: ["Utløpt", "m-av"],
};
const KILDE = { konto: "Registrert i butikken", mystore: "Importert fra Mystore" };

const tid = (iso) =>
  iso ? new Date(iso).toLocaleString("nb-NO", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

export default function KundeSide({ epost, navn, onLukk, onFeil, onMelding }) {
  const [d, setD] = useState(null);
  const [åpenOrdre, setÅpenOrdre] = useState(null);

  async function last() {
    try {
      setD(await api.kundeDetalj(epost));
    } catch (e) {
      onFeil(e);
    }
  }
  useEffect(() => { last(); }, [epost]);

  if (åpenOrdre) {
    return (
      <Salgsordre
        nr={åpenOrdre}
        onLukk={() => { setÅpenOrdre(null); last(); }}
        onFeil={onFeil}
        onMelding={onMelding || (() => {})}
      />
    );
  }

  const k = d?.kunde;
  return (
    <>
      <div className="rad-flex" style={{ marginBottom: 12 }}>
        <button className="knapp liten" onClick={onLukk}>← Alle kunder</button>
      </div>

      <div className="panel">
        <header>
          <h3>
            {k?.navn || navn || <span className="dempet">(uten navn)</span>}{" "}
            <span className="dempet" style={{ fontWeight: 400 }}>{epost}</span>
          </h3>
        </header>
        {!d ? (
          <div className="krop dempet">Henter…</div>
        ) : (
          <div className="krop" style={{ display: "grid", gap: 18, gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
            <dl style={{ margin: 0 }}>
              {k ? (
                <>
                  <Felt navn="Telefon">{k.telefon || "—"}</Felt>
                  <Felt navn="Adresse">
                    {[k.adresse, [k.postnr, k.poststed].filter(Boolean).join(" "), k.land && k.land !== "NO" ? k.land : ""]
                      .filter(Boolean).join(", ") || "—"}
                  </Felt>
                  <Felt navn="Konto">
                    {KILDE[k.kilde] || k.kilde}, {dato(k.created_at)}
                  </Felt>
                  <Felt navn="Innlogging">
                    {[k.har_passord && "passord", k.har_google && "Google"].filter(Boolean).join(" og ") || "ikke aktivert"}
                    {" · "}
                    {k.epost_bekreftet_at ? `e-post bekreftet ${dato(k.epost_bekreftet_at)}` : "e-post ikke bekreftet"}
                  </Felt>
                  <Felt navn="Sist inne">{tid(k.sist_inne_at)}</Felt>
                  <Felt navn="Nyhetsbrev">{k.nyhetsbrev ? "Ja" : "Nei"}</Felt>
                  {k.mystore_ordrer != null && (
                    <Felt navn="I Mystore">
                      {k.mystore_ordrer} ordrer for {kroner(k.mystore_ordreverdi_ore || 0)}
                      {k.mystore_sist_inne ? `, sist inne ${dato(k.mystore_sist_inne)}` : ""}
                    </Felt>
                  )}
                </>
              ) : (
                <Felt navn="Konto">Ingen konto. Adressen har bare ordrer eller kreditt.</Felt>
              )}
            </dl>
            <div className="kunde-tall" style={{ margin: 0, alignContent: "start" }}>
              <Nøkkeltall merke="Kjøpt i butikken" verdi={kroner(d.tall.kjøpt_ore)}
                under={`${d.tall.kjøpt_ordrer} ordrer · ${d.tall.kjøpt_kort} kort`} />
              <Nøkkeltall merke="Solgt til butikken" verdi={kroner(d.tall.solgt_ore)}
                under={`${d.tall.solgt_ordrer} oppgjort · ${d.tall.solgt_kort} kort`} />
            </div>
          </div>
        )}
      </div>

      {d && (
        <div className="panel">
          <header>
            <h3>Kjøp i butikken</h3>
            <span className="dempet">{d.salgsordrer.length} ordrer</span>
          </header>
          {!d.salgsordrer.length ? (
            <div className="tom"><b>Ingen kjøp</b></div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Ordre</th>
                  <th>Dato</th>
                  <th>Status</th>
                  <th className="h">Kort</th>
                  <th className="h">Betalt</th>
                  <th>Frakt</th>
                </tr>
              </thead>
              <tbody>
                {d.salgsordrer.map((o) => {
                  const [s, kl] = SALGSSTATUS[o.status] || [o.status, "m-av"];
                  return (
                    <tr key={o.ordrenr} style={{ cursor: "pointer" }} onClick={() => setÅpenOrdre(o.ordrenr)}>
                      <td><b>{o.ordrenr}</b></td>
                      <td>{tid(o.betalt_at || o.created_at)}</td>
                      <td>
                        <span className={`merkelapp ${kl}`}>{s}</span>
                        {o.rettet_ore > 0 && <span className="merkelapp m-av" style={{ marginLeft: 4 }} title={`${kroner(o.rettet_ore)} refundert`}>rettet</span>}
                      </td>
                      <td className="h tall">{o.antall_kort}</td>
                      <td className="h tall">
                        {kroner(o.sum_ore - o.rettet_ore)}
                        <div className="dempet" style={{ fontSize: 11.5, fontWeight: 400 }}>
                          {[
                            o.stripe_ore ? `${o.betalingsmate === "vipps" ? "Vipps" : "kort"} ${kroner(o.stripe_ore)}` : "",
                            o.kreditt_ore ? `kreditt ${kroner(o.kreditt_ore)}` : "",
                            o.gavekort_ore ? `gavekort ${kroner(o.gavekort_ore)}` : "",
                          ].filter(Boolean).join(" · ")}
                        </div>
                      </td>
                      <td className="dempet">{o.frakt_navn || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {d && (
        <div className="panel">
          <header>
            <h3>Kort solgt til butikken</h3>
            <span className="dempet">{d.kjøpsordrer.length} ordrer · åpnes under Kjøpsordrer</span>
          </header>
          {!d.kjøpsordrer.length ? (
            <div className="tom"><b>Ingen kjøpsordrer</b></div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Ordre</th>
                  <th>Sendt inn</th>
                  <th>Status</th>
                  <th className="h">Kort</th>
                  <th className="h">Forespeilet</th>
                  <th className="h">Oppgjort</th>
                </tr>
              </thead>
              <tbody>
                {d.kjøpsordrer.map((o) => {
                  const [s, kl] = KJØPSSTATUS[o.status] || [o.status, "m-av"];
                  const gjortOpp = o.oppgjort_at || o.discount_code;
                  return (
                    <tr key={o.order_no}>
                      <td><b>{o.order_no}</b></td>
                      <td>{tid(o.created_at)}</td>
                      <td><span className={`merkelapp ${kl}`}>{s}</span></td>
                      <td className="h tall">{o.kort}</td>
                      <td className="h tall dempet">{kroner(o.quoted_ore)}</td>
                      <td className="h tall">
                        {gjortOpp ? kroner(o.total_ore) : <span className="dempet">—</span>}
                        {gjortOpp && (
                          <div className="dempet" style={{ fontSize: 11.5, fontWeight: 400 }}>
                            {o.discount_code ? `kode ${o.discount_code}` : `kreditt ${dato(o.oppgjort_at)}`}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {d && d.ønskeliste.length > 0 && (
        <div className="panel">
          <header>
            <h3>Ønskeliste</h3>
            <span className="dempet">{d.ønskeliste.length} kort</span>
          </header>
          <div className="krop" style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {d.ønskeliste.map((ø, i) => (
              <span key={i} className="merkelapp m-av" title={`Lagt til ${dato(ø.created_at)}${ø.varslet_at ? `, varslet ${dato(ø.varslet_at)}` : ""}`}>
                {ø.navn}{ø.finish === "foil" ? " (foil)" : ""}
              </span>
            ))}
          </div>
        </div>
      )}

      <Konto epost={epost} navn={navn} onLukk={onLukk} onFeil={onFeil} innebygd />
    </>
  );
}

function Felt({ navn, children }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "110px 1fr", gap: 8, padding: "3px 0", fontSize: 13.5 }}>
      <dt className="dempet" style={{ margin: 0 }}>{navn}</dt>
      <dd style={{ margin: 0 }}>{children}</dd>
    </div>
  );
}

function Nøkkeltall({ merke, verdi, under }) {
  return (
    <div className="panel kunde-tallboks">
      <div className="dempet" style={{ fontSize: 12.5 }}>{merke}</div>
      <div className="tall" style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.2 }}>{verdi}</div>
      {under && <div className="dempet" style={{ fontSize: 12 }}>{under}</div>}
    </div>
  );
}
