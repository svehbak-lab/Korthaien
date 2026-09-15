import { useState, useEffect, useMemo } from "react";
import { api, kroner, CONDITIONS } from "../api.js";

// ─────────────────────────────────────────────────────────────────────────────
// BUTIKKVISNING
// ─────────────────────────────────────────────────────────────────────────────
// Forhåndsvisning av hvordan kundene vil se kortene. Ligger i admin inntil
// salgssiden bygges, og flyttes ut da.
//
// Hensikten er ikke pynt. Det er den eneste måten å oppdage at et intervall
// traff feil: prisene må stå ved siden av kortet, ikke i en tabell over regler.
//
// Sorteringen skjer på serveren, over hele settet. Sorterer man bare de kortene
// man allerede har hentet, får man den dyreste av de 25 første.

const FARGER = [
  { kode: "W", navn: "Hvit" },
  { kode: "U", navn: "Blå" },
  { kode: "B", navn: "Svart" },
  { kode: "R", navn: "Rød" },
  { kode: "G", navn: "Grønn" },
  { kode: "C", navn: "Fargeløs" },
];

const TYPER = ["Creature", "Instant", "Sorcery", "Artifact", "Enchantment", "Planeswalker", "Land"];

const SORTERING = [
  { id: "navn", navn: "Navn, A til Å" },
  { id: "navn_ned", navn: "Navn, Å til A" },
  { id: "pris_ned", navn: "Pris, høy til lav" },
  { id: "pris_opp", navn: "Pris, lav til høy" },
];

const RARITETER = ["mythic", "rare", "uncommon", "common", "special"];

// Rariteten er små bokstaver i dataene, men skal leses som en etikett ved
// siden av Hvit, Blå og Creature.
const stor = (s) => s.charAt(0).toUpperCase() + s.slice(1);

const TOMT = {
  q: "", rarity: [], farge: [], type: [],
  // Forsiden viser det du faktisk har. Et tomt skjermbilde forteller ingenting.
  baresalg: true, prisFra: "", prisTil: "",
};

