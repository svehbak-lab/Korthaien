import { useState, useEffect, useRef, useMemo } from "react";
import { api, kroner, ledig } from "../api.js";

const PER_SIDE = 60;

export default function Søk({ kurv, onLegg, onFeil, onTilstander }) {
  const [sett, setSett] = useState([]);
  const [q, setQ] = useState("");
  const [valgtSett, setValgtSett] = useState("");
  const [raritet, setRaritet] = useState("");
  const [treff, setTreff] = useState(null);
  const [laster, setLaster] = useState(false);
  // Foil og vanlig er samme kort med helt ulik pris, og et sett med foil gir
  // to rader per kort. Har kunden bare det ene, er halve lista i veien.
  const [visVanlig, setVisVanlig] = useState(true);
  const [visFoil, setVisFoil] = useState(true);
  const [side, setSide] = useState(0);
  const teller = useRef(0);
  const toppen = useRef(null);

  useEffect(() => {
    api.sett().then(setSett).catch(onFeil);
  }, []);

  // Søker mens du skriver, men venter til du tar en pause. Uten dette
  // sendes et kall per tastetrykk.
  useEffect(() => {
    if (q.trim().length < 2 && !valgtSett) {
      setTreff(null);
      return;
    }
    const min = ++teller.current;
    setLaster(true);
    const t = setTimeout(async () => {
      try {
        const d = await api.søk({ q: q.trim(), set: valgtSett, rarity: raritet });
        // Svarene kan komme i annen rekkefølge enn de ble sendt.
        if (min === teller.current) setTreff(d);
      } catch (e) {
        onFeil(e);
      } finally {
        if (min === teller.current) setLaster(false);
      }
    }, 280);
    return () => clearTimeout(t);
  }, [q, valgtSett, raritet]);

  const filtrert = useMemo(() => {
    if (!treff) return [];
    return treff.filter((t) => (t.finish === "foil" ? visFoil : visVanlig));
  }, [treff, visFoil, visVanlig]);

  // Nytt søk eller nytt filter betyr side én. Ellers står kunden på side 4
  // av et resultat som ikke finnes lenger.
  useEffect(() => {
    setSide(0);
  }, [treff, visFoil, visVanlig]);

  const sider = Math.ceil(filtrert.length / PER_SIDE);
  const vist = filtrert.slice(side * PER_SIDE, (side + 1) * PER_SIDE);

  function byttSide(n) {
    setSide(n);
    toppen.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <>
      <div ref={toppen} className="rad-flex" style={{ marginBottom: 12 }}>
        <input
          type="search"
          placeholder="Søk etter kortnavn"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ flex: "1 1 240px" }}
          autoFocus
        />
        <select value={valgtSett} onChange={(e) => setValgtSett(e.target.value)} style={{ width: 210 }}>
          <option value="">Alle sett</option>
          {sett.map((s) => (
            <option key={s.code} value={s.code}>{s.name}</option>
          ))}
        </select>
        <select value={raritet} onChange={(e) => setRaritet(e.target.value)} style={{ width: 140 }}>
          <option value="">Alle rariteter</option>
          <option value="mythic">Mythic</option>
          <option value="rare">Rare</option>
          <option value="uncommon">Uncommon</option>
          <option value="common">Common</option>
        </select>
      </div>

      <div className="rad-flex" style={{ marginBottom: 16, gap: 18 }}>
        <label>
          <input
            type="checkbox"
            checked={visVanlig}
            onChange={(e) => setVisVanlig(e.target.checked)}
          />{" "}
          Vanlige
        </label>
        <label>
          <input type="checkbox" checked={visFoil} onChange={(e) => setVisFoil(e.target.checked)} />{" "}
          Foil
        </label>
        {treff?.length > 0 && (
          <span className="dempet" style={{ marginLeft: "auto" }}>
            {filtrert.length} {filtrert.length === 1 ? "treff" : "treff"}
            {sider > 1 && ` — side ${side + 1} av ${sider}`}
          </span>
        )}
      </div>

      {laster && <p className="dempet">Søker…</p>}

      {!laster && treff === null && (
        <div className="panel">
          <div className="tom">
            Skriv inn et kortnavn, eller velg et sett for å se alt jeg kjøper derfra.
          </div>
        </div>
      )}

      {!laster && treff?.length === 0 && (
        <div className="panel">
          <div className="tom">
            Ingen treff. Enten kjøper jeg ikke kortet nå, eller så er kvoten full.
          </div>
        </div>
      )}

      {!laster && treff?.length > 0 && filtrert.length === 0 && (
        <div className="panel">
          <div className="tom">
            {visFoil || visVanlig
              ? `Ingen ${visFoil ? "foil" : "vanlige"} blant treffene. Huk av den andre for å se dem.`
              : "Huk av vanlige eller foil for å se noe."}
          </div>
        </div>
      )}

      {/* Prisknappene ser ut som prislapper. Uten denne linjen er det ikke
          opplagt at de er noe man trykker på, eller at ett klikk er ett kort. */}
      {filtrert.length > 0 && (
        <p className="dempet" style={{ marginTop: 0, marginBottom: 14 }}>
          Klikk på prisen for den tilstanden kortet ditt er i. Hvert klikk legger til
          ett kort — har du fire, klikker du fire ganger. Du kan justere antallet i
          lista til høyre etterpå.{" "}
          <button className="knapp blank" style={{ padding: 0, fontSize: "inherit" }} onClick={onTilstander}>
            Hvilken tilstand har kortet mitt?
          </button>
          {sider > 1 && (
            <>
              {" "}Har du mange kort fra dette settet, går det fortere å lime inn hele lista.
            </>
          )}
        </p>
      )}

      {vist.map((t) => (
        <Treff key={`${t.card_id}:${t.finish}`} tilbud={t} kurv={kurv} onLegg={onLegg} />
      ))}

      {sider > 1 && <Sider side={side} sider={sider} onBytt={byttSide} />}
    </>
  );
}

