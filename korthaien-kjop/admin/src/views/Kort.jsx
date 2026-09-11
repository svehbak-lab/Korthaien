import { useState, useEffect } from "react";
import { api, kroner, CONDITIONS } from "../api.js";

const KOLONNER = [
  { id: "collector_number", navn: "Nr.", bredde: 50 },
  { id: "name", navn: "Kort" },
  { id: "rarity", navn: "Raritet", bredde: 90 },
  { id: "usd", navn: "USD", h: true, bredde: 70 },
  { id: "egne_conditions", navn: "Tar imot", bredde: 165 },
  { id: "prod_nonfoil", navn: "Hos Korthaien", bredde: 200 },
  { id: "stock_nonfoil", navn: "På lager", h: true, bredde: 80 },
  { id: "ledig_nonfoil", navn: "Kan selges", h: true, bredde: 90 },
  { id: "want_nonfoil", navn: "Vil ha", h: true, bredde: 70 },
  { id: "stock_foil", navn: "Foil lager", h: true, bredde: 85 },
  { id: "want_foil", navn: "Vil ha foil", h: true, bredde: 85 },
];

// Rariteten sorteres etter verdi, ikke alfabetisk — «common» før «mythic»
// er ikke rekkefølgen noen leter etter.
const RARITET_RANG = { common: 0, uncommon: 1, rare: 2, mythic: 3, special: 4, bonus: 5 };
const RARITETER = [
  ["common", "Common"],
  ["uncommon", "Uncommon"],
  ["rare", "Rare"],
  ["mythic", "Mythic"],
];

