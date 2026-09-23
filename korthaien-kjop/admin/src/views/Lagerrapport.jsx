import { useState, useEffect, useMemo } from "react";
import { api, kroner } from "../api.js";

const RARITET_NAVN = {
  mythic: "Mythic",
  rare: "Rare",
  uncommon: "Uncommon",
  common: "Common",
  special: "Special",
  bonus: "Bonus",
  ukjent: "Uten raritet",
};

const tom = () => ({ antall: 0, verdi_ore: 0, uten_pris: 0 });

function legg(sum, rad) {
  sum.antall += rad.antall;
  sum.verdi_ore += rad.verdi_ore;
  sum.uten_pris += rad.uten_pris;
  return sum;
}

export default function Lagerrapport({ onFeil }) {
  const [data, setData] = useState(null);
  const [laster, setLaster] = useState(true);
  const [vanlig, setVanlig] = useState(true);
  const [foil, setFoil] = useState(true);
  // Sett du ikke har noe fra er uinteressante til daglig, men det er nettopp
  // dem du vurderer å kjøpe komplett. Derfor en bryter, ikke et valg.
  const [visTomme, setVisTomme] = useState(false);
  const [åpne, setÅpne] = useState(() => new Set());

  async function last() {
    try {
      setData(await api.lagerrapport());
    } catch (e) {
      onFeil(e);
    } finally {
      setLaster(false);
    }
  }

  useEffect(() => {
    last();
  }, []);

  const sett = useMemo(() => {
    if (!data) return [];
    return data.sett
      .map((s) => {
        const rader = s.rader.filter((r) => (r.finish === "foil" ? foil : vanlig));
        return { ...s, rader, sum: rader.reduce(legg, tom()) };
      })
      .filter((s) => s.sum.antall > 0 || (visTomme && s.grunnsett));
  }, [data, vanlig, foil, visTomme]);

  const total = useMemo(() => sett.map((s) => s.sum).reduce(legg, tom()), [sett]);

  async function lagreGrunnsett(kode, til) {
    try {
      await api.settGrunnsett(kode, til);
      await last();
    } catch (e) {
      onFeil(e);
    }
  }

  if (laster) return <p className="dempet">Regner ut lagerverdi…</p>;
  if (!data) return null;

  return (
    <>
      <div className="panel" style={{ marginBottom: 16, padding: "16px 18px" }}>
        <div className="rad-flex" style={{ gap: 32, flexWrap: "wrap" }}>
          <div>
            <div className="dempet" style={{ fontSize: 12 }}>Kort på lager</div>
            <div style={{ fontSize: 24, fontWeight: 700, lineHeight: 1.2 }}>
              {total.antall.toLocaleString("nb-NO")}
            </div>
          </div>
          <div>
            <div className="dempet" style={{ fontSize: 12 }}>Samlet salgsverdi</div>
            <div style={{ fontSize: 24, fontWeight: 700, lineHeight: 1.2 }}>
              {kroner(total.verdi_ore)}
            </div>
          </div>

          <div style={{ marginLeft: "auto", alignSelf: "center" }}>
            <label style={{ marginRight: 14 }}>
              <input type="checkbox" checked={vanlig} onChange={(e) => setVanlig(e.target.checked)} />{" "}
              Vanlig
            </label>
            <label style={{ marginRight: 14 }}>
              <input type="checkbox" checked={foil} onChange={(e) => setFoil(e.target.checked)} /> Foil
            </label>
            <label>
              <input
                type="checkbox"
                checked={visTomme}
                onChange={(e) => setVisTomme(e.target.checked)}
              />{" "}
              Vis sett uten lager
            </label>
          </div>
        </div>

        {total.uten_pris > 0 && (
          <div className="dempet" style={{ fontSize: 12, marginTop: 10 }}>
            {total.uten_pris.toLocaleString("nb-NO")} kort har ingen salgspris og teller ikke i
            verdien. De er med i antallet.
          </div>
        )}
      </div>

      {!vanlig && !foil && <div className="varsel info">Huk av vanlig eller foil for å se noe.</div>}

      <p className="ingress" style={{ marginBottom: 12 }}>
        Kolonnen «grunnsett» er ett eksemplar av hvert kort i standardsettet — det du ville fått
        om du kjøpte settet komplett. Skriv inn det høyeste samlernummeret i grunnsettet, så
        regnes begge summene ut. Alt over det nummeret er varianter og bonusark, og holdes utenfor.
      </p>

      <table className="tabell" style={{ width: "100%" }}>
        <thead>
          <tr>
            <th>Sett</th>
            <th style={{ textAlign: "right", width: 90 }}>Antall</th>
            <th style={{ textAlign: "right", width: 130 }}>Salgsverdi</th>
            <th style={{ textAlign: "right", width: 90 }}>Uten pris</th>
            <th style={{ textAlign: "right", width: 110 }}>Grunnsett t.o.m.</th>
            <th style={{ textAlign: "right", width: 130 }}>Marked</th>
            <th style={{ textAlign: "right", width: 130 }}>Din pris</th>
          </tr>
        </thead>
        <tbody>
          {sett.map((s) => (
            <SettRad
              key={s.set_code}
              sett={s}
              åpen={åpne.has(s.set_code)}
              onLagre={(til) => lagreGrunnsett(s.set_code, til)}
              onKlikk={() =>
                setÅpne((f) => {
                  const ny = new Set(f);
                  ny.has(s.set_code) ? ny.delete(s.set_code) : ny.add(s.set_code);
                  return ny;
                })
              }
            />
          ))}
        </tbody>
      </table>

      {!sett.length && (
        <div className="panel">
          <div className="tom">
            <b>Ingenting å vise</b>
            Kort kommer inn her når du gjør opp en kjøpsordre. Vil du vurdere et sett du ikke
            har noe fra, huk av «vis sett uten lager».
          </div>
        </div>
      )}
    </>
  );
}