// Nummererte sider, ikke «vis flere». Kunden som leter etter et bestemt kort
// i et helt sett skal kunne hoppe, ikke klikke seg nedover.
function Sider({ side, sider, onBytt }) {
  // Med 20 sider er ikke alle nummer nyttige. Vi viser de nærmeste, pluss
  // første og siste, så man alltid ser hvor enden er.
  const nummer = [];
  for (let i = 0; i < sider; i++) {
    if (i === 0 || i === sider - 1 || Math.abs(i - side) <= 2) nummer.push(i);
    else if (nummer[nummer.length - 1] !== "…") nummer.push("…");
  }

  return (
    <nav className="rad-flex" style={{ gap: 6, margin: "18px 0 8px", flexWrap: "wrap" }}>
      <button className="knapp liten" disabled={side === 0} onClick={() => onBytt(side - 1)}>
        Forrige
      </button>
      {nummer.map((n, i) =>
        n === "…" ? (
          <span key={`p${i}`} className="dempet" style={{ padding: "0 4px" }}>…</span>
        ) : (
          <button
            key={n}
            className={`knapp liten ${n === side ? "primar" : ""}`}
            aria-current={n === side ? "page" : undefined}
            onClick={() => onBytt(n)}
          >
            {n + 1}
          </button>
        )
      )}
      <button className="knapp liten" disabled={side >= sider - 1} onClick={() => onBytt(side + 1)}>
        Neste
      </button>
    </nav>
  );
}

export function Treff({ tilbud, kurv, onLegg }) {
  const plass = ledig(kurv, tilbud);
  return (
    <div className="treff">
      <div className="rad">
        {tilbud.image_uri ? (
          <img className="bilde" src={tilbud.image_uri} alt={`${tilbud.name}, ${tilbud.set_name}`} loading="lazy" />
        ) : (
          <div className="bilde" />
        )}
        <div className="midt">
          <div className="rad-flex" style={{ gap: 8 }}>
            <span className="navn">{tilbud.name}</span>
            {tilbud.finish === "foil" && <span className="merkelapp m-foil">Foil</span>}
          </div>
          <div className="sett">
            {tilbud.set_name}
            {tilbud.collector_number ? <span className="kode dempet"> #{tilbud.collector_number}</span> : null}
          </div>
          <div style={{ marginTop: 7 }}>
            {plass > 0 ? (
              <span className="merkelapp m-ledig">Inntil {plass} stk.</span>
            ) : (
              <span className="merkelapp m-nei">Kvoten er full</span>
            )}
          </div>
        </div>

        {/* Prisene til høyre. Der er det plass til alle fire tilstandene på
            én linje, og raden blir ikke høyere enn kortbildet. */}
        <div className="hoyre">
          <div className="kreditt-merk">Store credit</div>
          <div className="priser">
            {tilbud.conditions.map((c) => (
              <button
                key={c.condition}
                className="pris-knapp"
                disabled={plass <= 0}
                onClick={() => onLegg(tilbud, c.condition)}
                title={`Legg til ett kort i ${c.navn} — ${kroner(c.ore)} i butikkreditt`}
              >
                <span className="cond">{c.navn}</span>
                <b>{kroner(c.ore)}</b>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
