import { useState, useEffect } from "react";
import { api, kroner, kreditt, total, antallKort, sortert, prisFor, COND_NAVN } from "../api.js";

// Tilstand kan bare velges der settet faktisk tar imot mer enn én. Tar jeg
// bare NM fra settet, skal kunden se «NM» som fast tekst — ikke en meny som
// lar hen velge noe jeg kommer til å avvise ved mottak.
function Tilstand({ linje, onCondition }) {
  const valg = linje.tilbud.conditions;
  if (valg.length <= 1) {
    return (
      <span title={`Jeg tar bare imot ${COND_NAVN[linje.condition]} fra dette settet`}>
        {linje.condition}
      </span>
    );
  }
  return (
    <select
      value={linje.condition}
      onChange={(e) => onCondition(linje.k, e.target.value)}
      aria-label="Tilstand"
    >
      {valg.map((c) => (
        <option key={c.condition} value={c.condition}>
          {c.condition} — {kroner(c.ore)}
        </option>
      ))}
    </select>
  );
}

// Kunden kan ha valgt feil trykk i bulk, eller ombestemt seg etter å ha sett
// kunsten. Utgaven må derfor kunne endres helt fram til innsending — ikke bare
// i øyeblikket kortet ble lagt til.
function Utgavevalg({ linje, onBytt }) {
  const [åpen, setÅpen] = useState(false);
  const [valg, setValg] = useState(null);
  const [laster, setLaster] = useState(false);

  useEffect(() => {
    if (!åpen || valg) return;
    setLaster(true);
    api
      .søk({ q: linje.tilbud.name })
      .then((r) => setValg(r.filter((t) => t.name === linje.tilbud.name)))
      .catch(() => setValg([]))
      .finally(() => setLaster(false));
  }, [åpen, valg, linje.tilbud.name]);

  if (!åpen) {
    return (
      <>
        <span className="dempet">
          {linje.tilbud.set_name}
          {linje.tilbud.collector_number ? ` #${linje.tilbud.collector_number}` : ""}
        </span>
        {linje.tilbud.finish === "foil" && (
          <span className="merkelapp m-foil" style={{ marginLeft: 6 }}>Foil</span>
        )}
        <button
          className="knapp blank"
          style={{ display: "block", padding: 0, fontSize: 12.5 }}
          onClick={() => setÅpen(true)}
        >
          Bytt utgave
        </button>
      </>
    );
  }

  return (
    <div>
      {laster && <span className="dempet">Henter utgaver…</span>}
      {valg && (
        <select
          value={`${linje.tilbud.card_id}:${linje.tilbud.finish}`}
          onChange={(e) => {
            const t = valg.find((x) => `${x.card_id}:${x.finish}` === e.target.value);
            if (t) onBytt(linje.k, t);
            setÅpen(false);
          }}
          style={{ maxWidth: 300 }}
        >
          {valg.map((t) => (
            <option key={`${t.card_id}:${t.finish}`} value={`${t.card_id}:${t.finish}`}>
              {t.set_name}
              {t.collector_number ? ` #${t.collector_number}` : ""}
              {t.finish === "foil" ? " (foil)" : ""} — {kroner(t.conditions[0]?.ore)}
            </option>
          ))}
        </select>
      )}
      {valg && !valg.length && <span className="dempet">Fant ingen andre utgaver.</span>}
      <button className="knapp blank" style={{ padding: 0, fontSize: 12.5 }} onClick={() => setÅpen(false)}>
        Avbryt
      </button>
    </div>
  );
}