export default function Butikk({ onFeil }) {
  const [sett, setSett] = useState(null);
  const [alle, setAlle] = useState([]);
  const [data, setData] = useState(null);
  const [laster, setLaster] = useState(false);
  const [visning, setVisning] = useState("detalj");
  const [finish, setFinish] = useState("nonfoil");
  const [sortering, setSortering] = useState("pris_ned");
  const [perSide, setPerSide] = useState(25);
  const [side, setSide] = useState(1);
  const [f, setF] = useState(TOMT);
  const [åpentKort, setÅpentKort] = useState(null);

  useEffect(() => {
    api.sett().then((r) => setAlle(r.sett.filter((s) => Number(s.enabled)))).catch(onFeil);
  }, []);

  // Lagerfilteret hører til forsiden, der det er det eneste som avgrenser.
  // Velger du et sett, vil du se hele settet — ikke bare det du eier.
  useEffect(() => {
    setF((x) => ({ ...x, baresalg: !sett }));
  }, [sett]);

  // Endrer du et filter, må du tilbake til første side. Ellers står du på side
  // sju i et resultat med to sider og ser ingenting.
  useEffect(() => setSide(1), [sett, finish, sortering, perSide, f]);

  useEffect(() => {
    setLaster(true);
    const t = setTimeout(() => {
      api.butikk({
        sett: sett || "", finish, sortering, side, perSide, ...f,
        rarity: f.rarity.join(","), farge: f.farge.join(","), type: f.type.join(","),
      })
        .then(setData)
        .catch(onFeil)
        .finally(() => setLaster(false));
    }, 250);
    return () => clearTimeout(t);
  }, [sett, finish, sortering, side, perSide, f]);

  const synlige = useMemo(() => {
    if (!data) return [];
    return data.kort
      .map((k) => ({ ...k, valgt: k.varianter.find((v) => v.finish === finish) }))
      .filter((k) => k.valgt?.tilstander.length);
  }, [data, finish]);

  const endre = (felt, verdi) => setF((x) => ({ ...x, [felt]: verdi }));
  // Haker legger til og fjerner fra en liste. Ett valg er sjelden nok — man
  // leter gjerne etter rare og mythic samtidig.
  const veksle = (felt, verdi) =>
    setF((x) => ({
      ...x,
      [felt]: x[felt].includes(verdi) ? x[felt].filter((v) => v !== verdi) : [...x[felt], verdi],
    }));

  if (åpentKort) {
    return (
      <div className="butikk">
        <Kortside
          id={åpentKort}
          onLukk={() => setÅpentKort(null)}
          onÅpne={setÅpentKort}
          onSett={(kode) => { setSett(kode); setÅpentKort(null); }}
          onFeil={onFeil}
        />
      </div>
    );
  }

  return (
    <div className="butikk">
      <h1>Butikkvisning</h1>
      <p className="dempet" style={{ marginTop: -6 }}>
        Slik kundene vil se kortene. Ligger her inntil salgssiden bygges — bruk den
        til å se om intervallene gir prisene du mente.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "220px minmax(0, 1fr)", gap: 20, alignItems: "start" }}>
        <div className="panel" style={{ position: "sticky", top: 16 }}>
          <div className="krop">
            <Fast navn="Kortnavn">
              <input type="text" value={f.q} onChange={(e) => endre("q", e.target.value)} style={{ width: "100%" }} />
            </Fast>

            <Fast navn="Sett">
              <select value={sett || ""} onChange={(e) => setSett(e.target.value || null)} style={{ width: "100%" }}>
                <option value="">Alle sett</option>
                {alle.map((s) => (
                  <option key={s.code} value={s.code}>{s.name}</option>
                ))}
              </select>
            </Fast>

            <Gruppe navn="Raritet">
              {RARITETER.map((r) => (
                <Hake
                  key={r}
                  navn={stor(r)}
                  av={f.rarity.includes(r)}
                  onVeksle={() => veksle("rarity", r)}
                />
              ))}
            </Gruppe>

            <Gruppe navn="Farge">
              {FARGER.map((x) => (
                <Hake
                  key={x.kode}
                  navn={x.navn}
                  av={f.farge.includes(x.kode)}
                  onVeksle={() => veksle("farge", x.kode)}
                />
              ))}
            </Gruppe>

            <Gruppe navn="Type" lukket>
              {TYPER.map((t) => (
                <Hake key={t} navn={t} av={f.type.includes(t)} onVeksle={() => veksle("type", t)} />
              ))}
            </Gruppe>

            <Gruppe navn="Pris">
              <div className="rad-flex" style={{ gap: 4 }}>
                <input
                  type="text" inputMode="numeric" value={f.prisFra} placeholder="fra"
                  onChange={(e) => endre("prisFra", e.target.value.replace(/\D/g, ""))}
                  style={{ width: 62 }}
                />
                <input
                  type="text" inputMode="numeric" value={f.prisTil} placeholder="til"
                  onChange={(e) => endre("prisTil", e.target.value.replace(/\D/g, ""))}
                  style={{ width: 62 }}
                />
              </div>
            </Gruppe>

            <label className="dempet" style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 10 }}>
              <input type="checkbox" checked={f.baresalg} onChange={(e) => endre("baresalg", e.target.checked)} />
              Vis kun kort på lager
            </label>

            <button className="knapp liten" style={{ marginTop: 12 }} onClick={() => setF(TOMT)}>
              Nullstill filtre
            </button>
          </div>
        </div>

        <div>
          <>
              <div className="panel" style={{ paddingBottom: 0 }}>
                <div className="krop" style={{ paddingBottom: 0 }}>
                  {/* Fanene er sidenavigasjon, ikke knapper. Antallet i
                      parentes er det som gjør dem verdt å ha. */}
                  <div className="faner" role="tablist">
                    {[
                      { id: "nonfoil", navn: "Enkeltkort" },
                      { id: "foil", navn: "Foils" },
                    ].map((x) => (
                      <button
                        key={x.id}
                        role="tab"
                        aria-selected={finish === x.id}
                        onClick={() => setFinish(x.id)}
                      >
                        {x.navn}
                        {data && <span className="dempet"> ({data.antall?.[x.id] ?? 0})</span>}
                      </button>
                    ))}

                    <div style={{ marginLeft: "auto", display: "flex", gap: 2, paddingBottom: 8 }}>
                      <VisningsIkon
                        aktiv={visning === "tekst"}
                        tittel="Tekstvisning"
                        onClick={() => setVisning("tekst")}
                        strek
                      />
                      <VisningsIkon
                        aktiv={visning === "detalj"}
                        tittel="Detaljvisning"
                        onClick={() => setVisning("detalj")}
                      />
                    </div>
                  </div>

                  <div className="rad-flex" style={{ padding: "10px 0", justifyContent: "space-between" }}>
                    <span className="dempet">
                      {data
                        ? data.totalt === 0
                          ? "Ingen treff"
                          : `${(data.side - 1) * data.perSide + 1}–${Math.min(data.side * data.perSide, data.totalt)} av ${data.totalt}`
                        : ""}
                    </span>
                    <div className="rad-flex">
                      <label className="dempet">
                        Sorter{" "}
                        <select value={sortering} onChange={(e) => setSortering(e.target.value)}>
                          {SORTERING.map((x) => <option key={x.id} value={x.id}>{x.navn}</option>)}
                        </select>
                      </label>
                      <label className="dempet">
                        Vis{" "}
                        <select value={perSide} onChange={(e) => setPerSide(Number(e.target.value))}>
                          {[25, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}
                        </select>
                      </label>
                    </div>
                  </div>
                </div>
              </div>

              {laster && <p className="dempet">Henter…</p>}

              {!laster && data && (
                <>
                  <p className="dempet">
                    {data.utenPris > 0 && (
                      <>
                        {" "}
                        {data.utenPris} av kortene på denne siden har ingen pris —
                        verken fra Scryfall, intervallene eller manuelt. De ville ikke
                        vært til salgs.
                      </>
                    )}
                  </p>

                  {visning === "tekst"
                    ? synlige.map((k) => (
                        <Tekstrad
                          key={k.id}
                          kort={k}
                          onÅpne={() => setÅpentKort(k.id)}
                          onSett={() => setSett(k.set_code)}
                        />
                      ))
                    : synlige.map((k) => (
                        <Detaljrad
                          key={k.id}
                          kort={k}
                          onÅpne={() => setÅpentKort(k.id)}
                          onSett={() => setSett(k.set_code)}
                        />
                      ))}

                  {!synlige.length && <div className="tom">Ingen kort passer filteret.</div>}

                  {data.sider > 1 && (
                    <div className="rad-flex" style={{ justifyContent: "center", marginTop: 16 }}>
                      <button className="knapp" disabled={data.side <= 1} onClick={() => setSide(data.side - 1)}>
                        Forrige
                      </button>
                      <span className="dempet">Side {data.side} av {data.sider}</span>
                      <button
                        className="knapp"
                        disabled={data.side >= data.sider}
                        onClick={() => setSide(data.side + 1)}
                      >
                        Neste
                      </button>
                    </div>
                  )}
                </>
              )}
          </>
        </div>
      </div>
    </div>
  );
}

