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
  {
    id: "juletre",
    navn: "Jul: Juletre",
    om: "Granskog, julerødt og gull på kremhvitt. Gullstripe under menyen, Fraunces i navnene, priser i gull. Det klassiske.",
  },
  {
    id: "julenatt",
    navn: "Jul: Julenatt",
    om: "Midnattsblått med snø i toppen, rødt til «Selg dine kort» og prisene. Kjølig og rolig, lett å lese.",
  },
  {
    id: "pepperkake",
    navn: "Jul: Pepperkake",
    om: "Pepperkakebrunt og melisglasur, polkagrisstripe under menyen og stiplet søkefelt. Varmt og lekent.",
  },
];

export default function Utseende({ onFeil, onMelding }) {
  const [valgt, setValgt] = useState(null);
  const [jobber, setJobber] = useState(false);
  const [banner, setBanner] = useState(null);

  useEffect(() => {
    api.innstillinger().then((s) => {
      setValgt(s.tema || "dagens");
      setBanner(s.toppbanner || { bilde_id: null, aktiv: false });
    }).catch(onFeil);
  }, []);

  async function velg(id) {
    const forrige = valgt;
    setValgt(id);
    setJobber(true);
    try {
      await api.lagreInnstillinger({ tema: id });
      window.dispatchEvent(new CustomEvent("korthaien-tema", { detail: id }));
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
    {banner && <Toppbilde start={banner} tema={valgt} onFeil={onFeil} onMelding={onMelding} />}
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
// Et stort bilde øverst på forsiden, med en tekst du skriver selv. Teksten
// står i hjørnet, eller som en knapp midt på bildet i temaets aksentfarge.
// Peker du på et sett, fører et trykk på bildet dit.
function Toppbilde({ start, tema, onFeil, onMelding }) {
  const tom = { bilde_id: null, tekst: "", plassering: "hjorne", sett: null, aktiv: false };
  const [b, setB] = useState({ ...tom, ...start, tekst: start.tekst || "" });
  const [lagret, setLagret] = useState(b);
  const [størrelse, setStørrelse] = useState(null);
  const [sett, setSett] = useState([]);
  const [jobber, setJobber] = useState(false);
  const endret = JSON.stringify(b) !== JSON.stringify(lagret);

  useEffect(() => {
    api.sett().then((r) => {
      const liste = [...(r.sett || [])].sort((x, y) => String(y.released_at || "").localeCompare(String(x.released_at || "")));
      setSett(liste);
    }).catch(() => {});
  }, []);

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

  async function lagre() {
    setJobber(true);
    try {
      const s = await api.lagreInnstillinger({ toppbanner: b });
      const ny = { ...tom, ...s.toppbanner, tekst: s.toppbanner?.tekst || "" };
      setB(ny);
      setLagret(ny);
      onMelding(ny.aktiv && ny.bilde_id ? "Toppbildet er lagret." : "Toppbildet er skjult.");
    } catch (e) {
      onFeil(e);
    }
    setJobber(false);
  }

  return (
    <div className="panel">
      <header><h3>Toppbilde på forsiden</h3></header>
      <div className="krop skjema">
        <p className="dempet" style={{ margin: 0 }}>
          Et stort bilde øverst på forsiden. Bruk et bilde som er minst 1600 piksler bredt; mindre bilder blir
          uskarpe på store skjermer.
        </p>

        {b.bilde_id ? (
          // Butikkens egne klasser i temaet som er valgt, så forhåndsvisningen
          // er det kundene ser — også fargen på knappen.
          <div className="butikk" data-tema={tema} style={{ margin: 0, padding: 0, minHeight: 0, background: "transparent", maxWidth: 640 }}>
            <div
              className="b-banner"
              style={{ marginBottom: 0, ...(størrelse ? { aspectRatio: `${størrelse.bredde} / ${størrelse.hoyde}` } : {}) }}
            >
              <img
                src={bildeUrl(b.bilde_id)}
                alt="Toppbildet slik det vises på forsiden"
                onLoad={(e) => setStørrelse((s) => s || { bredde: e.target.naturalWidth, hoyde: e.target.naturalHeight })}
              />
              {b.tekst && b.plassering === "knapp" && <span className="b-banner-knapp">{b.tekst}</span>}
              {b.tekst && b.plassering !== "knapp" && <div className="b-banner-tekst">{b.tekst}</div>}
            </div>
          </div>
        ) : null}
        {størrelse && størrelse.bredde < 1600 && (
          <p style={{ margin: 0, fontSize: 13, color: "var(--advarsel)" }}>
            Bildet er {størrelse.bredde} × {størrelse.hoyde} piksler. Under 1600 piksler bredt blir det uskarpt
            over hele bredden.
          </p>
        )}

        <label>
          {b.bilde_id ? "Bytt bilde" : "Last opp bilde"} (JPEG, PNG eller WebP)
          <input type="file" accept="image/jpeg,image/png,image/webp" disabled={jobber} onChange={(e) => last(e.target.files?.[0])} />
        </label>

        <label style={{ maxWidth: 420 }}>
          Tekst
          <input
            value={b.tekst}
            maxLength={80}
            placeholder="Kommer 13. november"
            onChange={(e) => setB({ ...b, tekst: e.target.value })}
          />
          <span className="dempet" style={{ fontSize: 12 }}>Tomt felt: bare bildet.</span>
        </label>

        <div>
          <div style={{ fontSize: 13, marginBottom: 4 }}>Plassering</div>
          <label className="rad-flex" style={{ gap: 8 }}>
            <input type="radio" name="plassering" checked={b.plassering !== "knapp"} onChange={() => setB({ ...b, plassering: "hjorne" })} />
            Nede i hjørnet
          </label>
          <label className="rad-flex" style={{ gap: 8 }}>
            <input type="radio" name="plassering" checked={b.plassering === "knapp"} onChange={() => setB({ ...b, plassering: "knapp" })} />
            Knapp midt på bildet, i temaets aksentfarge
          </label>
        </div>

        <label style={{ maxWidth: 420 }}>
          Trykk på bildet fører til
          <select value={b.sett || ""} onChange={(e) => setB({ ...b, sett: e.target.value || null })}>
            <option value="">Ingen steder</option>
            {sett.map((s) => (
              <option key={s.code} value={s.code}>{s.visningsnavn || s.name}</option>
            ))}
          </select>
          {b.plassering === "knapp" && !b.sett && (
            <span style={{ fontSize: 12, color: "var(--advarsel)" }}>
              En knapp bør føre et sted. Velg et sett, eller bruk tekst i hjørnet.
            </span>
          )}
        </label>

        <label className="rad-flex" style={{ gap: 8 }}>
          <input type="checkbox" checked={!!b.aktiv} onChange={(e) => setB({ ...b, aktiv: e.target.checked })} />
          Vis toppbildet på forsiden
        </label>
        <div className="rad-flex">
          <button className="knapp primar" disabled={jobber || !endret} onClick={lagre}>Lagre</button>
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
