import { Ønske } from "./Onske.jsx";
import SettStabel from "./SettStabel.jsx";
import Bulksok from "./Bulksok.jsx";
import Tilstandsguide from "./Tilstandsguide.jsx";
import { useState, useEffect, useMemo, useRef } from "react";
import { api, kroner, CONDITIONS } from "../api.js";
import Bunn, { Kontakt, Frakt as Fraktside, Kreditt as Kredittside, OmOss, Retur, Tix, Vilkar, Personvern } from "./Bunn.jsx";
import { LeggProduktIKurven, HandelProvider, useHandel, LeggIKurven, KurvSide, Kasse, Kvittering, LoggInn, NyttPassord, MinSide, Bekreft } from "./Handel.jsx";
import { kunde as kapi, bildeUrl } from "../api.js";

// ─────────────────────────────────────────────────────────────────────────────
// BUTIKKVISNING
// ─────────────────────────────────────────────────────────────────────────────
// Forhåndsvisning av hvordan kundene vil se kortene. Ligger i admin inntil
// salgssiden bygges, og flyttes ut da.
//
// Hensikten er ikke pynt. Det er den eneste måten å oppdage at et intervall
// traff feil: prisene må stå ved siden av kortet, ikke i en tabell over regler.
//
// Sorteringen skjer på serveren, over hele settet. Sorterer man bare de kortene
// man allerede har hentet, får man den dyreste av de 25 første.

const FARGER = [
  { kode: "W", navn: "Hvit" },
  { kode: "U", navn: "Blå" },
  { kode: "B", navn: "Svart" },
  { kode: "R", navn: "Rød" },
  { kode: "G", navn: "Grønn" },
  { kode: "C", navn: "Fargeløs" },
];

const TYPER = ["Creature", "Instant", "Sorcery", "Artifact", "Enchantment", "Planeswalker", "Land"];

const SORTERING = [
  { id: "navn", navn: "Navn, A til Å" },
  { id: "navn_ned", navn: "Navn, Å til A" },
  { id: "pris_ned", navn: "Pris, høy til lav" },
  { id: "pris_opp", navn: "Pris, lav til høy" },
];

const RARITETER = ["mythic", "rare", "uncommon", "common", "special"];

// Rariteten er små bokstaver i dataene, men skal leses som en etikett ved
// siden av Hvit, Blå og Creature.
const stor = (s) => s.charAt(0).toUpperCase() + s.slice(1);

const TOMT = {
  q: "", rarity: [], farge: [], type: [],
  // «Bare disse fargene». Av som standard: «minst én av dem» er det folk
  // mener når de huker av hvit og blå.
  fargeEksakt: false,
  // Forsiden viser det du faktisk har. Et tomt skjermbilde forteller ingenting.
  baresalg: true, prisFra: "", prisTil: "",
};

// Kurven og kundekontoen deles av alle skjermene i butikken, så de ligger i
// en kontekst rundt hele siden.
export default function Butikk(props) {
  return (
    <HandelProvider>
      <ButikkSider {...props} />
    </HandelProvider>
  );
}

// Bare tilbake til våre egne sider — ellers kunne en lenke brukt innloggingen
// til å sende folk videre hvor som helst.
const TILBAKE = "korthaien-tilbake";
function trygtTilbake(url) {
  try {
    const u = new URL(url);
    if (u.hostname === "localhost") return true;
    return u.protocol === "https:" && (u.hostname === "korthaien.no" || u.hostname.endsWith(".korthaien.no"));
  } catch {
    return false;
  }
}
function hentTilbake() {
  try {
    const x = JSON.parse(localStorage.getItem(TILBAKE) || "null");
    if (x && Date.now() - x.t < 3 * 3600_000 && trygtTilbake(x.url)) return x.url;
  } catch {}
  return null;
}

// Lenkene tilbake fra Stripe, Google og «glemt passord»-e-posten lander på
// butikkens adresse med et spørsmål i URL-en. Det leses én gang og fjernes,
// så en oppdatering av siden ikke gjør det samme på nytt.
function lesLenke() {
  const p = new URLSearchParams(window.location.search);
  const ut = {
    kasse: p.get("kasse"),
    ordre: p.get("ordre"),
    m: p.get("m"),
    nyttpassord: p.get("nyttpassord"),
    innlogging: p.get("innlogging"),
    bekreft: p.get("bekreft"),
    kort: p.get("kort"),
    side: p.get("side"),
    q: p.get("q"),
    tilbake: p.get("tilbake"),
  };
  // Salgssiden sender kunden hit for å logge inn, og vil ha henne tilbake
  // etterpå. Huskes i nettleseren, så det overlever Google-innloggingen og
  // lenken i bekreftelseseposten.
  if (ut.tilbake && trygtTilbake(ut.tilbake)) {
    try { localStorage.setItem(TILBAKE, JSON.stringify({ url: ut.tilbake, t: Date.now() })); } catch {}
    ut.innlogging = ut.innlogging || "1";
  }
  if (ut.kasse || ut.nyttpassord || ut.innlogging || ut.bekreft || ut.kort || ut.side || ut.q || ut.tilbake) {
    window.history.replaceState(null, "", window.location.pathname);
  }
  return ut;
}

