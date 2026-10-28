import { useState, useEffect, useMemo } from "react";
import { api } from "../api.js";

// Hver rad i historikken er et øyeblikksbilde, ikke en sum over perioden.
// Derfor grupperes den ved å ta SISTE måling i hver bøtte — ikke snittet.
// Snittet av en voksende beholdning ville ligget under den faktiske, og
// kurven hadde haltet etter virkeligheten.
const PERIODER = [
  { id: "30", navn: "30 dager", dager: 30, gruppe: "dag" },
  { id: "90", navn: "3 måneder", dager: 90, gruppe: "uke" },
  { id: "365", navn: "12 måneder", dager: 365, gruppe: "måned" },
  { id: "alt", navn: "Alt", dager: null, gruppe: "måned" },
];

// «Verdi i butikken» var Mystore-prisene. Etter overgangen finnes det bare
// én pris, din, og den er salgsverdien.
const MÅL = [
  { id: "modell", navn: "Salgsverdi", type: "kr" },
  { id: "antall", navn: "Antall kort", type: "stk" },
];

const MÅNED = ["jan", "feb", "mar", "apr", "mai", "jun", "jul", "aug", "sep", "okt", "nov", "des"];

const dagNr = (iso) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / 86400000);

// Dag og uke vises som dd.mm — ikke mm.dd, som ville lest «10.05» som 10. mai.
// Måned vises med navn og årstall, siden en tolvmånedersperiode krysser nyttår.
const etikett = (iso, gruppe) =>
  gruppe === "måned"
    ? `${MÅNED[Number(iso.slice(5, 7)) - 1]} ${iso.slice(2, 4)}`
    : `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;

// Store tall i aksen blir uleselige i full bredde: 1 839 586 kr → «1,8 mill».
// Antall desimaler følger spennet i aksen og ikke tallet: er avstanden mellom
// to streker liten, må det være desimaler nok til at de ikke viser det samme.
const desimaler = (spenn, enhet) => {
  const steg = spenn / 2 / enhet;
  return steg >= 10 ? 0 : steg >= 1 ? 1 : 2;
};

const komma = (n, d) => n.toFixed(d).replace(".", ",");

function kompakt(øre, spenn = øre) {
  const kr = øre / 100;
  const s = spenn / 100;
  if (kr >= 1_000_000) return `${komma(kr / 1_000_000, desimaler(s, 1_000_000))} mill`;
  if (kr >= 1000) return `${komma(kr / 1000, desimaler(s, 1000))}k`;
  return String(Math.round(kr));
}

const antallKompakt = (n, spenn = n) =>
  n >= 1000 ? `${komma(n / 1000, desimaler(spenn, 1000))}k` : String(Math.round(n));

// Radene som faller innenfor en periode. Skilt ut fordi den trengs to
// steder: når kurven tegnes, og når startperioden velges.
function iPeriode(rader, p) {
  if (!rader?.length || !p.dager) return rader || [];
  const grense = dagNr(rader[rader.length - 1].dato) - p.dager;
  return rader.filter((r) => dagNr(r.dato) > grense);
}

function grupper(rader, gruppe) {
  if (gruppe === "dag") return rader;
  const sisteDag = dagNr(rader[rader.length - 1].dato);
  const bøtte = (iso) =>
    gruppe === "uke" ? String(Math.floor((sisteDag - dagNr(iso)) / 7)) : iso.slice(0, 7);

  const kart = new Map();
  for (const r of rader) kart.set(bøtte(r.dato), r); // siste i bøtta vinner
  return [...kart.values()].sort((a, b) => a.dato.localeCompare(b.dato));
}

// Minste kvadraters metode over punktene som vises. Trendlinjen sier hvilken
// vei det går, ikke hvor det ender — og den regnes på det du ser, ikke på
// hele serien, så den endrer seg når du bytter periode. Det er med vilje:
// trenden siste måned er noe annet enn trenden siste år.
function trend(verdier) {
  const n = verdier.length;
  if (n < 2) return null;
  let sx = 0, sy = 0, sxy = 0, sxx = 0;
  for (let i = 0; i < n; i++) {
    sx += i;
    sy += verdier[i];
    sxy += i * verdier[i];
    sxx += i * i;
  }
  const nevner = n * sxx - sx * sx;
  if (!nevner) return null;
  const stigning = (n * sxy - sx * sy) / nevner;
  const skjæring = (sy - stigning * sx) / n;
  return { fra: skjæring, til: skjæring + stigning * (n - 1), per: stigning };
}

export default function LagerGraf({ onFeil }) {
  const [rader, setRader] = useState(null);
  const [feil, setFeil] = useState(null);
  const [periode, setPeriode] = useState("90");
  const [mål, setMål] = useState("modell");
  const [visTrend, setVisTrend] = useState(true);

  useEffect(() => {
    api
      .lagerhistorikk()
      .then((d) => {
        setRader(d.rader);
        const egnet = PERIODER.find(
          (x) => grupper(iPeriode(d.rader, x), x.gruppe).length >= 2
        );
        setPeriode((egnet || PERIODER[1]).id);
      })
      .catch((e) => {
        setFeil(e?.message || String(e));
        onFeil(e);
      });
  }, []);

  const p = PERIODER.find((x) => x.id === periode) || PERIODER[1];
  const m = MÅL.find((x) => x.id === mål) || MÅL[0];

  const punkter = useMemo(() => {
    if (!rader?.length) return [];
    let utvalg = rader;
    if (p.dager) {
      const grense = dagNr(rader[rader.length - 1].dato) - p.dager;
      utvalg = rader.filter((r) => dagNr(r.dato) > grense);
    }
    if (!utvalg.length) return [];
    const les = (r) =>
      mål === "antall" ? r.antall + r.antall_foil : r.verdi_ore + r.verdi_foil_ore;
    return grupper(utvalg, p.gruppe).map((r) => ({ dato: r.dato, v: les(r) }));
  }, [rader, periode, mål]);

  if (feil) {
    return (
      <div className="varsel info" style={{ marginBottom: 16 }}>
        <b>Klarte ikke hente historikken.</b> {feil}
      </div>
    );
  }
  if (!rader) return null;

  const akse = m.type === "kr" ? kompakt : antallKompakt;
  const fullt = (v) =>
    m.type === "kr"
      ? `${Math.round(v / 100).toLocaleString("nb-NO")} kr`
      : `${Math.round(v).toLocaleString("nb-NO")} kort`;

  const t = punkter.length >= 2 ? trend(punkter.map((x) => x.v)) : null;
  const endring = punkter.length >= 2 ? punkter[punkter.length - 1].v - punkter[0].v : 0;

  return (
    <div className="panel" style={{ marginBottom: 16, padding: "14px 18px" }}>
      <div className="rad-flex" style={{ gap: 14, flexWrap: "wrap", alignItems: "center" }}>
        <strong style={{ marginRight: "auto" }}>Utvikling</strong>
        <label style={{ fontSize: 13 }}>
          <input type="checkbox" checked={visTrend} onChange={(e) => setVisTrend(e.target.checked)} />{" "}
          Trendlinje
        </label>
        <select value={mål} onChange={(e) => setMål(e.target.value)} style={{ width: 190 }}>
          {MÅL.map((x) => (
            <option key={x.id} value={x.id}>{x.navn}</option>
          ))}
        </select>
        <select value={periode} onChange={(e) => setPeriode(e.target.value)} style={{ width: 140 }}>
          {PERIODER.map((x) => (
            <option key={x.id} value={x.id}>{x.navn}</option>
          ))}
        </select>
      </div>

      {punkter.length < 2 ? (
        <div className="dempet" style={{ fontSize: 13, marginTop: 12 }}>
          {rader.length === 0
            ? "Ingen målinger ennå. Den første skrives etter neste lagersynk."
            : punkter.length === 0
              ? "Ingen målinger i denne perioden. Velg «Alt»."
              : rader.length >= 2
                ? `Målingene faller innenfor samme ${p.gruppe}. Velg en kortere periode for å se dem hver for seg.`
                : "Bare én måling så langt — kurven trenger minst to punkter."}
        </div>
      ) : (
        <>
          <Kurve
            punkter={punkter}
            akse={akse}
            fullt={fullt}
            gruppe={p.gruppe}
            trend={visTrend ? t : null}
          />
          <div className="dempet" style={{ fontSize: 11, marginTop: 6 }}>
            {endring >= 0 ? "Opp " : "Ned "}
            {fullt(Math.abs(endring))} i perioden
            {t && visTrend && `, trend ${t.per >= 0 ? "+" : "−"}${fullt(Math.abs(t.per))} per ${p.gruppe}`}
            {p.gruppe !== "dag" && ". Målt daglig, vist per " + p.gruppe}
            {". Hold over et punkt for tallet."}
          </div>
        </>
      )}
    </div>
  );
}

function Kurve({ punkter, akse, fullt, gruppe, trend }) {
  const B = 620, H = 170, PV = 54, PH = 10, PT = 10, PB = 22;

  // Et lager på 2,4 millioner som vokser til 2,7 er en rett strek mot null.
  // Aksen starter derfor på null bare når utslaget er stort nok til å synes —
  // ellers følger den tallene, og da står det på aksen hvor den begynner.
  const alle = [...punkter.map((q) => q.v), ...(trend ? [trend.fra, trend.til] : [])];
  const høy = Math.max(...alle);
  const lav = Math.min(...alle);
  const fraNull = !høy || lav / høy < 0.6;
  const luft = (høy - lav) * 0.15 || høy * 0.05 || 1;
  const topp = fraNull ? høy || 1 : høy + luft;
  const bunn = fraNull ? 0 : Math.max(0, lav - luft);

  const x = (i) => PV + (i * (B - PV - PH)) / (punkter.length - 1);
  const y = (v) =>
    PT + (H - PT - PB) * (1 - (Math.min(topp, Math.max(bunn, v)) - bunn) / (topp - bunn || 1));

  const bane = punkter.map((q, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(q.v).toFixed(1)}`).join(" ");
  // Flaten under kurven leses som «så mye er det». Det stemmer bare når
  // aksen begynner på null, så ellers er det bare linjen.
  const flate = fraNull
    ? `${bane} L${x(punkter.length - 1).toFixed(1)} ${y(bunn)} L${x(0).toFixed(1)} ${y(bunn)} Z`
    : null;
  const steg = Math.max(1, Math.ceil(punkter.length / 7));

  return (
    <svg
      viewBox={`0 0 ${B} ${H}`}
      role="img"
      aria-label={`Utvikling, ${punkter.length} punkter, høyeste ${fullt(topp)}`}
      style={{ width: "100%", height: "auto", marginTop: 10, display: "block" }}
    >
      {[0, 0.5, 1].map((f) => {
        const v = bunn + (topp - bunn) * f;
        return (
          <g key={f}>
            <line x1={PV} x2={B - PH} y1={y(v)} y2={y(v)} stroke="currentColor" strokeOpacity="0.12" />
            <text x={PV - 6} y={y(v) + 4} textAnchor="end" fontSize="10" fill="currentColor" fillOpacity="0.55">
              {akse(v, topp - bunn)}
            </text>
          </g>
        );
      })}

      {flate && <path d={flate} fill="currentColor" fillOpacity="0.08" />}
      <path d={bane} fill="none" stroke="currentColor" strokeWidth="2" strokeOpacity="0.85" />

      {trend && (
        <line
          x1={x(0)}
          y1={y(trend.fra)}
          x2={x(punkter.length - 1)}
          y2={y(trend.til)}
          stroke="currentColor"
          strokeWidth="1.5"
          strokeOpacity="0.45"
          strokeDasharray="5 4"
        />
      )}

      {/* Usynlige treffflater, så tallet kan leses av uten egen tooltip-kode. */}
      {punkter.map((q, i) => (
        <circle key={q.dato} cx={x(i)} cy={y(q.v)} r="7" fill="transparent">
          <title>{`${q.dato}: ${fullt(q.v)}`}</title>
        </circle>
      ))}

      {punkter.map((q, i) => {
        const siste = i === punkter.length - 1;
        if (!(siste || i % steg === 0)) return null;
        // Siste dato skal alltid stå. Da må en fast etikett som havner for
        // nær den vike, ellers skriver de to over hverandre — og avstanden
        // må måles i bredde, ikke i antall punkter: «okt 26» tar mer plass
        // enn «24.10», og et punkt er smalere jo lengre perioden er.
        if (!siste && x(punkter.length - 1) - x(i) < (gruppe === "måned" ? 46 : 36)) return null;
        return (
          <text
            key={q.dato}
            x={x(i)}
            y={H - 6}
            // Ytterst til venstre og høyre ville en midtstilt etikett stukket
            // utenfor viewBoxen og blitt klippet.
            textAnchor={siste ? "end" : i === 0 ? "start" : "middle"}
            fontSize="10"
            fill="currentColor"
            fillOpacity="0.55"
          >
            {etikett(q.dato, gruppe)}
          </text>
        );
      })}
    </svg>
  );
}
