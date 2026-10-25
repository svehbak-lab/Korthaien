// ─────────────────────────────────────────────────────────────────────────────
// LANDINGSSIDEN
// ─────────────────────────────────────────────────────────────────────────────
// Vises i stedet for butikken mens den er stengt — i dagene mellom at Mystore
// stenger og lageret er flyttet over. Admin ser butikken som vanlig, så alt
// kan sjekkes før døra åpnes. Kassen er stengt på serveren også; denne siden
// er bare det kunden ser.

export const STANDARD_TITTEL = "Ny nettbutikk på vei";
export const STANDARD_TEKST =
  "Vi flytter Korthaien til en ny nettbutikk. Butikken er stengt noen dager mens lageret telles over — " +
  "kontoen og kreditten din blir med.";

const penDato = (d) =>
  new Date(`${d}T12:00:00`).toLocaleDateString("nb-NO", { day: "numeric", month: "long", year: "numeric" });

export default function Landing({ tema, tittel, tekst, dato, forhåndsvisning }) {
  const åpner = dato && new Date(`${dato}T23:59:59`) >= new Date() ? dato : null;
  return (
    <div className={`butikk landing${forhåndsvisning ? " landing-liten" : ""}`} data-tema={tema || "dagens"}>
      <div className="landing-kort">
        <div className="landing-merke">
          <svg viewBox="88 22 128 136" fill="currentColor" aria-hidden="true">
            <path d="M95 150C125 132 172 88 208 30 186 76 182 118 196 150Z" />
          </svg>
          <span>Korthaien</span>
        </div>
        <h1>{tittel || STANDARD_TITTEL}</h1>
        {åpner && <p className="landing-dato">Åpner {penDato(åpner)}</p>}
        <p className="landing-tekst">{tekst || STANDARD_TEKST}</p>
        <div className="landing-lenker">
          <a className="knapp primar" href="https://kortsalg.korthaien.no">Selg kortene dine til oss</a>
          <a className="knapp" href="mailto:korthaien@gmail.com">korthaien@gmail.com</a>
        </div>
      </div>
    </div>
  );
}
