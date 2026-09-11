import { useState, useEffect } from "react";
import { api, kroner, dato, dagerTil, CONDITIONS, CONDITION_NAVN } from "../api.js";

const STATUS = {
  pending: { navn: "Venter i posten", klasse: "m-vent" },
  received: { navn: "Mottatt", klasse: "m-mottatt" },
  stocked: { navn: "Lagerført", klasse: "m-lager" },
  cancelled: { navn: "Kansellert", klasse: "m-av" },
  expired: { navn: "Utløpt", klasse: "m-av" },
};

export default function Ordrer({ onFeil, onAntall }) {
  const [arkiv, setArkiv] = useState(false);
  const [ordrer, setOrdrer] = useState([]);
  const [åpen, setÅpen] = useState(null);
  const [laster, setLaster] = useState(true);

  async function last() {
    setLaster(true);
    try {
      const d = await api.ordrer(arkiv);
      setOrdrer(d);
      if (!arkiv) onAntall(d.length);
    } catch (e) {
      onFeil(e);
    } finally {
      setLaster(false);
    }
  }

  useEffect(() => {
    last();
  }, [arkiv]);

  if (laster) return <p className="dempet">Henter ordrer…</p>;

  return (
    <>
      <div className="rad-flex" style={{ marginBottom: 14 }}>
        <button className={`knapp ${!arkiv ? "primar" : ""}`} onClick={() => setArkiv(false)}>
          Aktive
        </button>
        <button className={`knapp ${arkiv ? "primar" : ""}`} onClick={() => setArkiv(true)}>
          Ferdige
        </button>
        <button className="knapp" onClick={last}>Oppdater</button>
      </div>

      {!ordrer.length && (
        <div className="panel">
          <div className="tom">
            <b>{arkiv ? "Ingen ferdige ordrer" : "Ingen ordrer venter"}</b>
            {arkiv ? "Ordrer havner her når de er gjort opp." : "Nye salg dukker opp her med én gang de sendes inn."}
          </div>
        </div>
      )}

      {ordrer.map((o) => (
        <Ordre
          key={o.id}
          ordre={o}
          åpen={åpen === o.id}
          onVeksle={() => setÅpen(åpen === o.id ? null : o.id)}
          onEndret={last}
          onFeil={onFeil}
        />
      ))}
    </>
  );
}