// Gult merke, som hos Card Kingdom. Foil og vanlig er samme kort med samme
// bilde, og uten et tydelig merke er det lett å bestille feil.
function FoilMerke() {
  return (
    <span
      style={{
        display: "inline-block",
        marginTop: 5,
        background: "#f5d020",
        color: "#3b2f05",
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: "0.04em",
        padding: "1px 7px",
        borderRadius: 3,
      }}
    >
      FOIL
    </span>
  );
}

// To ikoner i stedet for ordene «Tekst» og «Detalj». Symbolene er kjente fra
// enhver nettbutikk, og de tar mindre plass enn teksten de erstatter.
function VisningsIkon({ aktiv, tittel, onClick, strek }) {
  return (
    <button
      title={tittel}
      aria-label={tittel}
      aria-pressed={aktiv}
      onClick={onClick}
      style={{
        border: "1px solid var(--strek)",
        background: aktiv ? "var(--aksent-svak)" : "var(--flate)",
        color: aktiv ? "var(--aksent)" : "var(--dempet)",
        borderRadius: 6,
        padding: "5px 8px",
        lineHeight: 0,
      }}
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
        {strek ? (
          <>
            <rect x="1" y="2" width="14" height="2" rx="1" />
            <rect x="1" y="7" width="14" height="2" rx="1" />
            <rect x="1" y="12" width="14" height="2" rx="1" />
          </>
        ) : (
          <>
            <rect x="1" y="2" width="5" height="12" rx="1" />
            <rect x="8" y="3" width="7" height="2" rx="1" />
            <rect x="8" y="7" width="7" height="2" rx="1" />
            <rect x="8" y="11" width="5" height="2" rx="1" />
          </>
        )}
      </svg>
    </button>
  );
}

