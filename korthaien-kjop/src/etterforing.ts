import { db } from "./db.js";

// ─────────────────────────────────────────────────────────────────────────────
// ETTERFØRING FRA MYSTORE
// ─────────────────────────────────────────────────────────────────────────────
// Overgangen bygde lagerboken fra Mystore-speilet slik det sto. Speilet var
// bare fullstendig for sett du kjøper fra — den vanlige synken henter ikke de
// andre — så sett som Revised kom med gamle eller ingen tall.
//
// Etter en full synk (Mystore er stengt, tallene står stille) sammenlignes
// hvert kort med det som faktisk ble ført inn fra Mystore, og bare
// differansen føres. Det som allerede er lagt inn fra Kobling, og tidligere
// etterføringer, trekkes fra, så ingenting telles to ganger. Salg, innkjøp og
// rettelser etter overgangen røres ikke: de er egne bevegelser.

const ÅPNING = "Åpningsbeholdning fra Mystore";
const ETTERFØRT = "Etterført fra Mystore (full synk)";

type Rad = {
  card_id: string;
  finish: string;
  name: string;
  set_code: string;
  set_name: string;
  collector_number: string;
  mystore: number;
  overgang: number;
  etterfort: number;
  endring: number;
  manuelt: boolean;
  produkt: string | null;
  // mangler: finnes i Mystore, ikke i lageret. flyttet: samme kort på flere
  // numre har byttet om. færre: Mystore har færre enn det som ble ført inn.
  type: "mangler" | "flyttet" | "færre";
  // Valgt som standard: bare det som tydelig mangler.
  foreslått: boolean;
};

const nøkkel = (c: string, f: string) => `${c}:${f}`;