function Ordre({ ordre, åpen, onVeksle, onEndret, onFeil }) {
  const s = STATUS[ordre.status] || STATUS.pending;
  const dager = dagerTil(ordre.expires_at);
  const antallKort = ordre.linjer.reduce((n, l) => n + l.qty, 0);

  // Kunden varsles som standard. Hakes den av, gjøres endringen stille — for
  // rettinger hen ikke trenger å vite om.
  const [varsle, setVarsle] = useState(true);

  async function sett(status) {
    try {
      await api.endreOrdre(ordre.id, { status, varsle });
      onEndret();
    } catch (e) {
      onFeil(e);
    }
  }

  return (
    <div className="panel">
      <header>
        <button className="knapp liten" onClick={onVeksle} aria-expanded={åpen}>
          {åpen ? "Skjul" : "Åpne"}
        </button>
        <span className="kode">{ordre.order_no}</span>
        <strong>{ordre.customer_name}</strong>
        <span className={`merkelapp ${s.klasse}`}>{s.navn}</span>
        <span className="dempet">
          {antallKort} kort · {ordre.linjer.length} linjer · {dato(ordre.created_at)}
        </span>
        {ordre.status === "pending" && dager !== null && (
          <span className="dempet" title="Reservasjonen frigjøres når fristen går ut">
            {dager > 0 ? `${dager} dager igjen` : "Fristen har gått ut"}
          </span>
        )}
        {ordre.discount_code && (
          <span className="merkelapp m-ok" title="Rabattkode lagt inn">{ordre.discount_code}</span>
        )}
        <span style={{ marginLeft: "auto" }} className="sum">{kroner(ordre.total_ore)}</span>
      </header>

      {åpen && (
        <div className="krop">
          <div className="rad-flex" style={{ marginBottom: 14 }}>
            <a href={`mailto:${ordre.email}`}>{ordre.email}</a>
            {ordre.phone && <span className="dempet">{ordre.phone}</span>}

          </div>

          {ordre.note && (
            <div className="varsel info" style={{ marginBottom: 14 }}>
              <b>Melding fra {ordre.customer_name}</b>
              <div style={{ whiteSpace: "pre-line", marginTop: 4 }}>{ordre.note}</div>
            </div>
          )}

          <Linjer linjer={ordre.linjer} onEndret={onEndret} onFeil={onFeil} />

          {["received", "pending"].includes(ordre.status) && (
            <NyLinje ordre={ordre} onEndret={onEndret} onFeil={onFeil} />
          )}

          <Logg ordre={ordre} />

          {["received", "stocked"].includes(ordre.status) && (
            <Oppgjør ordre={ordre} onEndret={onEndret} onFeil={onFeil} />
          )}

          <div className="spred" style={{ marginTop: 16 }}>
            <span className="dempet">
              {ordre.status === "received"
                ? "Kvoten holdes til ordren er gjort opp."
                : ordre.status === "pending"
                ? "Kortene er ikke kommet ennå."
                : ""}
            </span>
            <div className="rad-flex">
              <label className="dempet" style={{ display: "flex", alignItems: "center", gap: 6, marginRight: 4 }}>
                <input type="checkbox" checked={varsle} onChange={(e) => setVarsle(e.target.checked)} />
                Varsle kunden
              </label>
              {ordre.status === "pending" && (
                <>
                  <button className="knapp fare" onClick={() => sett("cancelled")}>Kanseller</button>
                  <button className="knapp primar" onClick={() => sett("received")}>Merk mottatt</button>
                </>
              )}
              {ordre.status === "received" && (
                <button className="knapp" onClick={() => sett("pending")}>Angre mottak</button>
              )}
              {["stocked", "cancelled", "expired"].includes(ordre.status) && (
                <button className="knapp" onClick={() => sett("pending")}>Åpne på nytt</button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Kortene ligger sortert på sett og navn, i samme rekkefølge som kunden ble
// bedt om å sortere bunken. Gå gjennom stabelen og lista i takt.
function Linjer({ linjer, onEndret, onFeil }) {
  return (
    <table className="kontroll">
      <thead>
        <tr>
          <th>Kort</th>
          <th>Utgave</th>
          <th>Cond.</th>
          <th className="h">Bestilt</th>
          <th className="h">Mottatt</th>
          <th className="h">Stk.pris</th>
          <th className="h">Sum</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {linjer.map((l) => (
          <Linje key={l.id} linje={l} onEndret={onEndret} onFeil={onFeil} />
        ))}
      </tbody>
    </table>
  );
}

// Kunden sendte et annet trykk enn hen valgte. Da byttes kortet på linjen —
// antall og tilstand står, prisen regnes om etter det nye settet, og
// endringsloggen forteller kunden hva som ble byttet fra.
function Utgave({ linje, onEndret, onFeil }) {
  const [åpen, setÅpen] = useState(false);
  const [treff, setTreff] = useState(null);
  const [jobber, setJobber] = useState(false);

  useEffect(() => {
    if (!åpen || treff) return;
    api
      .søkKort(linje.card_name)
      .then((r) => setTreff(r.filter((k) => k.name === linje.card_name)))
      .catch(() => setTreff([]));
  }, [åpen, treff, linje.card_name]);

  async function bytt(kort, finish) {
    setJobber(true);
    try {
      await api.byttKort(linje.id, kort.id, finish);
      setÅpen(false);
      onEndret();
    } catch (e) {
      onFeil(e);
    } finally {
      setJobber(false);
    }
  }

  if (!åpen) {
    return (
      <>
        <span className="kode">{linje.set_code.toUpperCase()}</span>{" "}
        {linje.collector_number && <span className="kode dempet">#{linje.collector_number}</span>}
        {linje.finish === "foil" && <span className="merkelapp m-vent" style={{ marginLeft: 6 }}>Foil</span>}
        <button className="knapp handling" onClick={() => setÅpen(true)}>
          Bytt utgave
        </button>
      </>
    );
  }

  return (
    <div>
      {!treff && <span className="dempet">Henter…</span>}
      {treff && (
        <select
          value={`${linje.card_id}:${linje.finish}`}
          disabled={jobber}
          onChange={(e) => {
            const [id, finish] = e.target.value.split(":");
            const k = treff.find((x) => x.id === id);
            if (k) bytt(k, finish);
          }}
          style={{ maxWidth: 230 }}
        >
          {treff.flatMap((k) =>
            [
              Number(k.has_nonfoil) !== 0 ? "nonfoil" : null,
              Number(k.has_foil) ? "foil" : null,
            ]
              .filter(Boolean)
              .map((f) => (
                <option key={`${k.id}:${f}`} value={`${k.id}:${f}`}>
                  {k.set_name} #{k.collector_number}
                  {f === "foil" ? " (foil)" : ""}
                </option>
              ))
          )}
        </select>
      )}
      {treff && !treff.length && <span className="dempet">Fant ingen andre trykk.</span>}
      <button className="knapp blank" style={{ padding: 0, fontSize: 12 }} onClick={() => setÅpen(false)}>
        Avbryt
      </button>
    </div>
  );
}

function Linje({ linje, onEndret, onFeil }) {
  const [mottatt, setMottatt] = useState(linje.qty_received ?? linje.qty);
  const [cond, setCond] = useState(linje.condition);
  const [lagrer, setLagrer] = useState(false);

  const endret = mottatt !== (linje.qty_received ?? linje.qty) || cond !== linje.condition;
  const avvik = mottatt !== linje.qty;

  async function lagre() {
    setLagrer(true);
    try {
      // Prisen settes ikke her. Serveren regner den om etter trappen for
      // settet når tilstanden endres — ellers ville to steder bestemt beløpet.
      await api.endreLinje(linje.id, { qty_received: mottatt, condition: cond });
      onEndret();
    } catch (e) {
      onFeil(e);
    } finally {
      setLagrer(false);
    }
  }

  async function slett() {
    if (!confirm(`Fjerne ${linje.card_name} fra ordren?`)) return;
    try {
      await api.slettLinje(linje.id);
      onEndret();
    } catch (e) {
      onFeil(e);
    }
  }

  // Fjernede linjer slettes ikke. De blir stående nedtonet, slik at du ser
  // hva som ble tatt ut og kan angre.
  if (linje.fjernet_at) {
    return (
      <tr style={{ opacity: 0.5 }}>
        <td style={{ textDecoration: "line-through" }}>
          <div>{linje.card_name}</div>
          <div className="sett">{linje.set_name}</div>
        </td>
        <td colSpan={4} className="dempet">Fjernet — kom ikke fram</td>
        <td className="h">
          <button
            className="knapp liten"
            onClick={async () => {
              try {
                await api.angreFjerning(linje.id);
                onEndret();
              } catch (e) {
                onFeil(e);
              }
            }}
          >
            Angre
          </button>
        </td>
      </tr>
    );
  }

  return (
    <tr data-avvik={avvik ? "true" : "false"}>
      <td>
        <div>
          {linje.card_name}
          {linje.kilde === "admin" && (
            <span className="merkelapp m-ok" style={{ marginLeft: 6 }}>Lagt til</span>
          )}
        </div>
        <div className="sett">{linje.set_name}</div>
      </td>
      <td>
        <Utgave linje={linje} onEndret={onEndret} onFeil={onFeil} />
      </td>
      <td>
        <select value={cond} onChange={(e) => setCond(e.target.value)}>
          {CONDITIONS.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </td>
      <td className="h">{linje.qty}</td>
      <td className="h">
        <input
          type="number"
          min="0"
          value={mottatt}
          onChange={(e) => setMottatt(Math.max(0, parseInt(e.target.value) || 0))}
        />
      </td>
      <td className="h tall">
        {kroner(linje.unit_ore)}
        {cond !== linje.condition && <div className="sett">regnes om ved lagring</div>}
      </td>
      <td className="h tall">{kroner(mottatt * linje.unit_ore)}</td>
      <td className="h">
        <div className="rad-flex" style={{ justifyContent: "flex-end" }}>
          {endret && (
            <button className="knapp liten primar" onClick={lagre} disabled={lagrer}>
              Lagre
            </button>
          )}
          <button className="knapp liten fare" onClick={slett} title="Fjern linjen">
            Fjern
          </button>
        </div>
      </td>
    </tr>
  );
}

// Bestilt mot mottatt. Endrer du tilstand eller antall, er dette forskjellen
// kunden må få vite om — og det er tallet som skal stå på rabattkoden.
// Utledet av det som ble frosset ved innsending. Dette er teksten kunden
// skal få — forskjellen mellom det hen sendte inn og det som ble godkjent.
function Logg({ ordre }) {
  const lovet = Number(ordre.quoted_ore || 0);
  const nå = Number(ordre.total_ore || 0);
  const [logg, setLogg] = useState(null);

  useEffect(() => {
    api.ordreLogg(ordre.id).then(setLogg).catch(() => setLogg([]));
  }, [ordre.id, ordre.total_ore, ordre.linjer.length]);

  if (!logg?.length && lovet === nå) return null;

  return (
    <div className="varsel info" style={{ marginTop: 12 }}>
      <b>Endringer siden innsending.</b> Kunden ble forespeilet {kroner(lovet)} og
      får nå {kroner(nå)}.
      {logg?.length > 0 && (
        <ul style={{ margin: "6px 0 0", paddingLeft: 20 }}>
          {logg.map((e, i) => <li key={i}>{e.tekst}</li>)}
        </ul>
      )}
    </div>
  );
}

// Kunden sendte et annet trykk enn hen trodde. Da søker du opp riktig kort og
// legger det til — prisen regnes ut på server, som alle andre priser.
function NyLinje({ ordre, onEndret, onFeil }) {
  const [åpen, setÅpen] = useState(false);
  const [søk, setSøk] = useState("");
  const [treff, setTreff] = useState([]);
  const [valgt, setValgt] = useState(null);
  const [cond, setCond] = useState("NM");
  const [antall, setAntall] = useState(1);
  const [jobber, setJobber] = useState(false);

  useEffect(() => {
    if (søk.trim().length < 3) return setTreff([]);
    const t = setTimeout(() => {
      api.søkKort(søk.trim()).then(setTreff).catch(() => setTreff([]));
    }, 250);
    return () => clearTimeout(t);
  }, [søk]);

  async function legg(finish) {
    setJobber(true);
    try {
      await api.leggTilLinje(ordre.id, {
        card_id: valgt.id,
        finish,
        condition: cond,
        qty: Math.max(1, parseInt(antall) || 1),
      });
      setÅpen(false);
      setValgt(null);
      setSøk("");
      onEndret();
    } catch (e) {
      onFeil(e);
    } finally {
      setJobber(false);
    }
  }

  if (!åpen) {
    return (
      <button className="knapp liten" style={{ marginTop: 10 }} onClick={() => setÅpen(true)}>
        + Legg til kort
      </button>
    );
  }

  return (
    <div className="panel" style={{ marginTop: 12, background: "var(--papir)" }}>
      <div className="krop">
        <strong>Legg til et kort kunden sendte</strong>
        <p className="dempet" style={{ margin: "4px 0 10px" }}>
          Brukes når kortet i pakken er et annet trykk enn det som ble bestilt.
          Fjern den opprinnelige linjen etterpå, så forklarer loggen begge deler.
        </p>

        {!valgt ? (
          <>
            <input
              type="text"
              value={søk}
              onChange={(e) => setSøk(e.target.value)}
              placeholder="Søk etter kortnavn"
              autoFocus
              style={{ width: "100%", maxWidth: 380 }}
            />
            <div style={{ maxHeight: 220, overflowY: "auto", marginTop: 8 }}>
              {treff.slice(0, 25).map((k) => (
                <button
                  key={k.id}
                  className="knapp liten"
                  style={{ display: "block", width: "100%", textAlign: "left", marginBottom: 4 }}
                  onClick={() => setValgt(k)}
                >
                  {k.name} <span className="dempet">{k.set_name} #{k.collector_number}</span>
                </button>
              ))}
              {søk.trim().length >= 3 && !treff.length && (
                <div className="dempet">Ingen treff.</div>
              )}
            </div>
          </>
        ) : (
          <>
            <div style={{ marginBottom: 10 }}>
              <strong>{valgt.name}</strong>{" "}
              <span className="dempet">{valgt.set_name} #{valgt.collector_number}</span>
            </div>
            <div className="rad-flex" style={{ marginBottom: 10 }}>
              <label>
                <span className="navn">Tilstand</span>
                <select value={cond} onChange={(e) => setCond(e.target.value)}>
                  {CONDITIONS.map((c) => (
                    <option key={c} value={c}>{c} — {CONDITION_NAVN[c]}</option>
                  ))}
                </select>
              </label>
              <label>
                <span className="navn">Antall</span>
                <input
                  type="number"
                  min="1"
                  value={antall}
                  onChange={(e) => setAntall(e.target.value)}
                  style={{ width: 70 }}
                />
              </label>
            </div>
            <div className="rad-flex">
              <button className="knapp primar" onClick={() => legg("nonfoil")} disabled={jobber}>
                Legg til vanlig
              </button>
              {valgt.has_foil ? (
                <button className="knapp" onClick={() => legg("foil")} disabled={jobber}>
                  Legg til foil
                </button>
              ) : null}
              <button className="knapp blank" onClick={() => setValgt(null)}>Velg et annet</button>
            </div>
          </>
        )}

        <div style={{ marginTop: 10 }}>
          <button className="knapp blank" onClick={() => { setÅpen(false); setValgt(null); }}>
            Lukk
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// OPPGJØR
// ─────────────────────────────────────────────────────────────────────────────
// Koden lages manuelt i Mystore som et fastbeløp, og limes inn her. Først når
// den ligger inne kan ordren gjøres opp — ellers ville den havnet i arkivet
// uten at kunden hadde fått noe.
function Oppgjør({ ordre, onEndret, onFeil }) {
  const [kode, setKode] = useState(ordre.discount_code || "");
  const [notat, setNotat] = useState(ordre.credit_note || "");
  const [jobber, setJobber] = useState(false);
  const [sendEpost, setSendEpost] = useState(true);
  const [tester, setTester] = useState(false);
  const ferdig = ordre.status === "stocked";

  async function test() {
    setTester(true);
    try {
      const r = await api.testEpost(ordre.id, "oppgjor");
      onFeil(new Error(r.sendt ? "Testen er sendt til deg selv." : `Ikke sendt: ${r.grunn}`));
    } catch (e) {
      onFeil(e);
    } finally {
      setTester(false);
    }
  }

  async function lagre(gjørOpp) {
    setJobber(true);
    try {
      await api.lagreKreditt(ordre.id, {
        discount_code: kode.trim() || null,
        credit_note: notat.trim() || null,
        sendt: gjørOpp,
        varsle: sendEpost,
      });
      // Kvoten holdes helt til ordren er gjort opp. Da overtar beholdningen i
      // Mystore tellingen, og derfor må kortene være lagt inn der først.
      if (gjørOpp) await api.endreOrdre(ordre.id, { status: "stocked", varsle: false });
      onEndret();
    } catch (e) {
      onFeil(e);
    } finally {
      setJobber(false);
    }
  }

  if (ferdig) {
    return (
      <div className="panel" style={{ marginTop: 14, background: "var(--papir)" }}>
        <div className="krop">
          <div className="rad-flex">
            <strong>Gjort opp</strong>
            <span className="kode">{ordre.discount_code || "ingen kode"}</span>
            <span className="dempet">{ordre.credit_sent_at ? dato(ordre.credit_sent_at) : ""}</span>
            {ordre.credit_note && <span className="dempet">{ordre.credit_note}</span>}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="panel" style={{ marginTop: 14, background: "var(--aksent-svak)", borderColor: "#ccd8f7" }}>
      <div className="krop">
        <strong>Gjør opp</strong>
        <p className="dempet" style={{ margin: "4px 0 12px" }}>
          Lag en rabattkode på {kroner(ordre.total_ore)} i Mystore, lim den inn her, og
          legg kortene inn på lager. Når du bekrefter, frigjøres kvoten og
          beholdningen i Mystore overtar tellingen — er ikke kortene lagt inn ennå,
          kan du love bort de samme kortene på nytt.
        </p>
        <div className="rad-flex" style={{ marginBottom: 10 }}>
          <label>
            <span className="navn">Rabattkode</span>
            <input
              type="text"
              value={kode}
              onChange={(e) => setKode(e.target.value)}
              placeholder="hhrl5l"
              style={{ width: 160, fontFamily: "var(--kode, monospace)" }}
            />
          </label>
          <label style={{ flex: 1 }}>
            <span className="navn">Notat <span className="dempet">— hva som eventuelt ble endret</span></span>
            <input
              type="text"
              value={notat}
              onChange={(e) => setNotat(e.target.value)}
              placeholder="To kort var EX, ikke NM"
              style={{ width: "100%" }}
            />
          </label>
        </div>
        <label className="dempet" style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
          <input type="checkbox" checked={sendEpost} onChange={(e) => setSendEpost(e.target.checked)} />
          Send oppgjørsepost med koden til kunden
        </label>
        <div className="rad-flex">
          <button className="knapp" onClick={() => lagre(false)} disabled={jobber}>
            Lagre uten å gjøre opp
          </button>
          <button className="knapp blank" onClick={test} disabled={tester || !kode.trim()}>
            {tester ? "Sender…" : "Send test til meg"}
          </button>
          <button
            className="knapp primar"
            onClick={() => lagre(true)}
            disabled={jobber || !kode.trim()}
            title={!kode.trim() ? "Legg inn rabattkoden først" : "Ordren flyttes til arkivet"}
          >
            {jobber ? "Lagrer…" : "Mottatt og godkjent — gjør opp"}
          </button>
        </div>
      </div>
    </div>
  );
}
