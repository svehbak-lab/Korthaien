import { useState, useEffect } from "react";
import { api, kroner, ledig } from "../api.js";

const EKSEMPEL = `4 Lightning Bolt
2 Ragavan, Nimble Pilferer (MH2) 138
1 Void [INV]
3 Counterspell foil
1 Black Lotus (LEA) 232 HP`;

// Tilstanden kunden skrev i linjen går foran. Ellers Near Mint, som er det
// folk flest sender. Kunden kan endre den i kurven, og du ved mottak.
function standardCondition(tilbud, condHint) {
  const har = (c) => tilbud.conditions.some((x) => x.condition === c);
  if (condHint && har(condHint)) return condHint;
  if (har("NM")) return "NM";
  return tilbud.conditions[0]?.condition;
}

export default function Bulk({ kurv, onLegg, onFeil }) {
  const [tekst, setTekst] = useState("");
  const [svar, setSvar] = useState(null);
  const [laster, setLaster] = useState(false);
  // Hvilken utgave kunden har valgt på hver linje. Ligger her og ikke i raden,
  // fordi «Legg til alle» må kjenne valgene for å kunne bruke dem.
  const [valg, setValg] = useState({});
  // Linjer som er lagt i kurven forsvinner fra lista. Det som står igjen er
  // det som gjenstår — ellers må kunden holde orden på det selv.
  const [lagtInn, setLagtInn] = useState(new Set());

  async function sjekk() {
    setLaster(true);
    try {
      setValg({});
      setLagtInn(new Set());
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

      {svar && (
        <LeggAlle
          resultat={svar.resultat.filter((r) => !lagtInn.has(r.linje))}
          valg={valg}
          onLegg={onLegg}
          onLagtInn={(linjer) => setLagtInn((s) => new Set([...s, ...linjer]))}
        />
      )}

      {svar && (
        <Resultat
          resultat={svar.resultat.filter((r) => !lagtInn.has(r.linje))}
          totalt={svar.resultat.length}
          kurv={kurv}
          valg={valg}
          onValg={(linje, i) => setValg((v) => ({ ...v, [linje]: i }))}
          onLegg={(t, c, n, linje) => {
            onLegg(t, c, n);
            setLagtInn((s) => new Set([...s, linje]));
          }}
        />
      )}
    </>
  );
}

// Linjer som ikke gikk gjennom drukner i en lang liste. De skilles ut i en
// egen fane, så kunden kan rette dem uten å lete.
function Resultat({ resultat, totalt, kurv, onLegg, valg, onValg }) {
  const fant = resultat.filter((r) => r.status === "løst" || r.status === "velg");
  const ikke = resultat.filter((r) => !["løst", "velg"].includes(r.status));
  const [fane, setFane] = useState("fant");

  // Gikk ingenting gjennom, er det den andre fanen som er interessant.
  useEffect(() => {
    setFane(fant.length ? "fant" : "ikke");
  }, [resultat]);

  const vis = fane === "fant" ? fant : ikke;

  if (!resultat.length) {
    return (
      <p className="dempet">
        Alle {totalt} {totalt === 1 ? "linjen" : "linjene"} er behandlet. Se kurven til
        høyre, eller lim inn en ny liste.
      </p>
    );
  }

  return (
    <>
      {ikke.length > 0 && (
        <div className="faner" role="tablist" style={{ marginTop: 18, marginBottom: 16 }}>
          <button role="tab" aria-selected={fane === "fant"} onClick={() => setFane("fant")}>
            Fant {fant.length}
          </button>
          <button role="tab" aria-selected={fane === "ikke"} onClick={() => setFane("ikke")}>
            Ikke lagt til {ikke.length}
          </button>
        </div>
      )}

      {fane === "ikke" && (
        <p className="ingress" style={{ marginBottom: 14 }}>
          Disse ble ikke lagt til. Står det at kortet ikke ble funnet, er det som
          regel stavemåten — prøv det engelske navnet, eller søk det opp i den andre
          fanen. Står det at jeg ikke kjøper kortet, er enten kvoten full eller
          settet ikke aktivt akkurat nå.
        </p>
      )}

      {vis.map((r) => (
        <Linje
          key={r.linje}
          rad={r}
          kurv={kurv}
          onLegg={onLegg}
          valgt={valg[r.linje] ?? 0}
          onValg={(i) => onValg(r.linje, i)}
        />
      ))}
    </>
  );
}

function Linje({ rad, kurv, onLegg, valgt, onValg }) {

  if (rad.status === "ukjent" || rad.status === "feil" || rad.status === "ikke_ønsket") {
    return (
      <div className="treff">
        <div className="rad" style={{ alignItems: "center" }}>
          <div style={{ flex: 1 }}>
            <span className="navn">{rad.navn || rad.rå}</span>
            <div className="sett">{rad.melding}</div>
            {/* Den opprinnelige linjen, så kunden ser hva som ble tolket feil.
                Uten den er det vanskelig å finne skrivefeilen. */}
            {rad.navn && rad.navn !== rad.rå && (
              <div className="kode dempet" style={{ marginTop: 3 }}>{rad.rå}</div>
            )}
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
              onChange={(e) => onValg(Number(e.target.value))}
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

        <Utgave
          tilbud={tilbud}
          qty={rad.qty}
          kurv={kurv}
          condHint={rad.condHint}
          onLegg={(t, c, n) => onLegg(t, c, n, rad.linje)}
        />
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
            ? `Klikk prisen for å legge til ${antall} — jeg tar inntil ${plass} stk. av denne`
            : "kvoten er full"}
        </span>
      </div>
    </div>
  );
}

// Stemmer lista, skal den kunne legges inn i én operasjon. Men bare linjene
// som har ett mulig trykk — der det finnes flere utgaver, ville dette vært å
// gjette på kundens vegne, og det er nettopp det hele velge-steget finnes for.
function LeggAlle({ resultat, valg, onLegg, onLagtInn }) {
  const funnet = resultat.filter((r) => r.status === "løst" || r.status === "velg");
  const uvalgte = resultat.filter((r) => r.status === "velg" && valg[r.linje] === undefined);
  if (!funnet.length) return null;

  const antall = funnet.reduce((n, r) => n + r.qty, 0);

  function leggInn() {
    for (const r of funnet) {
      const t = r.valg[Math.min(valg[r.linje] ?? 0, r.valg.length - 1)];
      if (!t) continue;
      const cond = standardCondition(t, r.condHint);
      if (cond) onLegg(t, cond, r.qty);
    }
    onLagtInn(funnet.map((r) => r.linje));
  }

  return (
    <div className="varsel info">
      <div className="rad-flex" style={{ justifyContent: "space-between" }}>
        <span>
          {funnet.length} {funnet.length === 1 ? "linje" : "linjer"} ble funnet — til
          sammen {antall} kort, i Near Mint.
          {uvalgte.length > 0 && (
            <>
              {" "}
              {uvalgte.length} av dem finnes i flere utgaver og står på den som vises i
              nedtrekksmenyen. Gå gjennom dem først hvis du har et annet trykk.
            </>
          )}
        </span>
        <button className="knapp primar" onClick={leggInn} style={{ flex: "none" }}>
          Legg til alle {antall}
        </button>
      </div>
    </div>
  );
}
