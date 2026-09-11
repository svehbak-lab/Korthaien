import { useState, useEffect, useMemo } from "react";
import { api, kroner, CONDITIONS } from "../api.js";

// ─────────────────────────────────────────────────────────────────────────────
// BUTIKKVISNING
// ─────────────────────────────────────────────────────────────────────────────
// Forhåndsvisning av hvordan kundene vil se kortene. Den ligger i admin inntil
// salgssiden bygges, og flyttes ut da.
//
// Hensikten er ikke pynt. Det er den eneste måten å oppdage at et intervall
// traff feil: prisene må stå ved siden av kortet, ikke i en tabell over regler.
//
// To visninger, som hos Card Kingdom. Tekstvisning med tilstandene nedover for
// å skumme mange kort, og detaljvisning med bilde og faner når du vil se ett.

export default function Butikk({ onFeil }) {
  const [sett, setSett] = useState(null);
  const [alle, setAlle] = useState([]);
  const [data, setData] = useState(null);
  const [laster, setLaster] = useState(false);
  const [visning, setVisning] = useState("tekst");
  const [finish, setFinish] = useState("nonfoil");
  const [q, setQ] = useState("");
  const [rarity, setRarity] = useState("");
  const [baresalg, setBaresalg] = useState(false);

  useEffect(() => {
    api.sett().then((r) => {
      setAlle(r.sett.filter((s) => Number(s.enabled)));
    }).catch(onFeil);
  }, []);

  useEffect(() => {
    if (!sett) return;
    setLaster(true);
    const t = setTimeout(() => {
      api.butikk({ sett, q, rarity, baresalg })
        .then(setData)
        .catch(onFeil)
        .finally(() => setLaster(false));
    }, 250);
    return () => clearTimeout(t);
  }, [sett, q, rarity, baresalg]);

  // Bare kort som finnes i valgt finish, og som har minst én pris.
  const synlige = useMemo(() => {
    if (!data) return [];
    return data.kort
      .map((k) => ({ ...k, variant: k.varianter.find((v) => v.finish === finish) }))
      .filter((k) => k.variant?.tilstander.length);
  }, [data, finish]);

  const utenPris = data?.utenPris ?? 0;

  return (
    <>
      <h1>Butikkvisning</h1>
      <p className="dempet" style={{ marginTop: -6 }}>
        Slik kundene vil se kortene. Ligger her inntil salgssiden bygges — bruk den
        til å se om intervallene gir prisene du mente.
      </p>

      <div className="panel">
        <div className="krop">
          <div className="rad-flex">
            <select value={sett || ""} onChange={(e) => setSett(e.target.value || null)}>
              <option value="">Velg sett…</option>
              {alle.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.name} ({String(s.code).toUpperCase()})
                </option>
              ))}
            </select>
            <input
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Søk i settet"
              style={{ width: 200 }}
            />
            <select value={rarity} onChange={(e) => setRarity(e.target.value)}>
              <option value="">Alle rariteter</option>
              {["common", "uncommon", "rare", "mythic", "special"].map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
            <label className="dempet" style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <input type="checkbox" checked={baresalg} onChange={(e) => setBaresalg(e.target.checked)} />
              Bare det jeg har på lager
            </label>
          </div>

          {sett && (
            <div className="rad-flex" style={{ marginTop: 12 }}>
              {["nonfoil", "foil"].map((f) => (
                <button
                  key={f}
                  className={`knapp liten ${finish === f ? "primar" : ""}`}
                  onClick={() => setFinish(f)}
                >
                  {f === "foil" ? "Foils" : "Vanlige"}
                </button>
              ))}
              <span style={{ marginLeft: "auto" }} />
              {["tekst", "detalj"].map((v) => (
                <button
                  key={v}
                  className={`knapp liten ${visning === v ? "primar" : ""}`}
                  onClick={() => setVisning(v)}
                >
                  {v === "tekst" ? "Tekstvisning" : "Detaljvisning"}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {!sett && <p className="dempet">Velg et sett for å se hvordan det ser ut.</p>}
      {sett && laster && <p className="dempet">Henter…</p>}

      {sett && !laster && data && (
        <>
          <p className="dempet">
            {synlige.length} {synlige.length === 1 ? "kort" : "kort"} i{" "}
            {finish === "foil" ? "foil" : "vanlig utgave"}.
            {data.totalt > data.kort.length && (
              <>
                {" "}
                Viser {data.kort.length} av {data.totalt} — søk eller filtrer for å
                snevre inn.
              </>
            )}
            {utenPris > 0 && (
              <>
                {" "}
                {utenPris} kort i settet har ingen pris — verken fra Scryfall,
                intervallene eller manuelt. De ville ikke vært til salgs.
              </>
            )}
          </p>

          {visning === "tekst"
            ? synlige.map((k) => <Tekstrad key={k.id} kort={k} />)
            : synlige.map((k) => <Detaljrad key={k.id} kort={k} />)}

          {!synlige.length && <div className="tom">Ingen kort passer filteret.</div>}
        </>
      )}
    </>
  );
}

// Tilstandene nedover, med lager og pris på samme linje. Tettere og lettere å
// skumme enn et rutenett, som er hele poenget med tekstvisning.
function Tekstrad({ kort }) {
  return (
    <div className="panel" style={{ marginBottom: 8 }}>
      <div className="krop" style={{ display: "flex", gap: 20, alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>
            {kort.name}
            {kort.variant && kort.variant !== "vanlig" && (
              <span className="merkelapp m-vent" style={{ marginLeft: 6 }}>{kort.variant}</span>
            )}
          </div>
          <div className="dempet" style={{ fontSize: 13 }}>
            {kort.set_name} · {kort.type_line || kort.rarity}
          </div>
          <div className="dempet" style={{ fontSize: 12 }}>
            Nr. {kort.collector_number}
            {kort.mana_cost ? ` · ${kort.mana_cost}` : ""}
          </div>
        </div>

        <table style={{ width: 260, flex: "none" }}>
          <tbody>
            {kort.variant.tilstander.map((t) => (
              <tr key={t.condition}>
                <td style={{ width: 40, padding: "3px 6px" }}>{t.condition}</td>
                <td className="h dempet" style={{ padding: "3px 6px", fontSize: 13 }}>
                  {t.lager > 0 ? `${t.lager} stk.` : "utsolgt"}
                </td>
                <td
                  className="h tall"
                  style={{ padding: "3px 6px", color: t.lager > 0 ? "inherit" : "var(--dempet)" }}
                >
                  {kroner(t.ore)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Bilde og faner per tilstand. Trykker du på en fane, er det den prisen som
// vises — slik Card Kingdom gjør det.
function Detaljrad({ kort }) {
  const første = kort.variant.tilstander.find((t) => t.lager > 0) || kort.variant.tilstander[0];
  const [valgt, setValgt] = useState(første.condition);
  const t = kort.variant.tilstander.find((x) => x.condition === valgt) || første;

  return (
    <div className="panel" style={{ marginBottom: 10 }}>
      <div className="krop" style={{ display: "flex", gap: 18, alignItems: "flex-start" }}>
        {kort.image_uri ? (
          <img
            src={kort.image_uri}
            alt={kort.name}
            loading="lazy"
            style={{ width: 130, borderRadius: 7, alignSelf: "flex-start" }}
          />
        ) : (
          <div style={{ width: 130, aspectRatio: "5 / 7", background: "var(--papir)", borderRadius: 7 }} />
        )}

        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="rad-flex" style={{ justifyContent: "space-between" }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: 16 }}>{kort.name}</div>
              <div className="dempet" style={{ fontSize: 13 }}>
                {kort.set_name} · Nr. {kort.collector_number}
              </div>
            </div>
            <div className="tall" style={{ fontSize: 20, fontWeight: 700 }}>{kroner(t.ore)}</div>
          </div>

          <div className="dempet" style={{ fontSize: 13, margin: "6px 0" }}>
            {kort.mana_cost} {kort.type_line}
            {kort.power ? ` · ${kort.power}/${kort.toughness}` : ""}
            {kort.loyalty ? ` · ${kort.loyalty}` : ""}
          </div>

          {kort.oracle_text && (
            <p style={{ whiteSpace: "pre-line", fontSize: 13.5, margin: "0 0 10px", maxWidth: "60ch" }}>
              {kort.oracle_text}
            </p>
          )}

          <div className="rad-flex" style={{ gap: 4 }}>
            {CONDITIONS.map((c) => {
              const x = kort.variant.tilstander.find((y) => y.condition === c);
              if (!x) return null;
              return (
                <button
                  key={c}
                  className={`knapp liten ${valgt === c ? "primar" : ""}`}
                  disabled={!x.lager}
                  onClick={() => setValgt(c)}
                  title={x.lager ? `${x.lager} på lager` : "Utsolgt"}
                >
                  {c}
                </button>
              );
            })}
            <span className="dempet" style={{ marginLeft: 8 }}>
              {t.lager > 0 ? `${t.lager} på lager` : "Utsolgt"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
