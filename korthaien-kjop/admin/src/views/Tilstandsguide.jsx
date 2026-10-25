import { useState, useEffect } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// TILSTANDSGUIDE (BUTIKKEN)
// ─────────────────────────────────────────────────────────────────────────────
// Hva NM, EX, VG og G betyr for kortene du kjøper. Samme grader og samme
// eksempelbilder som innkjøpssiden bruker — kortene graderes én gang, når de
// kommer inn, og det er den graderingen som står i butikken.

const GRADER = [
  {
    kode: "NM",
    navn: "Near Mint",
    kort: "Som nytt",
    farge: "#2f7d4f",
    beskrivelse:
      "Kortet ser ut som det nettopp kom ut av pakken. Skarpe kanter, blank " +
      "overflate, ingen bøy. Ser du hvite prikker langs kanten når du holder " +
      "kortet mot en mørk bakgrunn, er det ikke Near Mint.",
    tillatt: [
      "Én eller to nesten usynlige merker som bare vises i skrått lys",
      "Minimal ujevnhet i kuttet fra fabrikken",
    ],
    ikke: ["Hvite prikker på kantene", "Synlige riper", "Bøy av noe slag"],
    bilder: [
      { fil: "NM1.jpg", tekst: "Skarpe, jevnt svarte kanter hele veien rundt." },
      { fil: "NM2.jpg", tekst: "Ren overflate uten riper eller merker." },
    ],
  },
  {
    kode: "EX",
    navn: "Excellent",
    kort: "Lett brukt",
    farge: "#2b6f8f",
    beskrivelse:
      "Kortet har vært i bruk, men forsiktig. Noen få hvite prikker på kantene " +
      "eller en lett ripe i overflaten. På avstand og i sleeve ser det fint ut.",
    tillatt: [
      "Enkelte hvite prikker langs kant eller hjørne",
      "En lett ripe som ikke fanger neglen",
      "Helt svak bøy som forsvinner når kortet ligger flatt",
    ],
    ikke: ["Slitasje langs hele kanten", "Riper du kjenner med neglen", "Synlig bøy"],
    bilder: [
      { fil: "EX1.jpg", tekst: "Noen få lyse punkter langs venstre kant. Resten er ren." },
      { fil: "EX2.jpg", tekst: "Nærbilde i skrått lys: svake trykkmerker i overflaten." },
    ],
  },
  {
    kode: "VG",
    navn: "Very Good",
    kort: "Tydelig brukt",
    farge: "#a8742a",
    beskrivelse:
      "Slitasjen er tydelig, men kortet er helt og rent. Hvite kanter flere " +
      "steder, noen riper, kanskje en svak bøy. Dette er et kort som har vært " +
      "spilt uten sleeve.",
    tillatt: [
      "Hvite kanter på flere sider",
      "Riper som synes i vanlig lys",
      "Svak bøy",
      "Lett slitte hjørner",
    ],
    ikke: ["Fold eller knekk", "Skitt eller flekker", "Slitasje som går gjennom trykket"],
    bilder: [
      { fil: "VG1.jpg", tekst: "Tydelig slitasje i hjørnene og lyse partier langs kantene." },
      { fil: "VG2.jpg", tekst: "Slitasjen går rundt flere sider, men trykket er helt." },
    ],
  },
  {
    kode: "G",
    navn: "Good",
    kort: "Kraftig brukt",
    farge: "#6b7280",
    beskrivelse:
      "Kortet er tydelig slitt, men fortsatt helt og spillbart i sleeve. Hvite " +
      "kanter hele veien rundt, tydelige riper, merkbar bøy. Trykket er intakt.",
    tillatt: [
      "Hvite kanter rundt hele kortet",
      "Tydelige riper og bruksmerker",
      "Merkbar bøy",
      "Slitte hjørner",
    ],
    ikke: ["Hull, rift eller manglende biter", "Vannskade", "Skrift, tusj eller tape"],
    bilder: [
      { fil: "G1.jpg", tekst: "Kraftig slitte kanter og hjørner, riper i overflaten." },
      { fil: "G2.jpg", tekst: "Slitasje hele veien rundt. Kortet er fortsatt helt." },
    ],
  },
];