// Felter som alltid er i bruk. De trenger ingen sammenslåing — en pil å
// klikke på gir bare et klikk uten gevinst.
function Fast({ navn, children }) {
  return (
    <div style={{ marginBottom: 10, borderBottom: "1px solid var(--strek)", paddingBottom: 10 }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>{navn}</div>
      {children}
    </div>
  );
}

// Grupper som kan slås sammen. Med haker i stedet for nedtrekk blir menyen
// lang, og da må den kunne ryddes bort.
// ─────────────────────────────────────────────────────────────────────────────
// MANASYMBOLER
// ─────────────────────────────────────────────────────────────────────────────
// Scryfall serverer symbolene som SVG på faste adresser. «{3}» blir 3.svg,
// «{W/U}» blir WU.svg. Symbolene er Wizards' eiendom, men de stilles til
// rådighet gjennom Scryfall og brukes av alle kortbutikker.
//
// Teksten splittes på klammene og settes sammen igjen med bilder der det var
// symboler. Ukjente koder får stå som de er — bedre en synlig «{Q}» enn et
// ødelagt bilde.
// Delingen må være global, men prøvingen må ikke: et globalt regexp husker
// posisjon mellom kall til test(), og da slår annenhver sjekk feil.
const SYMBOL_DEL = /(\{[^}]{1,10}\})/g;
const ER_SYMBOL = /^\{[^}]{1,10}\}$/;

function symbolFil(kode) {
  return kode
    .slice(1, -1)
    .replace(/\//g, "")
    .toUpperCase();
}

export function MedSymboler({ tekst, størrelse = 14 }) {
  if (!tekst) return null;
  const deler = String(tekst).split(SYMBOL_DEL);
  return (
    <>
      {deler.map((d, i) => {
        if (!ER_SYMBOL.test(d)) return d;
        const fil = symbolFil(d);
        if (!/^[A-Z0-9∞]{1,4}$/.test(fil)) return d;
        return (
          <img
            key={i}
            src={`https://svgs.scryfall.io/card-symbols/${fil}.svg`}
            alt={d}
            title={d}
            loading="lazy"
            style={{
              width: størrelse,
              height: størrelse,
              verticalAlign: "-2px",
              margin: "0 1px",
            }}
            // Finnes ikke symbolet, vis koden i stedet for et brutt bilde.
            onError={(e) => {
              e.currentTarget.replaceWith(document.createTextNode(d));
            }}
          />
        );
      })}
    </>
  );
}

function Gruppe({ navn, children, lukket }) {
  const [åpen, setÅpen] = useState(!lukket);
  return (
    <div style={{ marginBottom: 10, borderBottom: "1px solid var(--strek)", paddingBottom: 8 }}>
      <button
        onClick={() => setÅpen(!åpen)}
        aria-expanded={åpen}
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          width: "100%", border: "none", background: "none", padding: "2px 0",
          fontSize: 13, fontWeight: 600, color: "var(--blekk)", cursor: "pointer",
        }}
      >
        {navn}
        <span className="dempet" style={{ fontSize: 11 }}>{åpen ? "\u25b2" : "\u25bc"}</span>
      </button>
      {åpen && <div style={{ marginTop: 6 }}>{children}</div>}
    </div>
  );
}

function Hake({ navn, av, onVeksle }) {
  return (
    <label
      style={{
        display: "flex", alignItems: "center", gap: 7,
        fontSize: 13.5, padding: "2px 0", cursor: "pointer",
        color: av ? "var(--blekk)" : "var(--dempet)",
      }}
    >
      <input type="checkbox" checked={av} onChange={onVeksle} />
      {navn}
    </label>
  );
}

