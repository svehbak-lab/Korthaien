import { useState, useEffect, useRef } from "react";
import { api, kroner, dato, importerKunder } from "../api.js";

// ─────────────────────────────────────────────────────────────────────────────
// KUNDER
// ─────────────────────────────────────────────────────────────────────────────
// Hvem som har konto, hvordan de logger inn, og hvor de kom fra. Kundelisten
// fra Mystore kan importeres her: kundene får konto uten passord og velger
// passord (eller bruker Google) første gang de logger inn.

export default function Kunder({ onFeil, onMelding }) {
  const [q, setQ] = useState("");
  const [søk, setSøk] = useState("");
  const [side, setSide] = useState(0);
  const [data, setData] = useState(null);
  const [importerer, setImporterer] = useState(false);
  const [resultat, setResultat] = useState(null);
  const fil = useRef(null);

  async function last() {
    try {
      setData(await api.kunder(søk, side));
    } catch (e) {
      onFeil(e);
    }
  }
  useEffect(() => { last(); }, [søk, side]);
  useEffect(() => {
    const t = setTimeout(() => { setSide(0); setSøk(q); }, 250);
    return () => clearTimeout(t);
  }, [q]);

  async function importer(e) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setImporterer(true);
    setResultat(null);
    try {
      const r = await importerKunder(f);
      setResultat(r);
      onMelding(`Importert: ${r.nye} nye kunder, ${r.oppdatert} oppdatert.`);
      await last();
    } catch (err) {
      onFeil(err);
    } finally {
      setImporterer(false);
    }
  }

  if (!data) return <p className="dempet">Henter kunder…</p>;
  const t = data.tall;
  const sider = Math.max(1, Math.ceil(data.antall / data.per));

  return (
    <>
      <div className="panel">
        <header><h3>Slik registrerer kundene seg</h3></header>
        <div className="krop">
          <ul style={{ margin: 0, paddingLeft: 20, lineHeight: 1.7 }}>
            <li>
              <b>E-post og passord</b> under «Logg inn» i butikken, eller i kassen. Kunden får en
              e-post for å bekrefte adressen. Kreditt og gamle ordrer følger kontoen først når den er bekreftet.
            </li>
            <li>
              <b>Google</b>: {data.google_paa
                ? "slått på. Google-kontoen kobles til en eksisterende konto med samme e-postadresse."
                : "ikke slått på ennå. Knappen vises når GOOGLE_CLIENT_ID og GOOGLE_CLIENT_SECRET er satt i Render."}
            </li>
            <li>
              <b>Kunder fra Mystore</b> (importert under) har konto uten passord. Prøver de å registrere seg,
              får de en e-post der de velger passord. «Glemt passord» og Google virker også.
            </li>
            <li>
              <b>Selgere fra kjøpssiden</b> og alle med kreditt kan lage konto med «Glemt passord» — kreditten følger med.
            </li>
            <li>Gjester kan handle uten konto, men kan ikke bruke kreditt.</li>
          </ul>
        </div>
      </div>

      <div className="kunde-tall">
        <Tall merke="Kontoer" verdi={t.totalt} />
        <Tall merke="Med passord" verdi={t.med_passord} />
        <Tall merke="Med Google" verdi={t.med_google} />
        <Tall merke="Bekreftet e-post" verdi={t.bekreftet} />
        <Tall merke="Fra Mystore" verdi={t.fra_mystore} under={`${t.mystore_ikke_aktivert} ikke logget inn ennå`} />
        <Tall merke="Nye siste 30 dager" verdi={t.nye_30} under={`${t.inne_30} logget inn`} />
      </div>

      <div className="panel">
        <header>
          <h3>Kunder</h3>
          <input
            type="search" placeholder="Søk på navn eller e-post" value={q}
            onChange={(e) => setQ(e.target.value)} style={{ marginLeft: "auto", width: 260 }}
          />
        </header>
        <table>
          <thead>
            <tr>
              <th>Kunde</th>
              <th>Innlogging</th>
              <th>Kunde siden</th>
              <th>Sist inne</th>
              <th className="h">Ordrer</th>
              <th className="h" title="Fra Mystore-eksporten">Mystore</th>
            </tr>
          </thead>
          <tbody>
            {data.kunder.map((k) => (
              <tr key={k.id}>
                <td>
                  {k.navn || <span className="dempet">(uten navn)</span>}
                  <div className="dempet" style={{ fontSize: 12 }}>
                    {k.email}{k.poststed ? ` · ${k.poststed}` : ""}
                  </div>
                </td>
                <td>
                  <span className="rad-flex" style={{ gap: 4, flexWrap: "wrap" }}>
                    {Number(k.har_passord) ? <span className="merkelapp m-ok">passord</span> : null}
                    {Number(k.har_google) ? <span className="merkelapp m-ok">Google</span> : null}
                    {!Number(k.har_passord) && !Number(k.har_google) && (
                      <span className="merkelapp m-av" title="Har ikke valgt passord eller brukt Google ennå">ikke aktivert</span>
                    )}
                    {!k.epost_bekreftet_at && (Number(k.har_passord) || Number(k.har_google))
                      ? <span className="merkelapp m-vent">ubekreftet</span> : null}
                  </span>
                </td>
                <td>
                  {dato(k.created_at)}
                  {k.kilde === "mystore" && <div className="dempet" style={{ fontSize: 11.5 }}>fra Mystore</div>}
                </td>
                <td>{k.sist_inne_at ? dato(k.sist_inne_at) : <span className="dempet">—</span>}</td>
                <td className="h tall">{Number(k.ordrer) || <span className="dempet">0</span>}</td>
                <td className="h tall">
                  {k.mystore_ordrer != null ? (
                    <>
                      {k.mystore_ordrer} ordrer
                      <div className="dempet" style={{ fontSize: 11.5 }}>{kroner(Number(k.mystore_ordreverdi_ore) || 0)}</div>
                    </>
                  ) : <span className="dempet">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!data.kunder.length && <div className="tom"><b>Ingen kunder{søk ? " som passer søket" : " ennå"}</b></div>}
        {sider > 1 && (
          <div className="krop rad-flex" style={{ justifyContent: "flex-end" }}>
            <button className="knapp liten" disabled={side === 0} onClick={() => setSide(side - 1)}>← Forrige</button>
            <span className="dempet">Side {side + 1} av {sider} · {data.antall} kunder</span>
            <button className="knapp liten" disabled={side + 1 >= sider} onClick={() => setSide(side + 1)}>Neste →</button>
          </div>
        )}
      </div>

      <div className="panel">
        <header><h3>Importer kunder fra Mystore</h3></header>
        <div className="krop">
          <p className="dempet" style={{ marginTop: 0 }}>
            I Mystore: Kunder → Eksporter (CSV). Kundene får konto med navn, adresse og telefon, uten
            passord. Fødselsdato tas ikke med. Finnes kontoen fra før, fylles bare tomme felt, så det er trygt
            å importere på nytt. Falske registreringer — ingen ordrer, aldri innlogget og bokstaver i
            postnummeret — hoppes over. Ingen kunder får e-post av importen.
          </p>
          <input ref={fil} type="file" accept=".csv,text/csv" onChange={importer} hidden />
          <button className="knapp primar" disabled={importerer} onClick={() => fil.current?.click()}>
            {importerer ? "Importerer…" : "Velg CSV-fil…"}
          </button>
          {resultat && (
            <p style={{ marginBottom: 0 }}>
              {resultat.rader} rader: <b>{resultat.nye} nye</b>, {resultat.oppdatert} fantes fra før,{" "}
              {resultat.falske} falske hoppet over, {resultat.ugyldige} med ugyldig eller dobbel e-post.
            </p>
          )}
        </div>
      </div>
    </>
  );
}

function Tall({ merke, verdi, under }) {
  return (
    <div className="panel kunde-tallboks">
      <div className="dempet" style={{ fontSize: 12.5 }}>{merke}</div>
      <div style={{ fontSize: 24, fontWeight: 700, lineHeight: 1.2 }} className="tall">{verdi}</div>
      {under && <div className="dempet" style={{ fontSize: 12 }}>{under}</div>}
    </div>
  );
}
