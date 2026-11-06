import { useState } from "react";
import { api, kroner, dato } from "../api.js";

// Uten innlogging er e-postadressen det eneste vi kan sjekke mot. Ordrenummeret
// er kort og datobasert, så det holder ikke alene.
export default function Oppslag({ onFeil, onTilbake }) {
  const [nr, setNr] = useState("");
  const [epost, setEpost] = useState("");
  const [ordre, setOrdre] = useState(null);
  const [laster, setLaster] = useState(false);

  async function hent() {
    setLaster(true);
    setOrdre(null);
    try {
      setOrdre(await api.ordre(nr.trim(), epost.trim()));
    } catch (e) {
      onFeil(
        e.message === "Fant ikke ordren"
          ? new Error("Fant ingen ordre med det nummeret og den e-posten. Sjekk begge.")
          : e
      );
    } finally {
      setLaster(false);
    }
  }

  return (
    <>
      <h1>Finn ordren din</h1>
      <p className="ingress">
        Skriv inn ordrenummeret fra bekreftelsen og e-postadressen du oppga. Du
        trenger ingen konto.
      </p>

      <div className="panel" style={{ maxWidth: 560 }}>
        <div className="feltrad">
          <label>
            <span className="navn">Ordrenummer</span>
            <input
              type="text"
              value={nr}
              onChange={(e) => setNr(e.target.value)}
              placeholder="K-00034"
            />
          </label>
          <label>
            <span className="navn">E-post</span>
            <input type="email" value={epost} onChange={(e) => setEpost(e.target.value)} />
          </label>
        </div>
        <div className="rad-flex">
          <button className="knapp primar" onClick={hent} disabled={laster || !nr.trim() || !epost.trim()}>
            {laster ? "Henter…" : "Hent ordren"}
          </button>
          <button className="knapp blank" onClick={onTilbake}>Tilbake</button>
        </div>
      </div>

      {ordre && <Vis ordre={ordre} />}
    </>
  );
}

const STATUS = {
  pending: ["Venter på kortene", "Send pakken innen fristen."],
  received: ["Mottatt og under kontroll", "Kortene er kommet fram. Jeg går gjennom dem nå."],
  stocked: ["Ferdig behandlet", "Kortene er gjennomgått og godkjent."],
  cancelled: ["Kansellert", "Denne ordren er avsluttet."],
  expired: ["Utløpt", "Fristen gikk ut før pakken kom fram. Legg inn et nytt salg om du fortsatt vil selge."],
};

function Vis({ ordre }) {
  // Oppgjøret kan komme før kortene er satt på plass i hylla. For kunden er
  // det oppgjøret som teller, så en oppgjort ordre er ferdig.
  const [tittel, forklaring] = ordre.credit_sent && ordre.status === "received"
    ? STATUS.stocked
    : STATUS[ordre.status] || ["Ukjent status", ""];

  return (
    <>
      <div className="panel">
        <h2>
          {ordre.order_no} — {tittel}
        </h2>
        <p className="dempet" style={{ marginTop: 0 }}>{forklaring}</p>

        {ordre.credit_sent && !ordre.med_kode ? (
          <div className="varsel info">
            <b>Kreditten står på kontoen din</b>
            <div>
              Oppgjøret ble lagt inn som kreditt
              {ordre.credit_sent_at ? ` ${dato(ordre.credit_sent_at)}` : ""}. Logg inn på{" "}
              <a href="https://korthaien.no">korthaien.no</a> med samme e-postadresse for å se
              saldoen. Kreditten trekkes automatisk i kassen og utløper ikke.
            </div>
          </div>
        ) : ordre.credit_sent ? (
          <div className="varsel info">
            <b>Rabattkoden er sendt</b>
            <div>
              Den ble sendt til e-postadressen din
              {ordre.credit_sent_at ? ` ${dato(ordre.credit_sent_at)}` : ""}. Av hensyn
              til sikkerheten vises den ikke her — hvem som helst med ordrenummeret
              ditt kunne ellers brukt den. Finner du den ikke i innboksen, ta kontakt,
              så sender jeg den på nytt.
            </div>
          </div>
        ) : (
          <p className="dempet">
            Når kortene er mottatt og godkjent, havner oppgjøret som kreditt på kontoen din på
            korthaien.no, og du får beskjed på e-post.
          </p>
        )}

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
                <td className="h tall">
                  {l.qty_received != null && l.qty_received !== l.qty ? (
                    <span title={`Du oppga ${l.qty}`}>
                      {l.qty_received} <span className="dempet">av {l.qty}</span>
                    </span>
                  ) : (
                    l.qty
                  )}
                </td>
                <td className="h tall">{kroner(l.unit_ore * (l.qty_received ?? l.qty))}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="sum-rad" style={{ marginTop: 14 }}>
          <span>
            Store credit
            {ordre.status === "pending" ? " — anslag, settes endelig ved mottak" : ""}
          </span>
          <span className="sum tall">{kroner(ordre.total_ore)}</span>
        </div>

        <p className="dempet" style={{ fontSize: 13 }}>
          Registrert {dato(ordre.created_at)}
          {ordre.status === "pending" && ordre.expires_at ? ` · frist ${dato(ordre.expires_at)}` : ""}
        </p>
      </div>

      <div className="rad-flex ingen-print">
        <button className="knapp" onClick={() => window.print()}>Skriv ut</button>
      </div>
    </>
  );
}
