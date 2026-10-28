import { useState, useEffect, useRef } from "react";
import { api, kroner, dato, importerKunder } from "../api.js";
import { Konto } from "./Kreditt.jsx";

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
  // Sortering: kolonne og retning. «Sist inne» med nyeste først er standard.
  const [sort, setSort] = useState({ felt: "sist_inne", opp: false });
  const [data, setData] = useState(null);
  const [importerer, setImporterer] = useState(false);
  const [resultat, setResultat] = useState(null);
  const fil = useRef(null);
  // Åpen kunde: kreditten hennes, med boka og feltene for å endre den.
  // null = lista, "" = kreditt på en ny adresse.
  const [åpen, setÅpen] = useState(null);

  async function last() {
    try {
      setData(await api.kunder(søk, side, sort.felt, sort.opp));
    } catch (e) {
      onFeil(e);
    }
  }
  useEffect(() => { last(); }, [søk, side, sort]);
  // Navn sorteres fra A, alt annet med høyest/nyest først.
  const sorterPå = (felt) => {
    setSide(0);
    setSort((x) => (x.felt === felt ? { felt, opp: !x.opp } : { felt, opp: felt === "navn" }));
  };
  const Kol = ({ felt, children, className, title }) => (
    <th className={className} title={title ? `${title} — klikk for å sortere` : "Klikk for å sortere"}
      style={{ cursor: "pointer", userSelect: "none" }} onClick={() => sorterPå(felt)}>
      {children}{sort.felt === felt ? (sort.opp ? " ▲" : " ▼") : ""}
    </th>
  );
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

  if (åpen !== null) {
    return (
      <Konto
        epost={åpen.email}
        navn={åpen.navn}
        tilbake="← Alle kunder"
        onLukk={() => { setÅpen(null); last(); }}
        onFeil={onFeil}
      />
    );
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

      {data.besok && (
        <div className="panel">
          <header><h3>Innloggede kunder innom</h3>
            <span className="dempet" style={{ fontSize: 12.5 }}>Hver kunde telles én gang per dag. Telles fra 28. oktober.</span>
          </header>
          <div className="krop" style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "flex-end" }}>
            {(() => {
              const maks = Math.max(1, ...data.besok.map((d) => d.innom));
              return [...data.besok].reverse().map((d, i, alle) => (
                <div key={d.dato} style={{ textAlign: "center", width: 46 }} title={`${d.dato}: ${d.innom}`}>
                  <div className="tall" style={{ fontSize: 13, fontWeight: i === alle.length - 1 ? 700 : 500 }}>{d.innom}</div>
                  <div style={{ height: 40, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
                    <div style={{ width: 22, height: Math.max(2, (d.innom / maks) * 40), background: i === alle.length - 1 ? "var(--aksent)" : "var(--strek-sterk)", borderRadius: 3 }} />
                  </div>
                  <div className="dempet" style={{ fontSize: 11 }}>
                    {i === alle.length - 1 ? "i dag" : new Date(d.dato + "T12:00:00").toLocaleDateString("nb-NO", { weekday: "short", day: "numeric" })}
                  </div>
                </div>
              ));
            })()}
          </div>
        </div>
      )}

      <div className="panel">
        <header>
          <h3>Kunder</h3>
          <input
            type="search" placeholder="Søk på navn eller e-post" value={q}
            onChange={(e) => setQ(e.target.value)} style={{ marginLeft: "auto", width: 260 }}
          />
          <button className="knapp" onClick={() => setÅpen({ email: "", navn: "" })} title="Gi kreditt til en adresse som ikke står i lista">
            Ny kreditt
          </button>
        </header>
        <div className="krop dempet" style={{ fontSize: 13, paddingTop: 8, paddingBottom: 8 }}>
          Trykk på en kunde for å se og endre kreditten. Selgere fra kjøpssiden som har kreditt men ikke konto, står også her.
        </div>
        <table>
          <thead>
            <tr>
              <Kol felt="navn">Kunde</Kol>
              <th>Innlogging</th>
              <Kol felt="siden">Kunde siden</Kol>
              <Kol felt="sist_inne" title="Sist innlogget eller innom butikken">Sist inne</Kol>
              <Kol felt="kreditt" className="h">Kreditt</Kol>
              <Kol felt="ordrer" className="h">Ordrer</Kol>
              <Kol felt="mystore" className="h" title="Fra Mystore-eksporten">Mystore</Kol>
            </tr>
          </thead>
          <tbody>
            {data.kunder.map((k) => (
              <tr key={k.id ?? k.email} style={{ cursor: "pointer" }} onClick={() => setÅpen({ email: k.email, navn: k.navn })}>
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
                    {k.kilde === "kreditt" && <span className="merkelapp m-av" title="Har kreditt, men har ikke laget konto">ingen konto</span>}
                    {k.kilde !== "kreditt" && !Number(k.har_passord) && !Number(k.har_google) && (
                      <span className="merkelapp m-av" title="Har ikke valgt passord eller brukt Google ennå">ikke aktivert</span>
                    )}
                    {!k.epost_bekreftet_at && (Number(k.har_passord) || Number(k.har_google))
                      ? <span className="merkelapp m-vent">ubekreftet</span> : null}
                  </span>
                </td>
                <td>
                  {dato(k.created_at)}
                  {k.kilde === "mystore" && <div className="dempet" style={{ fontSize: 11.5 }}>fra Mystore</div>}
                  {k.kilde === "kreditt" && <div className="dempet" style={{ fontSize: 11.5 }}>første kreditt</div>}
                </td>
                <td>
                  {k.sist_inne_at
                    ? new Date(k.sist_inne_at).toLocaleString("nb-NO", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
                    : <span className="dempet">—</span>}
                </td>
                <td className="h tall" style={{ fontWeight: Number(k.kreditt_ore) ? 600 : 400 }}>
                  {Number(k.kreditt_ore) ? kroner(Number(k.kreditt_ore)) : <span className="dempet">—</span>}
                </td>
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

      <Overgang onFeil={onFeil} onMelding={onMelding} />

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

// Dagen den nye butikken tar over. Står den, viser innloggingen en melding
// om at kunder fra før må velge passord første gang, og hvorfor.
function Overgang({ onFeil, onMelding }) {
  const [d, setD] = useState(null);
  const [lagrer, setLagrer] = useState(false);
  useEffect(() => {
    api.innstillinger().then((s) => setD(s.overgang_dato || "")).catch(onFeil);
  }, []);
  async function lagre(ny) {
    setLagrer(true);
    try {
      const s = await api.lagreInnstillinger({ overgang_dato: ny });
      setD(s.overgang_dato || "");
      onMelding(s.overgang_dato ? "Meldingen vises nå i innloggingen." : "Meldingen er skjult.");
    } catch (e) {
      onFeil(e);
    } finally {
      setLagrer(false);
    }
  }
  if (d === null) return null;
  return (
    <div className="panel">
      <header><h3>Melding om nytt passord</h3></header>
      <div className="krop">
        <p className="dempet" style={{ marginTop: 0 }}>
          Passordene fra Mystore kan ikke flyttes — de lagres kryptert hos Mystore, og ingen kan lese dem ut.
          Når du setter datoen den nye butikken åpnet, viser innloggingen en kort forklaring til kunder fra før.
        </p>
        <div className="rad-flex">
          <label className="dempet" style={{ fontSize: 13 }}>
            Ny butikk fra{" "}
            <input type="date" value={d} onChange={(e) => setD(e.target.value)} />
          </label>
          <button className="knapp primar" disabled={lagrer} onClick={() => lagre(d)}>Lagre</button>
          {d && <button className="knapp" disabled={lagrer} onClick={() => lagre("")}>Skjul meldingen</button>}
        </div>
        {d && (
          <div className="varsel info" style={{ marginTop: 12, marginBottom: 0 }}>
            <Overgangstekst dato={d} />
          </div>
        )}
      </div>
    </div>
  );
}

export function Overgangstekst({ dato: d }) {
  const pen = new Date(`${d}T12:00:00`).toLocaleDateString("nb-NO", { day: "numeric", month: "long", year: "numeric" });
  return (
    <>
      <b>Ny nettbutikk fra {pen}.</b> Har du handlet hos Korthaien før, må du velge nytt passord første
      gang du logger inn. Passord kunne ikke flyttes fra den gamle løsningen, fordi de er kryptert og
      ingen — heller ikke vi — kan lese dem. Bruk «Første gang her?» under med samme e-postadresse,
      eller fortsett med Google. Navn, adresse og kreditt ligger klart.
    </>
  );
}
