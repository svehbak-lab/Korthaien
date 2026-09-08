import { useState, useEffect } from "react";
import { api } from "../api.js";

// To nivåer av kobling. Kategoriene først: butikken er bygget som
// sett → raritet → produkter, og settet ligger bare i kategorien. Én
// kategorikobling fikser derfor alle kortene i grenen, mens produktkobling
// er én om gangen. Rekkefølgen er ikke tilfeldig.

// Produkter som synken ikke klarte å koble. Beholdningen deres regnes som 0,
// og da kan en kunde selge deg kort du allerede har fullt av. Derfor bør
// denne lista være tom før siden går live.
export default function Kobling({ onFeil, onAntall }) {
  const [fane, setFane] = useState("kategorier");
  const [visAlle, setVisAlle] = useState(false);
  const [katSøk, setKatSøk] = useState("");
  const [kat, setKat] = useState(null);
  const [data, setData] = useState(null);

  async function last() {
    try {
      const [k, p] = await Promise.all([api.kategorier(!visAlle, katSøk), api.ukoblede()]);
      setKat(k);
      setData(p);
      onAntall(k.antall + p.antall);
    } catch (e) {
      onFeil(e);
    }
  }
  useEffect(() => {
    last();
  }, [visAlle, katSøk]);

  if (!data || !kat) return <p className="dempet">Henter…</p>;

  return (
    <>
      <div className="rad-flex" style={{ marginBottom: 14 }}>
        <button className={`knapp ${fane === "kategorier" ? "primar" : ""}`} onClick={() => setFane("kategorier")}>
          Kategorier {kat.antall > 0 && `(${kat.antall})`}
        </button>
        <button className={`knapp ${fane === "produkter" ? "primar" : ""}`} onClick={() => setFane("produkter")}>
          Enkeltprodukter {data.antall > 0 && `(${data.antall})`}
        </button>
      </div>
      {fane === "kategorier"
        ? <Kategorier kat={kat} onFerdig={last} onFeil={onFeil}
            visAlle={visAlle} setVisAlle={setVisAlle} søk={katSøk} setSøk={setKatSøk} />
        : <Produkter data={data} onFerdig={last} onFeil={onFeil} />}
    </>
  );
}

function Kategorier({ kat, onFerdig, onFeil, visAlle, setVisAlle, søk, setSøk }) {
  const [kjører, setKjører] = useState(false);

  async function analyser() {
    setKjører(true);
    try {
      await api.jobb("gjett");
      // Jobben går i bakgrunnen. Vi henter på nytt etter litt, men den kan
      // bruke flere minutter på mange kategorier.
      setTimeout(onFerdig, 8000);
    } catch (e) {
      onFeil(e);
      setKjører(false);
    }
  }

  const filterrad = (
    <div className="rad-flex" style={{ marginBottom: 12 }}>
      <input
        type="text"
        placeholder="Søk i kategorier"
        value={søk}
        onChange={(e) => setSøk(e.target.value)}
        style={{ width: 240 }}
      />
      <label className="rad-flex" style={{ gap: 6 }}>
        <input type="checkbox" checked={visAlle} onChange={(e) => setVisAlle(e.target.checked)} />
        Vis også kategorier som allerede har sett
      </label>
    </div>
  );

  if (!kat.kategorier.length) {
    return (
      <>
        {filterrad}
        <div className="panel">
          <div className="tom">
            <b>{søk ? "Ingen kategorier passer søket" : "Alle kategorier er knyttet til et sett"}</b>
            {!søk && "Synken vet hvilket sett hvert produkt tilhører."}
          </div>
        </div>
      </>
    );
  }
  return (
    <>
      {filterrad}
      <div className="panel">
        <div className="krop">
          <div className="rad-flex">
            <div style={{ flex: 1, minWidth: 280 }}>
              <strong>Finn settet ut fra kortene</strong>
              <p className="dempet" style={{ margin: "4px 0 0" }}>
                Mystore oppgir ingen forelder for disse kategoriene, så navnet «Common»
                sier ingenting. Men kortene inne i dem gjør det: ligger det 80 kort der
                og 78 finnes i Invasion, er kategorien Invasion. Analysen kobler de
                tydelige tilfellene selv og legger fram kandidater for resten.
              </p>
            </div>
            <button className="knapp primar" onClick={analyser} disabled={kjører}>
              {kjører ? "Analyserer…" : "Kjør analysen"}
            </button>
          </div>
          {kjører && (
            <p className="dempet" style={{ marginBottom: 0 }}>
              Går i bakgrunnen — den henter en stikkprøve fra hver kategori, så det tar
              noen minutter. Lista oppdaterer seg. Fremdriften vises i backend-loggen.
            </p>
          )}
        </div>
      </div>
      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>Kategori</th>
              <th>Ligger under</th>
              <th>Koblet til</th>
              <th>Sett</th>
            </tr>
          </thead>
          <tbody>
            {kat.kategorier.map((k) => (
              <KategoriRad key={k.category_id} rad={k} onFerdig={onFerdig} onFeil={onFeil} />
            ))}
          </tbody>
        </table>
      </div>
      {kat.antall > kat.kategorier.length && (
        <p className="dempet">Viser {kat.kategorier.length} av {kat.antall}.</p>
      )}
    </>
  );
}

