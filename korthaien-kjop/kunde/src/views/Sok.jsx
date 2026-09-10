import { useState, useEffect, useRef } from "react";
import { api, kroner, ledig } from "../api.js";

export default function Søk({ kurv, onLegg, onFeil }) {
  const [sett, setSett] = useState([]);
  const [q, setQ] = useState("");
  const [valgtSett, setValgtSett] = useState("");
  const [raritet, setRaritet] = useState("");
  const [treff, setTreff] = useState(null);
  const [laster, setLaster] = useState(false);
  const teller = useRef(0);

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

  return (
    <>
      <div className="rad-flex" style={{ marginBottom: 16 }}>
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

      {/* Prisknappene ser ut som prislapper. Uten denne linjen er det ikke
          opplagt at de er noe man trykker på, eller at ett klikk er ett kort. */}
      {treff?.length > 0 && (
        <p className="dempet" style={{ marginTop: 0, marginBottom: 14 }}>
          Klikk på prisen for den tilstanden kortet ditt er i. Hvert klikk legger til
          ett kort — har du fire, klikker du fire ganger. Du kan justere antallet i
          lista til høyre etterpå.
        </p>
      )}

      {treff?.map((t) => (
        <Treff key={`${t.card_id}:${t.finish}`} tilbud={t} kurv={kurv} onLegg={onLegg} />
      ))}
    </>
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