export default function Tilstandsguide() {
  const [stort, setStort] = useState(null);
  const alle = GRADER.flatMap((g) => (g.bilder || []).map((b) => ({ ...b, grad: g })));

  useEffect(() => {
    if (!stort) return;
    const tast = (e) => {
      if (e.key === "Escape") setStort(null);
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        const i = alle.findIndex((b) => b.fil === stort.fil);
        setStort(alle[(i + (e.key === "ArrowRight" ? 1 : -1) + alle.length) % alle.length]);
      }
    };
    window.addEventListener("keydown", tast);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", tast);
      document.body.style.overflow = "";
    };
  }, [stort]);

  return (
    <div className="tilstandsguide">
      <h1 style={{ marginBottom: 6 }}>Tilstandsguide</h1>
      <p className="dempet" style={{ marginTop: 0, maxWidth: "66ch", lineHeight: 1.6 }}>
        Hvert kort i butikken har en tilstand, og hver tilstand har sin egen pris og sitt eget antall. Kortene
        graderes for hånd når de kommer inn, etter den dårligste delen av kortet — forside og bakside.
      </p>

      <div className="varsel info" style={{ maxWidth: "70ch" }}>
        <b>Får du et kort som ikke stemmer med tilstanden?</b> Ta kontakt på{" "}
        <a href="mailto:korthaien@gmail.com">korthaien@gmail.com</a>, så finner vi en løsning — bytte, prisavslag
        eller pengene tilbake.
      </div>

      {GRADER.map((g) => (
        <div className="panel" key={g.kode}>
          <div className="krop">
            <div className="rad-flex" style={{ gap: 10, marginBottom: 6 }}>
              <span style={{ background: g.farge, color: "#fff", fontWeight: 700, fontSize: 13, padding: "3px 10px", borderRadius: 5 }}>
                {g.kode}
              </span>
              <strong style={{ fontSize: 17 }}>{g.navn}</strong>
              <span className="dempet">— {g.kort}</span>
            </div>
            <p style={{ margin: "0 0 12px", lineHeight: 1.65, maxWidth: "62ch" }}>{g.beskrivelse}</p>
            {g.bilder && (
              <div className="tilstandsbilder">
                {g.bilder.map((b) => (
                  <figure key={b.fil}>
                    <button className="bildeknapp" onClick={() => setStort({ ...b, grad: g })} title="Klikk for å forstørre">
                      <img src={`/tilstander/${b.fil}`} alt={`${g.navn} — ${b.tekst}`} loading="lazy" />
                    </button>
                    <figcaption className="dempet">{b.tekst}</figcaption>
                  </figure>
                ))}
              </div>
            )}
            <div className="todelt-smal">
              <div>
                <div className="dempet" style={{ fontSize: 13, marginBottom: 3 }}>Kan ha</div>
                <ul style={{ margin: 0, paddingLeft: 20, lineHeight: 1.6 }}>
                  {g.tillatt.map((x, i) => <li key={i}>{x}</li>)}
                </ul>
              </div>
              <div>
                <div className="dempet" style={{ fontSize: 13, marginBottom: 3 }}>Har ikke</div>
                <ul style={{ margin: 0, paddingLeft: 20, lineHeight: 1.6 }}>
                  {g.ikke.map((x, i) => <li key={i}>{x}</li>)}
                </ul>
              </div>
            </div>
          </div>
        </div>
      ))}

      <div className="panel">
        <div className="krop">
          <h2 style={{ marginTop: 0, fontSize: 17 }}>Foil</h2>
          <p style={{ margin: 0, lineHeight: 1.7, maxWidth: "62ch" }}>
            Foil-kort bøyer seg nesten alltid litt. En lett bue trekker ikke ned så lenge resten av kortet er fint.
          </p>
        </div>
      </div>

      {stort && (
        <div className="lupe" onClick={() => setStort(null)} role="dialog" aria-modal="true">
          <button className="lupe-lukk" aria-label="Lukk">×</button>
          <img
            src={`/tilstander/${stort.fil.replace(".jpg", "-stor.jpg")}`}
            alt={`${stort.grad.navn} — ${stort.tekst}`}
            onClick={(e) => e.stopPropagation()}
          />
          <div className="lupe-tekst" onClick={(e) => e.stopPropagation()}>
            <b>{stort.grad.kode} — {stort.grad.navn}</b>
            <div>{stort.tekst}</div>
            <div style={{ fontSize: 12, marginTop: 6, opacity: 0.75 }}>Piltastene blar mellom gradene. Escape lukker.</div>
          </div>
        </div>
      )}
    </div>
  );
}
