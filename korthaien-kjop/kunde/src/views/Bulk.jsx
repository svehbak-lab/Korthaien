import { useState } from "react";
import { api, kroner, ledig } from "../api.js";

const EKSEMPEL = `4 Lightning Bolt
2 Ragavan, Nimble Pilferer (MH2) 138
1 Void [INV]
3 Counterspell foil
1 Black Lotus (LEA) 232 HP`;

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
        Lim inn lista di, én linje per kort. Antall foran navnet. Har du settkode,
        tilstand eller samlernummer med, tar jeg det med — ellers spør jeg. Inntil
        50 linjer om gangen.
      </p>

      <details className="hjelp">
        <summary>Hvilke formater kan jeg lime inn?</summary>
        <p>
          Det meste. Eksport fra Moxfield og Archidekt, kolonner fra et regneark,
          CSV, eller bare håndskrevet. Alle disse blir lest riktig:
        </p>
        <pre>{`4 Lightning Bolt
4x Lightning Bolt
4 Lightning Bolt (M10) 146
1 Fable of the Mirror-Breaker (NEO) 144 *F*
4 Lightning Bolt [Magic 2010]
4 stk Lightning Bolt NM
Lightning Bolt x4 foil`}</pre>
        <p className="dempet">
          Ett unntak verdt å vite om: «3. Lightning Bolt» med punktum leses som
          punkt nummer tre i en liste, altså ett kort. Skal du ha tre, skriv «3
          Lightning Bolt» uten punktum.
        </p>
      </details>

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
  // Skrev kunden en settkode, er valget allerede tatt. Ellers står den på
  // første utgave, men må bekreftes aktivt — se knappeteksten under.
  const [valgt, setValgt] = useState(0);

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

  const flere = rad.status === "velg";
  const tilbud = rad.valg[Math.min(valgt, rad.valg.length - 1)];

  return (
    <div className="treff">
      <div className="rad" style={{ flexDirection: "column", gap: 10 }}>
        <div className="rad-flex" style={{ width: "100%" }}>
          <span className="navn">
            {rad.qty}× {rad.navn}
          </span>
          {flere ? (
            <span className="merkelapp m-velg">{rad.valg.length} utgaver</span>
          ) : (
            <span className="merkelapp m-ok">Én utgave</span>
          )}
        </div>

        {rad.melding && !flere && <div className="sett">{rad.melding}</div>}

        {/* Med titalls utgaver av samme kort er en nedtrekksmeny raskere å
            komme gjennom enn et rutenett. Bildet av den valgte står ved siden
            av, for settnavnet alene forteller ikke alltid hvilket trykk man
            har liggende. */}
        {flere && (
          <>
            <p className="dempet" style={{ margin: 0 }}>
              {rad.navn} finnes i flere utgaver, og de er ikke verdt det samme.
              Velg den du faktisk har — se på kunsten, ikke bare settnavnet.
            </p>
            <select
              className="utgavevalg"
              value={valgt}
              onChange={(e) => setValgt(Number(e.target.value))}
              aria-label="Velg utgave"
            >
              {rad.valg.map((t, i) => (
                <option key={`${t.card_id}:${t.finish}`} value={i}>
                  {t.set_name}
                  {t.collector_number ? ` #${t.collector_number}` : ""}
                  {t.finish === "foil" ? " (foil)" : ""} — {kroner(t.conditions[0]?.ore)}
                </option>
              ))}
            </select>
          </>
        )}

        <Utgave tilbud={tilbud} qty={rad.qty} kurv={kurv} onLegg={onLegg} condHint={rad.condHint} />
      </div>
    </div>
  );
}

function Utgave({ tilbud, qty, kurv, onLegg, condHint }) {
  const plass = ledig(kurv, tilbud);
  const antall = Math.min(qty, plass) || 0;
  // Skrev kunden en tilstand på linjen, settes den først i rekka — men bare
  // hvis settet tar imot den.
  const conditions = [...tilbud.conditions].sort(
    (a, b) => (b.condition === condHint) - (a.condition === condHint)
  );

  return (
    <div className="utgave-rad">
      {tilbud.image_uri ? (
        <img src={tilbud.image_uri} alt={`${tilbud.name}, ${tilbud.set_name}`} loading="lazy" />
      ) : (
        <div className="bilde-tom" />
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="sett">
          {tilbud.set_name}
          {tilbud.collector_number ? <span className="kode dempet"> #{tilbud.collector_number}</span> : null}
          {tilbud.finish === "foil" && <span className="merkelapp m-foil" style={{ marginLeft: 6 }}>Foil</span>}
        </div>
        <div className="kreditt-merk">Store credit</div>
        <div className="priser">
          {conditions.map((c) => (
            <button
              key={c.condition}
              className="pris-knapp"
              disabled={plass <= 0}
              onClick={() => onLegg(tilbud, c.condition, antall)}
              title={`Legg til ${antall} i ${c.navn} — ${kroner(c.ore)} per kort`}
            >
              <span className="cond">
                {c.navn}
                {c.condition === condHint && " ✓"}
              </span>
              <b>{kroner(c.ore)}</b>
            </button>
          ))}
        </div>
        <span className="dempet" style={{ fontSize: 12 }}>
          {plass > 0
            ? `Legger til ${antall} — inntil ${plass} stk. av denne`
            : "kvoten er full"}
        </span>
      </div>
    </div>
  );
}
