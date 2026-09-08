import { useState } from "react";
import { api, kroner, ledig } from "../api.js";

const EKSEMPEL = `4 Lightning Bolt
2 Ragavan, Nimble Pilferer (MH2) 138
1 Void [INV]
3 Counterspell foil`;

export default function Bulk({ kurv, onLegg, onFeil }) {
  const [tekst, setTekst] = useState("");
  const [svar, setSvar] = useState(null);
  const [laster, setLaster] = useState(false);

  async function sjekk() {
    setLaster(true);
    try {
      setSvar(await api.bulk(tekst));
    } catch (e) {
      onFeil(e);
    } finally {
      setLaster(false);
    }
  }

  const linjeAntall = tekst.split("\n").filter((l) => l.trim()).length;

  return (
    <>
      <p className="ingress">
        Lim inn lista di, én linje per kort. Antall foran navnet, og settkode i
        parentes hvis du vet hvilken utgave du har. Jeg tar inntil 50 linjer om
        gangen.
      </p>

      <textarea
        rows={9}
        value={tekst}
        onChange={(e) => setTekst(e.target.value)}
        placeholder={EKSEMPEL}
        spellCheck={false}
      />

      <div className="rad-flex" style={{ margin: "12px 0 22px" }}>
        <button className="knapp primar" onClick={sjekk} disabled={laster || !tekst.trim()}>
          {laster ? "Sjekker…" : "Sjekk lista"}
        </button>
        <span className="dempet">
          {linjeAntall} {linjeAntall === 1 ? "linje" : "linjer"}
          {linjeAntall > 50 && " — bare de 50 første tas med"}
        </span>
      </div>

      {svar?.kuttet > 0 && (
        <div className="varsel info">
          Lista var lengre enn 50 linjer. De siste {svar.kuttet} ble ikke tatt med —
          send dem i en runde til.
        </div>
      )}

      {svar?.resultat.map((r) => (
        <Linje key={r.linje} rad={r} kurv={kurv} onLegg={onLegg} />
      ))}
    </>
  );
}

function Linje({ rad, kurv, onLegg }) {
  const [åpen, setÅpen] = useState(rad.status === "velg");

  if (rad.status === "ukjent" || rad.status === "feil" || rad.status === "ikke_ønsket") {
    return (
      <div className="treff">
        <div className="rad" style={{ alignItems: "center" }}>
          <div style={{ flex: 1 }}>
            <span className="navn">{rad.navn || rad.rå}</span>
            <div className="sett">{rad.melding}</div>
          </div>
          <span className="merkelapp m-nei">Ikke lagt til</span>
        </div>
      </div>
    );
  }

  const ett = rad.status === "løst" ? rad.valg[0] : null;

  return (
    <div className="treff">
      <div className="rad" style={{ flexDirection: "column", gap: 10 }}>
        <div className="rad-flex" style={{ width: "100%" }}>
          <span className="navn">
            {rad.qty}× {rad.navn}
          </span>
          {rad.status === "velg" ? (
            <span className="merkelapp m-velg">{rad.valg.length} utgaver</span>
          ) : (
            <span className="merkelapp m-ok">Én utgave</span>
          )}
          {rad.status === "velg" && (
            <button className="knapp blank" onClick={() => setÅpen(!åpen)}>
              {åpen ? "Skjul" : "Vis utgavene"}
            </button>
          )}
        </div>

        {/* Ett mulig trykk: kunden trenger bare velge tilstand.
            Flere trykk: hen må se kunsten for å vite hvilket kort hen har. */}
        {ett && !åpen && <Valg tilbud={ett} qty={rad.qty} kurv={kurv} onLegg={onLegg} />}

        {rad.status === "velg" && åpen && (
          <>
            <p className="dempet" style={{ margin: 0 }}>
              {rad.navn} finnes i flere utgaver, og de er ikke verdt det samme.
              Velg den du faktisk har — se på kunsten, ikke bare settnavnet.
            </p>
            <div className="utgaver" style={{ width: "100%" }}>
              {rad.valg.map((t) => (
                <Utgave key={`${t.card_id}:${t.finish}`} tilbud={t} qty={rad.qty} kurv={kurv} onLegg={onLegg} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Utgave({ tilbud, qty, kurv, onLegg }) {
  const plass = ledig(kurv, tilbud);
  return (
    <div className="utgave">
      {tilbud.image_uri
        ? <img src={tilbud.image_uri} alt={`${tilbud.name}, ${tilbud.set_name}`} loading="lazy" />
        : <div style={{ aspectRatio: "5 / 7", background: "var(--papir)", borderRadius: 5 }} />}
      <div>
        <div className="sett">{tilbud.set_name}</div>
        {tilbud.finish === "foil" && <span className="merkelapp m-foil">Foil</span>}
      </div>
      <Valg tilbud={tilbud} qty={qty} kurv={kurv} onLegg={onLegg} kompakt />
      <span className="dempet" style={{ fontSize: 12 }}>
        {plass > 0 ? `${plass} ${plass === 1 ? "ledig" : "ledige"}` : "kvoten er full"}
      </span>
    </div>
  );
}

function Valg({ tilbud, qty, kurv, onLegg, kompakt }) {
  const plass = ledig(kurv, tilbud);
  const antall = Math.min(qty, plass) || 0;
  return (
    <div className="priser" style={kompakt ? { marginTop: 0 } : undefined}>
      {tilbud.conditions.map((c) => (
        <button
          key={c.condition}
          className="pris-knapp"
          disabled={plass <= 0}
          onClick={() => onLegg(tilbud, c.condition, c.pris, antall)}
          title={`Legg til ${antall} i ${c.navn}`}
        >
          <span className="cond">{kompakt ? c.condition : c.navn}</span>
          <b>{kroner(c.pris)}</b>
        </button>
      ))}
    </div>
  );
}
