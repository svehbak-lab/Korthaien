import { useState, useEffect } from "react";
import { api, kroner } from "../api.js";

const CONDITIONS = ["MT", "NM", "EX", "GD", "LP", "PL", "PO"];

const dag = (iso) => (iso ? iso.slice(0, 10).split("-").reverse().slice(0, 2).join(".") : "");

// Hvor lenge et kupp har ligget. Et tilbud som har stått i tre uker er noe
// annet enn ett som dukket opp i natt — da vet du at ingen andre tok det.
function alder(iso) {
  const d = Math.floor((Date.now() - Date.parse(iso)) / 86400000);
  if (d <= 0) return "i dag";
  if (d === 1) return "i går";
  if (d < 14) return `${d} dager`;
  return `${Math.floor(d / 7)} uker`;
}

export default function Kupp({ onFeil }) {
  const [data, setData] = useState(null);
  const [sammendrag, setSammendrag] = useState(null);
  const [laster, setLaster] = useState(true);
  const [minAvvik, setMinAvvik] = useState(0);
  const [visBorte, setVisBorte] = useState(false);
  const [lagrer, setLagrer] = useState(false);

  async function last() {
    try {
      const [d, s] = await Promise.all([
        api.kupp({ minAvvik, visBorte }),
        api.kuppVakteliste(),
      ]);
      setData(d);
      setSammendrag(s);
    } catch (e) {
      onFeil(e);
    } finally {
      setLaster(false);
    }
  }

  useEffect(() => {
    last();
  }, [minAvvik, visBorte]);

  async function lagre(endringer) {
    setLagrer(true);
    try {
      await api.settKuppOppsett(endringer);
      await last();
    } catch (e) {
      onFeil(e);
    } finally {
      setLagrer(false);
    }
  }

  if (laster) return <p className="dempet">Henter kupplista…</p>;
  if (!data) return null;

  const o = data.oppsett;
  const treff = data.treff;

  return (
    <>
      <p className="ingress" style={{ marginTop: 0 }}>
        Kort andre norske butikker selger for mindre enn du selger dem for selv. Prisene
        hentes fra MTG Kortjakt, som spør butikkene live — ett oppslag her blir én
        forespørsel til hver butikk. Derfor går jobben i rotasjon, ikke som en
        gjennomgang av hele katalogen.
      </p>

      <div className="panel" style={{ marginBottom: 16, padding: "16px 18px" }}>
        <div className="rad-flex" style={{ gap: 28, flexWrap: "wrap" }}>
          <Tall navn="Kort som følges" verdi={sammendrag?.antall?.toLocaleString("nb-NO") ?? "—"} />
          <Tall navn="Full runde" verdi={sammendrag ? `${sammendrag.runde_dager} dager` : "—"} />
          <Tall
            navn="Per kjøring"
            verdi={sammendrag ? `${sammendrag.oppslag_per_natt} kort · ${sammendrag.tid_per_natt_min} min` : "—"}
          />
          <Tall navn="Treff nå" verdi={treff.filter((t) => !t.borte_at).length} />
          <Tall navn="Sist kjørt" verdi={data.status.sist_kjørt ? dag(data.status.sist_kjørt) : "aldri"} />
        </div>
      </div>

      {!o.aktiv && (
        <div className="varsel info" style={{ marginBottom: 16 }}>
          <b>Kuppjakten er av.</b> Kortjakt ber om at endepunktet ikke kalles i løkke, og
          tjenesten drives gratis av én person. Avklar med dem før du slår den på —
          e-post står på <code>mtgkortjakt.no/vilkar</code>. Du kan kjøre en prøve på ti
          kort uten å slå den på.
        </div>
      )}

      <details className="panel" style={{ marginBottom: 16, padding: "14px 18px" }}>
        <summary style={{ cursor: "pointer", fontWeight: 600 }}>Innstillinger</summary>
        <div className="rad-flex" style={{ gap: 18, flexWrap: "wrap", marginTop: 14 }}>
          <Felt
            navn="Minste salgspris"
            hjelp="Kort du selv tar mindre enn dette for, følges ikke."
            verdi={Math.round(o.min_ore / 100)}
            etter="kr"
            onLagre={(v) => lagre({ min_ore: Math.max(0, v) * 100 })}
          />
          <Felt
            navn="Grense"
            hjelp="Hvor langt under din salgspris tilbudet må ligge."
            verdi={o.pct}
            etter="%"
            onLagre={(v) => lagre({ pct: Math.min(99, Math.max(1, v)) })}
          />
          <Felt
            navn="Kort per kjøring"
            hjelp="Vaktelista delt på dette er antall dager per runde."
            verdi={o.per_natt}
            onLagre={(v) => lagre({ per_natt: Math.max(1, v) })}
          />
          <Felt
            navn="Pause"
            hjelp="Mellom hvert oppslag. Lavere er hardere mot butikkene."
            verdi={Math.round(o.pause_ms / 1000)}
            etter="sek"
            onLagre={(v) => lagre({ pause_ms: Math.max(1, v) * 1000 })}
          />
          <label style={{ fontSize: 13 }}>
            <div className="dempet" style={{ fontSize: 12, marginBottom: 4 }}>Minste tilstand</div>
            <select
              value={o.min_condition}
              onChange={(e) => lagre({ min_condition: e.target.value })}
              style={{ width: 90 }}
            >
              {CONDITIONS.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </label>
        </div>

        <div style={{ marginTop: 16, display: "flex", gap: 18, flexWrap: "wrap", alignItems: "center" }}>
          <label>
            <input
              type="checkbox"
              checked={o.utland}
              onChange={(e) => lagre({ utland: e.target.checked })}
            />{" "}
            Ta med Sverige og Danmark
            <span className="dempet" style={{ fontSize: 12 }}> — prisene har importmoms innbakt</span>
          </label>
          <label style={{ marginLeft: "auto", fontWeight: 600 }}>
            <input
              type="checkbox"
              checked={o.aktiv}
              onChange={(e) => lagre({ aktiv: e.target.checked })}
            />{" "}
            Kjør automatisk
          </label>
          <button
            className="knapp"
            disabled={lagrer}
            onClick={async () => {
              try {
                await api.jobb("kupp-prove");
                alert("Prøven er startet — følg med i loggen. Ti kort, ti sekunder mellom hvert.");
              } catch (e) {
                onFeil(e);
              }
            }}
          >
            Prøv ti kort
          </button>
        </div>
      </details>

      <div className="rad-flex" style={{ gap: 16, marginBottom: 12, alignItems: "center" }}>
        <select
          value={minAvvik}
          onChange={(e) => setMinAvvik(Number(e.target.value))}
          style={{ width: 170 }}
        >
          {[0, 20, 30, 40, 50, 60].map((n) => (
            <option key={n} value={n}>{n ? `Minst ${n} % under` : "Alle treff"}</option>
          ))}
        </select>
        <label style={{ fontSize: 13 }}>
          <input type="checkbox" checked={visBorte} onChange={(e) => setVisBorte(e.target.checked)} />{" "}
          Vis solgte
        </label>
        <span className="dempet" style={{ marginLeft: "auto", fontSize: 12 }}>
          Frakt er ikke trukket fra. Den er den samme om du kjøper ett kort eller tretti
          fra samme butikk.
        </span>
      </div>

      {!treff.length ? (
        <div className="panel">
          <div className="tom">
            <b>Ingen treff ennå</b>
            {data.status.sist_kjørt
              ? "Jobben har gått, men ingen butikk ligger under grensen din. Prøv en lavere prosent."
              : "Jobben har ikke kjørt. Kjør «Prøv ti kort» for å se at den virker."}
          </div>
        </div>
      ) : (
        <table className="tabell" style={{ width: "100%" }}>
          <thead>
            <tr>
              <th>Kort</th>
              <th>Butikk</th>
              <th style={{ textAlign: "right", width: 100 }}>Deres pris</th>
              <th style={{ textAlign: "right", width: 100 }}>Din pris</th>
              <th style={{ textAlign: "right", width: 80 }}>Under</th>
              <th style={{ textAlign: "right", width: 100 }}>Ligget</th>
            </tr>
          </thead>
          <tbody>
            {treff.map((t) => (
              <tr key={`${t.card_id}:${t.finish}:${t.shop}:${t.url}`} style={t.borte_at ? { opacity: 0.45 } : null}>
                <td>
                  <div>
                    {t.name}
                    {t.finish === "foil" && (
                      <span className="merkelapp m-foil" style={{ marginLeft: 6 }}>Foil</span>
                    )}
                    {t.usikker && (
                      <span
                        className="merkelapp"
                        style={{ marginLeft: 6 }}
                        title="Butikken oppga ikke samlernummer. Sjekk at det er samme utgave før du kjøper."
                      >
                        usikker utgave
                      </span>
                    )}
                  </div>
                  <div className="dempet" style={{ fontSize: 12 }}>
                    {t.set_name || t.set_code}
                    {t.collector_number ? ` #${t.collector_number}` : ""}
                    {t.condition ? ` · ${t.condition}` : ""}
                  </div>
                </td>
                <td>
                  {t.url ? (
                    <a href={t.url} target="_blank" rel="noreferrer noopener">
                      {t.shop_name || t.shop}
                    </a>
                  ) : (
                    t.shop_name || t.shop
                  )}
                  <div className="dempet" style={{ fontSize: 12 }}>
                    {t.frakt_ore ? `+${Math.round(t.frakt_ore / 100)} kr frakt` : ""}
                  </div>
                </td>
                <td style={{ textAlign: "right", fontWeight: 600 }}>{kroner(t.pris_ore)}</td>
                <td style={{ textAlign: "right" }}>
                  {kroner(t.salg_ore)}
                  <div className="dempet" style={{ fontSize: 11 }}>
                    marked {kroner(t.marked_ore)}
                  </div>
                </td>
                <td style={{ textAlign: "right", fontWeight: 600 }}>{t.avvik_pct} %</td>
                <td style={{ textAlign: "right" }} className="dempet">
                  {t.borte_at ? (
                    <span title={`Borte ${dag(t.borte_at)}`}>solgt</span>
                  ) : (
                    <span title={`Først sett ${dag(t.forst_sett)}`}>{alder(t.forst_sett)}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

function Tall({ navn, verdi }) {
  return (
    <div>
      <div className="dempet" style={{ fontSize: 12 }}>{navn}</div>
      <div style={{ fontSize: 20, fontWeight: 700, lineHeight: 1.3 }}>{verdi}</div>
    </div>
  );
}

// Lagres når feltet forlates, ikke ved hvert tastetrykk — ellers ville «650»
// utløst tre omregninger av hele vaktelista.
function Felt({ navn, hjelp, verdi, etter, onLagre }) {
  const [tekst, setTekst] = useState(String(verdi));
  useEffect(() => setTekst(String(verdi)), [verdi]);

  return (
    <label style={{ fontSize: 13 }} title={hjelp}>
      <div className="dempet" style={{ fontSize: 12, marginBottom: 4 }}>{navn}</div>
      <input
        type="number"
        min="0"
        value={tekst}
        style={{ width: 90, textAlign: "right" }}
        onChange={(e) => setTekst(e.target.value)}
        onBlur={() => {
          const n = parseInt(tekst, 10);
          if (Number.isFinite(n) && n !== verdi) onLagre(n);
        }}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      />
      {etter ? <span className="dempet" style={{ marginLeft: 6 }}>{etter}</span> : null}
    </label>
  );
}
