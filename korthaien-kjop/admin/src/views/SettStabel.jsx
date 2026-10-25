// ─────────────────────────────────────────────────────────────────────────────
// BILDET TIL ET KOMPLETT SETT
// ─────────────────────────────────────────────────────────────────────────────
// Tegnes, ikke lastes: en vifte av kort med settsymbolet over og en etikett
// med settnavn og antall kort. Foil får regnbuekort og det gule foilmerket
// som ellers i butikken. Alle komplette sett ser like ut; bare settet skiller.
//
// Baksiden er en nøytral kortbakside, ikke Magic-baksiden — den er Wizards'
// design. Settsymbolet er det offisielle fra Scryfall.

export default function SettStabel({ setCode, setNavn, antall, foil, liten }) {
  const ikon = setCode ? `https://svgs.scryfall.io/sets/${String(setCode).toLowerCase()}.svg` : null;
  return (
    <div className={`settstabel${foil ? " foil" : ""}${liten ? " liten" : ""}`} role="img"
      aria-label={`${setNavn || setCode || "Komplett sett"}${foil ? ", foil" : ""}`}>
      <div className="ss-kort" style={{ transform: "translate(-62%, -56%) rotate(-9deg)" }}><i /></div>
      <div className="ss-kort" style={{ transform: "translate(-50%, -56%) rotate(-2deg)" }}><i /></div>
      <div className="ss-kort" style={{ transform: "translate(-38%, -56%) rotate(6deg)" }}><i /></div>
      {foil && <span className="ss-foil">FOIL</span>}
      <div className="ss-symbol">
        {ikon ? <img src={ikon} alt="" onError={(e) => { e.currentTarget.style.display = "none"; }} /> : null}
      </div>
      {!liten && (
        <div className="ss-etikett">
          <b>{setNavn || String(setCode || "").toUpperCase() || "Komplett sett"}</b>
          <span>Komplett sett{antall ? ` · ${antall} kort` : ""}</span>
        </div>
      )}
    </div>
  );
}
