import { useState, useEffect, useMemo } from "react";
import { api, kroner } from "../api.js";

const CONDITIONS = ["MT", "NM", "EX", "GD", "LP", "PL", "PO"];

const dag = (iso) => (iso ? iso.slice(0, 10).split("-").reverse().slice(0, 2).join(".") : "");

// Hvor lenge et tilbud har ligget. Et kupp som har stått i tre uker er noe
// annet enn ett som dukket opp i natt — da vet du at ingen andre tok det.
function alder(iso) {
  const d = Math.floor((Date.now() - Date.parse(iso)) / 86400000);
  if (d <= 0) return "i dag";
  if (d === 1) return "i går";
  if (d < 14) return `${d} dager`;
  return `${Math.floor(d / 7)} uker`;
}

// Visningsvalg huskes i nettleseren. De styrer ingenting i jobben — de
// bestemmer bare hva du ser — men å måtte sette dem på nytt hver gang du
// bytter side er irriterende, og fikk dem til å ligne innstillinger som
// lagres. Private vinduer og blokkert lagring skal ikke velte siden, derfor
// try/catch rundt begge veier.
function useHusket(nøkkel, standard) {
  const [verdi, setVerdi] = useState(() => {
    try {
      const lagret = localStorage.getItem(`kupp.${nøkkel}`);
      return lagret === null ? standard : JSON.parse(lagret);
    } catch {
      return standard;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(`kupp.${nøkkel}`, JSON.stringify(verdi));
    } catch {
      /* ikke noe å gjøre, og ikke verdt å si fra om */
    }
  }, [nøkkel, verdi]);
  return [verdi, setVerdi];
}

export default function Kupp({ onFeil }) {
  const [fane, setFane] = useHusket("fane", "egen");

  return (
    <>
      {/* To lister av samme slag, men med motsatt formål: den ene finner
          andres feilpriser, den andre dine egne. De har ulike kilder og ulik
          oppdatering, så de holdes fra hverandre. */}
      <div className="rad-flex" style={{ gap: 8, marginBottom: 16 }}>
        <Fane valgt={fane === "egen"} onKlikk={() => setFane("egen")}>Korthaien</Fane>
        <Fane valgt={fane === "andre"} onKlikk={() => setFane("andre")}>Andre butikker</Fane>
      </div>

      {fane === "egen" ? <Egen onFeil={onFeil} /> : <Andre onFeil={onFeil} />}
    </>
  );
}

function Fane({ valgt, onKlikk, children }) {
  return (
    <button className={`knapp${valgt ? " primar" : ""}`} aria-pressed={valgt} onClick={onKlikk}>
      {children}
    </button>
  );
}

// Slår et kall feil, skal ruta si fra. Før returnerte komponenten null, og
// da forsvant hele siden uten et ord — det så ut som om funksjonen manglet.
function Feil({ feil, onPrøvIgjen }) {
  return (
    <div className="varsel info">
      <b>Klarte ikke hente lista.</b> {feil}
      {onPrøvIgjen && (
        <button className="knapp" style={{ marginLeft: 12 }} onClick={onPrøvIgjen}>
          Prøv igjen
        </button>
      )}
    </div>
  );
}

// ── Korthaien ────────────────────────────────────────────────────────────────

const RETNINGER = [
  { id: "under", navn: "Priset for lavt" },
  { id: "over", navn: "Priset for høyt" },
  { id: "begge", navn: "Begge retninger" },
];

const BELØP = [0, 100, 250, 500, 1000, 2500];