// ── kurv i sidekolonnen ──────────────────────────────────────────────────────
export function Kurv({ kurv, onAntall, onCondition, onVidere, minOrdreØre }) {
  const linjer = sortert(kurv);
  const sum = total(kurv);
  const forLite = sum > 0 && minOrdreØre && sum < minOrdreØre;

  return (
    <div className="kurv">
      <header>
        <h2>Det du får</h2>
        <span className="dempet" style={{ fontSize: 13 }}>
          {linjer.length ? `${antallKort(kurv)} kort` : "Ingenting lagt til ennå"}
        </span>
      </header>

      {!linjer.length ? (
        <div className="tom" style={{ padding: "26px 16px" }}>
          Søk opp kortene dine, eller lim inn hele lista.
        </div>
      ) : (
        <>
          <div className="liste">
            {linjer.map((l) => (
              <div className="linje" key={l.k}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14 }}>{l.tilbud.name}</div>
                  <div className="dempet" style={{ fontSize: 12 }}>
                    {l.tilbud.set_name}
                    {l.tilbud.finish === "foil" && " · foil"}
                  </div>
                  <div style={{ fontSize: 12, marginTop: 3 }}>
                    <Tilstand linje={l} onCondition={onCondition} />
                  </div>
                  <div className="dempet tall" style={{ fontSize: 12, marginTop: 3 }}>
                    {kreditt(prisFor(l.tilbud, l.condition))} per kort
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div className="antall">
                    <button onClick={() => onAntall(l.k, l.qty - 1)} aria-label="Færre">−</button>
                    <span className="tall">{l.qty}</span>
                    <button onClick={() => onAntall(l.k, l.qty + 1)} aria-label="Flere">+</button>
                  </div>
                  <div className="tall" style={{ fontSize: 13, marginTop: 4 }}>
                    {kroner(prisFor(l.tilbud, l.condition) * l.qty)}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="bunn">
            <div className="sum-rad">
              <span>Store credit</span>
              <span className="sum tall">{kroner(sum)}</span>
            </div>
            {forLite && (
              <p className="dempet" style={{ margin: "0 0 10px", fontSize: 13 }}>
                Minste ordre er {kroner(minOrdreØre)}. Du mangler {kroner(minOrdreØre - sum)}.
              </p>
            )}
            <button
              className="knapp primar"
              style={{ width: "100%" }}
              onClick={onVidere}
              disabled={forLite}
            >
              Gå gjennom lista
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ── gjennomgang før innsending ───────────────────────────────────────────────
// Det er billigere for begge parter at kunden oppdager en feil her enn at
// kortene ligger i en konvolutt på vei hit.
export function Gjennomgang({ kurv, onAntall, onCondition, onBytt, onTilbake, onVidere, minOrdreØre }) {
  const linjer = sortert(kurv);
  const sum = total(kurv);
  const forLite = minOrdreØre && sum < minOrdreØre;
  const låst = linjer.filter((l) => l.tilbud.conditions.length <= 1).length;

  return (
    <>
      <h1>Stemmer dette?</h1>

      <div className="varsel info">
        <b>Sjekk at tilstanden stemmer.</b> Jeg går gjennom hvert eneste kort ved
        mottak. Er tilstanden dårligere enn du har oppgitt, justerer jeg linjen
        ned, og summen blir lavere enn det som står her.
        {låst > 0 && (
          <>
            {" "}
            {låst === linjer.length ? "Alle kortene" : `${låst} av kortene`} er fra sett
            der jeg bare kjøper i én tilstand. Der kan du ikke velge — er kortet i
            dårligere stand, blir det ikke kjøpt.
          </>
        )}
      </div>

      <p className="ingress">
        Lista står sortert på sett og deretter alfabetisk. Det er samme rekkefølge
        du blir bedt om å legge kortene i, så det lønner seg å sortere bunken mens
        du har lista foran deg.
      </p>

      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>Kort</th>
              <th>Utgave</th>
              <th>Tilstand</th>
              <th className="h">Antall</th>
              <th className="h">Stk.pris</th>
              <th className="h">Sum</th>
            </tr>
          </thead>
          <tbody>
            {linjer.map((l) => (
              <tr key={l.k}>
                <td>{l.tilbud.name}</td>
                <td>
                  <Utgavevalg linje={l} onBytt={onBytt} />
                </td>
                <td>
                  <Tilstand linje={l} onCondition={onCondition} />
                </td>
                <td className="h">
                  <div className="antall" style={{ justifyContent: "flex-end" }}>
                    <button onClick={() => onAntall(l.k, l.qty - 1)} aria-label="Færre">−</button>
                    <span className="tall">{l.qty}</span>
                    <button onClick={() => onAntall(l.k, l.qty + 1)} aria-label="Flere">+</button>
                  </div>
                </td>
                <td className="h tall">{kroner(prisFor(l.tilbud, l.condition))}</td>
                <td className="h tall">{kroner(prisFor(l.tilbud, l.condition) * l.qty)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="sum-rad" style={{ marginTop: 14 }}>
          <span>Store credit på korthaien.no</span>
          <span className="sum tall">{kroner(sum)}</span>
        </div>
      </div>

      <div className="rad-flex" style={{ justifyContent: "space-between" }}>
        <button className="knapp" onClick={onTilbake}>Legg til flere kort</button>
        <div className="rad-flex">
          {forLite && (
            <span className="dempet" style={{ fontSize: 13 }}>
              Minste ordre er {kroner(minOrdreØre)}
            </span>
          )}
          <button className="knapp primar" onClick={onVidere} disabled={!linjer.length || forLite}>
            Videre
          </button>
        </div>
      </div>
    </>
  );
}

// ── kontaktskjema ────────────────────────────────────────────────────────────
export function Skjema({ kurv, sender, config, onTilbake, onSend, onVilkår }) {
  const [f, setF] = useState({ customer_name: "", email: "", phone: "", note: "" });
  const [godtatt, setGodtatt] = useState(false);
  const gyldig =
    godtatt &&
    f.customer_name.trim().length >= 2 &&
    /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email) &&
    f.phone.replace(/\D/g, "").length >= 8;

  return (
    <>
      <h1>Hvem sender kortene?</h1>
      <p className="ingress">
        Ordrenummeret og kortlista sendes til e-postadressen du oppgir. Den samme
        adressen bruker du hvis du vil finne fram ordren igjen senere.
      </p>

      <div className="panel" style={{ maxWidth: 560 }}>
        <div className="feltrad">
          <label>
            <span className="navn">Navn</span>
            <input
              type="text"
              value={f.customer_name}
              onChange={(e) => setF({ ...f, customer_name: e.target.value })}
              autoComplete="name"
            />
          </label>
          <label>
            <span className="navn">E-post</span>
            <input
              type="email"
              value={f.email}
              onChange={(e) => setF({ ...f, email: e.target.value })}
              autoComplete="email"
            />
          </label>
        </div>
        <label style={{ display: "block", marginBottom: 14 }}>
          <span className="navn">Telefon</span>
          <input
            type="tel"
            value={f.phone}
            onChange={(e) => setF({ ...f, phone: e.target.value })}
            autoComplete="tel"
          />
        </label>
        <label style={{ display: "block" }}>
          <span className="navn">Melding <span className="dempet">— valgfritt</span></span>
          <textarea
            rows={3}
            value={f.note}
            onChange={(e) => setF({ ...f, note: e.target.value })}
            style={{ fontFamily: "inherit", fontSize: 14 }}
          />
        </label>
      </div>

      <div className="panel" style={{ maxWidth: 560 }}>
        <h2>Før du sender</h2>
        <ul className="steg" style={{ listStyle: "disc" }}>
          <li>
            Summen er et <b>anslag</b>. Alle kort kontrolleres ved mottak, og linjer
            justeres hvis antall eller tilstand avviker.
          </li>
          <li>Oppgjøret er butikkreditt på korthaien.no, ikke kontanter.</li>
          {config?.order_expiry_days && (
            <li>
              Pakken må være sendt innen {config.order_expiry_days} dager. Etter det
              frigjøres kortene til andre selgere.
            </li>
          )}
        </ul>
        {config?.ship_to && (
          <>
            <h2 style={{ marginTop: 18 }}>Adressen du skal sende til</h2>
            <p className="adresse" style={{ whiteSpace: "pre-line", margin: 0 }}>
              {config.ship_to}
            </p>
            <p className="dempet" style={{ fontSize: 13 }}>
              Du får den igjen på kvitteringen sammen med ordrenummeret.
            </p>
          </>
        )}
      </div>

      {/* Haken er ikke et bevis i seg selv. Verdien ligger i at spørsmålet ble
          stilt, og at tidspunktet lagres med ordren. */}
      <label className="godta">
        <input type="checkbox" checked={godtatt} onChange={(e) => setGodtatt(e.target.checked)} />
        <span>
          Jeg er over 18, eller har snakket med en foresatt om dette salget. Jeg
          godtar{" "}
          <button className="knapp blank" style={{ padding: 0, fontSize: "inherit" }} onClick={onVilkår}>
            vilkårene
          </button>
          , og at navn, e-post og telefon lagres for å behandle salget.
        </span>
      </label>
      <div className="rad-flex" style={{ justifyContent: "space-between" }}>
        <button className="knapp" onClick={onTilbake}>Tilbake</button>
        <div className="rad-flex">
          <span className="sum tall">{kroner(total(kurv))}</span>
          <button className="knapp primar" onClick={() => onSend({ ...f, vilkar_godtatt: true })} disabled={!gyldig || sender}>
            {sender ? "Sender…" : "Send inn salget"}
          </button>
        </div>
      </div>
    </>
  );
}

// ── kvittering ───────────────────────────────────────────────────────────────
// Denne er også pakkseddelen. Kunden skriver den ut, legger den i konvolutten,
// og bunken ligger i samme rekkefølge som lista.
export function Kvittering({ ordre, onNy }) {
  return (
    <>
      <h1>Takk — salget er registrert</h1>
      <p className="ingress">
        Ordrenummeret ditt er <b className="ordrenr kode">{ordre.order_no}</b>. Skriv
        ut denne siden og legg den i pakken, eller noter nummeret før du lukker
        vinduet. Du finner ordren igjen med nummeret og e-postadressen din.
      </p>

      {ordre.avvist?.length > 0 && (
        <div className="varsel info">
          <b>Noe ble justert.</b>
          <ul style={{ margin: "6px 0 0", paddingLeft: 20 }}>
            {ordre.avvist.map((a, i) => (
              <li key={i}>{a.grunn}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="panel">
        <h2>Slik gjør du</h2>
        <ol className="steg">
          {ordre.instruksjoner.map((t, i) => (
            <li key={i} style={{ whiteSpace: "pre-line" }}>{t}</li>
          ))}
        </ol>
      </div>

      <div className="panel">
        <h2>Kortene, i den rekkefølgen de skal ligge</h2>
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Kort</th>
              <th>Utgave</th>
              <th>Tilstand</th>
              <th className="h">Antall</th>
              <th className="h">Sum</th>
            </tr>
          </thead>
          <tbody>
            {ordre.linjer.map((l, i) => (
              <tr key={i}>
                <td className="dempet tall">{i + 1}</td>
                <td>{l.card_name}</td>
                <td className="dempet">
                  {l.set_name}
                  {l.finish === "foil" ? " (foil)" : ""}
                  {l.rarity ? <div style={{ fontSize: 12 }}>{l.rarity}</div> : null}
                </td>
                <td>{l.condition}</td>
                <td className="h tall">{l.qty}</td>
                <td className="h tall">{kroner(l.unit_ore * l.qty)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="sum-rad" style={{ marginTop: 14 }}>
          <span>Store credit, anslag — settes endelig ved mottak</span>
          <span className="sum tall">{kroner(ordre.total_ore)}</span>
        </div>
      </div>

      <div className="rad-flex ingen-print">
        <button className="knapp" onClick={() => window.print()}>Skriv ut</button>
        <button className="knapp primar" onClick={onNy}>Selg flere kort</button>
      </div>
    </>
  );
}
