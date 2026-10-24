import { useState, useEffect } from "react";
import { api, lastOppBilde, bildeUrl } from "../api.js";

// ─────────────────────────────────────────────────────────────────────────────
// UTSEENDE
// ─────────────────────────────────────────────────────────────────────────────
// Butikkens tema. Ligger i innstillingene og ikke i nettleseren: det er
// butikkens utseende, ikke ditt. Bytter du her, ser kundene det samme.
//
// Hvert valg har en liten prøve tegnet i sitt eget tema, så du ser forskjellen
// uten å måtte velge først. Prøven bruker de samme klassene som butikken, så
// den kan ikke komme i utakt med den.

const TEMAER = [
  {
    id: "dagens",
    navn: "Dagens",
    om: "Dyp sjøgrønn og messing, system-skrift. Det butikken ser ut som nå.",
  },
  {
    id: "avis",
    navn: "Avis",
    om: "Avispapir og trykksverte. Fraunces i navn og priser, doble streker under toppen, rødt bare til «Selg dine kort». Ingen runde hjørner — trykksverte kaster ikke skygge.",
  },
  {
    id: "katalog",
    navn: "Katalog",
    om: "En varefortegnelse. Tall og koder i IBM Plex Mono, så sifrene står rett under hverandre nedover lista. Den tåler tusenvis av linjer best.",
  },
  {
    id: "pergament",
    navn: "Pergament",
    om: "Blekkblått og pergament med fiber i papiret, gull til prisen, EB Garamond til kortnavnene. Cinzel én gang, i ordmerket, aldri i en liste.",
  },
  {
    id: "lesesal",
    navn: "Lesesal",
    om: "Varmt papir og mørk topp. Literata i kortnavnene, Inter i alt annet, priser i rustrødt. All tekst minst 7:1.",
  },
  {
    id: "signal",
    navn: "Signal",
    om: "Mørkeblå topp og oransje salg, som Card Kingdom, men strammere. Atkinson Hyperlegible i kortnavnene. All tekst minst 7:1.",
  },
];