export default function Kort({ sett, onFeil, onByttSett }) {
  const [data, setData] = useState(null);
  const [søk, setSøk] = useState("");
  const [raritet, setRaritet] = useState("");
  const [sortering, setSortering] = useState({ kolonne: "collector_number", stigende: true });
  const [jobber, setJobber] = useState(false);
  const [modus, setModus] = useState("oversikt");

  async function last() {
    if (!sett) return;
    try {
      setData(await api.kort(sett));
    } catch (e) {
      onFeil(e);
    }
  }
  useEffect(() => {
    setData(null);
    setRaritet("");
    last();
  }, [sett]);

  if (!sett) {
    return (
      <div className="panel">
        <div className="tom">
          <b>Velg et sett først</b>
          Gå til Sett og trykk «Enkeltkort» på settet du vil justere.
        </div>
      </div>
    );
  }
  if (!data) return <p className="dempet">Henter kort…</p>;

  const regel = data.regel || {};
  const q = søk.trim().toLowerCase();

  // Ønsket antall som faktisk gjelder: kortets egen verdi hvis den finnes,
  // ellers settets. Det er dette tallet kvoten regnes av.
  const gjeldende = (k, finish) => {
    const eget = finish === "foil" ? k.want_foil : k.want_nonfoil;
    if (eget !== null && eget !== undefined) return Number(eget);
    if (!regel.enabled) return 0;
    return finish === "foil" ? Number(regel.wanted_foil || 0) : Number(regel.wanted_default || 0);
  };
  const ledig = (k, finish) => {
    const lager = Number((finish === "foil" ? k.stock_foil : k.stock_nonfoil) || 0);
    const res = Number((finish === "foil" ? k.res_foil : k.res_nonfoil) || 0);
    return Math.max(0, gjeldende(k, finish) - lager - res);
  };

  const beriket = data.kort.map((k) => ({
    ...k,
    ledig_nonfoil: ledig(k, "nonfoil"),
    ledig_foil: ledig(k, "foil"),
  }));

  const filtrert = beriket.filter((k) => {
    if (raritet && String(k.rarity || "") !== raritet) return false;
    if (q && !String(k.name).toLowerCase().includes(q)) return false;
    return true;
  });

  const synlige = [...filtrert].sort((a, b) => {
    const { kolonne, stigende } = sortering;
    const retning = stigende ? 1 : -1;
    let x = a[kolonne];
    let y = b[kolonne];
    if (kolonne === "usd") {
      // Sorter på prisen som faktisk gjelder. Din egen der du har satt en,
      // Scryfalls ellers — samme regel som prisberegningen bruker. Uten dette
      // havner alle manuelt prisede kort bakerst fordi Scryfall-feltet er tomt.
      x = a.pris_nonfoil ?? a.usd;
      y = b.pris_nonfoil ?? b.usd;
    } else if (kolonne === "rarity") {
      x = RARITET_RANG[String(x || "")] ?? 99;
      y = RARITET_RANG[String(y || "")] ?? 99;
    } else if (kolonne === "collector_number") {
      x = parseInt(x) || 0;
      y = parseInt(y) || 0;
    } else if (typeof x === "string" || typeof y === "string") {
      return String(x || "").localeCompare(String(y || ""), "nb") * retning;
    }
    const xt = x === null || x === undefined;
    const yt = y === null || y === undefined;
    if (xt && yt) return 0;
    if (xt) return 1;
    if (yt) return -1;
    return (Number(x) - Number(y)) * retning;
  });

  function sorter(id) {
    setSortering((s) =>
      s.kolonne === id ? { kolonne: id, stigende: !s.stigende } : { kolonne: id, stigende: true }
    );
  }

  async function settMange(finish, wanted, nullstill) {
    setJobber(true);
    try {
      await api.masseØnsker({
        set_code: sett,
        rarity: raritet || undefined,
        finish,
        wanted,
        nullstill,
      });
      await last();
    } catch (e) {
      onFeil(e);
    } finally {
      setJobber(false);
    }
  }

  const antallKoblet = data.kort.filter((k) => k.prod_nonfoil || k.prod_foil).length;

  return (
    <>
      <div className="rad-flex" style={{ marginBottom: 10 }}>
        <span className="kode">{sett.toUpperCase()}</span>
        <input
          type="text"
          placeholder="Søk i settet"
          value={søk}
          onChange={(e) => setSøk(e.target.value)}
          style={{ width: 200 }}
        />
        <button className="knapp" onClick={onByttSett}>Bytt sett</button>
        <span className="dempet" style={{ marginLeft: "auto" }}>
          {data.kort.length} kort · {antallKoblet} koblet mot Korthaien
          {!regel.enabled && " · settet er ikke slått på"}
        </span>
      </div>

      <div className="rad-flex" style={{ marginBottom: 12 }}>
        <button
          className={`knapp liten ${modus === "priser" ? "primar" : ""}`}
          onClick={() => {
            // Hentes på nytt når du går ut, så oversikten viser det du satte.
            if (modus === "priser") last();
            setModus(modus === "priser" ? "oversikt" : "priser");
          }}
        >
          {modus === "priser" ? "Ferdig med prisene" : "Manuell prising"}
        </button>
        <span className="dempet">Raritet:</span>
        <button className={`knapp liten ${!raritet ? "primar" : ""}`} onClick={() => setRaritet("")}>
          Alle
        </button>
        {RARITETER.map(([v, l]) => {
          const n = beriket.filter((k) => k.rarity === v).length;
          if (!n) return null;
          return (
            <button
              key={v}
              className={`knapp liten ${raritet === v ? "primar" : ""}`}
              onClick={() => setRaritet(v)}
            >
              {l} <span className="dempet">{n}</span>
            </button>
          );
        })}
      </div>

      {modus === "priser" ? (
        <Prisliste
          kort={synlige}
          regel={regel}
          settings={data.settings}
          onFeil={onFeil}
          onRegelEndret={last}
        />
      ) : (
      <>
      <Massefelt
        antall={filtrert.length}
        raritet={raritet ? RARITETER.find(([v]) => v === raritet)?.[1] : null}
        harFoil={filtrert.some((k) => Number(k.has_foil))}
        jobber={jobber}
        onSett={settMange}
      />

      <div className="panel">
        <table>
          <thead>
            <tr>
              {KOLONNER.map((k) => (
                <th
                  key={k.id}
                  className={k.h ? "h" : undefined}
                  style={{ width: k.bredde, cursor: "pointer", userSelect: "none" }}
                  onClick={() => sorter(k.id)}
                  aria-sort={
                    sortering.kolonne === k.id ? (sortering.stigende ? "ascending" : "descending") : "none"
                  }
                >
                  {k.navn}
                  <span style={{ color: sortering.kolonne === k.id ? "var(--aksent)" : "var(--strek)", marginLeft: 3 }}>
                    {sortering.kolonne === k.id ? (sortering.stigende ? "\u25b2" : "\u25bc") : "\u25b4"}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {synlige.slice(0, 500).map((k) => (
              <KortRad key={k.id} kort={k} regel={regel} onFeil={onFeil} onEndret={last} sett={sett} />
            ))}
          </tbody>
        </table>
        {!synlige.length && <div className="tom">Ingen kort passer filteret.</div>}
        {synlige.length > 500 && (
          <div className="krop dempet">Viser 500 av {synlige.length}. Masseoperasjonen over tar likevel alle.</div>
        )}
      </div>
      </>
      )}
    </>
  );
}

function Massefelt({ antall, raritet, harFoil, jobber, onSett }) {
  const [verdi, setVerdi] = useState(8);
  const hva = raritet ? `${antall} ${raritet.toLowerCase()}` : `alle ${antall}`;

  return (
    <div className="panel" style={{ background: "var(--aksent-svak)", borderColor: "#ccd8f7" }}>
      <div className="krop">
        <div className="rad-flex">
          <strong>Sett antall for {hva} kort</strong>
          <input
            type="number"
            min="0"
            value={verdi}
            onChange={(e) => setVerdi(Math.max(0, parseInt(e.target.value) || 0))}
          />
          <button className="knapp liten primar" disabled={jobber} onClick={() => onSett("nonfoil", verdi)}>
            Vanlige
          </button>
          <button
            className="knapp liten primar"
            disabled={jobber || !harFoil}
            onClick={() => onSett("foil", verdi)}
            title={harFoil ? "Gjelder bare kort som finnes i foil" : "Ingen av kortene finnes i foil"}
          >
            Foil
          </button>
          <span className="dempet">|</span>
          <button className="knapp liten" disabled={jobber} onClick={() => onSett("nonfoil", 0, true)}>
            Følg settet igjen
          </button>
        </div>
        <p className="dempet" style={{ margin: "8px 0 0" }}>
          Gjelder kortene raritetsfilteret viser. «Følg settet igjen» fjerner
          overstyringen, så kortene bruker settets antall på nytt.
        </p>
      </div>
    </div>
  );
}

// Settregelen er grov. Noen kort i et sett er verdt å ta i dårligere stand
// enn resten, og da settes tilstandene her. Tomt valg betyr at settets regel
// gjelder — og det er tilstanden man vil tilbake til, ikke en tom liste.
// Foil-bare-sett som Invocations har ingen vanlig pris, bare en foil-pris.
// Viste vi bare den vanlige, så hele settet prisløst ut.
function Pris({ kort }) {
  const manuell = kort.pris_nonfoil ?? kort.pris_foil;
  if (manuell) {
    return (
      <span title="Manuell pris">
        ${Number(manuell).toFixed(2)}
        <span style={{ color: "var(--aksent)" }}>*</span>
      </span>
    );
  }
  if (kort.usd) return <span>${Number(kort.usd).toFixed(2)}</span>;
  if (kort.usd_foil) {
    return (
      <span title="Kortet finnes bare i foil">
        ${Number(kort.usd_foil).toFixed(2)}{" "}
        <span className="merkelapp m-vent" style={{ fontSize: 10 }}>foil</span>
      </span>
    );
  }
  return <span>{"\u2014"}</span>;
}

function Tilstander({ kort, regel, onFeil }) {
  const fra = kort.egne_conditions ? JSON.parse(kort.egne_conditions) : null;
  const [egne, setEgne] = useState(fra);
  const [jobber, setJobber] = useState(false);
  const gjeldende = egne ?? regel.conditions ?? [];

  async function veksle(c) {
    const ny = gjeldende.includes(c)
      ? gjeldende.filter((x) => x !== c)
      : CONDITIONS.filter((x) => gjeldende.includes(x) || x === c);
    // Er lista lik settets igjen, fjernes overstyringen i stedet for å
    // dupliseres — da følger kortet settet automatisk hvis du endrer det.
    const likSettet =
      ny.length === (regel.conditions || []).length &&
      ny.every((x) => (regel.conditions || []).includes(x));
    setJobber(true);
    try {
      await api.lagreKortConditions(kort.id, likSettet ? [] : ny);
      setEgne(likSettet ? null : ny);
    } catch (e) {
      onFeil(e);
    } finally {
      setJobber(false);
    }
  }

  return (
    <div
      className="rad-flex"
      style={{ gap: 3, flexWrap: "nowrap" }}
      title={egne ? "Egen regel for dette kortet" : "Følger settet"}
    >
      {CONDITIONS.map((c) => (
        <button
          key={c}
          className={`knapp liten ${gjeldende.includes(c) ? "primar" : ""}`}
          disabled={jobber}
          style={{ padding: "2px 7px", fontSize: 12 }}
          onClick={() => veksle(c)}
        >
          {c}
        </button>
      ))}
      {egne && <span className="merkelapp m-vent" style={{ marginLeft: 2 }}>egen</span>}
    </div>
  );
}

function KortRad({ kort, regel, onFeil, onEndret, sett }) {
  return (
    <tr>
      <td className="kode dempet">
        {/* Lenke rett til kortet hos Scryfall, så du kan se hvilken versjon
            dette faktisk er. */}
        {kort.collector_number ? (
          <a
            href={`https://scryfall.com/card/${kort.set_code}/${kort.collector_number}`}
            target="_blank"
            rel="noreferrer"
            title="Åpne kortet hos Scryfall"
          >
            {kort.collector_number}
          </a>
        ) : (
          "\u2014"
        )}
      </td>
      <td>
        {kort.name}
        {kort.variant && kort.variant !== "vanlig" && (
          <span className="merkelapp m-vent" style={{ marginLeft: 6 }}>{kort.variant}</span>
        )}
      </td>
      <td className="dempet">{kort.rarity || "\u2014"}</td>
      <td className="h tall dempet">
        <Pris kort={kort} />
      </td>
      <td>
        <Tilstander kort={kort} regel={regel} onFeil={onFeil} />
      </td>
      <td>
        <Kobling kort={kort} onFeil={onFeil} onEndret={onEndret} sett={sett} />
      </td>
      <td className="h tall"><Lager qty={kort.stock_nonfoil} koblet={!!kort.prod_nonfoil} /></td>
      <td className="h tall">
        {kort.ledig_nonfoil > 0 ? kort.ledig_nonfoil : <span className="dempet">0</span>}
      </td>
      <td className="h">
        <ØnskeFelt kortId={kort.id} finish="nonfoil" verdi={kort.want_nonfoil} onFeil={onFeil} />
      </td>
      <td className="h tall">
        {Number(kort.has_foil) ? <Lager qty={kort.stock_foil} koblet={!!kort.prod_foil} /> : <span className="dempet">{"\u2014"}</span>}
      </td>
      <td className="h">
        {Number(kort.has_foil) ? (
          <ØnskeFelt kortId={kort.id} finish="foil" verdi={kort.want_foil} onFeil={onFeil} />
        ) : (
          <span className="dempet">{"\u2014"}</span>
        )}
      </td>
    </tr>
  );
}

// «0 på lager» og «ikke koblet» er to helt ulike ting: det første betyr at
// kunden kan selge deg hele kvoten, det andre at tallet ikke er til å stole
// på. Streken sier at kortet ikke finnes som produkt hos deg.
function Lager({ qty, koblet }) {
  if (!koblet) {
    return <span className="dempet" title="Ingen produkt hos Korthaien er koblet til dette kortet">–</span>;
  }
  return <span title="Koblet mot Korthaien">{Number(qty || 0)}</span>;
}

function ØnskeFelt({ kortId, finish, verdi, onFeil }) {
  const [v, setV] = useState(verdi === null || verdi === undefined ? "" : String(verdi));
  const [status, setStatus] = useState("");

  useEffect(() => {
    setV(verdi === null || verdi === undefined ? "" : String(verdi));
  }, [verdi]);

  async function lagre() {
    const rå = v.trim();
    try {
      if (rå === "") await api.nullstillØnske(kortId, finish);
      else {
        const n = Math.max(0, parseInt(rå) || 0);
        setV(String(n));
        await api.lagreØnske(kortId, finish, n);
      }
      setStatus("ok");
      setTimeout(() => setStatus(""), 1200);
    } catch (e) {
      setStatus("feil");
      onFeil(e);
    }
  }

  return (
    <input
      type="text"
      inputMode="numeric"
      value={v}
      placeholder="sett"
      title="Tomt felt følger settregelen"
      onChange={(e) => setV(e.target.value.replace(/[^\d]/g, ""))}
      onBlur={lagre}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      style={{
        width: 56,
        textAlign: "right",
        borderColor: status === "ok" ? "var(--ok)" : status === "feil" ? "var(--feil)" : undefined,
      }}
    />
  );
}

// Viser hvilket produkt hos deg kortet faktisk er koblet til. En kobling som
// bare er en ID kan ikke kontrolleres — her ser du navnet og kategorien, og
// kan sammenligne med kortet hos Scryfall.
function Kobling({ kort, onFeil, onEndret, sett }) {
  const [åpen, setÅpen] = useState(false);
  const [treff, setTreff] = useState(null);
  const [q, setQ] = useState(kort.name);

  const koblet = kort.prod_nonfoil || kort.prod_foil;

  async function søk(tekst) {
    try {
      setTreff(await api.ukobledeISett(sett, tekst));
    } catch (e) {
      onFeil(e);
    }
  }

  async function koble(produktId, finish) {
    try {
      await api.koble({ product_id: produktId, card_id: kort.id, finish });
      setÅpen(false);
      onEndret();
    } catch (e) {
      onFeil(e);
    }
  }

  async function fjern(finish) {
    if (!confirm("Fjerne koblingen? Produktet dukker opp i Kobling ved neste synk.")) return;
    try {
      await api.fjernKobling(kort.id, finish);
      onEndret();
    } catch (e) {
      onFeil(e);
    }
  }

  if (!koblet && !åpen) {
    return (
      <button
        className="knapp liten"
        onClick={() => { setÅpen(true); søk(kort.name); }}
        title="Finn produktet hos Korthaien og koble det til dette kortet"
      >
        Koble
      </button>
    );
  }

  return (
    <div>
      {kort.prod_nonfoil && (
        <ProduktLinje
          navn={kort.pnavn_nonfoil}
          kategori={kort.pkat_nonfoil}
          merke=""
          onFjern={() => fjern("nonfoil")}
        />
      )}
      {kort.prod_foil && (
        <ProduktLinje
          navn={kort.pnavn_foil}
          kategori={kort.pkat_foil}
          merke="foil"
          onFjern={() => fjern("foil")}
        />
      )}

      {åpen && (
        <div style={{ marginTop: 6 }}>
          <input
            type="text"
            value={q}
            onChange={(e) => { setQ(e.target.value); søk(e.target.value); }}
            placeholder="Søk blant ukoblede produkter"
            style={{ width: "100%", marginBottom: 4 }}
          />
          {treff?.length === 0 && (
            <span className="dempet" style={{ fontSize: 11 }}>
              Ingen ukoblede produkter i dette settet passer søket.
            </span>
          )}
          {(treff || []).slice(0, 8).map((p) => (
            <div key={p.product_id} className="rad-flex" style={{ gap: 4, marginBottom: 3 }}>
              <span style={{ fontSize: 12, flex: 1 }}>
                {p.name} <span className="dempet">({p.stock})</span>
              </span>
              <button className="knapp liten" onClick={() => koble(p.product_id, "nonfoil")}>
                Vanlig
              </button>
              {Number(kort.has_foil) > 0 && (
                <button className="knapp liten" onClick={() => koble(p.product_id, "foil")}>
                  Foil
                </button>
              )}
            </div>
          ))}
          <button className="knapp liten" onClick={() => setÅpen(false)} style={{ marginTop: 4 }}>
            Lukk
          </button>
        </div>
      )}

      {koblet && !åpen && (
        <button
          className="knapp blank"
          style={{ fontSize: 11 }}
          onClick={() => { setÅpen(true); søk(kort.name); }}
        >
          Koble et produkt til
        </button>
      )}
    </div>
  );
}

function ProduktLinje({ navn, kategori, merke, onFjern }) {
  return (
    <div className="rad-flex" style={{ gap: 5, fontSize: 12 }}>
      <span style={{ flex: 1, minWidth: 0 }}>
        {navn || "(uten navn)"}
        {merke && <span className="merkelapp m-vent" style={{ marginLeft: 4 }}>{merke}</span>}
        {kategori && <span className="dempet"> · {kategori}</span>}
      </span>
      <button className="knapp blank" style={{ fontSize: 11 }} onClick={onFjern} title="Fjern koblingen">
        ×
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MANUELL PRISING
// ─────────────────────────────────────────────────────────────────────────────
// Ett redigerbart felt per kort — markedsprisen i dollar, hentet fra en butikk
// som faktisk selger kortet. NM, EX, VG og G regnes ut mens du skriver, og
// oppdateres først i basen når feltet forlates. Ingenting annet er fokuserbart
// i tabellen, så Tab hopper rett fra kort til kort.
function Prisliste({ kort, regel, settings, onFeil, onRegelEndret }) {
  const conditions = regel.conditions?.length ? regel.conditions : ["NM"];
  const ladder = regel.ladder || {};
  const [utkast, setUtkast] = useState({});
  const [lagret, setLagret] = useState({});
  // Tomt felt betyr «følg den globale satsen». Vi holder det som tekst, ikke
  // tall, nettopp for å kunne skille tomt fra null.
  const [andel, setAndel] = useState(regel.buy_pct === null || regel.buy_pct === undefined ? "" : String(regel.buy_pct));
  const brukt = andel.trim() === "" ? settings.buy_pct : Number(andel.replace(",", ".")) || 0;

  async function lagreAndel() {
    const v = andel.trim() === "" ? null : Number(andel.replace(",", "."));
    if (v !== null && (!Number.isFinite(v) || v < 0 || v > 200)) return;
    try {
      // Endepunktet skriver hele regelen, så alt annet må sendes med
      // uendret. Sender vi bare prosenten, nulles ønsket antall og settet
      // slås av — uten at noe sier fra.
      await api.lagreSett(regel.set_code, {
        enabled: regel.enabled,
        wanted_default: regel.wanted_default,
        wanted_foil: regel.wanted_foil,
        conditions: regel.conditions,
        ladder: regel.ladder,
        buy_pct: v,
      });
      onRegelEndret();
    } catch (e) {
      onFeil(e);
    }
  }

  // Samme regnestykke som på serveren. Står de to noen gang i utakt, er det
  // serveren som gjelder — dette er bare for å se tallet mens du taster.
  function øre(usd, cond) {
    const pct = ladder[cond];
    if (!usd || pct === undefined || pct === null) return null;
    const o = Math.round(usd * settings.usd_nok * (brukt / 100) * (pct / 100) * 100);
    return o < settings.min_buy_ore ? 0 : o;
  }

  async function lagre(k, tekst) {
    const rå = (tekst ?? "").trim().replace(",", ".");
    const gjeldende = k.pris_nonfoil ? String(k.pris_nonfoil) : "";
    if (rå === gjeldende) return;
    try {
      if (rå === "") {
        if (k.pris_nonfoil) await api.nullstillPris(k.id, "nonfoil");
      } else {
        const usd = Number(rå);
        if (!Number.isFinite(usd) || usd <= 0) return;
        await api.lagrePris(k.id, "nonfoil", usd);
      }
      // Ingen ny henting her. Tabellen ville blitt bygget om mens du taber
      // videre, og fokus ville hoppet til toppen. Utkastet er sannheten på
      // skjermen til du forlater modusen.
      setLagret((l) => ({ ...l, [k.id]: true }));
      setTimeout(() => setLagret((l) => ({ ...l, [k.id]: false })), 1400);
    } catch (e) {
      onFeil(e);
    }
  }

  return (
    <div className="panel">
      <div className="krop">
        <p style={{ margin: "0 0 4px" }}>
          <strong>Manuell prising</strong> — skriv markedsprisen i dollar, for eksempel
          fra Card Kingdom. Kolonnene til høyre viser hva kunden får, og oppdateres
          mens du skriver. Tab hopper til neste kort.
        </p>
        <div className="rad-flex" style={{ margin: "10px 0 2px" }}>
          <label>
            <span className="navn">Du betaler for Near Mint</span>
            <input
              type="text"
              inputMode="decimal"
              value={andel}
              placeholder={String(settings.buy_pct)}
              onChange={(e) => setAndel(e.target.value.replace(/[^\d.,]/g, ""))}
              onBlur={lagreAndel}
              onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
              style={{ width: 64, textAlign: "right" }}
            />
            <span className="dempet"> % av markedsprisen</span>
          </label>
          <span className="dempet">
            {andel.trim() === ""
              ? `Følger den globale satsen på ${settings.buy_pct} %`
              : `Bare for dette settet — globalt er ${settings.buy_pct} %`}
          </span>
        </div>
        <p className="dempet" style={{ margin: 0 }}>
          Kurs {settings.usd_nok} · trapp{" "}
          {conditions.map((c) => `${c} ${ladder[c] ?? "—"} %`).join(" · ")} regnet av de{" "}
          {brukt} prosentene. Tomt prisfelt på en rad betyr at Scryfall-prisen gjelder.
        </p>
      </div>
      <table>
        <thead>
          <tr>
            <th style={{ width: 50 }}>Nr.</th>
            <th>Kort</th>
            <th className="h" style={{ width: 90 }}>Scryfall</th>
            <th className="h" style={{ width: 110 }}>Din pris $</th>
            {conditions.map((c) => (
              <th key={c} className="h" style={{ width: 110 }}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {kort.map((k) => {
            const verdi = utkast[k.id] ?? (k.pris_nonfoil ? String(k.pris_nonfoil) : "");
            const usd = Number(String(verdi).replace(",", ".")) || Number(k.usd) || 0;
            const egen = verdi !== "";
            return (
              <tr key={k.id}>
                <td className="kode dempet">{k.collector_number}</td>
                <td>
                  {k.name}
                  {k.variant && k.variant !== "vanlig" && (
                    <span className="dempet"> · {k.variant}</span>
                  )}
                </td>
                <td className="h tall dempet">{k.usd ? `$${Number(k.usd).toFixed(2)}` : "—"}</td>
                <td className="h">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={verdi}
                    placeholder="auto"
                    onChange={(e) =>
                      setUtkast((u) => ({ ...u, [k.id]: e.target.value.replace(/[^\d.,]/g, "") }))
                    }
                    onBlur={(e) => lagre(k, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur();
                      if (e.key === "Escape") {
                        setUtkast((u) => ({ ...u, [k.id]: k.pris_nonfoil ? String(k.pris_nonfoil) : "" }));
                        e.currentTarget.blur();
                      }
                    }}
                    style={{
                      width: 92,
                      textAlign: "right",
                      borderColor: lagret[k.id] ? "var(--ok)" : undefined,
                      fontWeight: egen ? 600 : 400,
                    }}
                  />
                </td>
                {conditions.map((c) => {
                  const o = øre(usd, c);
                  return (
                    <td key={c} className="h tall" style={{ color: egen ? "inherit" : "var(--dempet)" }}>
                      {o === null ? "—" : kroner(o)}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      {!kort.length && <div className="tom">Ingen kort passer filteret.</div>}
    </div>
  );
}