function Egen({ onFeil }) {
  const [data, setData] = useState(null);
  const [feil, setFeil] = useState(null);
  const [laster, setLaster] = useState(true);
  const [retning, setRetning] = useHusket("retning", "under");
  const [minKr, setMinKr] = useHusket("minKr", 0);
  const [visFerdige, setVisFerdige] = useHusket("visFerdige", false);
  const [teller, setTeller] = useState(0);

  // Hentes én gang per besøk, med alle avvikene i begge retninger. Filtrene
  // under jobber på det som allerede ligger i nettleseren, så et bytte er
  // øyeblikkelig. Før kostet hvert klikk en ny gjennomgang av hele lageret
  // på serveren, og det tok sekunder uten at noe på siden sa fra.
  useEffect(() => {
    let avbrutt = false;
    setLaster(true);
    api
      .kuppEgne()
      .then((d) => {
        if (avbrutt) return;
        setData(d);
        setFeil(null);
      })
      .catch((e) => {
        if (avbrutt) return;
        setFeil(e?.message || String(e));
        onFeil(e);
      })
      .finally(() => !avbrutt && setLaster(false));
    return () => {
      avbrutt = true;
    };
  }, [teller]);

  const rader = useMemo(() => {
    if (!data) return [];
    const minØre = minKr * 100;
    return data.rader.filter((r) => {
      if (r.ferdig && !visFerdige) return false;
      if (Math.abs(r.avvik_ore) < minØre) return false;
      if (retning === "under" && r.avvik_ore <= 0) return false;
      if (retning === "over" && r.avvik_ore >= 0) return false;
      return true;
    });
  }, [data, retning, minKr, visFerdige]);

  // Raden fjernes med én gang du huker av, og legges tilbake hvis lagringen
  // feiler. En arbeidsliste som henger etter hvert klikk er en arbeidsliste
  // man slutter å bruke.
  async function merk(rad, på) {
    const før = data;
    setData((d) => ({
      ...d,
      status: {
        ...d.status,
        ferdige: d.status.ferdige + (på ? 1 : -1),
        for_lavt: d.status.for_lavt + (rad.avvik_ore > 0 ? (på ? -1 : 1) : 0),
        for_hoyt: d.status.for_hoyt + (rad.avvik_ore < 0 ? (på ? -1 : 1) : 0),
      },
      rader: d.rader.map((r) =>
        r.card_id === rad.card_id && r.finish === rad.finish ? { ...r, ferdig: på } : r
      ),
    }));
    try {
      await api.settKuppRettet({
        card_id: rad.card_id,
        finish: rad.finish,
        pris_ore: rad.pris_ore,
        på,
      });
    } catch (e) {
      setData(før);
      onFeil(e);
    }
  }

  if (feil) return <Feil feil={feil} onPrøvIgjen={() => setTeller((n) => n + 1)} />;
  if (!data) {
    return (
      <p className="dempet">
        Henter dine egne priser… Første gang tar et par sekunder — hele lageret regnes
        gjennom.
      </p>
    );
  }

  return (
    <>
      <p className="ingress" style={{ marginTop: 0 }}>
        Dine egne priser fra Mystore, målt mot det kortet er verdt etter prismodellen din.
        Hele katalogen, oppdatert av nattsynken — ikke bare kortene i kuppjaktens rotasjon.
      </p>

      <div className="panel" style={{ marginBottom: 16, padding: "16px 18px" }}>
        <div className="rad-flex" style={{ gap: 28, flexWrap: "wrap" }}>
          <Tall navn="Priset for lavt" verdi={data.status.for_lavt.toLocaleString("nb-NO")} />
          <Tall navn="Priset for høyt" verdi={data.status.for_hoyt.toLocaleString("nb-NO")} />
          <Tall navn="Huket av" verdi={data.status.ferdige} />
          <Tall navn="Produkter med pris" verdi={data.status.med_pris.toLocaleString("nb-NO")} />
          <Tall
            navn="Sist synket"
            verdi={data.status.sist_synket ? dag(data.status.sist_synket) : "aldri"}
          />
        </div>
      </div>

      {!data.status.med_pris && (
        <div className="varsel info" style={{ marginBottom: 16 }}>
          <b>Ingen priser hentet ennå.</b> Prisene kommer inn med lagersynken. Kjør den fra
          Innstillinger, eller vent til i natt.
        </div>
      )}

      <div className="rad-flex" style={{ gap: 16, marginBottom: 12, alignItems: "center" }}>
        <span className="dempet" style={{ fontSize: 12 }}>Vis</span>
        <select value={retning} onChange={(e) => setRetning(e.target.value)} style={{ width: 170 }}>
          {RETNINGER.map((r) => (
            <option key={r.id} value={r.id}>{r.navn}</option>
          ))}
        </select>
        <select
          value={minKr}
          onChange={(e) => setMinKr(Number(e.target.value))}
          style={{ width: 170 }}
        >
          {BELØP.map((n) => (
            <option key={n} value={n}>{n ? `Minst ${n} kr i avvik` : "Alle beløp"}</option>
          ))}
        </select>
        <label style={{ fontSize: 13 }}>
          <input
            type="checkbox"
            checked={visFerdige}
            onChange={(e) => setVisFerdige(e.target.checked)}
          />{" "}
          Vis huket av
        </label>
        <span className="dempet" style={{ marginLeft: "auto", fontSize: 12 }}>
          {rader.length.toLocaleString("nb-NO")} av {data.rader.length.toLocaleString("nb-NO")}
          {data.status.kuttet > 0 && ` · ${data.status.kuttet.toLocaleString("nb-NO")} minste avvik utelatt`}
          {" · grensen er "}
          {data.oppsett.egen_pct} %
        </span>
      </div>

      {!rader.length ? (
        <div className="panel">
          <div className="tom">
            <b>Ingen avvik her</b>
            {data.status.ferdige && !visFerdige
              ? `Du har huket av ${data.status.ferdige} kort. De kommer tilbake hvis prisen endrer seg.`
              : "Prisene dine ligger innenfor grensene på det som er synket."}
          </div>
        </div>
      ) : (
        <table className="tabell" style={{ width: "100%" }}>
          <thead>
            <tr>
              <th style={{ width: 34 }} title="Huk av når du har sett på kortet" />
              <th>Kort</th>
              <th style={{ textAlign: "right", width: 100 }}>Din pris</th>
              <th style={{ textAlign: "right", width: 110 }}>Burde vært</th>
              <th style={{ textAlign: "right", width: 110 }}>Avvik</th>
              <th style={{ textAlign: "right", width: 70 }}>Antall</th>
            </tr>
          </thead>
          <tbody>
            {rader.map((r) => (
              <tr key={`${r.card_id}:${r.finish}`} style={r.ferdig ? { opacity: 0.45 } : null}>
                <td>
                  <input
                    type="checkbox"
                    checked={!!r.ferdig}
                    onChange={(e) => merk(r, e.target.checked)}
                    aria-label={`Huk av ${r.name}`}
                    title={
                      r.ferdig
                        ? `Huket av ${dag(r.ferdig_at)}. Kommer tilbake hvis prisen endrer seg.`
                        : "Huk av når du har sett på kortet"
                    }
                  />
                </td>
                <td>
                  <div>
                    {r.name}
                    {r.finish === "foil" && (
                      <span className="merkelapp m-foil" style={{ marginLeft: 6 }}>Foil</span>
                    )}
                  </div>
                  <div className="dempet" style={{ fontSize: 12 }}>
                    {r.set_name || r.set_code}
                    {r.collector_number ? ` #${r.collector_number}` : ""}
                  </div>
                </td>
                <td style={{ textAlign: "right", fontWeight: 600 }}>{kroner(r.pris_ore)}</td>
                <td style={{ textAlign: "right" }}>
                  {kroner(r.salg_ore)}
                  <div className="dempet" style={{ fontSize: 11 }}>marked {kroner(r.marked_ore)}</div>
                </td>
                {/* Beløpet uten fortegn. Undertittelen sier hvilken vei det
                    går, og et minustegn i tillegg leses like gjerne som at
                    avviket er negativt. */}
                <td style={{ textAlign: "right", fontWeight: 600 }}>
                  {kroner(Math.abs(r.avvik_ore))}
                  <div className="dempet" style={{ fontSize: 11, fontWeight: 400 }}>
                    {r.avvik_pct > 0 ? `${r.avvik_pct} % for lavt` : `${-r.avvik_pct} % for høyt`}
                  </div>
                </td>
                <td style={{ textAlign: "right" }} className="dempet">{r.antall}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p className="dempet" style={{ fontSize: 12, marginTop: 14 }}>
        Avviket er per kort, ikke ganget med antall. Mystore kan ikke skrives til herfra, så
        prisene rettes i butikken. Huker du av, hviler raden så lenge prisen står stille —
        endrer den seg, kommer kortet tilbake til ny vurdering.
      </p>
    </>
  );
}

// ── andre butikker ───────────────────────────────────────────────────────────

function Andre({ onFeil }) {
  const [data, setData] = useState(null);
  const [sammendrag, setSammendrag] = useState(null);
  const [feil, setFeil] = useState(null);
  const [minAvvik, setMinAvvik] = useHusket("andreMinAvvik", 0);
  const [visBorte, setVisBorte] = useHusket("andreVisBorte", false);
  const [lagrer, setLagrer] = useState(false);

  async function last() {
    try {
      const [d, s] = await Promise.all([api.kupp({ minAvvik, visBorte }), api.kuppVakteliste()]);
      setData(d);
      setSammendrag(s);
      setFeil(null);
    } catch (e) {
      setFeil(e?.message || String(e));
      onFeil(e);
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

  if (feil) return <Feil feil={feil} onPrøvIgjen={last} />;
  if (!data) return <p className="dempet">Henter kupplista…</p>;

  const o = data.oppsett;
  const treff = data.treff;

  return (
    <>
      <p className="ingress" style={{ marginTop: 0 }}>
        Kort andre norske butikker selger for mindre enn du selger dem for selv. Prisene
        hentes fra MTG Kortjakt, som spør butikkene live — ett oppslag her blir én
        forespørsel til hver butikk. Derfor går jobben i rotasjon, ikke som en gjennomgang
        av hele katalogen.
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
          <b>Kuppjakten er av.</b> Kortjakt krever nå innlogging med en gratis konto, og
          jobben har ingen. Den trenger et token før den kan kjøre igjen.
        </div>
      )}

      <details className="panel" style={{ marginBottom: 16, padding: "14px 18px" }}>
        <summary style={{ cursor: "pointer", fontWeight: 600 }}>
          Innstillinger <span className="dempet" style={{ fontWeight: 400, fontSize: 12 }}>— styrer jobben, lagres</span>
        </summary>
        <div className="rad-flex" style={{ gap: 18, flexWrap: "wrap", marginTop: 14 }}>
          <Felt
            navn="Minste salgspris"
            hjelp="Kort du selv tar mindre enn dette for, følges ikke av kuppjakten."
            verdi={Math.round(o.min_ore / 100)}
            etter="kr"
            onLagre={(v) => lagre({ min_ore: Math.max(0, v) * 100 })}
          />
          <Felt
            navn="Grense, andre"
            hjelp="Hvor langt under din salgspris et annet tilbud må ligge."
            verdi={o.pct}
            etter="%"
            onLagre={(v) => lagre({ pct: Math.min(99, Math.max(1, v)) })}
          />
          <Felt
            navn="Grense, egne"
            hjelp="Hvor mye din egen pris må avvike, i begge retninger, for å havne i Korthaien-fanen."
            verdi={o.egen_pct}
            etter="%"
            onLagre={(v) => lagre({ egen_pct: Math.min(99, Math.max(1, v)) })}
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
                alert("Prøven er startet. Ti kort — se loggen for api-tjenesten i Render.");
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
        <span className="dempet" style={{ fontSize: 12 }}>Vis</span>
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
          Frakt er ikke trukket fra. Den er den samme om du kjøper ett kort eller tretti fra
          samme butikk.
        </span>
      </div>

      {!treff.length ? (
        <div className="panel">
          <div className="tom">
            <b>Ingen treff</b>
            {data.status.sist_kjørt
              ? "Ingen butikk ligger under grensen din på det som er sjekket."
              : "Jobben har ikke kjørt."}
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
                  <div className="dempet" style={{ fontSize: 11 }}>marked {kroner(t.marked_ore)}</div>
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
  const [tekst, setTekst] = useState(String(verdi ?? ""));
  useEffect(() => setTekst(String(verdi ?? "")), [verdi]);

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