export async function etterføringsforslag(): Promise<{
  rader: Rad[];
  skjult: number;
  pluss: number;
  minus: number;
  sist_synket: string | null;
  overgang_at: string | null;
}> {
  const [speil, åpning, kobling, etter, sist] = await Promise.all([
    db().execute("SELECT card_id, finish, qty, product_id, product_name FROM mystore_stock"),
    db().execute({
      sql: `SELECT card_id, finish, SUM(antall) AS n, MAX(created_at) AS t
              FROM lager_bevegelser WHERE grunn = 'mystore' AND notat = ?
             GROUP BY card_id, finish`,
      args: [ÅPNING],
    }),
    // Produkter du har ført inn fra Kobling, er ferdig behandlet der — også
    // når de er delt på flere utgaver. De holdes helt utenfor.
    db().execute("SELECT DISTINCT product_id FROM mystore_innlagt"),
    db().execute({
      sql: `SELECT card_id, finish, SUM(antall) AS n FROM lager_bevegelser
             WHERE grunn = 'mystore' AND notat = ? GROUP BY card_id, finish`,
      args: [ETTERFØRT],
    }),
    db().execute("SELECT MAX(synced_at) AS t FROM mystore_stock"),
  ]);

  // Overgangstidspunktet: åpningsradene uten egen inn-dato fikk det.
  let overgangAt: string | null = null;
  for (const x of åpning.rows as any[]) if (!overgangAt || String(x.t) > overgangAt) overgangAt = String(x.t);

  const kart = new Map<string, { card_id: string; finish: string; mystore: number; overgang: number; kobling: number; etterfort: number; produkt: string | null }>();
  const hent = (c: string, f: string) => {
    const k = nøkkel(c, f);
    if (!kart.has(k)) kart.set(k, { card_id: c, finish: f, mystore: 0, overgang: 0, kobling: 0, etterfort: 0, produkt: null });
    return kart.get(k)!;
  };
  const fraKobling = new Set((kobling.rows as any[]).map((x) => String(x.product_id)));
  for (const x of speil.rows as any[]) {
    if (x.product_id && fraKobling.has(String(x.product_id))) continue;
    const r = hent(String(x.card_id), String(x.finish));
    r.mystore = Math.max(0, Number(x.qty || 0));
    r.produkt = x.product_name ? String(x.product_name) : null;
  }
  for (const x of åpning.rows as any[]) hent(String(x.card_id), String(x.finish)).overgang = Number(x.n || 0);
  for (const x of etter.rows as any[]) hent(String(x.card_id), String(x.finish)).etterfort = Number(x.n || 0);

  const rå = [...kart.values()]
    .map((r) => ({ ...r, endring: r.mystore - r.overgang - r.etterfort }))
    .filter((r) => r.endring !== 0);

  // Navn og sett, også for å kjenne igjen samme kort på flere numre.
  const ider = [...new Set(rå.map((r) => r.card_id))];
  const navn = new Map<string, any>();
  for (let i = 0; i < ider.length; i += 400) {
    const del = ider.slice(i, i + 400);
    const r = await db().execute({
      sql: `SELECT c.id, c.name, c.set_code, c.collector_number, COALESCE(s.visningsnavn, s.name) AS set_name
              FROM cards c LEFT JOIN sets s ON s.code = c.set_code WHERE c.id IN (${del.map(() => "?").join(",")})`,
      args: del,
    });
    for (const x of r.rows as any[]) navn.set(String(x.id), x);
  }
  const medNavn = rå.map((r) => {
    const n = navn.get(r.card_id) || {};
    return {
      ...r,
      name: String(n.name || r.card_id),
      set_code: String(n.set_code || ""),
      set_name: String(n.set_name || n.set_code || ""),
      collector_number: String(n.collector_number || ""),
    };
  });

  // Samme kort i samme sett på flere numre (basic lands, alternative
  // illustrasjoner, showcase og vanlig): har Mystore-produktene byttet kort
  // seg imellom siden overgangen, ser det ut som −17 på ett nummer og +17 på
  // et annet. Ingenting har endret seg i Mystore; bare koblingen har flyttet.
  //   netto 0          → hele gruppen er en flytting, og vises ikke.
  //   både + og −      → usikkert; vises, men er ikke valgt.
  //   bare +           → mangler i lageret; valgt.
  //   bare −           → Mystore har færre; vises, men er ikke valgt.
  const gruppe = (r: { name: string; set_code: string; finish: string }) => `${r.name}|${r.set_code}|${r.finish}`;
  const grupper = new Map<string, { netto: number; pluss: boolean; minus: boolean }>();
  for (const r of medNavn) {
    const g = grupper.get(gruppe(r)) || { netto: 0, pluss: false, minus: false };
    g.netto += r.endring;
    if (r.endring > 0) g.pluss = true; else g.minus = true;
    grupper.set(gruppe(r), g);
  }
  let skjult = 0;
  let endret = medNavn
    .filter((r) => {
      if (grupper.get(gruppe(r))!.netto === 0) { skjult++; return false; }
      return true;
    })
    .map((r) => {
      const g = grupper.get(gruppe(r))!;
      const type: "mangler" | "flyttet" | "færre" = g.pluss && g.minus ? "flyttet" : r.endring > 0 ? "mangler" : "færre";
      return { ...r, type };
    });

  // Færre i Mystore enn det som ble ført inn: kan bare trekkes så langt det
  // finnes NM igjen. Er kortene solgt i mellomtiden, er de allerede borte, og
  // raden har ingenting mer å rette.
  const negative = endret.filter((r) => r.endring < 0);
  if (negative.length) {
    const nm = new Map<string, number>();
    const nIder = [...new Set(negative.map((r) => r.card_id))];
    for (let i = 0; i < nIder.length; i += 400) {
      const del = nIder.slice(i, i + 400);
      const q = await db().execute({
        sql: `SELECT card_id, finish, SUM(antall) AS n FROM lager_bevegelser
               WHERE condition = 'NM' AND card_id IN (${del.map(() => "?").join(",")}) GROUP BY card_id, finish`,
        args: del,
      });
      for (const x of q.rows as any[]) nm.set(nøkkel(String(x.card_id), String(x.finish)), Number(x.n || 0));
    }
    endret = endret
      .map((r) => (r.endring < 0 ? { ...r, endring: -Math.min(-r.endring, Math.max(0, nm.get(nøkkel(r.card_id, r.finish)) || 0)) } : r))
      .filter((r) => r.endring !== 0);
  }

  // Kort du har rettet for hånd etter overgangen: kanskje du allerede har
  // lagt inn det som manglet. De merkes, så du kan velge selv.
  const manuelt = new Set<string>();
  if (overgangAt && endret.length) {
    const m = await db().execute({
      sql: `SELECT DISTINCT card_id, finish FROM lager_bevegelser
             WHERE grunn IN ('manuell', 'telling') AND created_at >= ?`,
      args: [overgangAt],
    });
    for (const x of m.rows as any[]) manuelt.add(nøkkel(String(x.card_id), String(x.finish)));
  }

  const rader: Rad[] = endret
    .map((r) => {
      const erManuelt = manuelt.has(nøkkel(r.card_id, r.finish));
      return { ...r, manuelt: erManuelt, foreslått: r.type === "mangler" && !erManuelt };
    })
    .sort((a, b) => a.set_name.localeCompare(b.set_name) || a.name.localeCompare(b.name) ||
      String(a.collector_number).localeCompare(String(b.collector_number), undefined, { numeric: true }));

  return {
    rader,
    skjult,
    pluss: rader.filter((r) => r.endring > 0).reduce((n, r) => n + r.endring, 0),
    minus: rader.filter((r) => r.endring < 0).reduce((n, r) => n - r.endring, 0),
    sist_synket: (sist.rows[0] as any)?.t ?? null,
    overgang_at: overgangAt,
  };
}

// Fører de valgte radene. Tallene regnes på nytt her, ikke tatt fra
// klienten: står lista åpen mens noe endres, er det dagens tall som gjelder.
export async function etterfør(valgt: { card_id: string; finish: string }[]): Promise<{ rader: number; pluss: number; minus: number }> {
  const ønsket = new Set(valgt.map((v) => nøkkel(String(v.card_id), String(v.finish))));
  const { rader } = await etterføringsforslag();
  const nå = new Date().toISOString();
  const setninger: { sql: string; args: any[] }[] = [];
  let pluss = 0, minus = 0;
  for (const r of rader) {
    if (!ønsket.has(nøkkel(r.card_id, r.finish))) continue;
    const n = r.endring;
    setninger.push({
      sql: `INSERT INTO lager_bevegelser (card_id, finish, condition, antall, grunn, order_id, notat, created_at)
            VALUES (?, ?, 'NM', ?, 'mystore', NULL, ?, ?)`,
      args: [r.card_id, r.finish, n, ETTERFØRT, nå],
    });
    if (n > 0) pluss += n; else minus -= n;
  }
  for (let i = 0; i < setninger.length; i += 300) await db().batch(setninger.slice(i, i + 300), "write");
  return { rader: setninger.length, pluss, minus };
}