function SettRad({ sett, åpen, onKlikk, onLagre }) {
  const g = sett.grunnsett;
  // Avvik mellom oppgitt nummer og antall kort funnet betyr hull i
  // nummereringen, eller samlernumre som ikke er rene tall. Da er summen for
  // lav, og det skal være synlig i stedet for skjult.
  const avvik = g && g.antall !== g.til;

  return (
    <>
      <tr style={{ fontWeight: 600 }} aria-expanded={åpen}>
        <td onClick={onKlikk} style={{ cursor: "pointer" }}>
          <span className="dempet" style={{ display: "inline-block", width: 18 }}>
            {sett.rader.length ? (åpen ? "−" : "+") : ""}
          </span>
          {sett.set_name}
          <span className="kode dempet"> {sett.set_code.toUpperCase()}</span>
        </td>
        <td style={{ textAlign: "right" }}>{sett.sum.antall.toLocaleString("nb-NO")}</td>
        <td style={{ textAlign: "right" }}>{kroner(sett.sum.verdi_ore)}</td>
        <td style={{ textAlign: "right" }} className="dempet">
          {sett.sum.uten_pris || ""}
        </td>

        <td style={{ textAlign: "right" }}>
          <GrunnsettFelt verdi={g?.til ?? ""} onLagre={onLagre} />
        </td>
        <td style={{ textAlign: "right" }} className="dempet">
          {g ? kroner(g.marked_ore) : ""}
        </td>
        <td style={{ textAlign: "right" }}>
          {g ? kroner(g.salg_ore) : ""}
          {avvik && (
            <div className="dempet" style={{ fontSize: 11, fontWeight: 400 }} title="Antall kort funnet i intervallet">
              {g.antall} av {g.til} funnet
            </div>
          )}
          {g?.uten_pris > 0 && (
            <div className="dempet" style={{ fontSize: 11, fontWeight: 400 }}>
              {g.uten_pris} uten pris
            </div>
          )}
        </td>
      </tr>

      {åpen &&
        sett.rader.map((r) => (
          <tr key={`${r.rarity}:${r.finish}`} className="dempet">
            <td style={{ paddingLeft: 36 }}>
              {RARITET_NAVN[r.rarity] || r.rarity}
              {r.finish === "foil" && (
                <span className="merkelapp m-foil" style={{ marginLeft: 6 }}>Foil</span>
              )}
            </td>
            <td style={{ textAlign: "right" }}>{r.antall.toLocaleString("nb-NO")}</td>
            <td style={{ textAlign: "right" }}>{kroner(r.verdi_ore)}</td>
            <td style={{ textAlign: "right" }}>{r.uten_pris || ""}</td>
            <td colSpan={3} />
          </tr>
        ))}
    </>
  );
}

// Lagres når feltet forlates, ikke ved hvert tastetrykk — ellers ville
// «286» utløst tre utregninger av hele settet.
function GrunnsettFelt({ verdi, onLagre }) {
  const [tekst, setTekst] = useState(String(verdi ?? ""));

  useEffect(() => {
    setTekst(String(verdi ?? ""));
  }, [verdi]);

  return (
    <input
      type="number"
      min="0"
      value={tekst}
      placeholder="—"
      style={{ width: 80, textAlign: "right" }}
      onChange={(e) => setTekst(e.target.value)}
      onBlur={() => {
        const n = tekst.trim() === "" ? null : Math.max(0, parseInt(tekst, 10) || 0);
        if (n !== (verdi || null)) onLagre(n);
      }}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
    />
  );
}
