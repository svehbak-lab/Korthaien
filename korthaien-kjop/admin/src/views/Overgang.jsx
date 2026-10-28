import { useState, useEffect } from "react";
import { api } from "../api.js";
import Landing, { STANDARD_TITTEL, STANDARD_TEKST } from "./Landing.jsx";
import Etterforing from "./Etterforing.jsx";

// ─────────────────────────────────────────────────────────────────────────────
// OVERGANGEN FRA MYSTORE
// ─────────────────────────────────────────────────────────────────────────────
// To ting som hører sammen den dagen butikken flyttes:
//  1. Landingssiden — det kundene ser mens butikken er stengt.
//  2. Lagerovergangen — én knapp som tømmer lagerboken, fører inn Mystore-
//     beholdningen som åpningsbeholdning og bytter butikken over til boken.

const penTid = (t) =>
  t ? new Date(t).toLocaleString("nb-NO", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "aldri";

export default function Overgang({ onFeil, onMelding }) {
  return (
    <>
      <Landingsside onFeil={onFeil} onMelding={onMelding} />
      <Lagerovergang onFeil={onFeil} onMelding={onMelding} />
      <Etterforing onFeil={onFeil} onMelding={onMelding} />
      <KrevKonto onFeil={onFeil} onMelding={onMelding} />
      <Rekkefolge />
    </>
  );
}

function Landingsside({ onFeil, onMelding }) {
  const [s, setS] = useState(null);
  const [lagrer, setLagrer] = useState(false);

  useEffect(() => {
    api
      .innstillinger()
      .then((x) =>
        setS({
          tema: x.tema,
          dato: x.overgang_dato || "",
          aktiv: !!x.stengt?.aktiv,
          tittel: x.stengt?.tittel || "",
          tekst: x.stengt?.tekst || "",
        })
      )
      .catch(onFeil);
  }, []);

  async function lagre(endring) {
    const ny = { ...s, ...endring };
    setLagrer(true);
    try {
      const r = await api.lagreInnstillinger({
        stengt: { aktiv: ny.aktiv, tittel: ny.tittel, tekst: ny.tekst },
        overgang_dato: ny.dato,
      });
      setS({ ...ny, aktiv: !!r.stengt?.aktiv, dato: r.overgang_dato || "" });
      onMelding(r.stengt?.aktiv ? "Butikken er stengt — kundene ser landingssiden." : "Landingssiden er lagret. Butikken er åpen.");
    } catch (e) {
      onFeil(e);
    } finally {
      setLagrer(false);
    }
  }

  if (!s) return null;
  const endre = (felt, v) => setS({ ...s, [felt]: v });

  return (
    <div className="panel">
      <header>
        <h3>Landingsside</h3>
        <span className={`merkelapp ${s.aktiv ? "m-vent" : "m-lager"}`} style={{ marginLeft: "auto" }}>
          {s.aktiv ? "Butikken er stengt" : "Butikken er åpen"}
        </span>
      </header>
      <div className="krop">
        <p className="dempet" style={{ marginTop: 0, maxWidth: "70ch" }}>
          Når butikken er stengt, ser kundene denne siden i stedet for butikken, og kassen tar ikke imot ordrer.
          Du ser butikken som vanlig når du er innlogget i admin — så du kan sjekke alt før du åpner.
        </p>
        <div className="skjema" style={{ maxWidth: 560 }}>
          <label>
            Overskrift
            <input value={s.tittel} maxLength={120} placeholder={STANDARD_TITTEL} onChange={(e) => endre("tittel", e.target.value)} />
          </label>
          <label>
            Tekst
            <textarea rows={4} value={s.tekst} maxLength={600} placeholder={STANDARD_TEKST} onChange={(e) => endre("tekst", e.target.value)} />
          </label>
          <label>
            Åpner
            <input type="date" value={s.dato} onChange={(e) => endre("dato", e.target.value)} />
            <span className="dempet" style={{ fontSize: 12 }}>
              Samme dato som passordmeldingen under Kunder. Vises på landingssiden til den er passert.
            </span>
          </label>
        </div>

        <div className="dempet" style={{ fontSize: 12, margin: "16px 0 6px" }}>Forhåndsvisning</div>
        <Landing forhåndsvisning tema={s.tema} tittel={s.tittel} tekst={s.tekst} dato={s.dato} />

        <div className="rad-flex" style={{ marginTop: 14 }}>
          <button className="knapp" disabled={lagrer} onClick={() => lagre({})}>Lagre tekst</button>
          {s.aktiv ? (
            <button className="knapp primar" disabled={lagrer} onClick={() => lagre({ aktiv: false })}>Åpne butikken</button>
          ) : (
            <button className="knapp primar" disabled={lagrer} onClick={() => lagre({ aktiv: true })}>Steng butikken</button>
          )}
        </div>
      </div>
    </div>
  );
}

function Lagerovergang({ onFeil, onMelding }) {
  const [st, setSt] = useState(null);
  const [bekreft, setBekreft] = useState("");
  const [kjører, setKjører] = useState(false);

  const hent = () => api.overgang().then(setSt).catch(onFeil);
  useEffect(() => { hent(); }, []);

  async function synk() {
    try {
      const r = await api.jobb("mystore-alle");
      onMelding(r.melding || "Den fulle lagersynken er startet.");
    } catch (e) {
      onFeil(e);
    }
  }

  async function kjør() {
    setKjører(true);
    try {
      const r = await api.kjørOvergang();
      setSt(r);
      setBekreft("");
      onMelding("Overgangen er gjort. Butikken leser nå beholdningen fra lagerboken.");
    } catch (e) {
      onFeil(e);
      hent();
    } finally {
      setKjører(false);
    }
  }

  if (!st) return null;
  const ferdig = st.lagerkilde === "bok";
  const bokStk = st.bok.reduce((n, b) => n + b.stk, 0);
  const hindring =
    st.usendte_salg > 0
      ? `${st.usendte_salg} salgsordre${st.usendte_salg === 1 ? "" : "r"} er ikke sendt. Send eller kanseller dem først — salgsbevegelsene deres ligger i lagerboken som tømmes.`
      : !st.mystore.kort
        ? "Mystore-speilet er tomt. Kjør den fulle lagersynken først."
        : "";

  return (
    <div className="panel">
      <header>
        <h3>Lagerovergang</h3>
        <span className={`merkelapp ${ferdig ? "m-lager" : "m-av"}`} style={{ marginLeft: "auto" }}>
          Butikken leser fra {ferdig ? "lagerboken" : "Mystore"}
        </span>
      </header>
      <div className="krop">
        <table style={{ maxWidth: 620 }}>
          <tbody>
            <tr>
              <td>Mystore-beholdning (speilet)</td>
              <td className="h tall">{st.mystore.kort.toLocaleString("nb-NO")} kort · {st.mystore.stk.toLocaleString("nb-NO")} stk.</td>
            </tr>
            <tr>
              <td>Sist synket fra Mystore</td>
              <td className="h">{penTid(st.mystore.sist_synket)}</td>
            </tr>
            <tr>
              <td>Lagerboken nå</td>
              <td className="h tall">
                {st.bok.length ? `${bokStk.toLocaleString("nb-NO")} stk. (${st.bok.map((b) => `${b.grunn} ${b.stk}`).join(", ")})` : "tom"}
              </td>
            </tr>
            <tr>
              <td>Salgsordrer ikke sendt</td>
              <td className="h tall" style={{ color: st.usendte_salg ? "var(--feil)" : undefined }}>{st.usendte_salg}</td>
            </tr>
            <tr>
              <td>Kjøpsordrer mottatt, ikke lagt inn i Mystore</td>
              <td className="h tall" style={{ color: st.kjop_ikke_lagt_inn ? "var(--advarsel)" : undefined }}>{st.kjop_ikke_lagt_inn}</td>
            </tr>
          </tbody>
        </table>

        {ferdig ? (
          <div className="varsel ok" style={{ marginTop: 14, marginBottom: 0 }}>
            Overgangen er gjort. Beholdningen føres nå i lagerboken: salg trekker fra, kjøpsordrer som legges inn
            fører til. Kjøpsordrer gjøres nå opp som kreditt på kundens e-postadresse i stedet for med en
            Mystore-kode. Mystore-synken kan slås av.
          </div>
        ) : (
          <>
            <p className="dempet" style={{ maxWidth: "70ch" }}>
              Knappen gjør tre ting i én operasjon: tømmer lagerboken, fører inn hele Mystore-beholdningen som
              åpningsbeholdning (alt som NM), og bytter butikken over til lagerboken. Går noe galt underveis, skjer
              ingenting. Kjør den fulle lagersynken rett før, etter at du har stengt Mystore og pakket alle ordrene der.
              Fra da av gjøres kjøpsordrer opp som kreditt i stedet for med rabattkode i Mystore.
            </p>
            {st.kjop_ikke_lagt_inn > 0 && (
              <div className="varsel info">
                {st.kjop_ikke_lagt_inn} mottatt{st.kjop_ikke_lagt_inn === 1 ? "" : "e"} kjøpsordre{st.kjop_ikke_lagt_inn === 1 ? "" : "r"} er
                ikke lagt inn i Mystore. Kortene i dem kommer ikke med i åpningsbeholdningen — legg dem inn etter overgangen.
              </div>
            )}
            {hindring && <div className="varsel feil">{hindring}</div>}
            <div className="rad-flex" style={{ marginTop: 10 }}>
              <button className="knapp" onClick={synk}>Kjør full lagersynk</button>
              <button className="knapp" onClick={hent}>Oppdater</button>
            </div>
            <div className="rad-flex" style={{ marginTop: 14 }}>
              <label className="dempet" style={{ fontSize: 13 }}>
                Skriv OVERGANG for å bekrefte{" "}
                <input value={bekreft} onChange={(e) => setBekreft(e.target.value.toUpperCase())} style={{ width: 130 }} />
              </label>
              <button className="knapp primar" disabled={kjører || bekreft !== "OVERGANG" || !!hindring} onClick={kjør}>
                {kjører ? "Kjører…" : "Gjør overgangen"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// Konto påkrevd: ingen gjestekjøp, og kort sendes bare inn fra en konto.
// Slås på av overgangsknappen; haken er her for å prøve det på forhånd eller
// slå det av igjen.
function KrevKonto({ onFeil, onMelding }) {
  const [på, setPå] = useState(null);
  useEffect(() => {
    api.innstillinger().then((s) => setPå(!!s.krev_konto)).catch(onFeil);
  }, []);
  async function bytt(v) {
    try {
      const s = await api.lagreInnstillinger({ krev_konto: v });
      setPå(!!s.krev_konto);
      onMelding(s.krev_konto ? "Konto kreves nå for å handle og for å selge kort." : "Gjestekjøp og innsending uten konto er slått på igjen.");
    } catch (e) {
      onFeil(e);
    }
  }
  if (på === null) return null;
  return (
    <div className="panel">
      <header>
        <h3>Konto påkrevd</h3>
        <span className={`merkelapp ${på ? "m-lager" : "m-av"}`} style={{ marginLeft: "auto" }}>{på ? "På" : "Av"}</span>
      </header>
      <div className="krop">
        <p className="dempet" style={{ marginTop: 0, maxWidth: "70ch" }}>
          Når dette er på, må kundene være innlogget med bekreftet e-postadresse for å handle, og for å sende inn kort på
          salgssiden. Salgskurven kan fortsatt brukes uten konto, så folk kan se hva de får. Oppgjør for kjøpsordrer blir
          kreditt på kontoen. Overgangsknappen slår dette på.
        </p>
        <label className="rad-flex" style={{ gap: 8 }}>
          <input type="checkbox" checked={på} onChange={(e) => bytt(e.target.checked)} />
          Krev konto for å handle og selge
        </label>
      </div>
    </div>
  );
}

function Rekkefolge() {
  return (
    <div className="panel">
      <header><h3>Rekkefølgen på dagen</h3></header>
      <div className="krop">
        <ol style={{ margin: 0, paddingLeft: 20, lineHeight: 1.8 }}>
          <li>Steng butikken her (landingssiden), og steng Mystore for bestillinger.</li>
          <li>Pakk alle Mystore-ordrene, så beholdningen der står stille.</li>
          <li>Send eller kanseller åpne salgsordrer her.</li>
          <li>Kjør full lagersynk og vent til den er ferdig — se «Sist synket».</li>
          <li>Gjør overgangen.</li>
          <li>Importer rabattkodene (gavekortene) fra Mystore med saldoen slik den står nå — Admin → Rabattkoder → Importer.</li>
          <li>Eksporter kundelista fra Mystore på nytt og importer den (Admin → Kunder → Importer), så kunder som har kommet til siden sist er med. Kunder som finnes fra før blir ikke overskrevet.</li>
          <li>Ta en full eksport av ordrene fra Mystore og legg den i arkivet — bokføringsloven krever fem år.</li>
          <li>Sett SHOP_URL og BUTIKK_ORIGIN til https://korthaien.no på API-tjenesten i Render.</li>
          <li>Pek korthaien.no til den nye butikken, og sjekk den mens du er innlogget i admin.</li>
          <li>
            Prøv hele flyten: send inn en kjøpsordre innlogget, gjør den opp (kreditten skal komme på kontoen),
            legg kortene inn i beholdningen (de skal dukke opp i butikken), og handle med kreditten.
          </li>
          <li>Åpne butikken.</li>
          <li>Slå av Mystore-synken (cron-jobben i Render).</li>
        </ol>
      </div>
    </div>
  );
}