function ButikkSider({ onFeil }) {
  const h = useHandel();
  const [lenke] = useState(lesLenke);
  const [sett, setSett] = useState(null);
  const [alle, setAlle] = useState([]);
  const [data, setData] = useState(null);
  const [laster, setLaster] = useState(false);
  const [visning, setVisning] = useState("detalj");
  const [visFiltre, setVisFiltre] = useState(false);
  // Fanene er én tilstand, ikke to. «Sealed» og «Om settet» er faner paa
  // linje med de andre for den som ser paa, men de er ikke finish — derfor
  // utledes finish herfra, og spoerringen kan aldri faa «sealed» som finish.
  const [fane, setFane] = useState("alle");
  const finish = KORTFANER.some((x) => x.id === fane) ? fane : "alle";
  const [settinfo, setSettinfo] = useState(null);
  const [sortering, setSortering] = useState("pris_ned");
  const [perSide, setPerSide] = useState(25);
  const [side, setSide] = useState(1);
  // Trykker man på et settnavn, vil man se settet — ikke søket man kom fra.
  // Filtrene nullstilles (bare kort på lager, som ellers), og fanen går
  // tilbake til «Alle treff».
  const velgSett = (kode) => {
    setF(TOMT);
    setFane("alle");
    setSett(kode);
    setÅpentKort(null);
    setSkjerm("liste");
    window.scrollTo(0, 0);
  };
  // ?q= fra toppen på salgssiden: rett i lista med søket.
  const [f, setF] = useState(() => (lenke.q ? { ...TOMT, q: lenke.q } : TOMT));
  // ?kort=<id> fra e-posten om ønskelista åpner kortet direkte.
  const [åpentKort, setÅpentKort] = useState(() => lenke.kort || null);
  const [minSideFane, setMinSideFane] = useState(() =>
    lenke.side === "onskeliste" ? "onskeliste" : lenke.side === "minesalg" ? "salg" : "ordrer"
  );
  // Forsiden først. Lista er fortsatt det arbeidsredskapet den alltid har
  // vært — den er ett klikk unna, og søket herfra lander rett i den.
  const [skjerm, setSkjerm] = useState(() =>
    lenke.kasse === "ok" ? "kvittering"
      : lenke.kasse === "avbrutt" ? "kurv"
      : lenke.nyttpassord ? "nyttpassord"
      : lenke.bekreft ? "bekreft"
      : lenke.innlogging ? "konto"
      : lenke.q ? "liste"
      : ["onskeliste", "minekjop", "minesalg"].includes(lenke.side) ? "konto"
      // Lenkene fra salgssiden (toppen og bunnen der) peker hit.
      : ["vilkar", "personvern", "retur", "frakt", "tilstand", "sett", "sealed", "komplettsett", "tix", "kurv",
         "konto", "kontakt", "omoss", "kreditt", "bulksok"].includes(lenke.side) ? lenke.side
      : "forside"
  );
  const [kvittering, setKvittering] = useState(
    lenke.kasse === "ok" ? { nr: lenke.ordre, m: lenke.m } : null
  );
  const [kurvmelding, setKurvmelding] = useState("");
  // Etter innlogging fra kassen skal kunden tilbake til kassen, ikke til
  // «Min side».
  const [etterInnlogging, setEtterInnlogging] = useState(null);

  // Innlogget med bekreftet e-post og kom fra salgssiden: tilbake dit.
  useEffect(() => {
    if (!h.kunde?.bekreftet) return;
    const url = hentTilbake();
    if (!url) return;
    try { localStorage.removeItem(TILBAKE); } catch {}
    window.location.assign(url);
  }, [h.kunde?.bekreftet]);

  // Trykket kunden «tilbake» på Stripe-siden, frigis kortene med en gang.
  useEffect(() => {
    if (lenke.kasse === "avbrutt" && lenke.ordre) {
      kapi.avbryt(lenke.ordre, lenke.m).catch(() => {});
      setKurvmelding("Betalingen ble avbrutt. Kortene ligger fortsatt i kurven.");
    }
  }, []);
  // Temaet kommer fra innstillingene, ikke fra nettleseren: det er butikkens
  // utseende og ikke den enkeltes. Null som startverdi, ikke "dagens" — da
  // rekker ikke siden aa blinke i feil tema foer svaret er inne.
  const [tema, setTema] = useState(null);
  // Hvor mange sealed og komplette sett som finnes paa lager. Styrer om
  // menypunktet og forsideseksjonen vises i det hele tatt.
  const [produktantall, setProduktantall] = useState(null);
  // Sealed kan slås av under Produkter i admin. Da teller vi dem som null,
  // så menyen, forsiden og sidene for dem forsvinner av seg selv.
  const [visSealed, setVisSealed] = useState(true);
  const produktantallVist = visSealed ? produktantall : {};

  useEffect(() => {
    kapi.foretak().then((s) => { setTema(s.tema || "dagens"); setVisSealed(s.vis_sealed !== false); }).catch(() => setTema("dagens"));
  }, []);

  useEffect(() => {
    kapi.produkter({ bareLager: 1 }).then((r) => setProduktantall(r.antall || {})).catch(() => {});
  }, []);

  useEffect(() => {
    kapi.settliste().then((r) => setAlle(r.sett.filter((s) => Number(s.enabled)))).catch(onFeil);
  }, []);

  // Fakta om settet du staar i. Samme svar bestemmer om Sealed-fanen vises
  // og fyller «Om settet», saa de to aldri kan bli uenige.
  useEffect(() => {
    if (!sett) {
      setSettinfo(null);
      return;
    }
    let avbrutt = false;
    setSettinfo(null);
    kapi.settinfo(sett).then((r) => !avbrutt && setSettinfo(r.info)).catch(() => {});
    return () => {
      avbrutt = true;
    };
  }, [sett]);

  // Fanene som bare finnes inne i et sett kan forsvinne under foettene paa
  // deg: du bytter sett, og det nye har ingen sealed. Da skal du lande paa
  // «Alle treff» og ikke paa en tom fane.
  useEffect(() => {
    if (fane === "om" && !sett) setFane("alle");
    if (fane === "sealed" && (!sett || (settinfo && settprodukter(settinfo) === 0))) setFane("alle");
  }, [sett, settinfo, fane]);

  // Endrer du et filter, må du tilbake til første side. Ellers står du på side
  // sju i et resultat med to sider og ser ingenting.
  useEffect(() => setSide(1), [sett, finish, sortering, perSide, f]);

  // Hvert søk får et løpenummer. Svarene kan komme i feil rekkefølge — et
  // tregt søk på hele katalogen kan komme etter det raske søket på «egg» —
  // og da skal bare svaret på det siste søket vises.
  const søkNr = useRef(0);
  useEffect(() => {
    setLaster(true);
    const nr = ++søkNr.current;
    const t = setTimeout(() => {
      kapi.katalog({
        sett: sett || "", finish, sortering, side, perSide, ...f,
        rarity: f.rarity.join(","), farge: f.farge.join(","), type: f.type.join(","),
      })
        .then((d) => { if (nr === søkNr.current) setData(d); })
        .catch((e) => { if (nr === søkNr.current) onFeil(e); })
        .finally(() => { if (nr === søkNr.current) setLaster(false); });
    }, 250);
    return () => clearTimeout(t);
  }, [sett, finish, sortering, side, perSide, f]);

  const synlige = useMemo(() => {
    if (!data) return [];
    return data.kort
      .map((k) => ({
        ...k,
        // I «Vanlig» og «Foil» er det den utførelsen og ingen annen — står
        // du i foil-fanen, skal du ikke få et kort uten foilmerke.
        //
        // I «Alle treff» vises kortet én gang. Da er det den vanlige
        // utgaven, for det er den folk flest leter etter, og foil hvis den
        // er den eneste som finnes. Begge prisene står uansett på kortsiden.
        valgt:
          finish === "alle"
            ? k.varianter.find((v) => v.finish === "nonfoil") || k.varianter[0] || null
            : k.varianter.find((v) => v.finish === finish) || null,
      }))
      .filter((k) => k.valgt?.tilstander.length);
  }, [data, finish]);

  const endre = (felt, verdi) => setF((x) => ({ ...x, [felt]: verdi }));
  // Haker legger til og fjerner fra en liste. Ett valg er sjelden nok — man
  // leter gjerne etter rare og mythic samtidig.
  const veksle = (felt, verdi) =>
    setF((x) => ({
      ...x,
      [felt]: x[felt].includes(verdi) ? x[felt].filter((v) => v !== verdi) : [...x[felt], verdi],
    }));

  // De to linjene i toppen står på hver eneste skjerm; alt som skifter,
  // skifter under dem. Derfor pakkes alle visningene i det samme skallet i
  // stedet for å ha hver sin ytterdiv — da kan de ikke komme i utakt.
  //
  // Topp holder sin egen søketekst. Den overlever skjermbyttene fordi
  // elementet står på samme plass i treet uansett hvilken gren som
  // returneres, og React beholder tilstanden til en komponent som ikke
  // flytter på seg.
  const skall = (innhold) => (
    <div className="butikk" data-tema={tema || "dagens"}>
      <Topp
        onKonto={() => { setÅpentKort(null); setSkjerm("konto"); }}
        onKurv={() => { setÅpentKort(null); setKurvmelding(""); setSkjerm("kurv"); }}
        produkter={produktantallVist}
        onProdukt={(t) => { setÅpentKort(null); setSkjerm(t); }}
        onHjem={() => { setÅpentKort(null); setSkjerm("forside"); }}
        onSøk={(t) => {
          // Søket i toppen er det samme filteret som feltet i søyla. Ett sted
          // å lete fra, ett sted det havner.
          endre("q", t);
          setÅpentKort(null);
          setSkjerm("liste");
        }}
        onAlleSett={() => { setÅpentKort(null); setSkjerm("sett"); }}
        onTix={() => { setÅpentKort(null); setSkjerm("tix"); }}
      />
      <div className="b-innhold">{innhold}</div>
      {/* Bunnen staar paa hver skjerm, som toppen. */}
      <Bunn
        onSkjerm={(id) => {
          setÅpentKort(null);
          // Snarveier fra bunnen rett til en fane på «Min side».
          if (id === "onskeliste" || id === "minekjop" || id === "minesalg") {
            setMinSideFane(id === "onskeliste" ? "onskeliste" : id === "minesalg" ? "salg" : "ordrer");
            setSkjerm("konto");
          } else {
            if (id === "konto") setMinSideFane("ordrer");
            setSkjerm(id);
          }
        }}
      />
    </div>
  );

  if (åpentKort) {
    return skall(
      <Kortside
        id={åpentKort}
        onLukk={() => { setÅpentKort(null); setSkjerm("liste"); }}
        onÅpne={setÅpentKort}
        onSett={velgSett}
        onFeil={onFeil}
        onLoggInn={() => { setEtterInnlogging(null); setÅpentKort(null); setSkjerm("konto"); }}
      />
    );
  }

  if (skjerm === "forside") {
    return skall(
      <Forside
        produktantall={produktantallVist}
        onProdukt={(t) => setSkjerm(t)}
        onButikk={() => setSkjerm("liste")}
        onÅpne={setÅpentKort}
        onSett={velgSett}
        onFeil={onFeil}
      />
    );
  }

  if (skjerm === "kurv") {
    return skall(
      <KurvSide
        melding={kurvmelding}
        onKasse={() => setSkjerm("kasse")}
        onHandleVidere={() => setSkjerm(data ? "liste" : "forside")}
      />
    );
  }
  if (skjerm === "kasse") {
    return skall(
      <Kasse
        onTilbake={() => setSkjerm("kurv")}
        onLoggInn={() => { setEtterInnlogging("kasse"); setSkjerm("konto"); }}
        onKvittering={(nr, m) => { setKvittering({ nr, m }); setSkjerm("kvittering"); }}
      />
    );
  }
  if (skjerm === "kvittering" && kvittering) {
    return skall(<Kvittering nr={kvittering.nr} merke={kvittering.m} onFerdig={() => setSkjerm("forside")} />);
  }
  if (skjerm === "bekreft") {
    return skall(<Bekreft token={lenke.bekreft} onFerdig={() => setSkjerm("konto")} />);
  }
  if (skjerm === "nyttpassord") {
    return skall(<NyttPassord token={lenke.nyttpassord} onFerdig={() => setSkjerm("konto")} />);
  }
  if (skjerm === "konto") {
    if (!h.lastet) return skall(<p className="dempet">Henter…</p>);
    if (!h.kunde) {
      return skall(
        <>
          {lenke.innlogging === "feil" && (
            <div className="varsel feil">Innloggingen med Google gikk ikke. Prøv igjen.</div>
          )}
          <LoggInn
            onInne={() => {
              const til = etterInnlogging;
              setEtterInnlogging(null);
              setSkjerm(til || "konto");
            }}
          />
        </>
      );
    }
    return skall(<MinSide startfane={minSideFane} onUt={() => setSkjerm("forside")} />);
  }


  if (skjerm === "kontakt") return skall(<Kontakt onFeil={onFeil} />);
  if (skjerm === "frakt") return skall(<Fraktside onFeil={onFeil} />);
  if (skjerm === "kreditt") return skall(<Kredittside />);
  if (skjerm === "omoss") return skall(<OmOss />);
  if (skjerm === "retur") return skall(<Retur />);
  if (skjerm === "vilkar") return skall(<Vilkar onSkjerm={(id) => setSkjerm(id)} />);
  if (skjerm === "personvern") return skall(<Personvern />);
  if (skjerm === "tilstand") return skall(<Tilstandsguide />);
  if (skjerm === "bulksok") return skall(<Bulksok onKurv={() => { setKurvmelding(""); setSkjerm("kurv"); }} />);
  if (skjerm === "tix") return skall(<Tix onFeil={onFeil} onKonto={() => setSkjerm("konto")} />);
  if (visSealed && PRODUKTTYPER.some((t) => t.id === skjerm)) {
    return skall(<Produktliste type={skjerm} onFeil={onFeil} />);
  }

  if (skjerm === "sett") {
    return skall(
      <AlleSett sett={alle} onVelg={velgSett} />
    );
  }

  return skall(
    <>
      {/* På mobil står filtrene over treffene, sammenfoldet bak en knapp —
          ellers får treffene en stripe på siden og skyves ut av skjermen. */}
      <button type="button" className="knapp b-filterknapp" onClick={() => setVisFiltre((v) => !v)} aria-expanded={visFiltre}>
        {visFiltre ? "Skjul filtre" : "Filtre"}
        {(() => {
          const n = (f.rarity?.length || 0) + (f.farge?.length || 0) + (f.prisFra ? 1 : 0) + (f.prisTil ? 1 : 0) + (sett ? 1 : 0);
          return n ? ` (${n})` : "";
        })()}
      </button>
      <div className="b-sokeoppsett">
        <div className={`panel b-filtre${visFiltre ? " vis" : ""}`}>
          <div className="krop">
            <Fast navn="Kortnavn">
              <input type="text" value={f.q} onChange={(e) => endre("q", e.target.value)} style={{ width: "100%" }} />
            </Fast>

            {/* Rett under søket: det er det første valget folk vil ta. */}
            <label className="b-baresalg">
              <input type="checkbox" checked={f.baresalg} onChange={(e) => endre("baresalg", e.target.checked)} />
              Vis kun kort på lager
            </label>

            <Fast navn="Sett">
              <select value={sett || ""} onChange={(e) => setSett(e.target.value || null)} style={{ width: "100%" }}>
                <option value="">Alle sett</option>
                {alle.map((s) => (
                  <option key={s.code} value={s.code}>{s.name}</option>
                ))}
              </select>
            </Fast>

            <Gruppe navn="Raritet">
              {RARITETER.map((r) => (
                <Hake
                  key={r}
                  navn={stor(r)}
                  av={f.rarity.includes(r)}
                  onVeksle={() => veksle("rarity", r)}
                />
              ))}
            </Gruppe>

            <Gruppe navn="Farge">
              {FARGER.map((x) => (
                <Hake
                  key={x.kode}
                  navn={x.navn}
                  av={f.farge.includes(x.kode)}
                  onVeksle={() => veksle("farge", x.kode)}
                />
              ))}
              {/* Står under fargene, ikke som egen gruppe: den endrer
                  betydningen av avhukingene over, og hører til dem.
                  Grå ut når ingen farge er valgt — da gjør den ingenting,
                  og en bryter som ikke gjør noe er verre enn ingen. */}
              <label
                style={{
                  display: "flex", alignItems: "center", gap: 7, cursor: f.farge.length ? "pointer" : "default",
                  fontSize: 13, marginTop: 6, paddingTop: 6, borderTop: "1px solid var(--strek)",
                  color: f.farge.length ? "var(--blekk)" : "var(--dempet)",
                }}
              >
                <input
                  type="checkbox"
                  checked={f.fargeEksakt}
                  disabled={!f.farge.length}
                  onChange={(e) => endre("fargeEksakt", e.target.checked)}
                />
                Bare disse fargene
              </label>
              <p className="dempet" style={{ fontSize: 11.5, margin: "4px 0 0", lineHeight: 1.4 }}>
                {f.fargeEksakt
                  ? f.farge.filter((x) => x !== "C").length === 1
                    ? "Bare monofargede kort i den fargen."
                    : "Kort som er nøyaktig disse fargene, ikke flere."
                  : "Uten denne: kort som har minst én av fargene."}
              </p>
            </Gruppe>

            <Gruppe navn="Type" lukket>
              {TYPER.map((t) => (
                <Hake key={t} navn={t} av={f.type.includes(t)} onVeksle={() => veksle("type", t)} />
              ))}
            </Gruppe>

            <Gruppe navn="Pris">
              <div className="rad-flex" style={{ gap: 4 }}>
                <input
                  type="text" inputMode="numeric" value={f.prisFra} placeholder="fra"
                  onChange={(e) => endre("prisFra", e.target.value.replace(/\D/g, ""))}
                  style={{ width: 62 }}
                />
                <input
                  type="text" inputMode="numeric" value={f.prisTil} placeholder="til"
                  onChange={(e) => endre("prisTil", e.target.value.replace(/\D/g, ""))}
                  style={{ width: 62 }}
                />
              </div>
            </Gruppe>

            <button className="knapp liten" style={{ marginTop: 12 }} onClick={() => setF(TOMT)}>
              Nullstill filtre
            </button>
          </div>
        </div>

        <div>
          <>
              <div className="panel" style={{ paddingBottom: 0 }}>
                <div className="krop" style={{ paddingBottom: 0 }}>
                  {/* Fanene er sidenavigasjon, ikke knapper. Antallet i
                      parentes er det som gjør dem verdt å ha.

                      «Alle treff» står først og er standard. De to andre er
                      avgrensninger av den, ikke to halvdeler av katalogen —
                      derfor kan ingen kort bli borte fordi man står i feil
                      fane. Det var dét som gjorde at Kaladesh Inventions
                      ikke dukket opp når man søkte «Sol Ring». */}
                  <div className="faner" role="tablist">
                    {KORTFANER.map((x) => (
                      <button
                        key={x.id}
                        role="tab"
                        aria-selected={fane === x.id}
                        onClick={() => setFane(x.id)}
                      >
                        {x.navn}
                        {data && <span className="dempet"> ({data.antall?.[x.id] ?? 0})</span>}
                      </button>
                    ))}

                    {/* Sealed staar bare naar du staar i et sett og det
                        faktisk finnes sealed i det. En fane som aapner en
                        tom liste er en fane som lyver om hva du har. */}
                    {sett && settprodukter(settinfo) > 0 && (
                      <button role="tab" aria-selected={fane === "sealed"} onClick={() => setFane("sealed")}>
                        Sealed<span className="dempet"> ({settprodukter(settinfo)})</span>
                      </button>
                    )}

                    {/* «Om settet» staar saa lenge du staar i et sett. Det
                        finnes alltid noe aa si naar settet finnes. */}
                    {sett && (
                      <button role="tab" aria-selected={fane === "om"} onClick={() => setFane("om")}>
                        Om settet
                      </button>
                    )}

                    {KORTFANER.some((x) => x.id === fane) && (
                    <div style={{ marginLeft: "auto", display: "flex", gap: 2, paddingBottom: 8 }}>
                      {/* Rekkefølgen er tetthet: tettest til venstre, mest
                          plass per kort til høyre. */}
                      <VisningsIkon
                        aktiv={visning === "tekst"}
                        tittel="Tekstvisning"
                        onClick={() => setVisning("tekst")}
                        form="strek"
                      />
                      <VisningsIkon
                        aktiv={visning === "detalj"}
                        tittel="Detaljvisning"
                        onClick={() => setVisning("detalj")}
                        form="detalj"
                      />
                      <VisningsIkon
                        aktiv={visning === "galleri"}
                        tittel="Galleri"
                        onClick={() => setVisning("galleri")}
                        form="rutenett"
                      />
                    </div>
                    )}
                  </div>

                  {KORTFANER.some((x) => x.id === fane) && (
                  <div className="rad-flex" style={{ padding: "10px 0", justifyContent: "space-between" }}>
                    <span className="dempet">
                      {data
                        ? data.totalt === 0
                          ? "Ingen treff"
                          : `${(data.side - 1) * data.perSide + 1}–${Math.min(data.side * data.perSide, data.totalt)} av ${data.totalt}`
                        : ""}
                    </span>
                    <div className="rad-flex">
                      <label className="dempet">
                        Sorter{" "}
                        <select value={sortering} onChange={(e) => setSortering(e.target.value)}>
                          {SORTERING.map((x) => <option key={x.id} value={x.id}>{x.navn}</option>)}
                        </select>
                      </label>
                      <label className="dempet">
                        Vis{" "}
                        <select value={perSide} onChange={(e) => setPerSide(Number(e.target.value))}>
                          {[25, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}
                        </select>
                      </label>
                    </div>
                  </div>
                  )}
                </div>
              </div>

              {fane === "sealed" && (
                <Produktliste setKode={sett} skjulTittel onFeil={onFeil} />
              )}
              {fane === "om" && <OmSettet info={settinfo} onSett={velgSett} />}

              {KORTFANER.some((x) => x.id === fane) && laster && <p className="dempet">Henter…</p>}

              {KORTFANER.some((x) => x.id === fane) && !laster && data && (
                <>
                  {/* Kort uten pris vises ikke. Listen over dem ligger under
                      Lagerrapport, ikke her der kundene ser det. */}

                  {/* Samme kort, tre tettheter. Galleriet er ett rutenett og
                      ikke en rekke paneler, så det må stå for seg. */}
                  {visning === "galleri" ? (
                    <div className="b-galleri">
                      {synlige.map((k) => (
                        <Galleriflis
                          key={k.id}
                          kort={k}
                          onÅpne={() => setÅpentKort(k.id)}
                          onSett={() => velgSett(k.set_code)}
                        />
                      ))}
                    </div>
                  ) : visning === "tekst" ? (
                    synlige.map((k) => (
                      <Tekstrad
                        key={k.id}
                        kort={k}
                        onÅpne={() => setÅpentKort(k.id)}
                        onSett={() => velgSett(k.set_code)}
                      />
                    ))
                  ) : (
                    synlige.map((k) => (
                      <Detaljrad
                        key={k.id}
                        kort={k}
                        onÅpne={() => setÅpentKort(k.id)}
                        onSett={() => velgSett(k.set_code)}
                      />
                    ))
                  )}

                  {!synlige.length && <div className="tom">Ingen kort passer filteret.</div>}

                  {data.sider > 1 && (
                    <div className="rad-flex" style={{ justifyContent: "center", marginTop: 16 }}>
                      <button className="knapp" disabled={data.side <= 1} onClick={() => setSide(data.side - 1)}>
                        Forrige
                      </button>
                      <span className="dempet">Side {data.side} av {data.sider}</span>
                      <button
                        className="knapp"
                        disabled={data.side >= data.sider}
                        onClick={() => setSide(data.side + 1)}
                      >
                        Neste
                      </button>
                    </div>
                  )}
                </>
              )}
          </>
        </div>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TOPPEN
// ─────────────────────────────────────────────────────────────────────────────
// To linjer som står på hver eneste side, slik Card Kingdom har det.
//
//   Linje 1, mørk grønn:   logo — søkefelt — Logg inn — kurvene
//   Linje 2, lysere grønn: Alle sett — … — Selg dine kort i oransje
//
// Innlogging og kurvene finnes ikke ennå. De står her likevel, deaktivert,
// fordi det er plasseringen som skal vurderes nå — og fordi en topp som
// mangler halve innholdet ikke sier noe om hvordan den blir.
// Produkttypene staar ett sted. Menyen i toppen, skjermene og seksjonene paa
// forsiden leser alle herfra, saa en ny type blir én linje og ikke tre.
// Kortfanene. De tre er avgrensninger av hverandre, ikke tre halvdeler av
// katalogen — derfor kan ingen kort bli borte fordi man staar i feil fane.
// Alt du har fra utgivelsen, uansett slag. En forseglet boks og et ferdig
// samlet sett hoerer til det samme settet, og den som staar paa settsida
// leter etter begge deler — ikke etter en av dem.
const settprodukter = (info) => (info?.sealed || 0) + (info?.komplettsett || 0);

const KORTFANER = [
  { id: "alle", navn: "Alle treff" },
  { id: "nonfoil", navn: "Vanlig" },
  { id: "foil", navn: "Foil" },
];

const PRODUKTTYPER = [
  { id: "sealed", navn: "Sealed", ingress: "Forseglede bokser, bundles og displayer." },
  { id: "komplettsett", navn: "Komplette sett", ingress: "Hele sett, ferdig samlet." },
];

function Topp({ onHjem, onSøk, onAlleSett, produkter, onProdukt, onKonto, onKurv, onTix }) {
  const [q, setQ] = useState("");
  const h = useHandel();

  return (
    <div className="b-skall-topp">
      <div className="b-linje1">
        <div className="b-midt">
          <button className="b-logo" onClick={onHjem} title="Til forsiden">
            {/* Ryggfinnen fra kundesiden. Navnet er Korthaien, så finnen er
                et merke og ikke en illustrasjon. Bytt denne mot logofilen
                din når du har en — det er det eneste stedet den står. */}
            <svg viewBox="88 22 128 136" fill="currentColor" aria-hidden="true">
              <path d="M95 150C125 132 172 88 208 30 186 76 182 118 196 150Z" />
            </svg>
            <span>Korthaien</span>
          </button>

          <form
            className="b-toppsok"
            role="search"
            onSubmit={(e) => {
              e.preventDefault();
              onSøk(q.trim());
              // Søket flyttes over i feltet i søyla; toppfeltet tømmes, så
              // et nytt søk ikke starter med det gamle.
              setQ("");
              e.currentTarget.querySelector("input")?.blur();
            }}
          >
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Søk etter kort"
              aria-label="Søk etter kort"
            />
            <button type="submit" aria-label="Søk">
              <svg width="17" height="17" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="7" cy="7" r="5" />
                <path d="M11 11l4 4" strokeLinecap="round" />
              </svg>
            </button>
          </form>

          <div className="b-hoyre">
            <button className="b-toppknapp" onClick={onKonto}>
              {h.kunde ? "Min side" : "Logg inn"}
            </button>

            {/* To kurver, ikke én. Å kjøpe og å selge er to bunker som lever
                side om side: den ene sendes til deg, den andre fra deg. Én
                kurv for begge ville blandet dem.
                Samme symbol på begge — det er ordet under som skiller dem,
                og to ulike symboler ville latt som om de var to ulike ting. */}
            <Kurv navn="Kjøp" antall={h.antall} tittel="Handlekurven" onClick={onKurv} />
            <Kurv navn="Selg" antall={0} tittel="Kortene du selger til meg — kommer" />
          </div>
        </div>
      </div>

      <div className="b-linje2">
        <div className="b-midt">
          <button className="b-navvalg" onClick={onAlleSett}>Alle sett</button>
          {/* Sealed og komplette sett staar her og ikke bare paa forsiden:
              toppen vises alltid, og det er der folk leter naar de staar et
              annet sted enn forsiden.

              Punktet vises bare naar det finnes noe aa vise. En meny som
              lenker til en tom side er et loefte den ikke holder. */}
          {PRODUKTTYPER.map((t) =>
            (produkter?.[t.id] || 0) > 0 ? (
              <button key={t.id} className="b-navvalg" onClick={() => onProdukt(t.id)}>
                {t.navn}
              </button>
            ) : null
          )}
          {/* Tix ved siden av, med omriss i stedet for fylt farge: lett å
              finne, men «Selg dine kort» er fortsatt det som roper høyest. */}
          {/* De to salgsknappene holdes sammen og til høyre. Blir linja for
              smal, går de ned på en egen rad — fortsatt til høyre. */}
          <span className="b-selgknapper">
            <button className="b-selg-tix" onClick={onTix}>Selg MTGO-tix</button>
            <a className="b-selg" href="https://kortsalg.korthaien.no">Selg dine kort</a>
          </span>
        </div>
      </div>
    </div>
  );
}

// Kurven i toppen. Tallet ligger oppå symbolet, ordet under — slik blir
// symbolet det samme for begge, og ordet det eneste som skiller dem.
function Kurv({ navn, antall, tittel, onClick }) {
  return (
    <button className="b-kurv" disabled={!onClick} title={tittel} onClick={onClick}>
      <span className="b-kurvikon">
        <svg width="21" height="21" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7">
          <path d="M2 3h2.2l2 9.5h9l2-7H6" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="8" cy="16.5" r="1.3" fill="currentColor" stroke="none" />
          <circle cx="15" cy="16.5" r="1.3" fill="currentColor" stroke="none" />
        </svg>
        <span className="b-antall">{antall}</span>
      </span>
      <span className="b-kurvnavn">{navn}</span>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ALLE SETT
// ─────────────────────────────────────────────────────────────────────────────
// Settene alfabetisk, gruppert på forbokstav. Den som leter etter et bestemt
// sett vet navnet, ikke hvor i rekka det står — derfor bokstavene som anker.
//
// Lista er settene du kjøper fra. Den som skal vise hva du har til salgs i
// hvert sett trenger et antall per sett, og det finnes ingen rute for ennå.
function AlleSett({ sett, onVelg }) {
  if (!sett.length) return <p className="dempet">Henter sett…</p>;

  const navnet = (s) => String(s.name || s.code);
  const sortert = [...sett].sort((a, b) => navnet(a).localeCompare(navnet(b), "nb"));

  // Sett som begynner på et tall samles under «#». Ett sett som heter «10th
  // Edition» skal ikke få sin egen bokstav mellom A og B.
  const grupper = [];
  for (const s of sortert) {
    const første = navnet(s).charAt(0).toUpperCase();
    const bokstav = /[A-ZÆØÅ]/.test(første) ? første : "#";
    const siste = grupper[grupper.length - 1];
    if (siste && siste.bokstav === bokstav) siste.sett.push(s);
    else grupper.push({ bokstav, sett: [s], id: "sett-" + (bokstav === "#" ? "tall" : bokstav) });
  }

  // Hoppelenkene. Med hundrevis av sett er lista flere skjermhøyder lang, og
  // den som leter etter Zendikar skal slippe å rulle forbi alt annet.
  //
  // Bare bokstavene som finnes er klikkbare. En rad med hele alfabetet der
  // halvparten ikke gjør noe, lover mer enn den holder.
  function hoppTil(id) {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <>
      <h1 style={{ fontSize: 24, margin: "4px 0 2px" }}>Alle sett</h1>
      <p className="dempet" style={{ marginTop: 0 }}>
        {sortert.length} sett. Velg ett for å se kortene vi har i det.
      </p>

      <nav className="b-bokstaver" aria-label="Hopp til bokstav">
        {grupper.map((g) => (
          <button key={g.id} onClick={() => hoppTil(g.id)}>{g.bokstav}</button>
        ))}
      </nav>

      {grupper.map((g) => (
        <section key={g.id} id={g.id} className="b-settgruppe">
          <h2>{g.bokstav}</h2>
          <div className="b-settliste">
            {g.sett.map((s) => (
              <button key={s.code} className="lenke" onClick={() => onVelg(s.code)}>
                {navnet(s)}
                <span className="dempet"> {String(s.code).toUpperCase()}</span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}

// Gult merke, som hos Card Kingdom. Foil og vanlig er samme kort med samme
// bilde, og uten et tydelig merke er det lett å bestille feil.
//
// Foil-etched er en annen vare enn vanlig foil og koster noe annet, så den
// skal ikke stå med samme ord. Den kjenner vi igjen på variant = 'etched'.
//
// De andre — surge foil, galaxy foil, textured — ligger i Scryfalls
// promo_types, som ikke lagres hos oss. Skal de merkes, må kolonnen inn
// først; importen leser feltet allerede.
// I galleriet står merket på samme linje som samlernummeret, ikke på egen
// linje: en ekstra linje ville skjøvet tilstandene og prisen på foilkortene
// ned, så de ikke lenger står på linje med kortene ved siden av.
function FoilMerke({ variant, påLinja }) {
  const etched = variant === "etched";
  return (
    <span
      style={{
        display: "inline-block",
        ...(påLinja ? { marginLeft: 6, verticalAlign: "1px", lineHeight: 1.45 } : { marginTop: 5 }),
        background: etched ? "#d9c08a" : "#f5d020",
        color: "#3b2f05",
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: "0.04em",
        padding: "1px 7px",
        borderRadius: 3,
      }}
    >
      {etched ? "FOIL-ETCHED" : "FOIL"}
    </span>
  );
}

// To ikoner i stedet for ordene «Tekst» og «Detalj». Symbolene er kjente fra
// enhver nettbutikk, og de tar mindre plass enn teksten de erstatter.
function VisningsIkon({ aktiv, tittel, onClick, form }) {
  const tegning = {
    strek: (
      <>
        <rect x="1" y="2" width="14" height="2" rx="1" />
        <rect x="1" y="7" width="14" height="2" rx="1" />
        <rect x="1" y="12" width="14" height="2" rx="1" />
      </>
    ),
    detalj: (
      <>
        <rect x="1" y="2" width="5" height="12" rx="1" />
        <rect x="8" y="3" width="7" height="2" rx="1" />
        <rect x="8" y="7" width="7" height="2" rx="1" />
        <rect x="8" y="11" width="5" height="2" rx="1" />
      </>
    ),
    // Fire ruter. Ikonet skal ligne det det gir deg.
    rutenett: (
      <>
        <rect x="1" y="1" width="6" height="6" rx="1" />
        <rect x="9" y="1" width="6" height="6" rx="1" />
        <rect x="1" y="9" width="6" height="6" rx="1" />
        <rect x="9" y="9" width="6" height="6" rx="1" />
      </>
    ),
  }[form];

  return (
    <button
      title={tittel}
      aria-label={tittel}
      aria-pressed={aktiv}
      onClick={onClick}
      style={{
        border: "1px solid var(--strek)",
        background: aktiv ? "var(--aksent-svak)" : "var(--flate)",
        color: aktiv ? "var(--aksent)" : "var(--dempet)",
        borderRadius: 6,
        padding: "5px 8px",
        lineHeight: 0,
      }}
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
        {tegning}
      </svg>
    </button>
  );
}

// Felter som alltid er i bruk. De trenger ingen sammenslåing — en pil å
// klikke på gir bare et klikk uten gevinst.
function Fast({ navn, children }) {
  return (
    <div style={{ marginBottom: 10, borderBottom: "1px solid var(--strek)", paddingBottom: 10 }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>{navn}</div>
      {children}
    </div>
  );
}

// Grupper som kan slås sammen. Med haker i stedet for nedtrekk blir menyen
// lang, og da må den kunne ryddes bort.
// ─────────────────────────────────────────────────────────────────────────────
// MANASYMBOLER
// ─────────────────────────────────────────────────────────────────────────────
// Scryfall serverer symbolene som SVG på faste adresser. «{3}» blir 3.svg,
// «{W/U}» blir WU.svg. Symbolene er Wizards' eiendom, men de stilles til
// rådighet gjennom Scryfall og brukes av alle kortbutikker.
//
// Teksten splittes på klammene og settes sammen igjen med bilder der det var
// symboler. Ukjente koder får stå som de er — bedre en synlig «{Q}» enn et
// ødelagt bilde.
// Delingen må være global, men prøvingen må ikke: et globalt regexp husker
// posisjon mellom kall til test(), og da slår annenhver sjekk feil.
const SYMBOL_DEL = /(\{[^}]{1,10}\})/g;
const ER_SYMBOL = /^\{[^}]{1,10}\}$/;

function symbolFil(kode) {
  return kode
    .slice(1, -1)
    .replace(/\//g, "")
    .toUpperCase();
}

export function MedSymboler({ tekst, størrelse = 14 }) {
  if (!tekst) return null;
  const deler = String(tekst).split(SYMBOL_DEL);
  return (
    <>
      {deler.map((d, i) => {
        if (!ER_SYMBOL.test(d)) return d;
        const fil = symbolFil(d);
        if (!/^[A-Z0-9∞]{1,4}$/.test(fil)) return d;
        return (
          <img
            key={i}
            src={`https://svgs.scryfall.io/card-symbols/${fil}.svg`}
            alt={d}
            title={d}
            loading="lazy"
            style={{
              width: størrelse,
              height: størrelse,
              verticalAlign: "-2px",
              margin: "0 1px",
            }}
            // Finnes ikke symbolet, vis koden i stedet for et brutt bilde.
            onError={(e) => {
              e.currentTarget.replaceWith(document.createTextNode(d));
            }}
          />
        );
      })}
    </>
  );
}

function Gruppe({ navn, children, lukket }) {
  const [åpen, setÅpen] = useState(!lukket);
  return (
    <div style={{ marginBottom: 10, borderBottom: "1px solid var(--strek)", paddingBottom: 8 }}>
      <button
        onClick={() => setÅpen(!åpen)}
        aria-expanded={åpen}
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          width: "100%", border: "none", background: "none", padding: "2px 0",
          fontSize: 13, fontWeight: 600, color: "var(--blekk)", cursor: "pointer",
        }}
      >
        {navn}
        <span className="dempet" style={{ fontSize: 11 }}>{åpen ? "\u25b2" : "\u25bc"}</span>
      </button>
      {åpen && <div style={{ marginTop: 6 }}>{children}</div>}
    </div>
  );
}

function Hake({ navn, av, onVeksle }) {
  return (
    <label
      style={{
        display: "flex", alignItems: "center", gap: 7,
        fontSize: 13.5, padding: "2px 0", cursor: "pointer",
        color: av ? "var(--blekk)" : "var(--dempet)",
      }}
    >
      <input type="checkbox" checked={av} onChange={onVeksle} />
      {navn}
    </label>
  );
}

// Tilstandene nedover, med lager og pris på samme linje. Tettere og lettere å
// skumme enn et rutenett, som er hele poenget med tekstvisning.
function Tekstrad({ kort, onÅpne, onSett }) {
  return (
    <div className="panel" style={{ marginBottom: 8 }}>
      <div className="krop" style={{ display: "flex", gap: 20, alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>
            <button className="lenke" onClick={onÅpne}>{kort.name}</button>
            {kort.variant && kort.variant !== "vanlig" && (
              <span className="merkelapp m-vent" style={{ marginLeft: 6 }}>{kort.variant}</span>
            )}
          </div>
          <div className="dempet" style={{ fontSize: 13 }}>
            <button className="lenke" onClick={onSett}>{kort.set_name}</button>
            {" · "}
            {kort.type_line || kort.rarity}
          </div>
          <div className="dempet" style={{ fontSize: 12 }}>
            Collector #: {kort.collector_number}
            {kort.mana_cost ? <> · <MedSymboler tekst={kort.mana_cost} størrelse={12} /></> : null}
          </div>
          {kort.valgt.finish === "foil" && <FoilMerke variant={kort.variant} />}
        </div>

        {/* Tilstand, pris, antall, og til slutt handlingen. Rekkefølgen er
            den man leser i: hva slags stand, hva koster det, har du noen,
            og kan jeg få det. */}
        <table style={{ width: 330, flex: "none" }}>
          <tbody>
            {kort.valgt.tilstander.map((t) => (
              <tr key={t.condition}>
                <td style={{ width: 38, padding: "3px 6px", fontWeight: 500 }}>{t.condition}</td>
                <td
                  className={`h tall ${t.lager > 0 ? "pris" : "utsolgt"}`}
                  style={{ width: 80, padding: "3px 6px" }}
                >
                  {kroner(t.ore)}
                </td>
                <td className="h dempet" style={{ width: 62, padding: "3px 6px", fontSize: 13 }}>
                  {t.lager > 0 ? `${t.lager} stk.` : ""}
                </td>
                <td className="h" style={{ padding: "3px 6px" }}>
                  <LeggIKurven kort={kort} finish={kort.valgt.finish} tilstand={t} liten stil={{ padding: "2px 10px" }} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Bilde til venstre, kortopplysninger i midten, og en prisboks til høyre med
// tilstandene som faner — slik Card Kingdom gjør det. Trykker du på en fane,
// bytter både prisen og antallet over og under.
function Detaljrad({ kort, onÅpne, onSett }) {
  const første = kort.valgt.tilstander.find((t) => t.lager > 0) || kort.valgt.tilstander[0];
  const [valgt, setValgt] = useState(første.condition);
  const t = kort.valgt.tilstander.find((x) => x.condition === valgt) || første;

  return (
    <div className="panel" style={{ marginBottom: 10 }}>
      <div className="krop" style={{ display: "flex", gap: 18, alignItems: "flex-start" }}>
        {kort.image_uri ? (
          <img
            src={kort.image_uri}
            alt={kort.name}
            loading="lazy"
            onClick={onÅpne}
            style={{ width: 130, borderRadius: 7, alignSelf: "flex-start", cursor: "pointer" }}
          />
        ) : (
          <div style={{ width: 130, aspectRatio: "5 / 7", background: "var(--papir)", borderRadius: 7 }} />
        )}

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 16 }}>
            <button className="lenke" onClick={onÅpne}>{kort.name}</button>
          </div>
          <div style={{ fontSize: 13 }}>
            <button className="lenke" onClick={onSett}>{kort.set_name}</button>
          </div>
          <div className="dempet" style={{ fontSize: 13 }}>
            Collector #: {kort.collector_number}
          </div>
          {kort.valgt.finish === "foil" && <FoilMerke variant={kort.variant} />}

          <div className="dempet" style={{ fontSize: 13, margin: "8px 0 0" }}>
            <MedSymboler tekst={kort.mana_cost} /> {kort.type_line}
            {kort.power ? ` · ${kort.power}/${kort.toughness}` : ""}
            {kort.loyalty ? ` · ${kort.loyalty}` : ""}
          </div>

          {kort.oracle_text && (
            <p style={{ whiteSpace: "pre-line", fontSize: 13.5, margin: "6px 0 0", maxWidth: "56ch", lineHeight: 1.6 }}>
              <MedSymboler tekst={kort.oracle_text} />
            </p>
          )}
        </div>

        <div className="b-prisboks">
          <div className="tall pris-stor" style={{ marginBottom: 6 }}>{kroner(t.ore)}</div>

          <div className="cond-valg">
            {CONDITIONS.map((c) => {
              const x = kort.valgt.tilstander.find((y) => y.condition === c);
              if (!x) return null;
              const aktiv = valgt === c;
              return (
                <button
                  key={c}
                  onClick={() => setValgt(c)}
                  aria-pressed={aktiv}
                  className={x.lager ? undefined : "tom"}
                  title={x.lager ? `${x.lager} på lager` : "Utsolgt — prisen vises likevel"}
                >
                  {c}
                </button>
              );
            })}
          </div>

          <div className="dempet" style={{ fontSize: 13, margin: "7px 0 8px" }}>
            {t.lager > 0 ? `${t.lager} tilgjengelig` : "Utsolgt"}
          </div>

          <LeggIKurven kort={kort} finish={kort.valgt.finish} tilstand={t} stil={{ width: "100%" }} />
        </div>
      </div>
    </div>
  );
}

// Galleri: bildet først og alt annet under. Den tetteste måten å se mange
// kort på når det er bildet man kjenner dem igjen på — og det er det man
// gjør med Magic-kort.
//
// Tilstandsvelgeren er den samme som i detaljvisningen, og oppfører seg likt:
// trykker du på en fane, bytter prisen og antallet over og under.
function Galleriflis({ kort, onÅpne, onSett }) {
  const første = kort.valgt.tilstander.find((t) => t.lager > 0) || kort.valgt.tilstander[0];
  const [valgt, setValgt] = useState(første.condition);
  const t = kort.valgt.tilstander.find((x) => x.condition === valgt) || første;

  return (
    <div className="panel b-gflis">
      <button className="b-gbilde" onClick={onÅpne} title={kort.name}>
        {kort.image_uri ? (
          <img src={kort.image_uri} alt={kort.name} loading="lazy" />
        ) : (
          <div className="b-gtomt" />
        )}
      </button>

      <div className="krop">
        <div className="b-gsett">
          <button className="lenke" onClick={onSett}>{kort.set_name}</button>
        </div>
        {/* Knapp og ikke lenke: kortsiden er en tilstand i dette panelet,
            ikke en adresse. En href hadde navigert ut av admin. Det endrer
            seg når butikken flyttes ut og sidene får egne adresser. */}
        <div className="b-gnavn">
          <button className="lenke" onClick={onÅpne}>{kort.name}</button>
        </div>
        <div className="dempet b-gnr">
          Collector #: {kort.collector_number}
          {kort.valgt.finish === "foil" && <FoilMerke variant={kort.variant} påLinja />}
        </div>

        <div className="cond-valg" style={{ marginTop: 8 }}>
          {CONDITIONS.map((c) => {
            const x = kort.valgt.tilstander.find((y) => y.condition === c);
            if (!x) return null;
            return (
              <button
                key={c}
                onClick={() => setValgt(c)}
                aria-pressed={valgt === c}
                className={x.lager ? undefined : "tom"}
                title={x.lager ? `${x.lager} på lager` : "Utsolgt — prisen vises likevel"}
              >
                {c}
              </button>
            );
          })}
        </div>

        <div className="tall pris b-gpris">{kroner(t.ore)}</div>
        <div className="dempet b-gnr">
          {t.lager > 0 ? `${t.lager} tilgjengelig` : "Utsolgt"}
        </div>

        <LeggIKurven kort={kort} finish={kort.valgt.finish} tilstand={t} stil={{ width: "100%", marginTop: 8 }} />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// KORTSIDE
// ─────────────────────────────────────────────────────────────────────────────
// Alt om ett trykk, og de andre utgavene av samme kort. «Samme kort» er
// Scryfalls oracle_id, ikke navnet — den holder også når navnet er skrevet
// ulikt mellom utgivelser.
function Kortside({ id, onLukk, onÅpne, onSett, onFeil, onLoggInn }) {
  const [data, setData] = useState(null);
  const [finish, setFinish] = useState("nonfoil");
  const [valgt, setValgt] = useState(null);

  useEffect(() => {
    setData(null);
    kapi.kort(id)
      .then((d) => {
        setData(d);
        const første = d.kort.varianter[0];
        setFinish(første?.finish || "nonfoil");
        setValgt(
          (første?.tilstander.find((t) => t.lager > 0) || første?.tilstander[0])?.condition || "NM"
        );
      })
      .catch(onFeil);
  }, [id]);

  if (!data) return <p className="dempet">Henter…</p>;

  const k = data.kort;
  const variant = k.varianter.find((v) => v.finish === finish) || k.varianter[0];
  const t = variant?.tilstander.find((x) => x.condition === valgt) || variant?.tilstander[0];
  const harBegge = k.varianter.length > 1;

  return (
    <>
      <button className="knapp liten" style={{ marginBottom: 14 }} onClick={onLukk}>
        ← Tilbake til lista
      </button>

      <h1 style={{ marginBottom: 4 }}>{k.name}</h1>
      <p className="dempet" style={{ marginTop: 0 }}>
        <button className="lenke" onClick={() => onSett(k.set_code)}>{k.set_name}</button>
      </p>

      <div className="panel">
        <div className="krop" style={{ display: "flex", gap: 24, alignItems: "flex-start" }}>
          {k.image_uri ? (
            <img className="b-kortbilde" src={k.image_uri} alt={k.name} style={{ width: 240, borderRadius: 11 }} />
          ) : (
            <div className="b-kortbilde" style={{ width: 240, aspectRatio: "5 / 7", background: "var(--papir)", borderRadius: 11 }} />
          )}

          <div className="b-kortinfo" style={{ flex: 1, minWidth: 0 }}>
            <Rad navn="Utgave">
              <button className="lenke" onClick={() => onSett(k.set_code)}>{k.set_name}</button>
            </Rad>
            <Rad navn="Type">{k.type_line || "\u2014"}</Rad>
            {k.mana_cost && <Rad navn="Kostnad"><MedSymboler tekst={k.mana_cost} /></Rad>}
            <Rad navn="Raritet">{k.rarity || "\u2014"}</Rad>
            <Rad navn="Collector #">{k.collector_number}</Rad>
            {(k.power || k.loyalty) && (
              <Rad navn={k.loyalty ? "Lojalitet" : "Styrke"}>
                {k.loyalty ? k.loyalty : `${k.power}/${k.toughness}`}
              </Rad>
            )}
            {k.artist && <Rad navn="Kunstner">{k.artist}</Rad>}
            {Number(k.reserved) === 1 && (
              <Rad navn="Merk">
                <span className="merkelapp m-velg">På reservelisten</span>
              </Rad>
            )}

            {k.oracle_text && (
              <p style={{ whiteSpace: "pre-line", fontSize: 14, lineHeight: 1.65, margin: "16px 0 0", maxWidth: "58ch" }}>
                <MedSymboler tekst={k.oracle_text} />
              </p>
            )}
          </div>

          <div className="b-prisboks">
            {!variant ? (
              <p className="dempet">Ikke til salgs — kortet har ingen pris.</p>
            ) : (
              <>
                <div className="tall pris-stor" style={{ marginBottom: 6 }}>{kroner(t.ore)}</div>
                <div className="cond-valg">
                  {CONDITIONS.map((c) => {
                    const x = variant.tilstander.find((y) => y.condition === c);
                    if (!x) return null;
                    return (
                      <button
                        key={c}
                        onClick={() => setValgt(c)}
                        aria-pressed={valgt === c}
                        className={x.lager ? undefined : "tom"}
                        title={x.lager ? `${x.lager} på lager` : "Utsolgt — prisen vises likevel"}
                      >
                        {c}
                      </button>
                    );
                  })}
                </div>
                <div className="dempet" style={{ fontSize: 13, margin: "7px 0 8px" }}>
                  {t.lager > 0 ? `${t.lager} tilgjengelig` : "Utsolgt"}
                </div>
                <LeggIKurven kort={k} finish={variant.finish} tilstand={t} stil={{ width: "100%" }} />
                {harBegge && (
                  <button
                    className="knapp"
                    style={{ width: "100%", marginTop: 8 }}
                    onClick={() => {
                      const ny = finish === "foil" ? "nonfoil" : "foil";
                      setFinish(ny);
                      const v = k.varianter.find((x) => x.finish === ny);
                      setValgt((v?.tilstander.find((x) => x.lager > 0) || v?.tilstander[0])?.condition);
                    }}
                  >
                    {finish === "foil" ? "Bytt til vanlig" : "Bytt til foil"}
                  </button>
                )}
              </>
            )}
            <Ønske kort={k} onLoggInn={onLoggInn} />
          </div>
        </div>
      </div>

      {data.andreUtgaver.length > 0 && (
        <>
          <h2 style={{ marginTop: 22 }}>Andre utgaver ({data.andreUtgaver.length})</h2>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
            {data.andreUtgaver.map((u) => (
              <button
                key={u.id}
                onClick={() => onÅpne(u.id)}
                title={`${u.set_name} #${u.collector_number}`}
                style={{
                  width: 116, border: "1px solid var(--strek)", borderRadius: 9,
                  background: "var(--flate)", padding: 7, cursor: "pointer", textAlign: "center",
                }}
              >
                {u.image_uri ? (
                  <img src={u.image_uri} alt={u.set_name} loading="lazy" style={{ width: "100%", borderRadius: 5 }} />
                ) : (
                  <div style={{ width: "100%", aspectRatio: "5 / 7", background: "var(--papir)", borderRadius: 5 }} />
                )}
                <div className="dempet" style={{ fontSize: 11, marginTop: 5, lineHeight: 1.3 }}>
                  {u.set_name}
                </div>
                <div className="tall" style={{ fontSize: 12.5, fontWeight: 600, color: "var(--brass)" }}>
                  {u.nm ? kroner(u.nm) : "\u2014"}
                </div>
                {u.påLager > 0 && (
                  <div className="dempet" style={{ fontSize: 11 }}>{u.påLager} på lager</div>
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// FORSIDEN
// ─────────────────────────────────────────────────────────────────────────────
// Det kunden møter før lista: hva stedet er, et søkefelt, den andre halvparten
// av butikken, og noen kort å se på. Ingen filtre — de hører til når man
// allerede leter etter noe bestemt.
// Rutenettet fylles med så mange kort det er plass til i hele rader: sju per
// rad på en bred skjerm gir fjorten, fem gir ti. Ingen halvtom siste rad.
function FulleRader({ kort, rader, onÅpne }) {
  const ref = useRef(null);
  const [kolonner, setKolonner] = useState(6);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const mål = () => {
      const n = getComputedStyle(el).gridTemplateColumns.split(" ").filter(Boolean).length;
      if (n) setKolonner(n);
    };
    mål();
    const ro = new ResizeObserver(mål);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const maks = Math.min(kort.length, kolonner * rader);
  const antall = Math.max(Math.min(kolonner, kort.length), Math.floor(maks / kolonner) * kolonner);
  return (
    <div className="b-rute" ref={ref}>
      {kort.slice(0, antall).map((k) => <Flis key={k.flisnøkkel || k.id} kort={k} onÅpne={() => onÅpne(k.id)} />)}
    </div>
  );
}

function Forside({ onButikk, onÅpne, onSett, onProdukt, produktantall, onFeil }) {
  const [kort, setKort] = useState(null);
  const [nyeste, setNyeste] = useState(null);
  // Toppbildet av neste sett. Undefined mens vi spør, null når det ikke er
  // noe — da står den vanlige teksten der i stedet.
  const [banner, setBanner] = useState(undefined);

  useEffect(() => {
    kapi.toppbanner().then((r) => setBanner(r.banner)).catch(() => setBanner(null));
  }, []);

  // Raden med nyeste sett. Henter seg selv fra lageret, saa ingen trenger aa
  // huske aa bytte den naar et sett kommer inn.
  useEffect(() => {
    let avbrutt = false;
    kapi
      .nyesteSett()
      .then((d) => !avbrutt && setNyeste(d.sett))
      .catch(() => !avbrutt && setNyeste([]));
    return () => {
      avbrutt = true;
    };
  }, []);

  // De dyreste kortene på lager. Ingen egen rute: butikkruta sorterer
  // allerede, og baresalg gjør at den bare viser det du faktisk har.
  useEffect(() => {
    let avbrutt = false;
    // Én flis per utgave, i den rekkefølgen de kom inn. Serveren velger.
    kapi
      .nylig()
      .then((d) => !avbrutt && setKort(d.kort || []))
      .catch((e) => !avbrutt && onFeil(e));
    return () => {
      avbrutt = true;
    };
  }, []);

  return (
    <>
      {banner ? (
        <div
          className="b-banner"
          style={banner.bredde && banner.hoyde ? { aspectRatio: `${banner.bredde} / ${banner.hoyde}` } : undefined}
        >
          <img src={bildeUrl(banner.bilde_id)} alt="" />
          {/* Peker banneret på et sett, fører hele bildet dit — knappen er
              bare det tydeligste stedet å trykke. */}
          {banner.sett && (
            <button
              className="b-banner-flate"
              aria-label={banner.tekst || "Se settet"}
              onClick={() => onSett(banner.sett)}
            />
          )}
          {banner.tekst && banner.plassering === "knapp" ? (
            <span
              className="b-banner-knapp"
              role={banner.sett ? undefined : "note"}
            >
              {banner.tekst}
            </span>
          ) : banner.tekst ? (
            <div className="b-banner-tekst">{banner.tekst}</div>
          ) : null}
        </div>
      ) : banner === null && (
      <div className="b-hero">
        <h1>Magic-kort fra Korthaien</h1>
        <p>
          {/* Søkefeltet sto her før. Nå står det i toppen på hver eneste side,
              og to søkefelt over hverandre er ett for mye. */}
          Enkeltkort fra eget lager, med tilstand og antall oppgitt for hvert
          kort. Søk i feltet øverst, eller bla gjennom butikken.
        </p>
      </div>
      )}

      {/* Sealed og komplette sett, oeverst og ved siden av hverandre. De
          staar foerst fordi de er det faerreste og dyreste du har — og de
          vises bare naar det finnes noe i dem. En seksjon som lenker til en
          tom side er verre enn ingen seksjon. */}
      {produktantall && PRODUKTTYPER.some((t) => (produktantall[t.id] || 0) > 0) && (
        <div className="b-seksjoner">
          {PRODUKTTYPER.filter((t) => (produktantall[t.id] || 0) > 0).map((t) => (
            <button key={t.id} className="b-seksjon" onClick={() => onProdukt(t.id)}>
              <h2>{t.navn}</h2>
              <p>{t.ingress}</p>
              <span className="b-seksjontall">
                {produktantall[t.id]} {produktantall[t.id] === 1 ? "produkt" : "produkter"} på lager →
              </span>
            </button>
          ))}
        </div>
      )}

      <div className="b-band">
        <div>
          <h2>Selg dine kort</h2>
          <p>
            Søk opp kortene eller lim inn hele lista. Du ser prisen med én
            gang, og hvor mange jeg har plass til.
          </p>
        </div>
        <a href="https://kortsalg.korthaien.no">Selg dine kort →</a>
      </div>

      {nyeste && nyeste.length > 0 && (
        <>
          <div className="b-rad">
            <h2>Nye sett i butikken</h2>
          </div>
          {/* Bildet er det dyreste kortet vi har i settet — det er kortet
              folk kjenner settet igjen paa. Hele flisa er klikkbar til
              settet, ikke til kortet: det er settet raden handler om. */}
          <div className="b-settrad">
            {nyeste.map((s) => (
              <button key={s.code} className="b-settflis" onClick={() => onSett(s.code)}>
                {s.kunst_uri || s.image_uri ? (
                  <img
                    src={s.kunst_uri || s.image_uri}
                    alt=""
                    loading="lazy"
                    className={s.kunst_uri ? "kunst" : undefined}
                  />
                ) : (
                  <div className="b-settflis-tom" />
                )}
                <span className="navn">{s.name}</span>
                {/* Ulike kort, ikke eksemplarer: 259 betyr 259 forskjellige
                    utgaver på lager, ikke 259 i bunken. */}
                <span className="linje">{s.kort} ulike kort</span>
              </button>
            ))}
          </div>
        </>
      )}

      <div className="b-rad">
        <h2>Nylig inn i butikken</h2>
        <button className="knapp liten hoyre" onClick={onButikk}>Hele butikken</button>
      </div>

      {kort === null && <p className="dempet">Henter kort…</p>}
      {kort !== null && kort.length === 0 && (
        <div className="tom">Ingen kort på lager ennå.</div>
      )}
      {kort !== null && kort.length > 0 && <FulleRader kort={kort} rader={2} onÅpne={onÅpne} />}

      <div className="b-info">
        <div>
          <h3>Tilstand oppgitt per kort</h3>
          <p>
            Hver tilstand har sin egen pris og sitt eget antall. Du ser hva som
            faktisk ligger i hylla.
          </p>
        </div>
        <div>
          <h3>Butikkreditt</h3>
          <p>
            Selger du kort til meg, blir oppgjøret kreditt du kan handle for
            her. Den utløper ikke.
          </p>
        </div>
        <div>
          <h3>Frakt fra 55 kr</h3>
          <p>
            Brev, liten eller stor norgespakke. Du velger selv hva som er verdt
            å forsikre.
          </p>
        </div>
      </div>
    </>
  );
}

// Ett kort i rutenettet på forsiden. Prisen er den billigste du faktisk har
// på lager.
//
// «Fra» står bare når det finnes flere priser å velge mellom — har du både NM
// og EX til ulik pris, er den billigste et utgangspunkt og ikke prisen. Har du
// bare én, er det prisen, og da er «fra» et forbehold mot ingenting.
function Flis({ kort, onÅpne }) {
  const priser = (kort.varianter || [])
    .flatMap((v) => v.tilstander || [])
    .filter((t) => t.lager > 0 && t.ore !== null && t.ore !== undefined)
    .map((t) => t.ore);
  const fra = priser.length ? Math.min(...priser) : null;
  const flerePriser = new Set(priser).size > 1;
  const antall = (kort.varianter || []).reduce((n, v) => n + (v.påLager || 0), 0);
  const foil = (kort.varianter || []).some((v) => v.finish === "foil" && v.påLager > 0);

  return (
    <button className="b-flis" onClick={onÅpne}>
      {kort.image_uri ? (
        // Bildet lastes først når det nærmer seg skjermen.
        <img src={kort.image_uri} alt={kort.name} loading="lazy" />
      ) : (
        <div style={{ width: "100%", aspectRatio: "488 / 680", background: "var(--papir)", borderRadius: 8 }} />
      )}
      <span className="navn">{kort.name}</span>
      <span className="linje">
        {kort.set_name} · {kort.collector_number}
        {kort.variant && kort.variant !== "vanlig" ? " · " + kort.variant : ""}
        {foil ? " · foil" : ""}
      </span>
      <span className="pris tall">
        {fra === null ? "Utsolgt" : (flerePriser ? "fra " : "") + kroner(fra)}
      </span>
      <span className="linje">{antall} på lager</span>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PRODUKTLISTE
// ─────────────────────────────────────────────────────────────────────────────
// Sealed og komplette sett har ingen tilstand aa velge mellom og ingen
// varianter aa bla i. Derfor ingen kortside og ingen fanerad — bare navn,
// bilde, pris og hvor mange du har. Et skjermbilde som later som om det er
// mer komplisert enn det er, er et skjermbilde i veien.
function Produktliste({ type, setKode, skjulTittel, onFeil }) {
  const [produkter, setProdukter] = useState(null);
  const valgt = PRODUKTTYPER.find((t) => t.id === type);

  useEffect(() => {
    let avbrutt = false;
    setProdukter(null);
    kapi
      .produkter({ type, sett: setKode || "", bareLager: 1 })
      .then((r) => !avbrutt && setProdukter(r.produkter || []))
      .catch((e) => {
        if (avbrutt) return;
        onFeil(e);
        setProdukter([]);
      });
    return () => {
      avbrutt = true;
    };
  }, [type, setKode]);

  return (
    <>
      {!skjulTittel && (
        <>
          <div className="b-rad">
            <h2>{valgt?.navn || "Produkter"}</h2>
          </div>
          {valgt?.ingress && <p className="dempet" style={{ marginTop: -6 }}>{valgt.ingress}</p>}
        </>
      )}

      {produkter === null && <p className="dempet">Henter…</p>}
      {produkter !== null && produkter.length === 0 && (
        <div className="tom">Ingenting på lager her akkurat nå.</div>
      )}
      {produkter !== null && produkter.length > 0 && (
        <div className="b-rute">
          {produkter.map((p) => <Produktflis key={p.id} produkt={p} />)}
        </div>
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// OM SETTET
// ─────────────────────────────────────────────────────────────────────────────
// Card Kingdom har en redaksjonell tekst her. Den maa noen skrive, og den
// blir staaende uendret naar lageret endrer seg. Disse tallene er sanne hver
// gang noen aapner sida, og ingen maa huske aa oppdatere dem.
function OmSettet({ info }) {
  if (!info) return <p className="dempet">Henter…</p>;
  const ikon = info.ikon || `https://svgs.scryfall.io/sets/${info.code}.svg`;
  const rader = [
    ["Sett", info.navn + (info.offisielt_navn !== info.navn ? ` (${info.offisielt_navn})` : "")],
    ["Settkode", info.code.toUpperCase()],
    ["Utgitt", info.utgitt ? nordato(info.utgitt) : "—"],
    ["Type", SETTYPER[info.set_type] || (info.set_type ? info.set_type.replace(/_/g, " ") : "—")],
    ["Antall kort", info.kort_i_settet
      ? `${info.kort_i_settet}${info.kort_med_varianter > info.kort_i_settet ? ` (${info.kort_med_varianter} med varianter)` : ""}`
      : "—"],
    ["Lovlig i", info.formater?.length ? info.formater.join(", ") : "—"],
    ["Foils", info.foil === "begge" ? "Ja" : info.foil === "bare_foil" ? "Bare foil" : "Nei"],
  ];
  return (
    <div className="panel">
      <div className="krop">
        <div className="rad-flex" style={{ gap: 14, marginBottom: 14 }}>
          <img src={ikon} alt="" style={{ width: 44, height: 44, objectFit: "contain" }}
            onError={(e) => { e.currentTarget.style.display = "none"; }} />
          <h2 style={{ margin: 0, fontSize: 22 }}>{info.navn}</h2>
        </div>
        <table className="b-omtabell">
          <tbody>
            {rader.map(([k, v]) => (
              <tr key={k}><th>{k}</th><td>{v}</td></tr>
            ))}
            <tr>
              <th>Korthaien har</th>
              <td>
                {info.ulike_på_lager} {info.kort_med_varianter || info.kort_i_settet ? `av ${info.kort_med_varianter || info.kort_i_settet} ` : ""}kort på lager
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Scryfalls settyper. Engelske ord, som rariteten — det er det spillerne bruker.
const SETTYPER = {
  core: "Core set", expansion: "Expansion", masters: "Masters", draft_innovation: "Draft innovation",
  commander: "Commander", alchemy: "Alchemy", masterpiece: "Masterpiece", arsenal: "Arsenal",
  from_the_vault: "From the Vault", spellbook: "Spellbook", premium_deck: "Premium deck",
  duel_deck: "Duel deck", starter: "Starter", box: "Box set", promo: "Promo", token: "Token",
  memorabilia: "Memorabilia", funny: "Un-set", planechase: "Planechase", archenemy: "Archenemy",
  vanguard: "Vanguard", treasure_chest: "Treasure chest", minigame: "Minigame",
};

function Omtall({ tall, tekst }) {
  return (
    <div className="b-omtall">
      <b>{tall}</b>
      <span>{tekst}</span>
    </div>
  );
}

// Rariteten på engelsk, slik spillerne sier den.
const RARITETSNAVN = {
  common: "Common", uncommon: "Uncommon", rare: "Rare",
  mythic: "Mythic", special: "Special", bonus: "Bonus",
};

// Ikke toLocaleString: den gir ulik tekst i ulike nettlesere, og dette skal
// se likt ut uansett hvem som ser paa.
const MÅNEDER = ["januar", "februar", "mars", "april", "mai", "juni", "juli",
  "august", "september", "oktober", "november", "desember"];
function nordato(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return `${d.getDate()}. ${MÅNEDER[d.getMonth()]} ${d.getFullYear()}`;
}

function Produktflis({ produkt: p }) {
  return (
    <div className="b-flis b-flis-stille">
      {p.bilde_url ? (
        <img className="produktbilde" src={p.bilde_url} alt={p.navn} loading="lazy" />
      ) : p.type === "komplettsett" && p.set_code ? (
        <SettStabel setCode={p.set_code} setNavn={p.set_navn} antall={p.set_antall} foil={p.foil} />
      ) : (
        <div
          className="b-flis-tomt"
          style={{ width: "100%", aspectRatio: "488 / 680", borderRadius: 8 }}
        />
      )}
      <span className="navn">{p.navn}</span>
      {p.beskrivelse && <span className="linje">{p.beskrivelse}</span>}
      {/* Én pris. En forseglet boks har ingen tilstand aa velge mellom, saa
          det staar ingen «fra» her — det ville vaert et forbehold mot
          ingenting. */}
      <span className="pris tall">{kroner(p.pris_ore)}</span>
      <span className="linje">{p.antall} på lager</span>
      <div style={{ marginTop: 6 }}><LeggProduktIKurven produkt={p} /></div>
    </div>
  );
}

function Rad({ navn, children }) {
  return (
    <div style={{ display: "flex", gap: 12, fontSize: 14, padding: "3px 0" }}>
      <span className="dempet" style={{ width: 96, flex: "none" }}>{navn}</span>
      <span>{children}</span>
    </div>
  );
}
