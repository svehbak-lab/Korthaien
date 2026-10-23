import { useState, useEffect } from "react";
import { api, kroner } from "../api.js";

// ─────────────────────────────────────────────────────────────────────────────
// FRAKT
// ─────────────────────────────────────────────────────────────────────────────
// Alternativene kunden velger mellom i kassen. Prisene ligger her og ikke i
// koden, fordi Posten endrer dem og du skal slippe en utrulling for å rette
// et tall.
//
// Kunden velger fritt — vi tvinger ingen over på sporing, heller ikke på
// dyre ordrer. Men forsikringsgrensen vises, så valget er opplyst.

// Beløp oppgis i kroner og lagres i øre. Alt annet i systemet er i øre, og
// det skal ikke snike seg inn et sted der det ikke er det.
const tilØre = (kr) => Math.round((parseFloat(String(kr).replace(",", ".")) || 0) * 100);
const tilKr = (ore) => (ore === null || ore === undefined ? "" : String(ore / 100));

const TOM = { navn: "", pris_kr: "", forsikret_kr: "", beskrivelse: "", sortering: 0 };

export default function Frakt({ onFeil, onMelding }) {
  return (
    <>
      <Fraktalternativer onFeil={onFeil} onMelding={onMelding} />
      <Foretaket onFeil={onFeil} onMelding={onMelding} />
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// FORETAKET OG RETUR
// ─────────────────────────────────────────────────────────────────────────────
// Returssiden i butikken skrives av disse feltene. Et organisasjonsnummer som
// står i koden er et som ingen finner den dagen det skal rettes — og dette er
// opplysninger loven krever at kunden ser, så de skal ikke ligge et sted som
// krever en utrulling.
//
// Hvem som betaler returfrakten er et valg loven lar deg ta, men bare hvis du
// sier det på forhånd. Sier du ingenting, må du dekke den selv. Derfor er
// valget her, og teksten på returssiden følger det du velger.
function Foretaket({ onFeil, onMelding }) {
  const [s, setS] = useState(null);
  const [lagrer, setLagrer] = useState(false);

  useEffect(() => {
    api.innstillinger().then(setS).catch(onFeil);
  }, []);

  const endre = (felt, verdi) => setS((f) => ({ ...f, [felt]: verdi }));

  async function lagre() {
    setLagrer(true);
    try {
      setS(await api.lagreInnstillinger(s));
      onMelding("Lagret. Returssiden i butikken er oppdatert.");
    } catch (e) {
      onFeil(e);
    } finally {
      setLagrer(false);
    }
  }

  if (!s) return null;

  return (
    <div className="panel">
      <header><h3>Foretaket og retur</h3></header>
      <div className="krop">
        <p className="dempet" style={{ marginTop: 0 }}>
          Dette står på «Retur og angrerett» i butikken. Loven krever at kunden
          ser hvem selgeren er og hvor varen skal returneres, så feltene står
          her og ikke i koden.
        </p>

        <Felt navn="Registrert foretaksnavn">
          <input
            type="text" value={s.firmanavn || ""} style={{ width: 320 }}
            onChange={(e) => endre("firmanavn", e.target.value)}
          />
        </Felt>
        <Felt navn="Organisasjonsnummer">
          <input
            type="text" inputMode="numeric" value={s.org_nr || ""} style={{ width: 140 }}
            onChange={(e) => endre("org_nr", e.target.value)}
          />
        </Felt>
        <Felt navn="Returfrakten betales av">
          <select value={s.retur_frakt || "kunde"} onChange={(e) => endre("retur_frakt", e.target.value)}>
            <option value="kunde">Kunden</option>
            <option value="butikk">Korthaien</option>
          </select>
        </Felt>
        <p className="dempet">
          Velger du «Kunden», må det stå på returssiden før kjøpet — og det
          gjør det. Står det ingenting, er det du som må dekke frakten.
        </p>

        <Felt navn="Returadresse">
          <span className="dempet" style={{ whiteSpace: "pre-line" }}>
            {s.ship_to?.trim() || "— ikke lagt inn —"}
          </span>
        </Felt>
        <p className="dempet">
          Samme adresse som kunden sender salgskort til. Den endres under
          fanen <b>Innkjøp</b>, slik at det bare finnes én adresse å holde
          oppdatert.
        </p>

        <div className="rad-flex" style={{ marginTop: 4 }}>
          <button className="knapp primar" onClick={lagre} disabled={lagrer}>
            {lagrer ? "Lagrer…" : "Lagre"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Felt({ navn, children }) {
  return (
    <div className="rad-flex" style={{ alignItems: "baseline", gap: 12, marginBottom: 10 }}>
      <div className="dempet" style={{ width: 210, flex: "none", fontSize: 13 }}>{navn}</div>
      {children}
    </div>
  );
}

function Fraktalternativer({ onFeil, onMelding }) {
  const [alternativer, setAlternativer] = useState(null);
  const [ny, setNy] = useState(TOM);
  const [redigerer, setRedigerer] = useState(null);
  const [jobber, setJobber] = useState(false);

  async function last() {
    try {
      const r = await api.frakt();
      setAlternativer(r.alternativer || []);
    } catch (e) {
      onFeil(e);
    }
  }
  useEffect(() => {
    last();
  }, []);

  async function leggTil() {
    if (!ny.navn.trim()) return;
    setJobber(true);
    try {
      await api.leggTilFrakt({
        navn: ny.navn,
        pris_ore: tilØre(ny.pris_kr),
        // Tomt felt betyr uten sporing og forsikring. Det er noe annet enn
        // «forsikret for null kroner», og skillet må overleve helt til kassen.
        forsikret_ore: String(ny.forsikret_kr).trim() === "" ? null : tilØre(ny.forsikret_kr),
        beskrivelse: ny.beskrivelse,
        sortering: Number(ny.sortering) || 0,
      });
      setNy(TOM);
      await last();
      onMelding("Fraktalternativet er lagt til.");
    } catch (e) {
      onFeil(e);
    } finally {
      setJobber(false);
    }
  }

  async function lagre(f) {
    setJobber(true);
    try {
      await api.endreFrakt(f.id, {
        navn: f.navn,
        pris_ore: tilØre(f.pris_kr),
        forsikret_ore: String(f.forsikret_kr).trim() === "" ? null : tilØre(f.forsikret_kr),
        beskrivelse: f.beskrivelse,
        sortering: Number(f.sortering) || 0,
        aktiv: f.aktiv !== 0,
      });
      setRedigerer(null);
      await last();
      onMelding("Lagret.");
    } catch (e) {
      onFeil(e);
    } finally {
      setJobber(false);
    }
  }

  async function slåAv(f) {
    if (!confirm(`Slå av «${f.navn}»? Den forsvinner fra kassen, men blir stående her.`)) return;
    try {
      await api.slåAvFrakt(f.id);
      await last();
    } catch (e) {
      onFeil(e);
    }
  }

  if (!alternativer) return <p className="dempet">Henter fraktalternativer…</p>;

  return (
    <>
      <div className="panel">
        <header><h3>Fraktalternativer</h3></header>
        <div className="krop">
          <p className="dempet" style={{ margin: "0 0 4px" }}>
            Dette er det kunden velger mellom i kassen, i rekkefølgen under.
            Kunden velger fritt — vi tvinger ingen over på sporing — men
            forsikringsgrensen vises, så valget er opplyst.
          </p>
          <p className="dempet" style={{ margin: 0 }}>
            Tomt forsikringsfelt betyr uten sporing og forsikring. Det er noe
            annet enn null kroner, og kassen sier det ulikt.
          </p>
        </div>

        <table>
          <thead>
            <tr>
              <th style={{ width: 60 }}>Rekke</th>
              <th>Navn</th>
              <th className="h" style={{ width: 100 }}>Pris</th>
              <th className="h" style={{ width: 130 }}>Forsikret til</th>
              <th>Merknad</th>
              <th style={{ width: 150 }}></th>
            </tr>
          </thead>
          <tbody>
            {alternativer.map((f) =>
              redigerer?.id === f.id ? (
                <tr key={f.id}>
                  <td>
                    <input
                      type="number" value={redigerer.sortering}
                      onChange={(e) => setRedigerer({ ...redigerer, sortering: e.target.value })}
                      style={{ width: 54 }}
                    />
                  </td>
                  <td>
                    <input
                      type="text" value={redigerer.navn}
                      onChange={(e) => setRedigerer({ ...redigerer, navn: e.target.value })}
                      style={{ width: "100%" }}
                    />
                  </td>
                  <td className="h">
                    <input
                      type="text" inputMode="decimal" value={redigerer.pris_kr}
                      onChange={(e) => setRedigerer({ ...redigerer, pris_kr: e.target.value })}
                      style={{ width: 78, textAlign: "right" }}
                    />
                  </td>
                  <td className="h">
                    <input
                      type="text" inputMode="decimal" value={redigerer.forsikret_kr}
                      placeholder="ingen"
                      onChange={(e) => setRedigerer({ ...redigerer, forsikret_kr: e.target.value })}
                      style={{ width: 96, textAlign: "right" }}
                    />
                  </td>
                  <td>
                    <input
                      type="text" value={redigerer.beskrivelse || ""}
                      onChange={(e) => setRedigerer({ ...redigerer, beskrivelse: e.target.value })}
                      style={{ width: "100%" }}
                    />
                  </td>
                  <td>
                    <button className="knapp liten primar" disabled={jobber} onClick={() => lagre(redigerer)}>
                      Lagre
                    </button>
                    <button className="knapp liten" onClick={() => setRedigerer(null)} style={{ marginLeft: 6 }}>
                      Avbryt
                    </button>
                  </td>
                </tr>
              ) : (
                <tr key={f.id} style={{ opacity: f.aktiv ? 1 : 0.5 }}>
                  <td className="dempet">{f.sortering}</td>
                  <td>
                    {f.navn}
                    {!f.aktiv && <span className="merkelapp m-av" style={{ marginLeft: 8 }}>av</span>}
                  </td>
                  <td className="h tall">{kroner(f.pris_ore)}</td>
                  <td className="h tall">
                    {f.forsikret_ore === null
                      ? <span className="dempet">ingen</span>
                      : kroner(f.forsikret_ore)}
                  </td>
                  <td className="dempet">{f.beskrivelse || "—"}</td>
                  <td>
                    <button
                      className="knapp handling"
                      style={{ marginLeft: 0 }}
                      onClick={() =>
                        setRedigerer({
                          ...f,
                          pris_kr: tilKr(f.pris_ore),
                          forsikret_kr: tilKr(f.forsikret_ore),
                        })
                      }
                    >
                      Endre
                    </button>
                    {f.aktiv === 1 && (
                      <button className="knapp handling" onClick={() => slåAv(f)}>
                        Slå av
                      </button>
                    )}
                  </td>
                </tr>
              )
            )}
          </tbody>
        </table>

        {!alternativer.length && (
          <div className="tom">
            <b>Ingen fraktalternativer ennå</b>
            Legg inn de du bruker under, så står de klare når kassen bygges.
          </div>
        )}
      </div>

      <div className="panel">
        <header><h3>Nytt alternativ</h3></header>
        <div className="krop">
          <div className="rad-flex" style={{ alignItems: "flex-end", gap: 14 }}>
            <label>
              <div className="dempet" style={{ fontSize: 12, marginBottom: 3 }}>Navn</div>
              <input
                type="text" value={ny.navn} placeholder="Liten norgespakke"
                onChange={(e) => setNy({ ...ny, navn: e.target.value })}
                style={{ width: 200 }}
              />
            </label>
            <label>
              <div className="dempet" style={{ fontSize: 12, marginBottom: 3 }}>Pris kr</div>
              <input
                type="text" inputMode="decimal" value={ny.pris_kr} placeholder="80"
                onChange={(e) => setNy({ ...ny, pris_kr: e.target.value })}
                style={{ width: 80, textAlign: "right" }}
              />
            </label>
            <label>
              <div className="dempet" style={{ fontSize: 12, marginBottom: 3 }}>Forsikret til kr</div>
              <input
                type="text" inputMode="decimal" value={ny.forsikret_kr} placeholder="ingen"
                onChange={(e) => setNy({ ...ny, forsikret_kr: e.target.value })}
                style={{ width: 110, textAlign: "right" }}
              />
            </label>
            <label style={{ flex: 1, minWidth: 160 }}>
              <div className="dempet" style={{ fontSize: 12, marginBottom: 3 }}>Merknad</div>
              <input
                type="text" value={ny.beskrivelse} placeholder="Uten sporing"
                onChange={(e) => setNy({ ...ny, beskrivelse: e.target.value })}
                style={{ width: "100%" }}
              />
            </label>
            <label>
              <div className="dempet" style={{ fontSize: 12, marginBottom: 3 }}>Rekke</div>
              <input
                type="number" value={ny.sortering}
                onChange={(e) => setNy({ ...ny, sortering: e.target.value })}
                style={{ width: 60 }}
              />
            </label>
            <button className="knapp primar" disabled={jobber || !ny.navn.trim()} onClick={leggTil}>
              Legg til
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