function KategoriRad({ rad, onFerdig, onFeil }) {
  const [q, setQ] = useState("");
  const [treff, setTreff] = useState([]);
  const [lagrer, setLagrer] = useState(false);

  async function lagre(kode) {
    setLagrer(true);
    try {
      await api.koblKategori(rad.category_id, kode || null);
      onFerdig();
    } catch (e) {
      onFeil(e);
      setLagrer(false);
    }
  }

  async function søk(tekst) {
    setQ(tekst);
    if (tekst.trim().length < 2) return setTreff([]);
    try {
      setTreff(await api.søkSett(tekst.trim()));
    } catch (e) {
      onFeil(e);
    }
  }

  // Innholdsforslagene veier tyngst: de bygger på hvilke kort som faktisk
  // ligger i kategorien, ikke på hva den tilfeldigvis heter.
  const fraInnhold = rad.fraInnhold || [];
  const valg = treff.length ? treff : fraInnhold.length ? [] : rad.forslag || [];

  return (
    <tr>
      <td>{rad.name || "(uten navn)"}</td>
      <td className="dempet">{rad.parent_name || <span title="Kategorien har ingen forelder i Mystore">—</span>}</td>
      <td>
        {rad.set_name ? (
          <span className="merkelapp m-lager" title={Number(rad.manuell) ? "Satt manuelt" : "Funnet automatisk"}>
            {rad.set_name}
          </span>
        ) : (
          <span className="dempet">—</span>
        )}
      </td>
      <td>
        <div className="rad-flex" style={{ alignItems: "flex-start" }}>
          <div style={{ minWidth: 300 }}>
            <input
              type="text"
              value={q}
              onChange={(e) => søk(e.target.value)}
              placeholder="Søk i alle sett…"
              style={{ width: "100%", marginBottom: 5 }}
            />
            {fraInnhold.length > 0 && treff.length === 0 && (
              <div style={{ marginBottom: 6 }}>
                {fraInnhold.map((f) => (
                  <button
                    key={f.set_code}
                    className="knapp liten"
                    disabled={lagrer}
                    onClick={() => lagre(f.set_code)}
                    style={{ marginRight: 5, marginBottom: 4 }}
                    title={`${f.treff} av ${f.avNavn ?? "?"} kortnavn i kategorien finnes i ${f.set_name}`}
                  >
                    {f.set_name}{" "}
                    <span className="dempet">
                      {f.treff}
                      {f.avNavn ? `/${f.avNavn}` : ""}
                    </span>
                  </button>
                ))}
                <div className="dempet" style={{ fontSize: 11 }}>
                  Treff av antall kortnavn i kategorien. Få navn gir svakt grunnlag,
                  selv når andelen er høy.
                </div>
              </div>
            )}
            <div className="rad-flex" style={{ gap: 5 }}>
              {valg.length === 0 && fraInnhold.length === 0 && (
                <span className="dempet" style={{ fontSize: 12 }}>Ingen forslag — søk selv</span>
              )}
              {valg.map((s) => (
                <button
                  key={s.code}
                  className="knapp liten"
                  disabled={lagrer}
                  onClick={() => lagre(s.code)}
                  title={`Koble til ${s.name}`}
                >
                  {s.name}
                </button>
              ))}
            </div>
          </div>
          <button className="knapp liten" disabled={lagrer} onClick={() => lagre(null)} title="Tilbehør og annet som ikke er kort">
            Ikke kort
          </button>
        </div>
      </td>
    </tr>
  );
}

