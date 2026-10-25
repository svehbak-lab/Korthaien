import { Ønskeliste } from "./Onske.jsx";
import SettStabel from "./SettStabel.jsx";
import { Overgangstekst } from "./Kunder.jsx";
import { createContext, useContext, useEffect, useMemo, useState, useCallback } from "react";
import { kunde as kapi, kroner } from "../api.js";

// ─────────────────────────────────────────────────────────────────────────────
// HANDEL
// ─────────────────────────────────────────────────────────────────────────────
// Handlekurven, kassen, kvitteringen, innloggingen og «Min side».
//
// Kurven bor i nettleseren og ikke på serveren: en kurv er et ønske, ikke en
// avtale, og den skal overleve at kunden lukker fanen. Serveren ser den først
// når kassen åpnes — og da regnes pris og beholdning på nytt der. Det som
// står her, er bare det kunden valgte, og et bilde av prisen for visning.
//
// Kortene holdes av når kassen åpnes, ikke når de legges i kurven.

const LAGER = "kh_kurv";
const Handel = createContext(null);
export const useHandel = () => useContext(Handel);

const nøkkel = (l) => `${l.card_id}:${l.finish}:${l.condition}`;

function lesKurv() {
  try {
    const v = JSON.parse(localStorage.getItem(LAGER) || "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export function HandelProvider({ children }) {
  const [linjer, setLinjer] = useState(lesKurv);
  const [konto, setKonto] = useState({ kunde: null, kreditt_ore: 0, google: false, lastet: false });

  useEffect(() => {
    try {
      localStorage.setItem(LAGER, JSON.stringify(linjer));
    } catch {
      // Privat vindu eller full lagring: kurven lever da bare til fanen lukkes.
    }
  }, [linjer]);

  const oppdaterKonto = useCallback(async () => {
    try {
      const r = await kapi.meg();
      setKonto({ ...r, lastet: true });
      return r.kunde;
    } catch {
      setKonto((k) => ({ ...k, lastet: true }));
      return null;
    }
  }, []);
  useEffect(() => {
    oppdaterKonto();
  }, []);

  const verdi = useMemo(() => {
    const legg = (vare, antall = 1) =>
      setLinjer((ls) => {
        const k = nøkkel(vare);
        const før = ls.find((l) => nøkkel(l) === k);
        const maks = vare.maks ?? før?.maks ?? 99;
        if (før) return ls.map((l) => (nøkkel(l) === k ? { ...l, ...vare, antall: Math.min(maks, l.antall + antall) } : l));
        return [...ls, { ...vare, antall: Math.min(maks, antall) }];
      });
    return {
      linjer,
      antall: linjer.reduce((n, l) => n + l.antall, 0),
      legg,
      settAntall: (k, antall) =>
        setLinjer((ls) => (antall > 0 ? ls.map((l) => (nøkkel(l) === k ? { ...l, antall } : l)) : ls.filter((l) => nøkkel(l) !== k))),
      fjern: (k) => setLinjer((ls) => ls.filter((l) => nøkkel(l) !== k)),
      tøm: () => setLinjer([]),
      iKurven: (v) => linjer.find((l) => nøkkel(l) === nøkkel(v))?.antall || 0,
      ...konto,
      oppdaterKonto,
    };
  }, [linjer, konto, oppdaterKonto]);

  return <Handel.Provider value={verdi}>{children}</Handel.Provider>;
}

// ── knappen i lista og på kortsiden ─────────────────────────────────────────
export function LeggIKurven({ kort, finish, tilstand, liten, stil }) {
  const h = useHandel();
  const [lagt, setLagt] = useState(false);
  const vare = {
    card_id: kort.id,
    finish,
    condition: tilstand.condition,
    navn: kort.name,
    set_name: kort.set_name,
    collector_number: kort.collector_number,
    image_uri: kort.image_uri,
    enhet_ore: tilstand.ore,
    maks: tilstand.lager,
  };
  const har = h.iKurven(vare);
  const fullt = har >= tilstand.lager;
  if (!tilstand.lager) {
    return liten ? <span className="dempet" style={{ fontSize: 13 }}>Utsolgt</span> : (
      <button className={`knapp ${liten ? "liten" : "primar"}`} style={stil} disabled>Utsolgt</button>
    );
  }
  return (
    <button
      className={`knapp ${liten ? "liten" : "primar"}`}
      style={stil}
      disabled={fullt}
      title={fullt ? `Du har alle ${tilstand.lager} i kurven` : undefined}
      onClick={() => {
        h.legg(vare, 1);
        setLagt(true);
        setTimeout(() => setLagt(false), 1400);
      }}
    >
      {lagt ? "Lagt i kurven ✓" : fullt ? `${har} i kurven` : har ? `Legg i kurven (${har})` : "Legg i kurven"}
    </button>
  );
}

// Sealed og komplette sett: én pris, ingen tilstand. card_id er «p:<id>».
export function LeggProduktIKurven({ produkt: p }) {
  const h = useHandel();
  const [lagt, setLagt] = useState(false);
  const vare = {
    card_id: `p:${p.id}`, finish: "nonfoil", condition: "NM", navn: p.navn,
    set_name: p.type === "komplettsett" ? "Komplette sett" : "Sealed",
    image_uri: p.bilde_url, enhet_ore: p.pris_ore, maks: p.antall,
  };
  const har = h.iKurven(vare);
  if (!p.antall) return <button className="knapp liten" disabled>Utsolgt</button>;
  const fullt = har >= p.antall;
  return (
    <button
      className="knapp liten primar"
      disabled={fullt}
      onClick={() => { h.legg(vare, 1); setLagt(true); setTimeout(() => setLagt(false), 1400); }}
    >
      {lagt ? "Lagt i kurven ✓" : fullt ? `${har} i kurven` : har ? `Legg i kurven (${har})` : "Legg i kurven"}
    </button>
  );
}

const finishTekst = (f) => (f === "foil" ? " · foil" : "");

// ── kurven ──────────────────────────────────────────────────────────────────
export function KurvSide({ onKasse, onHandleVidere, melding }) {
  const h = useHandel();
  const [priset, setPriset] = useState(null);
  const [feil, setFeil] = useState("");

  // Prisen og beholdningen hentes fra serveren hver gang kurven endres. Det
  // som står lagret i nettleseren kan være dager gammelt.
  useEffect(() => {
    if (!h.linjer.length) return setPriset([]);
    let avbrutt = false;
    kapi
      .kurv(h.linjer.map(({ card_id, finish, condition, antall }) => ({ card_id, finish, condition, antall })))
      .then((r) => !avbrutt && setPriset(r.linjer))
      .catch((e) => !avbrutt && setFeil(e.message));
    return () => {
      avbrutt = true;
    };
  }, [h.linjer]);

  if (!h.linjer.length) {
    return (
      <div className="panel">
        <div className="krop">
          <h2 style={{ marginTop: 0 }}>Handlekurven er tom</h2>
          {melding && <p>{melding}</p>}
          <p className="dempet">Søk etter kort øverst, eller bla i settene.</p>
          <button className="knapp primar" onClick={onHandleVidere}>Til butikken</button>
        </div>
      </div>
    );
  }
  if (!priset) return <p className="dempet">Henter priser…</p>;

  const sum = priset.reduce((n, l) => n + l.enhet_ore * Math.min(l.antall, l.tilgjengelig), 0);
  const problemer = priset.filter((l) => l.feil);
  const antall = priset.reduce((n, l) => n + l.antall, 0);

  return (
    <>
      <h1 style={{ marginBottom: 12 }}>Handlekurv</h1>
      {melding && <div className="varsel ok" style={{ marginBottom: 12 }}>{melding}</div>}
      {feil && <div className="varsel feil">{feil}</div>}
      {problemer.length > 0 && (
        <div className="panel" style={{ borderColor: "var(--feil)", marginBottom: 14 }}>
          <div className="krop rad-flex">
            <span>
              {problemer.length === 1 ? "Ett kort" : `${problemer.length} kort`} i kurven er ikke tilgjengelig i det
              antallet du har valgt.
            </span>
            <button
              className="knapp liten"
              style={{ marginLeft: "auto" }}
              onClick={() => {
                for (const l of problemer) h.settAntall(nøkkel(l), l.enhet_ore ? l.tilgjengelig : 0);
              }}
            >
              Juster kurven
            </button>
          </div>
        </div>
      )}
      <div className="panel">
        <table>
          <thead>
            <tr>
              <th style={{ width: 56 }} />
              <th>Kort</th>
              <th>Tilstand</th>
              <th className="h">Pris</th>
              <th className="h">Antall</th>
              <th className="h">Sum</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {priset.map((l) => {
              const k = nøkkel(l);
              const valg = Math.max(l.antall, l.tilgjengelig, 1);
              return (
                <tr key={k}>
                  <td>
                    {l.image_uri ? (
                      <img src={l.image_uri} alt="" style={{ width: 44, borderRadius: 3, display: "block" }} />
                    ) : l.produkt_type === "komplettsett" && l.set_code ? (
                      <div style={{ width: 44 }}><SettStabel setCode={l.set_code} foil={l.foil} liten /></div>
                    ) : null}
                  </td>
                  <td>
                    <div style={{ fontWeight: 600 }} className="lenke">{l.card_name}</div>
                    <div className="dempet" style={{ fontSize: 12.5 }}>
                      {l.set_name}
                      {l.collector_number ? ` #${l.collector_number}` : ""}
                      {l.produkt ? (l.foil ? " · foil" : "") : finishTekst(l.finish)}
                    </div>
                    {l.feil && <div style={{ color: "var(--feil)", fontSize: 12.5 }}>{l.feil}</div>}
                  </td>
                  <td>{l.produkt ? <span className="dempet">—</span> : l.condition}</td>
                  <td className="h tall pris">{kroner(l.enhet_ore)}</td>
                  <td className="h">
                    <select value={l.antall} onChange={(e) => h.settAntall(k, Number(e.target.value))}>
                      {Array.from({ length: Math.min(99, valg) }, (_, i) => i + 1).map((n) => (
                        <option key={n} value={n} disabled={n > l.tilgjengelig}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="h tall">{kroner(l.enhet_ore * l.antall)}</td>
                  <td className="h">
                    <button className="knapp liten" onClick={() => h.fjern(k)} title="Fjern fra kurven">
                      Fjern
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="rad-flex" style={{ justifyContent: "flex-end", gap: 18, marginTop: 6 }}>
        <span className="dempet">{antall} {priset.some((l) => l.produkt) ? (antall === 1 ? "vare" : "varer") : "kort"} · frakt velges i kassen</span>
        <span className="tall pris-stor">{kroner(sum)}</span>
      </div>
      <div className="rad-flex" style={{ justifyContent: "flex-end", marginTop: 12 }}>
        <button className="knapp" onClick={onHandleVidere}>Handle videre</button>
        <button className="knapp primar" disabled={problemer.length > 0} onClick={onKasse}>
          Til kassen
        </button>
      </div>
    </>
  );
}

// ── kassen ──────────────────────────────────────────────────────────────────
const tomAdresse = { navn: "", email: "", telefon: "", adresse: "", postnr: "", poststed: "", land: "NO" };

export function Kasse({ onTilbake, onKvittering, onLoggInn }) {
  const h = useHandel();
  const [oppsett, setOppsett] = useState(null);
  const [priset, setPriset] = useState(null);
  const [a, setA] = useState(tomAdresse);
  const [frakt, setFrakt] = useState(null);
  const [brukKreditt, setBrukKreditt] = useState(true);
  // Rabattkoden: det kunden skriver, og det serveren sa om den.
  const [kodeFelt, setKodeFelt] = useState("");
  const [kode, setKode] = useState(null);
  const [kodeFeil, setKodeFeil] = useState("");
  const [sjekker, setSjekker] = useState(false);
  const [husk, setHusk] = useState(true);
  const [notat, setNotat] = useState("");
  const [vilkår, setVilkår] = useState(false);
  const [sender, setSender] = useState(false);
  const [feil, setFeil] = useState("");

  useEffect(() => {
    kapi.oppsett().then((o) => {
      setOppsett(o);
      setFrakt((f) => f ?? o.frakt[0]?.id ?? null);
    }).catch((e) => setFeil(e.message));
  }, []);

  useEffect(() => {
    if (!h.linjer.length) return;
    kapi
      .kurv(h.linjer.map(({ card_id, finish, condition, antall }) => ({ card_id, finish, condition, antall })))
      .then((r) => setPriset(r.linjer))
      .catch((e) => setFeil(e.message));
  }, [h.linjer]);

  // Innlogget: adressen fra profilen. Kunden kan endre den for denne ordren.
  useEffect(() => {
    const k = h.kunde;
    if (!k) return;
    setA((x) => ({
      navn: x.navn || k.navn || "",
      email: k.email,
      telefon: x.telefon || k.telefon || "",
      adresse: x.adresse || k.adresse || "",
      postnr: x.postnr || k.postnr || "",
      poststed: x.poststed || k.poststed || "",
      land: k.land || "NO",
    }));
  }, [h.kunde]);

  if (!h.linjer.length) {
    return (
      <div className="panel"><div className="krop">
        <p>Handlekurven er tom.</p>
        <button className="knapp" onClick={onTilbake}>Tilbake</button>
      </div></div>
    );
  }
  if (!oppsett || !priset) return <p className="dempet">Henter kassen…</p>;

  const valgtFrakt = oppsett.frakt.find((f) => f.id === frakt);
  // Henter kunden selv, er adressen valgfri.
  const henter = /\bhent/i.test(valgtFrakt?.navn || "");
  const varer = priset.reduce((n, l) => n + l.enhet_ore * l.antall, 0);
  const totalt = varer + (valgtFrakt?.pris_ore || 0);
  const harKreditt = !!(h.kunde?.bekreftet && h.kreditt_ore > 0);
  // Samme rekkefølge som serveren: prosent av kortene, så gavekort, så
  // kreditt, og resten med kort. Stripe tar ikke beløp under 3 kr, så da
  // brukes litt mindre kreditt (og om nødvendig gavekort).
  const rabatt = kode?.type === "prosent" ? Math.round((varer * kode.prosent) / 100) : 0;
  const sum = totalt - rabatt;
  let gavekort = kode?.type === "saldo" ? Math.min(kode.tilgjengelig_ore, sum) : 0;
  let kreditt = harKreditt && brukKreditt ? Math.min(h.kreditt_ore, sum - gavekort) : 0;
  let rest = sum - gavekort - kreditt;
  if (rest > 0 && rest < 300 && kreditt + gavekort > 0) {
    let mangler = 300 - rest;
    const k1 = Math.min(kreditt, mangler); kreditt -= k1; mangler -= k1;
    gavekort -= Math.min(gavekort, mangler);
    rest = sum - gavekort - kreditt;
  }
  const åBetale = rest;

  async function brukKode(e) {
    e?.preventDefault?.();
    if (!kodeFelt.trim()) return;
    setSjekker(true);
    setKodeFeil("");
    try {
      setKode(await kapi.rabattkode(kodeFelt.trim()));
    } catch (err) {
      setKode(null);
      setKodeFeil(err.message);
    }
    setSjekker(false);
  }
  const problemer = priset.some((l) => l.feil);
  const felt = (navn) => ({ value: a[navn], onChange: (e) => setA({ ...a, [navn]: e.target.value }) });

  async function betal(e) {
    e.preventDefault();
    setFeil("");
    setSender(true);
    try {
      if (h.kunde && husk) {
        const { email, ...profil } = a;
        await kapi.profil(profil).catch(() => {});
      }
      const r = await kapi.kasse({
        ...a,
        linjer: h.linjer.map(({ card_id, finish, condition, antall }) => ({ card_id, finish, condition, antall })),
        frakt_id: frakt,
        bruk_kreditt: harKreditt && brukKreditt,
        rabattkode: kode?.kode || "",
        notat,
        vilkar: vilkår,
      });
      if (r.url) {
        window.location.assign(r.url);
        return;
      }
      onKvittering(r.ordrenr, r.merke);
    } catch (e) {
      setFeil(e.message);
      if (e.data?.linjer) setPriset(e.data.linjer);
      setSender(false);
    }
  }

  return (
    <form onSubmit={betal}>
      <button type="button" className="knapp liten" style={{ marginBottom: 12 }} onClick={onTilbake}>
        ← Tilbake til kurven
      </button>
      <h1 style={{ marginBottom: 12 }}>Kasse</h1>
      {feil && <div className="varsel feil">{feil}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 320px", gap: 18, alignItems: "start" }}>
        <div>
          <div className="panel">
            <header><h3>Levering</h3></header>
            <div className="krop skjema">
              <label>Navn<input required autoComplete="name" {...felt("navn")} /></label>
              <label>
                E-post
                <input required type="email" autoComplete="email" {...felt("email")} disabled={!!h.kunde} />
              </label>
              <label>Telefon<input type="tel" autoComplete="tel" {...felt("telefon")} /></label>
              <label>Adresse<input required={!henter} autoComplete="street-address" {...felt("adresse")} /></label>
              <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 10 }}>
                <label>Postnr.<input required={!henter} autoComplete="postal-code" {...felt("postnr")} /></label>
                <label>Poststed<input required={!henter} autoComplete="address-level2" {...felt("poststed")} /></label>
              </div>
              {h.kunde && (
                <label className="rad-flex" style={{ gap: 8 }}>
                  <input type="checkbox" checked={husk} onChange={(e) => setHusk(e.target.checked)} />
                  Lagre adressen på kontoen min
                </label>
              )}
            </div>
          </div>

          <div className="panel">
            <header><h3>Frakt</h3></header>
            <div className="krop">
              {oppsett.frakt.map((f) => (
                <label key={f.id} className="rad-flex" style={{ gap: 10, padding: "6px 0", alignItems: "flex-start" }}>
                  <input type="radio" name="frakt" checked={frakt === f.id} onChange={() => setFrakt(f.id)} />
                  <span style={{ flex: 1 }}>
                    <b>{f.navn}</b> — {kroner(f.pris_ore)}
                    <div className="dempet" style={{ fontSize: 12.5 }}>
                      {/\bhent/i.test(f.navn)
                        ? "Du henter selv — vi sender e-post når ordren er klar"
                        : f.forsikret_ore === null ? "Uten sporing og forsikring" : `Sporing, forsikret inntil ${kroner(f.forsikret_ore)}`}
                      {f.beskrivelse ? ` · ${f.beskrivelse}` : ""}
                    </div>
                  </span>
                </label>
              ))}
              {valgtFrakt && valgtFrakt.forsikret_ore !== null && varer > valgtFrakt.forsikret_ore && (
                <p style={{ fontSize: 13, color: "var(--advarsel)", margin: "6px 0 0" }}>
                  Ordren er verdt mer enn {valgtFrakt.navn.toLowerCase()} er forsikret for.
                </p>
              )}
            </div>
          </div>

          <div className="panel">
            <header><h3>Kommentar</h3></header>
            <div className="krop">
              <textarea rows={2} value={notat} onChange={(e) => setNotat(e.target.value)} placeholder="Valgfritt" />
            </div>
          </div>
        </div>

        <div className="panel" style={{ position: "sticky", top: 12 }}>
          <header><h3>Oppsummering</h3></header>
          <div className="krop">
            {harKreditt && (
              <label className={`kreditt-boks${brukKreditt ? " valgt" : ""}`}>
                <input type="checkbox" checked={brukKreditt} onChange={(e) => setBrukKreditt(e.target.checked)} />
                <span>
                  <b>Bruk kreditt</b>
                  <span className="kreditt-saldo">{kroner(h.kreditt_ore)} tilgjengelig</span>
                  {brukKreditt && kreditt > 0 && (
                    <span className="kreditt-info">
                      {kroner(kreditt)} trekkes fra denne ordren
                      {h.kreditt_ore - kreditt > 0 ? ` · ${kroner(h.kreditt_ore - kreditt)} igjen etterpå` : ""}
                    </span>
                  )}
                </span>
              </label>
            )}
            {h.kunde && !h.kunde.bekreftet && (
              <div className="kreditt-boks">
                <span>
                  <b>Har du kreditt?</b>
                  <span className="kreditt-info">Bekreft e-postadressen din med lenken vi sendte, så kan du bruke den her.</span>
                </span>
              </div>
            )}
            {!h.kunde && (
              <div className="kreditt-boks">
                <span>
                  <b>Har du kreditt?</b>
                  <span className="kreditt-info">Logg inn for å bruke den. Ordren havner også under «Min side».</span>
                  <button type="button" className="knapp liten" style={{ marginTop: 8 }} onClick={onLoggInn}>
                    Logg inn
                  </button>
                </span>
              </div>
            )}
            <table>
              <tbody>
                <tr><td>Kort ({priset.reduce((n, l) => n + l.antall, 0)})</td><td className="h tall">{kroner(varer)}</td></tr>
                {rabatt > 0 && (
                  <tr><td>Rabatt {kode.prosent} % <span className="dempet">({kode.kode})</span></td><td className="h tall">−{kroner(rabatt)}</td></tr>
                )}
                <tr>
                  <td>
                    Frakt
                    {valgtFrakt && valgtFrakt.pris_ore > 0 && (
                      <div className="dempet" style={{ fontSize: 12 }}>herav mva {kroner(Math.round(valgtFrakt.pris_ore / 5))}</div>
                    )}
                  </td>
                  <td className="h tall">{valgtFrakt ? kroner(valgtFrakt.pris_ore) : "—"}</td>
                </tr>
                {gavekort > 0 && (
                  <tr><td>Gavekort <span className="dempet">({kode.kode})</span></td><td className="h tall">−{kroner(gavekort)}</td></tr>
                )}
                {kreditt > 0 && (
                  <tr><td>Kreditt</td><td className="h tall">−{kroner(kreditt)}</td></tr>
                )}
                <tr>
                  <td><b>Å betale</b></td>
                  <td className="h tall pris-stor" style={{ fontSize: 20 }}>{kroner(åBetale)}</td>
                </tr>
              </tbody>
            </table>
            <div className="rabattkode">
              {kode ? (
                <div className="rad-flex" style={{ gap: 8 }}>
                  <span className="merkelapp m-ok">{kode.kode}</span>
                  <span style={{ fontSize: 13 }}>
                    {kode.type === "prosent"
                      ? `${kode.prosent} % rabatt på kortene`
                      : `Gavekort, ${kroner(kode.tilgjengelig_ore)} tilgjengelig`}
                  </span>
                  <button type="button" className="lenke" style={{ marginLeft: "auto", fontSize: 13 }} onClick={() => { setKode(null); setKodeFelt(""); }}>
                    Fjern
                  </button>
                </div>
              ) : (
                <>
                  <div className="rad-flex" style={{ gap: 6 }}>
                    <input
                      value={kodeFelt}
                      onChange={(e) => setKodeFelt(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") brukKode(e); }}
                      placeholder="Rabattkode eller gavekort"
                      aria-label="Rabattkode"
                      style={{ flex: 1, minWidth: 0, textTransform: "uppercase" }}
                    />
                    <button type="button" className="knapp" disabled={sjekker || !kodeFelt.trim()} onClick={brukKode}>
                      {sjekker ? "…" : "Bruk"}
                    </button>
                  </div>
                  {kodeFeil && <div style={{ color: "var(--feil)", fontSize: 12.5, marginTop: 4 }}>{kodeFeil}</div>}
                </>
              )}
            </div>
            <label className="rad-flex" style={{ gap: 8, margin: "12px 0", fontSize: 13.5, alignItems: "flex-start" }}>
              <input type="checkbox" checked={vilkår} onChange={(e) => setVilkår(e.target.checked)} />
              <span>
                Jeg godtar <a href="?side=vilkar" target="_blank" rel="noopener">kjøpsvilkårene</a> og har lest om{" "}
                <a href="?side=retur" target="_blank" rel="noopener">angrerett</a>.
              </span>
            </label>
            <button
              type="submit"
              className="knapp primar"
              style={{ width: "100%" }}
              disabled={sender || problemer || !frakt || !vilkår || (åBetale > 0 && !oppsett.betaling)}
            >
              {sender ? "Et øyeblikk…" : åBetale > 0 ? `Til betaling — ${kroner(åBetale)}` : gavekort > 0 && !kreditt ? "Fullfør med gavekort" : "Fullfør med kreditt"}
            </button>
            {åBetale > 0 && !oppsett.betaling && (
              <p className="dempet" style={{ fontSize: 12.5 }}>Kortbetaling er ikke slått på ennå.</p>
            )}
            <p className="dempet" style={{ fontSize: 12, margin: "10px 0 0" }}>
              Kortene holdes av i {oppsett.reservasjon_min} minutter mens du betaler. Du betaler med kort eller Vipps
              på Stripes sikre betalingsside.
            </p>
          </div>
        </div>
      </div>
    </form>
  );
}

// ── kvitteringen ────────────────────────────────────────────────────────────
const STATUS = {
  apen: "Venter på betaling",
  betalt: "Betalt — pakkes",
  pakket: "Pakket",
  sendt: "Sendt",
  kansellert: "Kansellert",
  utlopt: "Ikke fullført",
};

export function Kvittering({ nr, merke, onFerdig }) {
  const h = useHandel();
  const [o, setO] = useState(null);
  const [feil, setFeil] = useState("");
  const [forsøk, setForsøk] = useState(0);

  // Stripe sender kunden tilbake før webhooken nødvendigvis har kommet. Da
  // står ordren som åpen et par sekunder; vi spør igjen til den er betalt.
  useEffect(() => {
    let t;
    kapi
      .kvittering(nr, merke)
      .then((r) => {
        setO(r.ordre);
        if (r.ordre.status === "apen" && forsøk < 20) t = setTimeout(() => setForsøk((n) => n + 1), 2000);
        if (["betalt", "pakket", "sendt"].includes(r.ordre.status)) {
          h.tøm();
          h.oppdaterKonto();
        }
      })
      .catch((e) => setFeil(e.message));
    return () => clearTimeout(t);
  }, [nr, merke, forsøk]);

  if (feil) return <div className="varsel feil">{feil}</div>;
  if (!o) return <p className="dempet">Henter ordren…</p>;

  const betalt = ["betalt", "pakket", "sendt"].includes(o.status);
  return (
    <div className="panel">
      <div className="krop">
        <h1 style={{ marginTop: 0 }}>{betalt ? "Takk for bestillingen!" : STATUS[o.status]}</h1>
        {betalt ? (
          <p>
            Ordre <b>{o.ordrenr}</b> er betalt. Bekreftelsen er sendt til <b>{o.email}</b>, og du får en ny
            e-post når pakken er sendt.
          </p>
        ) : o.status === "apen" ? (
          <p className="dempet">Venter på bekreftelse fra betalingen…</p>
        ) : (
          <p>Betalingen ble ikke fullført, og ingenting er trukket. Kortene ligger fortsatt i handlekurven din.</p>
        )}
        <OrdreLinjer o={o} />
        <button className="knapp primar" onClick={onFerdig}>Til butikken</button>
      </div>
    </div>
  );
}

function OrdreLinjer({ o }) {
  return (
    <>
      <table style={{ margin: "12px 0" }}>
        <thead>
          <tr><th>Kort</th><th>Tilstand</th><th className="h">Antall</th><th className="h">Sum</th></tr>
        </thead>
        <tbody>
          {o.linjer.map((l) => (
            <tr key={l.id}>
              <td>
                {l.card_name}
                <span className="dempet" style={{ fontSize: 12.5 }}>
                  {" — "}{l.set_name}{l.collector_number ? ` #${l.collector_number}` : ""}{l.utgave ? ` · ${l.utgave}` : ""}{finishTekst(l.finish)}
                </span>
              </td>
              <td>{l.produkt ? "—" : l.condition}</td>
              <td className="h">{l.antall}</td>
              <td className="h tall">{kroner(l.enhet_ore * l.antall)}</td>
            </tr>
          ))}
          {Number(o.rabatt_ore) > 0 && (
            <tr><td colSpan={3}>Rabatt ({o.rabattkode})</td><td className="h tall">−{kroner(o.rabatt_ore)}</td></tr>
          )}
          <tr><td colSpan={3}>Frakt: {o.frakt_navn}</td><td className="h tall">{kroner(o.frakt_ore)}</td></tr>
          {Number(o.gavekort_ore) > 0 && (
            <tr><td colSpan={3}>Betalt med gavekort ({o.rabattkode})</td><td className="h tall">{kroner(o.gavekort_ore)}</td></tr>
          )}
          {Number(o.kreditt_ore) > 0 && (
            <tr><td colSpan={3}>Betalt med kreditt</td><td className="h tall">{kroner(o.kreditt_ore)}</td></tr>
          )}
          {Number(o.stripe_ore) > 0 && (
            <tr><td colSpan={3}>Betalt med kort/Vipps</td><td className="h tall">{kroner(o.stripe_ore)}</td></tr>
          )}
          <tr>
            <td colSpan={3}><b>Totalt</b></td>
            <td className="h tall"><b>{kroner(Number(o.varer_ore) - (Number(o.rabatt_ore) || 0) + Number(o.frakt_ore))}</b></td>
          </tr>
        </tbody>
      </table>
      <div className="dempet" style={{ fontSize: 13, marginBottom: 14, whiteSpace: "pre-line" }}>
        Sendes til: {[o.kunde_navn, o.adresse, `${o.postnr || ""} ${o.poststed || ""}`].filter(Boolean).join(", ")}
      </div>
    </>
  );
}

// ── innlogging ──────────────────────────────────────────────────────────────
export function LoggInn({ onInne, startmodus = "inn" }) {
  const h = useHandel();
  const [modus, setModus] = useState(startmodus);
  const [email, setEmail] = useState("");
  const [passord, setPassord] = useState("");
  const [navn, setNavn] = useState("");
  const [feil, setFeil] = useState("");
  const [melding, setMelding] = useState("");
  const [sender, setSender] = useState(false);
  const [overgang, setOvergang] = useState("");

  useEffect(() => {
    kapi.oppsett().then((o) => setOvergang(o.overgang_dato || "")).catch(() => {});
  }, []);

  async function send(e) {
    e.preventDefault();
    setFeil("");
    setMelding("");
    setSender(true);
    try {
      if (modus === "inn") await kapi.loggInn(email, passord);
      else if (modus === "ny") await kapi.registrer({ email, passord, navn });
      else {
        await kapi.glemt(email);
        setMelding("Finnes det en konto eller ordre på adressen, har vi sendt en lenke for å lage nytt passord. Sjekk innboksen (og søppelposten).");
        setSender(false);
        return;
      }
      await h.oppdaterKonto();
      onInne?.();
    } catch (e) {
      setFeil(e.message);
    }
    setSender(false);
  }

  return (
    <div className="panel" style={{ maxWidth: 420, margin: "10px auto" }}>
      <header><h3>{modus === "inn" ? "Logg inn" : modus === "ny" ? "Ny konto" : "Velg nytt passord"}</h3></header>
      <form className="krop skjema" onSubmit={send}>
        {overgang && modus !== "glemt" && (
          <div className="varsel info" style={{ fontSize: 13.5 }}>
            <Overgangstekst dato={overgang} />
          </div>
        )}
        {modus === "glemt" && (
          <p className="dempet" style={{ margin: 0, fontSize: 13.5 }}>
            Skriv e-postadressen din, så sender vi en lenke der du velger passord. Det gjelder også
            første gang du logger inn i den nye butikken.
          </p>
        )}
        {feil && <div className="varsel feil">{feil}</div>}
        {melding && <div className="varsel ok">{melding}</div>}
        {modus === "ny" && <label>Navn<input autoComplete="name" value={navn} onChange={(e) => setNavn(e.target.value)} /></label>}
        <label>
          E-post
          <input required type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        {modus !== "glemt" && (
          <label>
            Passord
            <input
              required
              type="password"
              minLength={modus === "ny" ? 8 : undefined}
              autoComplete={modus === "ny" ? "new-password" : "current-password"}
              value={passord}
              onChange={(e) => setPassord(e.target.value)}
            />
            {modus === "ny" && <span className="dempet" style={{ fontSize: 12 }}>Minst 8 tegn.</span>}
          </label>
        )}
        <button className="knapp primar" disabled={sender} style={{ width: "100%" }}>
          {modus === "inn" ? "Logg inn" : modus === "ny" ? "Lag konto" : "Send lenke"}
        </button>

        {h.google && modus !== "glemt" && (
          <a className="knapp" href={kapi.googleUrl()} style={{ display: "block", textAlign: "center", marginTop: 10, textDecoration: "none" }}>
            Fortsett med Google
          </a>
        )}

        <div className="rad-flex" style={{ justifyContent: "space-between", marginTop: 14, fontSize: 13.5 }}>
          {modus !== "inn" && <button type="button" className="lenke" onClick={() => setModus("inn")}>Har konto? Logg inn</button>}
          {modus !== "ny" && <button type="button" className="lenke" onClick={() => setModus("ny")}>Lag ny konto</button>}
          {modus !== "glemt" && (
            <button type="button" className="lenke" onClick={() => setModus("glemt")}>
              {overgang ? "Første gang her? / Glemt passord" : "Glemt passord?"}
            </button>
          )}
        </div>
        {modus === "ny" && (
          <p className="dempet" style={{ fontSize: 12.5, marginBottom: 0 }}>
            Har du solgt kort til Korthaien før? Bruk «Glemt passord» med samme e-postadresse, så følger
            kreditten og historikken din med.
          </p>
        )}
      </form>
    </div>
  );
}

// Lenken fra bekreftelses-e-posten.
export function Bekreft({ token, onFerdig }) {
  const h = useHandel();
  const [svar, setSvar] = useState(null);
  useEffect(() => {
    kapi
      .bekreft(token)
      .then(() => { setSvar({ ok: true }); h.oppdaterKonto(); })
      .catch((e) => setSvar({ ok: false, feil: e.message }));
  }, [token]);
  if (!svar) return <p className="dempet">Bekrefter…</p>;
  return (
    <div className="panel" style={{ maxWidth: 460, margin: "10px auto" }}>
      <div className="krop">
        <h2 style={{ marginTop: 0 }}>{svar.ok ? "E-postadressen er bekreftet" : "Lenken virket ikke"}</h2>
        <p>{svar.ok ? "Kreditten og ordrene på adressen følger nå kontoen din." : svar.feil}</p>
        <button className="knapp primar" onClick={onFerdig}>Til kontoen</button>
      </div>
    </div>
  );
}

function IkkeBekreftet() {
  const [sendt, setSendt] = useState(false);
  return (
    <div className="varsel" style={{ borderColor: "var(--advarsel)", color: "var(--blekk)" }}>
      Bekreft e-postadressen din med lenken vi sendte. Til den er bekreftet, vises ikke kreditten og
      tidligere ordrer på adressen her.{" "}
      {sendt ? (
        <b>Ny lenke er sendt.</b>
      ) : (
        <button className="lenke" onClick={() => kapi.sendBekreftelse().then(() => setSendt(true)).catch(() => {})}>
          Send lenken på nytt
        </button>
      )}
    </div>
  );
}

export function NyttPassord({ token, onFerdig }) {
  const h = useHandel();
  const [passord, setPassord] = useState("");
  const [feil, setFeil] = useState("");
  return (
    <div className="panel" style={{ maxWidth: 420, margin: "10px auto" }}>
      <header><h3>Velg nytt passord</h3></header>
      <form
        className="krop skjema"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await kapi.nyttPassord(token, passord);
            await h.oppdaterKonto();
            onFerdig();
          } catch (e) {
            setFeil(e.message);
          }
        }}
      >
        {feil && <div className="varsel feil">{feil}</div>}
        <label>
          Nytt passord
          <input required type="password" minLength={8} autoComplete="new-password" value={passord} onChange={(e) => setPassord(e.target.value)} />
        </label>
        <button className="knapp primar" style={{ width: "100%" }}>Lagre og logg inn</button>
      </form>
    </div>
  );
}

// ── min side ────────────────────────────────────────────────────────────────
const SIDEFANER = [
  { id: "ordrer", navn: "Ordrer" },
  { id: "onskeliste", navn: "Ønskeliste" },
  { id: "kreditt", navn: "Kreditt" },
  { id: "profil", navn: "Profil" },
];

export function MinSide({ onUt, startfane = "ordrer" }) {
  const h = useHandel();
  const [fane, setFane] = useState(startfane);
  useEffect(() => setFane(startfane), [startfane]);
  const [åpen, setÅpen] = useState(null);

  return (
    <>
      <div className="rad-flex" style={{ marginBottom: 6 }}>
        <h1 style={{ margin: 0 }}>Min side</h1>
        <span className="dempet">{h.kunde.navn || h.kunde.email}</span>
        <button
          className="knapp liten"
          style={{ marginLeft: "auto" }}
          onClick={async () => {
            await kapi.loggUt().catch(() => {});
            await h.oppdaterKonto();
            onUt();
          }}
        >
          Logg ut
        </button>
      </div>
      {!h.kunde.bekreftet && <IkkeBekreftet />}
      <div className="faner" role="tablist" style={{ margin: "10px 0 16px" }}>
        {SIDEFANER.map((f) => (
          <button key={f.id} role="tab" aria-selected={fane === f.id} onClick={() => { setFane(f.id); setÅpen(null); }}>
            {f.navn}
          </button>
        ))}
      </div>
      {fane === "ordrer" && (åpen ? <KundeOrdre nr={åpen} onLukk={() => setÅpen(null)} /> : <KundeOrdrer onÅpne={setÅpen} />)}
      {fane === "onskeliste" && <Ønskeliste />}
      {fane === "kreditt" && <KundeKreditt />}
      {fane === "profil" && <Profil />}
    </>
  );
}

function KundeOrdrer({ onÅpne }) {
  const [ordrer, setOrdrer] = useState(null);
  useEffect(() => {
    kapi.ordrer().then((r) => setOrdrer(r.ordrer)).catch(() => setOrdrer([]));
  }, []);
  if (!ordrer) return <p className="dempet">Henter…</p>;
  if (!ordrer.length) return <p className="dempet">Ingen ordrer ennå.</p>;
  return (
    <div className="panel">
      <table>
        <thead>
          <tr><th>Ordre</th><th>Dato</th><th>Status</th><th className="h">Kort</th><th className="h">Totalt</th></tr>
        </thead>
        <tbody>
          {ordrer.map((o) => (
            <tr key={o.ordrenr} style={{ cursor: "pointer" }} onClick={() => onÅpne(o.ordrenr)}>
              <td><button className="lenke">{o.ordrenr}</button></td>
              <td>{new Date(o.created_at).toLocaleDateString("nb-NO")}</td>
              <td>{STATUS[o.status] || o.status}{o.sporingsnr ? ` · ${o.sporingsnr}` : ""}</td>
              <td className="h">{o.antall_kort}</td>
              <td className="h tall">{kroner(Number(o.varer_ore) + Number(o.frakt_ore))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function KundeOrdre({ nr, onLukk }) {
  const [o, setO] = useState(null);
  useEffect(() => {
    kapi.ordre(nr).then((r) => setO(r.ordre)).catch(() => onLukk());
  }, [nr]);
  if (!o) return <p className="dempet">Henter…</p>;
  return (
    <div className="panel">
      <div className="krop">
        <button className="knapp liten" onClick={onLukk}>← Alle ordrer</button>
        <h2 style={{ marginBottom: 2 }}>Ordre {o.ordrenr}</h2>
        <div className="dempet">
          {new Date(o.created_at).toLocaleString("nb-NO")} · {STATUS[o.status] || o.status}
          {o.sendt_at ? ` ${new Date(o.sendt_at).toLocaleDateString("nb-NO")}` : ""}
        </div>
        {o.sporingsnr && (
          <p>
            Sporingsnummer:{" "}
            <a href={`https://sporing.posten.no/sporing/${encodeURIComponent(o.sporingsnr)}`} target="_blank" rel="noreferrer">
              {o.sporingsnr}
            </a>
          </p>
        )}
        <OrdreLinjer o={o} />
      </div>
    </div>
  );
}

const GRUNNER = {
  kjopsordre: "Oppgjør for kort du solgte",
  manuell: "Lagt inn av butikken",
  kjop: "Brukt i butikken",
  refusjon: "Refundert til kreditt",
  retting: "Retting",
};

function KundeKreditt() {
  const [k, setK] = useState(null);
  useEffect(() => {
    kapi.kreditt().then(setK).catch(() => setK({ tilgjengelig_ore: 0, bevegelser: [] }));
  }, []);
  if (!k) return <p className="dempet">Henter…</p>;
  if (k.bekreftet === false) {
    return <p className="dempet">Kreditten vises når e-postadressen er bekreftet.</p>;
  }
  return (
    <div className="panel">
      <div className="krop">
        <div className="dempet" style={{ fontSize: 13 }}>Tilgjengelig kreditt</div>
        <div className="tall pris-stor">{kroner(k.tilgjengelig_ore)}</div>
        <p className="dempet" style={{ fontSize: 13 }}>
          Kreditt utløper ikke, og kan brukes på hele ordren, også frakten. Saldoen er summen av linjene under.
        </p>
      </div>
      {k.bevegelser.length > 0 && (
        <table>
          <thead><tr><th>Dato</th><th>Hva</th><th className="h">Beløp</th></tr></thead>
          <tbody>
            {k.bevegelser.map((b) => (
              <tr key={b.id}>
                <td>{new Date(b.created_at).toLocaleDateString("nb-NO")}</td>
                <td>{GRUNNER[b.grunn] || b.grunn}{b.order_no ? ` · ${b.order_no}` : ""}</td>
                <td className="h tall" style={{ color: Number(b.ore) < 0 ? undefined : "var(--ok)" }}>
                  {Number(b.ore) > 0 ? "+" : ""}{kroner(b.ore)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function Profil() {
  const h = useHandel();
  const k = h.kunde;
  const [p, setP] = useState({
    navn: k.navn || "", telefon: k.telefon || "", adresse: k.adresse || "", postnr: k.postnr || "", poststed: k.poststed || "",
  });
  const [gammelt, setGammelt] = useState("");
  const [nytt, setNytt] = useState("");
  const [melding, setMelding] = useState("");
  const [feil, setFeil] = useState("");
  const felt = (n) => ({ value: p[n], onChange: (e) => setP({ ...p, [n]: e.target.value }) });

  return (
    <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", alignItems: "start" }}>
      <form
        className="panel"
        onSubmit={async (e) => {
          e.preventDefault();
          setFeil(""); setMelding("");
          try {
            await kapi.profil(p);
            await h.oppdaterKonto();
            setMelding("Lagret.");
          } catch (e) {
            setFeil(e.message);
          }
        }}
      >
        <header><h3>Adresse</h3></header>
        <div className="krop skjema">
          {melding && <div className="varsel ok">{melding}</div>}
          {feil && <div className="varsel feil">{feil}</div>}
          <label>E-post<input value={k.email} disabled /></label>
          <label>Navn<input autoComplete="name" {...felt("navn")} /></label>
          <label>Telefon<input type="tel" autoComplete="tel" {...felt("telefon")} /></label>
          <label>Adresse<input autoComplete="street-address" {...felt("adresse")} /></label>
          <div style={{ display: "grid", gridTemplateColumns: "110px 1fr", gap: 10 }}>
            <label>Postnr.<input autoComplete="postal-code" {...felt("postnr")} /></label>
            <label>Poststed<input autoComplete="address-level2" {...felt("poststed")} /></label>
          </div>
          <button className="knapp primar">Lagre</button>
        </div>
      </form>

      <form
        className="panel"
        onSubmit={async (e) => {
          e.preventDefault();
          setFeil(""); setMelding("");
          try {
            await kapi.passord(gammelt, nytt);
            setGammelt(""); setNytt("");
            setMelding("Passordet er endret.");
            await h.oppdaterKonto();
          } catch (e) {
            setFeil(e.message);
          }
        }}
      >
        <header><h3>{k.har_passord ? "Bytt passord" : "Lag passord"}</h3></header>
        <div className="krop skjema">
          {!k.har_passord && (
            <p className="dempet" style={{ marginTop: 0, fontSize: 13 }}>
              Du logger inn med Google. Med et passord kan du også logge inn uten.
            </p>
          )}
          {k.har_passord && (
            <label>Nåværende passord
              <input type="password" autoComplete="current-password" value={gammelt} onChange={(e) => setGammelt(e.target.value)} />
            </label>
          )}
          <label>Nytt passord
            <input type="password" minLength={8} autoComplete="new-password" value={nytt} onChange={(e) => setNytt(e.target.value)} />
          </label>
          <button className="knapp">Lagre passord</button>
        </div>
      </form>
    </div>
  );
}
