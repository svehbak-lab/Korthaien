import { useState } from "react";
import { kroner, total, antallKort, sortert } from "../api.js";

// ── kurv i sidekolonnen ──────────────────────────────────────────────────────
export function Kurv({ kurv, onAntall, onVidere }) {
  const linjer = sortert(kurv);
  const sum = total(kurv);

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
                    {l.tilbud.set_name} · {l.condition}
                    {l.tilbud.finish === "foil" && " · foil"}
                  </div>
                  <div className="dempet tall" style={{ fontSize: 12 }}>
                    {kroner(l.pris)} per kort
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div className="antall">
                    <button onClick={() => onAntall(l.k, l.qty - 1)} aria-label="Færre">−</button>
                    <span className="tall">{l.qty}</span>
                    <button onClick={() => onAntall(l.k, l.qty + 1)} aria-label="Flere">+</button>
                  </div>
                  <div className="tall" style={{ fontSize: 13, marginTop: 4 }}>
                    {kroner(l.pris * l.qty)}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="bunn">
            <div className="sum-rad">
              <span>Butikkreditt</span>
              <span className="sum tall">{kroner(sum)}</span>
            </div>
            <button className="knapp primar" style={{ width: "100%" }} onClick={onVidere}>
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
export function Gjennomgang({ kurv, onAntall, onTilbake, onVidere }) {
  const linjer = sortert(kurv);

  return (
    <>
      <h1>Stemmer dette?</h1>
      <p className="ingress">
        Sjekk at antall og tilstand er riktig før du sender inn. Lista står
        sortert på sett og deretter alfabetisk — det er samme rekkefølge du blir
        bedt om å legge kortene i.
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
                <td className="dempet">
                  {l.tilbud.set_name}
                  {l.tilbud.finish === "foil" && <span className="merkelapp m-foil" style={{ marginLeft: 6 }}>Foil</span>}
                </td>
                <td>{l.condition}</td>
                <td className="h">
                  <div className="antall" style={{ justifyContent: "flex-end" }}>
                    <button onClick={() => onAntall(l.k, l.qty - 1)} aria-label="Færre">−</button>
                    <span className="tall">{l.qty}</span>
                    <button onClick={() => onAntall(l.k, l.qty + 1)} aria-label="Flere">+</button>
                  </div>
                </td>
                <td className="h tall">{kroner(l.pris)}</td>
                <td className="h tall">{kroner(l.pris * l.qty)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rad-flex" style={{ justifyContent: "space-between" }}>
        <button className="knapp" onClick={onTilbake}>Legg til flere kort</button>
        <div className="rad-flex">
          <span className="sum tall">{kroner(total(kurv))}</span>
          <button className="knapp primar" onClick={onVidere} disabled={!linjer.length}>
            Videre
          </button>
        </div>
      </div>
    </>
  );
}

// ── kontaktskjema ────────────────────────────────────────────────────────────
export function Skjema({ kurv, sender, onTilbake, onSend }) {
  const [f, setF] = useState({ customer_name: "", email: "", phone: "", note: "" });
  const gyldig = f.customer_name.trim().length >= 2 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email);

  return (
    <>
      <h1>Hvem sender kortene?</h1>
      <p className="ingress">
        Etter innsending får du et ordrenummer, adressen du skal sende til, og
        beskjed om hvordan kortene skal ligge i pakken.
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
          <span className="navn">Telefon <span className="dempet">— valgfritt</span></span>
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

      <div className="rad-flex" style={{ justifyContent: "space-between" }}>
        <button className="knapp" onClick={onTilbake}>Tilbake</button>
        <div className="rad-flex">
          <span className="sum tall">{kroner(total(kurv))}</span>
          <button className="knapp primar" onClick={() => onSend(f)} disabled={!gyldig || sender}>
            {sender ? "Sender…" : "Send inn salget"}
          </button>
        </div>
      </div>
    </>
  );
}

// ── kvittering ───────────────────────────────────────────────────────────────
export function Kvittering({ ordre, onNy }) {
  return (
    <>
      <h1>Takk — salget er registrert</h1>
      <p className="ingress">
        Ordrenummeret ditt er <b className="ordrenr kode">{ordre.order_no}</b>. Ta vare
        på det — skriv ut denne siden, eller noter nummeret før du lukker vinduet.
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
                </td>
                <td>{l.condition}</td>
                <td className="h tall">{l.qty}</td>
                <td className="h tall">{kroner(l.unit_nok * l.qty)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="sum-rad" style={{ marginTop: 14 }}>
          <span>Butikkreditt når kortene er mottatt og kontrollert</span>
          <span className="sum tall">{kroner(ordre.total_nok)}</span>
        </div>
      </div>

      <div className="rad-flex ingen-print">
        <button className="knapp" onClick={() => window.print()}>Skriv ut</button>
        <button className="knapp primar" onClick={onNy}>Selg flere kort</button>
      </div>
    </>
  );
}