// Tilstandene nedover, med lager og pris på samme linje. Tettere og lettere å
// skumme enn et rutenett, som er hele poenget med tekstvisning.
function Tekstrad({ kort, onÅpne, onSett }) {
  return (
    <div className="panel" style={{ marginBottom: 8 }}>
      <div className="krop" style={{ display: "flex", gap: 20, alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>
            <button className="lenke" onClick={onÅpne}>{kort.name}</button>
            {kort.variant && kort.variant !== "vanlig" && (
              <span className="merkelapp m-vent" style={{ marginLeft: 6 }}>{kort.variant}</span>
            )}
          </div>
          <div className="dempet" style={{ fontSize: 13 }}>
            <button className="lenke" onClick={onSett}>{kort.set_name}</button>
            {" · "}
            {kort.type_line || kort.rarity}
          </div>
          <div className="dempet" style={{ fontSize: 12 }}>
            Collector #: {kort.collector_number}
            {kort.mana_cost ? <> · <MedSymboler tekst={kort.mana_cost} størrelse={12} /></> : null}
          </div>
          {kort.valgt.finish === "foil" && <FoilMerke />}
        </div>

        {/* Tilstand, pris, antall, og til slutt handlingen. Rekkefølgen er
            den man leser i: hva slags stand, hva koster det, har du noen,
            og kan jeg få det. */}
        <table style={{ width: 330, flex: "none" }}>
          <tbody>
            {kort.valgt.tilstander.map((t) => (
              <tr key={t.condition}>
                <td style={{ width: 38, padding: "3px 6px", fontWeight: 500 }}>{t.condition}</td>
                <td
                  className={`h tall ${t.lager > 0 ? "pris" : "utsolgt"}`}
                  style={{ width: 80, padding: "3px 6px" }}
                >
                  {kroner(t.ore)}
                </td>
                <td className="h dempet" style={{ width: 62, padding: "3px 6px", fontSize: 13 }}>
                  {t.lager > 0 ? `${t.lager} stk.` : ""}
                </td>
                <td className="h" style={{ padding: "3px 6px" }}>
                  {t.lager > 0 ? (
                    <button
                      className="knapp liten"
                      disabled
                      title="Kurven kommer når kassen bygges"
                      style={{ padding: "2px 10px" }}
                    >
                      Legg i kurven
                    </button>
                  ) : (
                    <span className="dempet" style={{ fontSize: 13 }}>Utsolgt</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Bilde til venstre, kortopplysninger i midten, og en prisboks til høyre med
// tilstandene som faner — slik Card Kingdom gjør det. Trykker du på en fane,
// bytter både prisen og antallet over og under.
function Detaljrad({ kort, onÅpne, onSett }) {
  const første = kort.valgt.tilstander.find((t) => t.lager > 0) || kort.valgt.tilstander[0];
  const [valgt, setValgt] = useState(første.condition);
  const t = kort.valgt.tilstander.find((x) => x.condition === valgt) || første;

  return (
    <div className="panel" style={{ marginBottom: 10 }}>
      <div className="krop" style={{ display: "flex", gap: 18, alignItems: "flex-start" }}>
        {kort.image_uri ? (
          <img
            src={kort.image_uri}
            alt={kort.name}
            loading="lazy"
            onClick={onÅpne}
            style={{ width: 130, borderRadius: 7, alignSelf: "flex-start", cursor: "pointer" }}
          />
        ) : (
          <div style={{ width: 130, aspectRatio: "5 / 7", background: "var(--papir)", borderRadius: 7 }} />
        )}

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 16 }}>
            <button className="lenke" onClick={onÅpne}>{kort.name}</button>
          </div>
          <div style={{ fontSize: 13 }}>
            <button className="lenke" onClick={onSett}>{kort.set_name}</button>
          </div>
          <div className="dempet" style={{ fontSize: 13 }}>
            Collector #: {kort.collector_number}
          </div>
          {kort.valgt.finish === "foil" && <FoilMerke />}

          <div className="dempet" style={{ fontSize: 13, margin: "8px 0 0" }}>
            <MedSymboler tekst={kort.mana_cost} /> {kort.type_line}
            {kort.power ? ` · ${kort.power}/${kort.toughness}` : ""}
            {kort.loyalty ? ` · ${kort.loyalty}` : ""}
          </div>

          {kort.oracle_text && (
            <p style={{ whiteSpace: "pre-line", fontSize: 13.5, margin: "6px 0 0", maxWidth: "56ch", lineHeight: 1.6 }}>
              <MedSymboler tekst={kort.oracle_text} />
            </p>
          )}
        </div>

        <div style={{ width: 200, flex: "none", textAlign: "center" }}>
          <div className="tall pris-stor" style={{ marginBottom: 6 }}>{kroner(t.ore)}</div>

          <div className="cond-valg">
            {CONDITIONS.map((c) => {
              const x = kort.valgt.tilstander.find((y) => y.condition === c);
              if (!x) return null;
              const aktiv = valgt === c;
              return (
                <button
                  key={c}
                  onClick={() => setValgt(c)}
                  aria-pressed={aktiv}
                  className={x.lager ? undefined : "tom"}
                  title={x.lager ? `${x.lager} på lager` : "Utsolgt — prisen vises likevel"}
                >
                  {c}
                </button>
              );
            })}
          </div>

          <div className="dempet" style={{ fontSize: 13, margin: "7px 0 8px" }}>
            {t.lager > 0 ? `${t.lager} tilgjengelig` : "Utsolgt"}
          </div>

          {/* Kurven finnes ikke ennå. Knappen står her fordi plasseringen er
              det som skal vurderes — den kobles opp når kassen bygges. */}
          <button
            className="knapp primar"
            style={{ width: "100%" }}
            disabled
            title="Kurven kommer når kassen bygges"
          >
            Legg i kurven
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// KORTSIDE
// ─────────────────────────────────────────────────────────────────────────────
// Alt om ett trykk, og de andre utgavene av samme kort. «Samme kort» er
// Scryfalls oracle_id, ikke navnet — den holder også når navnet er skrevet
// ulikt mellom utgivelser.
function Kortside({ id, onLukk, onÅpne, onSett, onFeil }) {
  const [data, setData] = useState(null);
  const [finish, setFinish] = useState("nonfoil");
  const [valgt, setValgt] = useState(null);

  useEffect(() => {
    setData(null);
    api.butikkKort(id)
      .then((d) => {
        setData(d);
        const første = d.kort.varianter[0];
        setFinish(første?.finish || "nonfoil");
        setValgt(
          (første?.tilstander.find((t) => t.lager > 0) || første?.tilstander[0])?.condition || "NM"
        );
      })
      .catch(onFeil);
  }, [id]);

  if (!data) return <p className="dempet">Henter…</p>;

  const k = data.kort;
  const variant = k.varianter.find((v) => v.finish === finish) || k.varianter[0];
  const t = variant?.tilstander.find((x) => x.condition === valgt) || variant?.tilstander[0];
  const harBegge = k.varianter.length > 1;

  return (
    <>
      <button className="knapp liten" style={{ marginBottom: 14 }} onClick={onLukk}>
        ← Tilbake til lista
      </button>

      <h1 style={{ marginBottom: 4 }}>{k.name}</h1>
      <p className="dempet" style={{ marginTop: 0 }}>
        <button className="lenke" onClick={() => onSett(k.set_code)}>{k.set_name}</button>
      </p>

      <div className="panel">
        <div className="krop" style={{ display: "flex", gap: 24, alignItems: "flex-start" }}>
          {k.image_uri ? (
            <img src={k.image_uri} alt={k.name} style={{ width: 240, borderRadius: 11 }} />
          ) : (
            <div style={{ width: 240, aspectRatio: "5 / 7", background: "var(--papir)", borderRadius: 11 }} />
          )}

          <div style={{ flex: 1, minWidth: 0 }}>
            <Rad navn="Utgave">
              <button className="lenke" onClick={() => onSett(k.set_code)}>{k.set_name}</button>
            </Rad>
            <Rad navn="Type">{k.type_line || "\u2014"}</Rad>
            {k.mana_cost && <Rad navn="Kostnad"><MedSymboler tekst={k.mana_cost} /></Rad>}
            <Rad navn="Raritet">{k.rarity || "\u2014"}</Rad>
            <Rad navn="Collector #">{k.collector_number}</Rad>
            {(k.power || k.loyalty) && (
              <Rad navn={k.loyalty ? "Lojalitet" : "Styrke"}>
                {k.loyalty ? k.loyalty : `${k.power}/${k.toughness}`}
              </Rad>
            )}
            {k.artist && <Rad navn="Kunstner">{k.artist}</Rad>}
            {Number(k.reserved) === 1 && (
              <Rad navn="Merk">
                <span className="merkelapp m-velg">På reservelisten</span>
              </Rad>
            )}

            {k.oracle_text && (
              <p style={{ whiteSpace: "pre-line", fontSize: 14, lineHeight: 1.65, margin: "16px 0 0", maxWidth: "58ch" }}>
                <MedSymboler tekst={k.oracle_text} />
              </p>
            )}
          </div>

          <div style={{ width: 210, flex: "none", textAlign: "center" }}>
            {!variant ? (
              <p className="dempet">Ikke til salgs — kortet har ingen pris.</p>
            ) : (
              <>
                <div className="tall pris-stor" style={{ marginBottom: 6 }}>{kroner(t.ore)}</div>
                <div className="cond-valg">
                  {CONDITIONS.map((c) => {
                    const x = variant.tilstander.find((y) => y.condition === c);
                    if (!x) return null;
                    return (
                      <button
                        key={c}
                        onClick={() => setValgt(c)}
                        aria-pressed={valgt === c}
                        className={x.lager ? undefined : "tom"}
                        title={x.lager ? `${x.lager} på lager` : "Utsolgt — prisen vises likevel"}
                      >
                        {c}
                      </button>
                    );
                  })}
                </div>
                <div className="dempet" style={{ fontSize: 13, margin: "7px 0 8px" }}>
                  {t.lager > 0 ? `${t.lager} tilgjengelig` : "Utsolgt"}
                </div>
                <button className="knapp primar" style={{ width: "100%" }} disabled title="Kurven kommer når kassen bygges">
                  Legg i kurven
                </button>
                {harBegge && (
                  <button
                    className="knapp"
                    style={{ width: "100%", marginTop: 8 }}
                    onClick={() => {
                      const ny = finish === "foil" ? "nonfoil" : "foil";
                      setFinish(ny);
                      const v = k.varianter.find((x) => x.finish === ny);
                      setValgt((v?.tilstander.find((x) => x.lager > 0) || v?.tilstander[0])?.condition);
                    }}
                  >
                    {finish === "foil" ? "Bytt til vanlig" : "Bytt til foil"}
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {data.andreUtgaver.length > 0 && (
        <>
          <h2 style={{ marginTop: 22 }}>Andre utgaver ({data.andreUtgaver.length})</h2>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
            {data.andreUtgaver.map((u) => (
              <button
                key={u.id}
                onClick={() => onÅpne(u.id)}
                title={`${u.set_name} #${u.collector_number}`}
                style={{
                  width: 116, border: "1px solid var(--strek)", borderRadius: 9,
                  background: "var(--flate)", padding: 7, cursor: "pointer", textAlign: "center",
                }}
              >
                {u.image_uri ? (
                  <img src={u.image_uri} alt={u.set_name} loading="lazy" style={{ width: "100%", borderRadius: 5 }} />
                ) : (
                  <div style={{ width: "100%", aspectRatio: "5 / 7", background: "var(--papir)", borderRadius: 5 }} />
                )}
                <div className="dempet" style={{ fontSize: 11, marginTop: 5, lineHeight: 1.3 }}>
                  {u.set_name}
                </div>
                <div className="tall" style={{ fontSize: 12.5, fontWeight: 600, color: "var(--brass)" }}>
                  {u.nm ? kroner(u.nm) : "\u2014"}
                </div>
                {u.påLager > 0 && (
                  <div className="dempet" style={{ fontSize: 11 }}>{u.påLager} på lager</div>
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </>
  );
}

function Rad({ navn, children }) {
  return (
    <div style={{ display: "flex", gap: 12, fontSize: 14, padding: "3px 0" }}>
      <span className="dempet" style={{ width: 96, flex: "none" }}>{navn}</span>
      <span>{children}</span>
    </div>
  );
}
