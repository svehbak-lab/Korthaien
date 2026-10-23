import { useState, useEffect } from "react";
import { api, kroner, dato } from "../api.js";

// ─────────────────────────────────────────────────────────────────────────────
// KREDITT
// ─────────────────────────────────────────────────────────────────────────────
// Kreditt er en bok, ikke et tall. Saldoen er summen av linjene, og hver
// linje har en grunn. Det er forskjellen på å kunne svare «du fikk 1 240 for
// ordre K-1043 den 12. mars» og å måtte si «det står 1 240, vet ikke hvorfor».
//
// Derfor finnes det ingen måte å overskrive en saldo her. Setter du den til
// et annet tall, bokføres differansen som en egen linje, og begge tallene
// står igjen.
//
// Kunden kjennes igjen på e-postadressen. Det finnes ingen kundekonto ennå,
// og adressen er det eneste som følger en kunde fra ordre til ordre.

const GRUNNER = {
  kjopsordre: "Oppgjør for kjøpsordre",
  manuell: "Lagt inn manuelt",
  kjop: "Brukt i butikken",
  refusjon: "Refundert til kreditt",
  retting: "Retting",
};

const tilØre = (kr) => Math.round((parseFloat(String(kr).replace(",", ".")) || 0) * 100);

export default function Kreditt({ onFeil }) {
  const [kontoer, setKontoer] = useState(null);
  const [q, setQ] = useState("");
  const [åpen, setÅpen] = useState(null);

  async function last(søk = q) {
    try {
      const r = await api.kreditt(søk);
      setKontoer(r.kontoer || []);
    } catch (e) {
      onFeil(e);
    }
  }
  useEffect(() => {
    const t = setTimeout(() => last(), 250);
    return () => clearTimeout(t);
  }, [q]);

  if (åpen) {
    return (
      <Konto
        epost={åpen}
        onLukk={() => {
          setÅpen(null);
          last();
        }}
        onFeil={onFeil}
      />
    );
  }

  return (
    <div className="panel">
      <header>
        <h3>Kreditt</h3>
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Søk i e-postadresser"
          style={{ width: 220, marginLeft: "auto" }}
        />
        <button className="knapp" onClick={() => setÅpen("")}>Ny konto</button>
      </header>

      <div className="krop">
        <p className="dempet" style={{ margin: 0 }}>
          Saldoen er summen av linjene i boka. Den kan ikke overskrives — setter
          du den til et annet tall, bokføres differansen som en egen linje, og
          begge tallene står igjen.
        </p>
      </div>

      {!kontoer && <div className="krop dempet">Henter…</div>}

      {kontoer && kontoer.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>E-post</th>
              <th className="h" style={{ width: 120 }}>Saldo</th>
              <th className="h" style={{ width: 80 }}>Linjer</th>
              <th style={{ width: 130 }}>Sist endret</th>
              <th style={{ width: 80 }}></th>
            </tr>
          </thead>
          <tbody>
            {kontoer.map((k) => (
              <tr key={k.email}>
                <td>{k.email}</td>
                <td
                  className="h tall"
                  style={{ fontWeight: 600, color: k.saldo_ore < 0 ? "var(--feil)" : undefined }}
                >
                  {kroner(k.saldo_ore)}
                </td>
                <td className="h dempet">{k.linjer}</td>
                <td className="dempet">{dato(k.sist)}</td>
                <td className="h">
                  <button className="knapp handling" style={{ marginLeft: 0 }} onClick={() => setÅpen(k.email)}>
                    Åpne
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {kontoer && !kontoer.length && (
        <div className="tom">
          <b>{q ? "Ingen treff" : "Ingen kreditt bokført ennå"}</b>
          {q
            ? "Prøv en annen del av adressen."
            : "Trykk «Ny konto» for å legge inn en saldo du allerede har gitt noen."}
        </div>
      )}
    </div>
  );
}

// Én kunde: saldoen, boka, og de to måtene å endre den på.
function Konto({ epost, onLukk, onFeil }) {
  const [adresse, setAdresse] = useState(epost);
  const [data, setData] = useState(null);
  const [modus, setModus] = useState("legg");
  const [beløp, setBeløp] = useState("");
  const [notat, setNotat] = useState("");
  const [jobber, setJobber] = useState(false);

  async function last(e = adresse) {
    if (!e || !e.includes("@")) {
      setData(null);
      return;
    }
    try {
      setData(await api.kredittKonto(e));
    } catch (err) {
      onFeil(err);
    }
  }
  useEffect(() => {
    last(epost);
  }, []);

  async function bokfør() {
    setJobber(true);
    try {
      await api.bokførKreditt(
        modus === "legg"
          ? { epost: adresse, ore: tilØre(beløp), notat }
          : { epost: adresse, saldo_ore: tilØre(beløp), notat }
      );
      setBeløp("");
      setNotat("");
      await last();
    } catch (e) {
      onFeil(e);
    } finally {
      setJobber(false);
    }
  }

  const ugyldig =
    !adresse.includes("@") ||
    String(beløp).trim() === "" ||
    (modus === "legg" && tilØre(beløp) === 0);

  return (
    <>
      <div className="rad-flex" style={{ marginBottom: 12 }}>
        <button className="knapp liten" onClick={onLukk}>← Alle kontoer</button>
      </div>

      <div className="panel">
        <header>
          <h3>{adresse || "Ny konto"}</h3>
          {data && (
            <span className="sum" style={{ marginLeft: "auto" }}>
              {kroner(data.saldo_ore)}
            </span>
          )}
        </header>

        <div className="krop">
          {!epost && (
            <label style={{ display: "block", marginBottom: 12 }}>
              <div className="dempet" style={{ fontSize: 12, marginBottom: 3 }}>E-post</div>
              <input
                type="text"
                value={adresse}
                onChange={(e) => setAdresse(e.target.value)}
                onBlur={() => last()}
                placeholder="kunde@eksempel.no"
                style={{ width: 280 }}
              />
            </label>
          )}

          {/* To måter å si det samme. «Legg til» når du vet hvor mye som skal
              inn eller ut; «Sett saldo til» når du vet hva den skal ende på.
              Begge blir en linje i boka. */}
          <div className="rad-flex" style={{ gap: 6, marginBottom: 10 }}>
            {[
              ["legg", "Legg til beløp"],
              ["sett", "Sett saldo til"],
            ].map(([v, navn]) => (
              <button
                key={v}
                className={`knapp liten ${modus === v ? "primar" : ""}`}
                onClick={() => setModus(v)}
              >
                {navn}
              </button>
            ))}
          </div>

          <div className="rad-flex" style={{ alignItems: "flex-end", gap: 14 }}>
            <label>
              <div className="dempet" style={{ fontSize: 12, marginBottom: 3 }}>
                {modus === "legg" ? "Beløp i kroner (minus for å trekke fra)" : "Ny saldo i kroner"}
              </div>
              <input
                type="text"
                inputMode="decimal"
                value={beløp}
                onChange={(e) => setBeløp(e.target.value)}
                placeholder={modus === "legg" ? "250 eller -250" : "0"}
                style={{ width: 150, textAlign: "right" }}
              />
            </label>
            <label style={{ flex: 1, minWidth: 180 }}>
              <div className="dempet" style={{ fontSize: 12, marginBottom: 3 }}>
                Grunn — den som leser boka om et år er deg
              </div>
              <input
                type="text"
                value={notat}
                onChange={(e) => setNotat(e.target.value)}
                placeholder="Kompensasjon for feilsendt ordre"
                style={{ width: "100%" }}
              />
            </label>
            <button className="knapp primar" disabled={jobber || ugyldig} onClick={bokfør}>
              Bokfør
            </button>
          </div>

          {modus === "sett" && data && (
            <p className="dempet" style={{ margin: "10px 0 0" }}>
              Saldoen er {kroner(data.saldo_ore)} nå. Setter du den til noe annet,
              bokføres differansen som en egen linje — ingenting overskrives.
            </p>
          )}
        </div>

        {/* Lista leses med ?. og faller tilbake på tom. Et svar som ikke ser
            ut som forventet skal ikke gjøre hele adminpanelet hvitt — og et
            hvitt panel uten feilmelding er den verste måten å si fra på. */}
        {data && (data.bevegelser?.length || 0) > 0 && (
          <table>
            <thead>
              <tr>
                <th style={{ width: 120 }}>Dato</th>
                <th className="h" style={{ width: 110 }}>Endring</th>
                <th style={{ width: 170 }}>Grunn</th>
                <th>Notat</th>
              </tr>
            </thead>
            <tbody>
              {(data.bevegelser || []).map((b) => (
                <tr key={b.id}>
                  <td className="dempet">{dato(b.created_at)}</td>
                  <td
                    className="h tall"
                    style={{ color: b.ore < 0 ? "var(--feil)" : "var(--ok)", fontWeight: 600 }}
                  >
                    {b.ore > 0 ? "+" : ""}{kroner(b.ore)}
                  </td>
                  <td>
                    {GRUNNER[b.grunn] || b.grunn}
                    {b.order_no && <span className="kode"> {b.order_no}</span>}
                  </td>
                  <td className="dempet">{b.notat || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {data && !(data.bevegelser?.length || 0) && (
          <div className="tom">Ingen bevegelser ennå.</div>
        )}
      </div>
    </>
  );
}
