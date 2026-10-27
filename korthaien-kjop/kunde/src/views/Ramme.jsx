// ─────────────────────────────────────────────────────────────────────────────
// TOPPEN OG BUNNEN — SOM I BUTIKKEN
// ─────────────────────────────────────────────────────────────────────────────
// Salgssiden er en del av butikken for kunden, og skal se slik ut: samme to
// linjer øverst, samme bunn, samme tema. Klassene er butikkens (.b-linje1,
// .b-selg …), og stilen hentes fra butikken ved bygging (scripts/butikktema.mjs).
//
// Alt som hører til butikken, lenker dit: søket, settene, kurven, kontoen.
// Butikken forstår ?side= og ?q=, så kunden lander der hen trykket.

const BUTIKK_STANDARD = "https://korthaien.no";

export const butikkUrl = (config) => String(config?.butikk_url || BUTIKK_STANDARD).replace(/\/+$/, "");

function Kurvikon({ navn, antall, href, title }) {
  const innhold = (
    <>
      <span className="b-kurvikon">
        <svg width="21" height="21" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7">
          <path d="M2 3h2.2l2 9.5h9l2-7H6" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="8" cy="16.5" r="1.3" fill="currentColor" stroke="none" />
          <circle cx="15" cy="16.5" r="1.3" fill="currentColor" stroke="none" />
        </svg>
        {antall !== null && <span className="b-antall">{antall}</span>}
      </span>
      <span className="b-kurvnavn">{navn}</span>
    </>
  );
  return (
    <a className="b-kurv" href={href} title={title} style={{ textDecoration: "none" }}>
      {innhold}
    </a>
  );
}

export function Topp({ config, meg, antallSelg, onSelgKurv }) {
  const b = butikkUrl(config);
  const side = (s) => `${b}/?side=${s}`;
  const tilbake = typeof window !== "undefined" ? window.location.origin + window.location.pathname : "";
  return (
    <div className="b-skall-topp ingen-print">
      <div className="b-linje1">
        <div className="b-midt">
          <a className="b-logo" href={b} title="Til butikken" style={{ textDecoration: "none" }}>
            <svg viewBox="88 22 128 136" fill="currentColor" aria-hidden="true">
              <path d="M95 150C125 132 172 88 208 30 186 76 182 118 196 150Z" />
            </svg>
            <span>Korthaien</span>
          </a>

          {/* Søket i toppen er butikkens: der finnes kortene du kan kjøpe.
              Kortene du vil selge, søker du opp i feltet under. */}
          <form className="b-toppsok" role="search" action={`${b}/`} method="get">
            <input type="search" name="q" placeholder="Søk etter kort i butikken" aria-label="Søk etter kort i butikken" />
            <button type="submit" aria-label="Søk">
              <svg width="17" height="17" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="7" cy="7" r="5" />
                <path d="M11 11l4 4" strokeLinecap="round" />
              </svg>
            </button>
          </form>

          <div className="b-hoyre">
            {meg?.kunde ? (
              <a className="b-toppknapp" href={side("konto")} style={{ textDecoration: "none" }}>Min side</a>
            ) : (
              <a className="b-toppknapp" href={`${b}/?tilbake=${encodeURIComponent(tilbake)}`} style={{ textDecoration: "none" }}>
                Logg inn
              </a>
            )}
            {/* Handlekurven bor i butikken, på en annen adresse — antallet
                kan ikke leses herfra, så symbolet står uten tall. */}
            <Kurvikon navn="Kjøp" antall={null} href={side("kurv")} title="Handlekurven i butikken" />
            <button className="b-kurv" title="Kortene du selger" onClick={onSelgKurv}>
              <span className="b-kurvikon">
                <svg width="21" height="21" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7">
                  <path d="M2 3h2.2l2 9.5h9l2-7H6" strokeLinecap="round" strokeLinejoin="round" />
                  <circle cx="8" cy="16.5" r="1.3" fill="currentColor" stroke="none" />
                  <circle cx="15" cy="16.5" r="1.3" fill="currentColor" stroke="none" />
                </svg>
                <span className="b-antall">{antallSelg}</span>
              </span>
              <span className="b-kurvnavn">Selg</span>
            </button>
          </div>
        </div>
      </div>

      <div className="b-linje2">
        <div className="b-midt">
          <a className="b-navvalg" href={side("sett")} style={{ textDecoration: "none" }}>Alle sett</a>
          <a className="b-navvalg" href={side("sealed")} style={{ textDecoration: "none" }}>Sealed</a>
          <a className="b-navvalg" href={side("komplettsett")} style={{ textDecoration: "none" }}>Komplette sett</a>
          <span className="b-selgknapper">
            <a className="b-selg-tix" href={side("tix")} style={{ textDecoration: "none" }}>Selg MTGO-tix</a>
            <a className="b-selg" href="/">Selg dine kort</a>
          </span>
        </div>
      </div>
    </div>
  );
}

const SPALTER = [
  {
    navn: "Kundeservice",
    punkter: [
      { tekst: "Kontakt oss", side: "kontakt" },
      { tekst: "Frakt og levering", side: "frakt" },
      { tekst: "Retur og angrerett", side: "retur" },
      { tekst: "Tilstandsguide", side: "tilstand" },
    ],
  },
  {
    navn: "Min konto",
    punkter: [
      { tekst: "Logg inn", side: "konto" },
      { tekst: "Mine kjøp", side: "minekjop" },
      { tekst: "Mine salg", side: "minesalg" },
      { tekst: "Ønskeliste", side: "onskeliste" },
    ],
  },
  {
    navn: "Verktøy",
    punkter: [
      { tekst: "Selg kortene dine", her: true },
      { tekst: "Selg MTGO-tix", side: "tix" },
      { tekst: "Bulksøk", side: "bulksok" },
    ],
  },
  {
    navn: "Korthaien",
    punkter: [
      { tekst: "Om oss", side: "omoss" },
      { tekst: "Butikkreditt", side: "kreditt" },
      { tekst: "Kjøpsvilkår", side: "vilkar" },
      { tekst: "Personvern", side: "personvern" },
    ],
  },
];

export function Bunn({ config, onVilkår, onOppslag }) {
  const b = butikkUrl(config);
  return (
    <footer className="b-bunn ingen-print">
      <div className="b-midt b-bunnrad">
        {SPALTER.map((s) => (
          <nav key={s.navn}>
            <h4>{s.navn}</h4>
            <ul>
              {s.punkter.map((p) => (
                <li key={p.tekst}>
                  <a className="b-bunnlenke" href={p.her ? "/" : `${b}/?side=${p.side}`}>{p.tekst}</a>
                </li>
              ))}
              {s.navn === "Verktøy" && (
                <li>
                  <button className="b-bunnlenke" onClick={onOppslag}>Finn innsendt ordre</button>
                </li>
              )}
            </ul>
          </nav>
        ))}
      </div>
      <div className="b-midt b-bunnjus">
        <span>
          <button className="b-bunnlenke" style={{ display: "inline", padding: 0 }} onClick={onVilkår}>
            Vilkår for salg til Korthaien
          </button>
          {" · "}
          <a className="b-bunnlenke" style={{ display: "inline" }} href={`${b}/?side=personvern`}>Personvern</a>
        </span>
        <span className="dempet">
          © {new Date().getFullYear()} Korthaien · Magic: The Gathering er et varemerke
          som tilhører Wizards of the Coast. Korthaien er ikke tilknyttet dem.
        </span>
      </div>
    </footer>
  );
}