function Produkter({ data, onFerdig, onFeil }) {
  if (!data.produkter.length) {
    return (
      <div className="panel">
        <div className="tom">
          <b>Alle produkter er koblet</b>
          Hvert produkt peker på et kort i katalogen, og beholdningen teller
          riktig i kvotene.
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="varsel feil" style={{ marginBottom: 16 }}>
        {data.antall} produkter i sett du kjøper fra fant ikke sitt kort. Beholdningen
        deres regnes som 0, så kunder kan selge deg kort du har fra før.
      </div>
      {data.produkter.map((p) => (
        <Produkt key={p.product_id} produkt={p} onFerdig={onFerdig} onFeil={onFeil} />
      ))}
      {data.antall > data.produkter.length && (
        <p className="dempet">Viser {data.produkter.length} av {data.antall}. Koble disse, så kommer resten.</p>
      )}
    </>
  );
}

function Produkt({ produkt, onFerdig, onFeil }) {
  const [q, setQ] = useState(produkt.name || "");
  const [treff, setTreff] = useState(null);
  const [søker, setSøker] = useState(false);
  const [åpen, setÅpen] = useState(false);

  async function søk(tekst) {
    setSøker(true);
    try {
      setTreff(await api.søkKort(tekst));
    } catch (e) {
      onFeil(e);
    } finally {
      setSøker(false);
    }
  }

  function åpne() {
    setÅpen(true);
    if (!treff) søk(q);
  }

  async function koble(kort, finish) {
    try {
      await api.koble({ product_id: produkt.product_id, card_id: kort.id, finish });
      onFerdig();
    } catch (e) {
      onFeil(e);
    }
  }

  async function ignorer() {
    try {
      await api.koble({ product_id: produkt.product_id, ignored: true });
      onFerdig();
    } catch (e) {
      onFeil(e);
    }
  }

  return (
    <div className="panel">
      <header>
        <strong>{produkt.name || "(uten navn)"}</strong>
        {produkt.set_code && <span className="kode dempet">{String(produkt.set_code).toUpperCase()}</span>}
        {produkt.category && <span className="dempet">{produkt.category}</span>}
        <span className="dempet">{produkt.stock} på lager</span>
        <div style={{ marginLeft: "auto" }} className="rad-flex">
          <button className="knapp liten" onClick={ignorer} title="Ermer, esker og annet som ikke er kort">
            Ikke et kort
          </button>
          {!åpen && (
            <button className="knapp liten primar" onClick={åpne}>
              Finn kortet
            </button>
          )}
        </div>
      </header>

      {åpen && (
        <div className="krop">
          <div className="rad-flex" style={{ marginBottom: 12 }}>
            <input
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && søk(q)}
              placeholder="Kortnavn"
              style={{ width: 280 }}
            />
            <button className="knapp liten" onClick={() => søk(q)} disabled={søker}>
              {søker ? "Søker…" : "Søk"}
            </button>
            <button className="knapp liten" onClick={() => setÅpen(false)}>Lukk</button>
          </div>

          {treff?.length === 0 && (
            <p className="dempet">Ingen treff. Prøv bare kortnavnet, uten sett og tilleggsord.</p>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 10 }}>
            {(treff || []).map((k) => (
              <div key={k.id} style={{ border: "1px solid var(--strek)", borderRadius: 8, padding: 8 }}>
                {k.image_uri && (
                  <img
                    src={k.image_uri}
                    alt={`${k.name}, ${k.set_name}`}
                    loading="lazy"
                    style={{ width: "100%", aspectRatio: "5 / 7", objectFit: "cover", borderRadius: 4 }}
                  />
                )}
                <div style={{ fontSize: 12, marginTop: 6 }}>{k.set_name || k.set_code}</div>
                <div className="kode dempet" style={{ fontSize: 11 }}>
                  {String(k.set_code).toUpperCase()} #{k.collector_number}
                </div>
                <div className="rad-flex" style={{ gap: 4, marginTop: 6 }}>
                  <button className="knapp liten" onClick={() => koble(k, "nonfoil")}>Vanlig</button>
                  {Number(k.has_foil) > 0 && (
                    <button className="knapp liten" onClick={() => koble(k, "foil")}>Foil</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