export default function Utseende({ onFeil, onMelding }) {
  const [valgt, setValgt] = useState(null);
  const [jobber, setJobber] = useState(false);
  const [banner, setBanner] = useState(null);

  useEffect(() => {
    api.innstillinger().then((s) => {
      setValgt(s.tema || "dagens");
      setBanner(s.toppbanner || { bilde_id: null, dato: null, aktiv: false });
    }).catch(onFeil);
  }, []);

  async function velg(id) {
    const forrige = valgt;
    setValgt(id);
    setJobber(true);
    try {
      await api.lagreInnstillinger({ tema: id });
      onMelding("Temaet er byttet. Åpne Butikk for å se det.");
    } catch (e) {
      setValgt(forrige);
      onFeil(e);
    } finally {
      setJobber(false);
    }
  }

  if (!valgt) return <p className="dempet">Henter…</p>;

  return (
    <>
    {banner && <Toppbilde start={banner} onFeil={onFeil} onMelding={onMelding} />}
    <div className="panel">
      <header><h3>Butikkens utseende</h3></header>
      <div className="krop">
        <p className="dempet" style={{ margin: "0 0 16px" }}>
          Temaet gjelder butikken, ikke adminpanelet, og det gjelder for alle —
          det ligger i innstillingene og ikke i nettleseren din. Ingenting
          flytter seg når du bytter: et tema bytter farge, skrift og form,
          aldri plassering.
        </p>

        <div className="temavalg">
          {TEMAER.map((t) => (
            <button
              key={t.id}
              className={`temakort ${valgt === t.id ? "valgt" : ""}`}
              disabled={jobber}
              aria-pressed={valgt === t.id}
              onClick={() => velg(t.id)}
            >
              <Prove tema={t.id} />
              <div className="temanavn">
                {t.navn}
                {valgt === t.id && <span className="merkelapp m-lager">i bruk</span>}
              </div>
              <p className="dempet">{t.om}</p>
            </button>
          ))}
        </div>
      </div>
    </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TOPPBILDET
// ─────────────────────────────────────────────────────────────────────────────
// Et stort bilde av neste sett øverst på forsiden. Teksten over bildet går
// av seg selv: «Kommer 13. november» fram til datoen, «Ute nå» i 30 dager
// etter, og så skjules bildet. Det kan aldri bli stående med en gammel dato.
const MND = ["januar", "februar", "mars", "april", "mai", "juni", "juli", "august", "september", "oktober", "november", "desember"];
const iDag = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Oslo" }).format(new Date());
const pluss = (d, n) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const norsk = (d) => { const [, m, dag] = d.split("-").map(Number); return `${dag}. ${MND[m - 1]}`; };

function Toppbilde({ start, onFeil, onMelding }) {
  const [b, setB] = useState(start);
  const [lagret, setLagret] = useState(start);
  const [størrelse, setStørrelse] = useState(null);
  const [jobber, setJobber] = useState(false);
  const endret = JSON.stringify(b) !== JSON.stringify(lagret);

  async function last(fil) {
    if (!fil) return;
    setJobber(true);
    try {
      const r = await lastOppBilde(fil);
      setB((x) => ({ ...x, bilde_id: r.id, aktiv: true }));
      setStørrelse({ bredde: r.bredde, hoyde: r.hoyde });
    } catch (e) {
      onFeil(e);
    }
    setJobber(false);
  }

  async function lagre(ny = b) {
    setJobber(true);
    try {
      const s = await api.lagreInnstillinger({ toppbanner: ny });
      setB(s.toppbanner);
      setLagret(s.toppbanner);
      onMelding(ny.aktiv && ny.bilde_id ? "Toppbildet er lagret." : "Toppbildet er skjult.");
    } catch (e) {
      onFeil(e);
    }
    setJobber(false);
  }

  const d = iDag();
  const status = !b.bilde_id
    ? "Ingen bilde lastet opp. Forsiden viser den vanlige teksten."
    : !b.dato
      ? "Velg utgivelsesdatoen, så vet bildet hva det skal si."
      : !b.aktiv
        ? "Skjult. Forsiden viser den vanlige teksten."
        : d < b.dato
          ? `Viser «Kommer ${norsk(b.dato)}» til ${norsk(pluss(b.dato, -1))}, «Ute nå» fram til ${norsk(pluss(b.dato, 29))}, så skjules bildet av seg selv.`
          : d < pluss(b.dato, 30)
            ? `Viser «Ute nå» fram til ${norsk(pluss(b.dato, 29))}, så skjules bildet av seg selv.`
            : "Datoen er passert med mer enn 30 dager. Bildet vises ikke lenger.";

  return (
    <div className="panel">
      <header><h3>Toppbilde på forsiden</h3></header>
      <div className="krop skjema">
        <p className="dempet" style={{ margin: 0 }}>
          Et stort bilde av neste sett øverst på forsiden. Bruk et bilde som er minst 1600 piksler bredt,
          gjerne fra butikkpakken til settet. Mindre bilder blir uskarpe på store skjermer.
        </p>
        {b.bilde_id ? (
          <div style={{ maxWidth: 640, overflow: "hidden", borderRadius: 8, background: "#111" }}>
            <img
              src={bildeUrl(b.bilde_id)}
              alt="Toppbildet slik det vises på forsiden"
              style={{ width: "100%", height: "auto", display: "block" }}
              onLoad={(e) => setStørrelse((s) => s || { bredde: e.target.naturalWidth, hoyde: e.target.naturalHeight })}
            />
          </div>
        ) : null}
        {størrelse && størrelse.bredde < 1600 && (
          <p style={{ margin: 0, fontSize: 13, color: "var(--advarsel)" }}>
            Bildet er {størrelse.bredde} × {størrelse.hoyde} piksler. Under 1600 piksler bredt blir det uskarpt
            over hele bredden. Finn en større utgave hvis du kan.
          </p>
        )}
        <label>
          {b.bilde_id ? "Bytt bilde" : "Last opp bilde"} (JPEG, PNG eller WebP)
          <input type="file" accept="image/jpeg,image/png,image/webp" disabled={jobber} onChange={(e) => last(e.target.files?.[0])} />
        </label>
        <label style={{ maxWidth: 220 }}>
          Utgivelsesdato
          <input type="date" value={b.dato || ""} onChange={(e) => setB({ ...b, dato: e.target.value || null })} />
        </label>
        <label className="rad-flex" style={{ gap: 8 }}>
          <input type="checkbox" checked={!!b.aktiv} onChange={(e) => setB({ ...b, aktiv: e.target.checked })} />
          Vis toppbildet på forsiden
        </label>
        <p className="dempet" style={{ margin: 0, fontSize: 13 }}>{status}</p>
        <div className="rad-flex">
          <button className="knapp primar" disabled={jobber || !endret} onClick={() => lagre()}>Lagre</button>
        </div>
      </div>
    </div>
  );
}

// Prøven er butikkens egne klasser i miniatyr: topplinjene, et kortnavn, en
// pris og tilstandsvelgeren. Den henter stilen fra samme sted som butikken,
// så det du ser her er det du får der.
function Prove({ tema }) {
  return (
    <div className="butikk prove" data-tema={tema}>
      <div className="b-skall-topp">
        <div className="b-linje1">
          <div className="b-midt">
            <span className="b-logo">
              <svg viewBox="88 22 128 136" fill="currentColor" aria-hidden="true">
                <path d="M95 150C125 132 172 88 208 30 186 76 182 118 196 150Z" />
              </svg>
              <span>Korthaien</span>
            </span>
          </div>
        </div>
        <div className="b-linje2">
          <div className="b-midt">
            <span className="b-navvalg">Alle sett</span>
            <span className="b-selg">Selg dine kort</span>
          </div>
        </div>
      </div>
      <div className="provekrop">
        <div className="lenke provenavn">Mana Crypt</div>
        <div className="dempet provesett">Eternal Masters · 225</div>
        <div className="tall pris-stor">1 890 kr</div>
        <div className="cond-valg">
          <button aria-pressed="true">NM</button>
          <button>EX</button>
          <button className="tom">VG</button>
        </div>
      </div>
    </div>
  );
}
