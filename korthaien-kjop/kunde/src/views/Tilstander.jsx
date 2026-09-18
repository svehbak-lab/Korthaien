// ─────────────────────────────────────────────────────────────────────────────
// TILSTANDSGUIDE
// ─────────────────────────────────────────────────────────────────────────────
// Kunden skal kunne vurdere kortene sine før de sendes, og guiden er det jeg
// blir holdt til hvis vi er uenige etterpå. Derfor er den skrevet så konkret
// som mulig: hva du ser etter, og hvor grensen går.

const GRADER = [
  {
    kode: "NM",
    navn: "Near Mint",
    kort: "Som nytt",
    farge: "var(--ok)",
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
    farge: "var(--sjo)",
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
    farge: "var(--brass)",
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
    farge: "var(--dempet)",
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

export default function Tilstander({ onTilbake }) {
  return (
    <>
      <h1>Hvilken tilstand har kortet?</h1>
      <p className="ingress">
        Fire trinn. Vurder kortet i godt lys, og se på både forside og bakside —
        graderingen følger den dårligste delen av kortet. Er forsiden perfekt og
        baksiden bøyd, er det baksiden som bestemmer.
      </p>

      <div className="varsel info">
        <b>Er du i tvil, velg det laveste.</b> Jeg går gjennom hvert kort ved
        mottak, og retter tilstanden der den ikke stemmer. Har du satt den for
        høyt, går summen ned og du får beskjed om hvorfor. Har du satt den for
        lavt, går den opp — du taper ikke på å være forsiktig.
      </div>

      {GRADER.map((g) => (
        <div className="panel" key={g.kode}>
          <div className="rad-flex" style={{ gap: 10, marginBottom: 6 }}>
            <span
              style={{
                background: g.farge,
                color: "#fff",
                fontWeight: 700,
                fontSize: 13,
                padding: "3px 10px",
                borderRadius: 5,
              }}
            >
              {g.kode}
            </span>
            <strong style={{ fontSize: 17 }}>{g.navn}</strong>
            <span className="dempet">— {g.kort}</span>
          </div>

          <p style={{ margin: "0 0 12px", lineHeight: 1.65, maxWidth: "62ch" }}>
            {g.beskrivelse}
          </p>

          {g.bilder && (
            <div className="tilstandsbilder">
              {g.bilder.map((b) => (
                <figure key={b.fil}>
                  <img
                    src={`/tilstander/${b.fil}`}
                    alt={`${g.navn} — ${b.tekst}`}
                    loading="lazy"
                  />
                  <figcaption className="dempet">{b.tekst}</figcaption>
                </figure>
              ))}
            </div>
          )}

          <div className="todelt-smal">
            <div>
              <div className="dempet" style={{ fontSize: 13, marginBottom: 3 }}>Greit</div>
              <ul style={{ margin: 0, paddingLeft: 20, lineHeight: 1.6 }}>
                {g.tillatt.map((x, i) => <li key={i}>{x}</li>)}
              </ul>
            </div>
            <div>
              <div className="dempet" style={{ fontSize: 13, marginBottom: 3 }}>Da er det lavere</div>
              <ul style={{ margin: 0, paddingLeft: 20, lineHeight: 1.6 }}>
                {g.ikke.map((x, i) => <li key={i}>{x}</li>)}
              </ul>
            </div>
          </div>
        </div>
      ))}

      <div className="panel">
        <h2 style={{ marginTop: 0 }}>Kort jeg ikke tar imot</h2>
        <p style={{ marginTop: 0 }}>
          Uansett hvor sjeldent kortet er, kjøper jeg ikke inn kort med disse
          skadene gjennom denne siden. Har du et verdifullt kort i dårlig stand,
          ta kontakt på{" "}
          <a href="mailto:korthaien@gmail.com">korthaien@gmail.com</a> i stedet —
          da ser vi på det hver for seg.
        </p>
        <ul style={{ margin: 0, paddingLeft: 20, lineHeight: 1.7 }}>
          <li>Rift, hull eller manglende biter</li>
          <li>Vannskade, bølgete overflate eller flekker</li>
          <li>Skrift, tusj, klistremerker eller tape</li>
          <li>Kort som er klippet, trimmet eller malt på</li>
          <li>Falske kort og proxyer</li>
        </ul>
      </div>

      <div className="panel">
        <h2 style={{ marginTop: 0 }}>Slik ser du etter</h2>
        <p style={{ marginTop: 0, lineHeight: 1.7, maxWidth: "62ch" }}>
          Legg kortet på et mørkt underlag. Da kommer hvite prikker langs kantene
          tydelig fram — det er den vanligste slitasjen, og den som oftest blir
          oversett. Hold kortet i skrått lys mot et vindu for å se riper i
          overflaten. Legg det flatt på bordet for å se om det er bøyd.
        </p>
        <p style={{ margin: "10px 0 0", lineHeight: 1.7, maxWidth: "62ch" }}>
          Foil bøyer seg nesten alltid litt. En lett bue på et foil-kort trekker
          ikke ned så lenge resten er fin.
        </p>
      </div>

      <div className="rad-flex ingen-print">
        <button className="knapp primar" onClick={onTilbake}>Tilbake til søket</button>
      </div>
    </>
  );
}
