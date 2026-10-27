import { db, hentSettings, CONDITIONS, type Condition } from "./db.js";

// Bunken sorteres slik du faktisk går gjennom den: sett for sett, og innenfor
// hvert sett de dyre kortene først. Da ligger det som må vurderes nøye øverst,
// og bulken nederst.
const RARITET = ["mythic", "rare", "uncommon", "common"];
export const raritetsRang = (r: unknown) => {
  const i = RARITET.indexOf(String(r || "").toLowerCase());
  return i === -1 ? RARITET.length : i;
};
// Samme rekkefølge i SQL, slik at lista er lik uansett hvor den hentes fra.
export const SORTERING = `set_name,
  CASE lower(COALESCE(rarity, ''))
    WHEN 'mythic' THEN 0 WHEN 'rare' THEN 1
    WHEN 'uncommon' THEN 2 WHEN 'common' THEN 3 ELSE 4 END,
  card_name`;
import {
  prisØre, beregnØre, prisenFor, hentSetRule, hentManuellPris, hentEgneConditionsFor,
} from "./pricing.js";
import { hentKvote } from "./quota.js";

// ─────────────────────────────────────────────────────────────────────────────
// ORDRE
// ─────────────────────────────────────────────────────────────────────────────
// Klienten sender bare kort-ID, finish, condition og antall. Alt annet —
// pris, kvote, hva som faktisk kjøpes — regnes på nytt her. En kunde som
// endrer prisen i nettleseren oppnår ingenting.

export type InnLinje = {
  card_id: string;
  finish: "nonfoil" | "foil";
  condition: Condition;
  qty: number;
};

export type Avvist = { card_id: string; finish: string; condition: string; grunn: string };

export async function lagOrdre(input: {
  customer_name: string;
  email: string;
  phone?: string;
  note?: string;
  vilkar_godtatt?: boolean;
  linjer: InnLinje[];
}) {
  const s = await hentSettings();
  const navn = (input.customer_name || "").trim();
  const epost = (input.email || "").trim();
  if (navn.length < 2) throw new HttpFeil(400, "Navn mangler");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(epost)) throw new HttpFeil(400, "Ugyldig e-postadresse");
  if (!input.linjer?.length) throw new HttpFeil(400, "Ordren er tom");
  if (input.linjer.length > 500) throw new HttpFeil(400, "For mange linjer i én ordre");

  // Slå sammen duplikater før validering, ellers kan samme kort sendes
  // flere ganger for å komme rundt kvoten.
  const slått = new Map<string, InnLinje>();
  for (const l of input.linjer) {
    if (!CONDITIONS.includes(l.condition)) throw new HttpFeil(400, `Ukjent condition: ${l.condition}`);
    if (l.finish !== "nonfoil" && l.finish !== "foil") throw new HttpFeil(400, "Ukjent finish");
    const qty = Math.floor(Number(l.qty));
    if (!Number.isFinite(qty) || qty < 1) throw new HttpFeil(400, "Ugyldig antall");
    const k = `${l.card_id}:${l.finish}:${l.condition}`;
    const fins = slått.get(k);
    if (fins) fins.qty += qty;
    else slått.set(k, { ...l, qty });
  }

  const godkjent: any[] = [];
  const avvist: Avvist[] = [];
  // Kvoten deles på tvers av conditions for samme kort, så vi teller ned
  // underveis i stedet for å validere hver linje isolert.
  const brukt = new Map<string, number>();

  for (const l of slått.values()) {
    const r = await db().execute({
      sql: `SELECT c.*, COALESCE(s.visningsnavn, s.name) AS set_name FROM cards c
              LEFT JOIN sets s ON s.code = c.set_code WHERE c.id = ?`,
      args: [l.card_id],
    });
    const kort: any = r.rows[0];
    if (!kort) {
      avvist.push({ ...l, grunn: "Kortet finnes ikke" });
      continue;
    }
    if (l.finish === "foil" && !Number(kort.has_foil)) {
      avvist.push({ ...l, grunn: "Kortet finnes ikke i foil" });
      continue;
    }

    const regel = await hentSetRule(String(kort.set_code), s);
    // Kortets egen liste må leses før sjekken, ellers avvises en tilstand du
    // har åpnet for akkurat dette kortet.
    const egne = await hentEgneConditionsFor(l.card_id);
    const godtatt = egne?.length ? egne : regel.conditions;
    if (!godtatt.includes(l.condition)) {
      avvist.push({ ...l, grunn: `${l.condition} tas ikke imot for dette kortet` });
      continue;
    }

    const kvoteNøkkel = `${l.card_id}:${l.finish}`;
    const kvote = await hentKvote(l.card_id, l.finish, String(kort.set_code), regel);
    const alleredeBrukt = brukt.get(kvoteNøkkel) || 0;
    const ledig = kvote.available - alleredeBrukt;
    if (ledig <= 0) {
      avvist.push({ ...l, grunn: "Kvoten er full" });
      continue;
    }

    const qty = Math.min(l.qty, ledig);
    const manuell = await hentManuellPris(l.card_id, l.finish);
    const pris = prisØre(kort, l.finish, l.condition, regel, s, manuell, egne);
    if (pris <= 0) {
      avvist.push({ ...l, grunn: "Ingen gyldig pris for dette kortet" });
      continue;
    }
    if (qty < l.qty) {
      avvist.push({ ...l, grunn: `Bare ${qty} av ${l.qty} fikk plass i kvoten` });
    }

    brukt.set(kvoteNøkkel, alleredeBrukt + qty);
    godkjent.push({
      card_id: l.card_id,
      finish: l.finish,
      condition: l.condition,
      qty,
      unit_ore: pris,
      rarity: kort.rarity ? String(kort.rarity) : null,
      card_name: String(kort.name),
      set_code: String(kort.set_code),
      set_name: String(kort.set_name || kort.set_code),
      collector_number: kort.collector_number ? String(kort.collector_number) : null,
    });
  }

  if (!godkjent.length) throw new HttpFeil(409, "Ingen av kortene kunne tas imot", { avvist });

  // Sett, så sjeldenhet, så kortnavn. Kunden får beskjed om å legge bunken i
  // samme rekkefølge, så mottakskontrollen går rett gjennom lista.
  godkjent.sort(
    (a, b) =>
      a.set_name.localeCompare(b.set_name, "nb") ||
      raritetsRang(a.rarity) - raritetsRang(b.rarity) ||
      a.card_name.localeCompare(b.card_name, "nb") ||
      a.finish.localeCompare(b.finish) ||
      CONDITIONS.indexOf(a.condition) - CONDITIONS.indexOf(b.condition)
  );

  const total = godkjent.reduce((n, l) => n + l.unit_ore * l.qty, 0);
  // Bunnen sjekkes på det som faktisk ble godkjent, ikke på det kunden la i
  // kurven. Røk halve ordren på kvote, skal hen få vite at resten er for lite
  // — ikke få en bekreftelse på en ordre jeg ikke vil ha i posten.
  if (total < s.min_order_ore) {
    throw new HttpFeil(400, `Ordren må være på minst ${Math.round(s.min_order_ore / 100)} kr. Denne er på ${(total / 100).toFixed(2).replace(".", ",")} kr.`, {
      total_ore: total,
      min_order_ore: s.min_order_ore,
      avvist,
    });
  }
  const nå = new Date();
  const utløp = new Date(nå.getTime() + s.order_expiry_days * 86400000);
  const ordreNr = await nyttOrdrenummer(nå);

  const res = await db().execute({
    sql: `INSERT INTO orders (order_no, customer_name, email, phone, status, total_nok, total_ore, quoted_ore,
                              vilkar_godtatt, note, created_at, expires_at)
          VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?)`,
    args: [ordreNr, navn, epost, input.phone || null, Math.round(total / 100), total, total,
           input.vilkar_godtatt ? nå.toISOString() : null,
           input.note || null, nå.toISOString(), utløp.toISOString()],
  });
  const ordreId = Number(res.lastInsertRowid);

  for (const l of godkjent) {
    await db().execute({
      sql: `INSERT INTO order_lines
              (order_id, card_id, finish, condition, condition_start, qty, unit_nok, unit_ore, unit_ore_start,
               card_name, set_code, set_name, collector_number, rarity)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [ordreId, l.card_id, l.finish, l.condition, l.condition, l.qty, Math.round(l.unit_ore / 100), l.unit_ore, l.unit_ore,
             l.card_name, l.set_code, l.set_name, l.collector_number, l.rarity],
    });
  }

  await oppdaterSalgsverdi([ordreId]).catch((e) => console.error("Salgsverdien feilet:", e?.message));

  return {
    order_no: ordreNr,
    total_ore: total,
    expires_at: utløp.toISOString(),
    linjer: godkjent,
    avvist,
    instruksjoner: instruksjoner(ordreNr, s.ship_to, utløp),
  };
}

export function instruksjoner(ordreNr: string, adresse: string, utløp: Date) {
  return [
    "SORTER KORTENE i nøyaktig samme rekkefølge som kortlista under. Lista går sett for sett, og innenfor hvert sett fra de sjeldneste kortene til de vanligste. Dette er det viktigste punktet: en usortert bunke tar mange ganger så lang tid å gå gjennom, og oppgjøret ditt blir tilsvarende forsinket.",
    "Legg en lapp i pakken med ordrenummer " + ordreNr + ".",
    "Send til:\n" + adresse,
    "Pakken må være sendt innen " + utløp.toLocaleDateString("nb-NO") + " — etter det frigjøres kortene til andre selgere.",
    "Summen er et anslag. Jeg går gjennom alle kortene ved mottak og sjekker antall og tilstand. Avviker noe fra det du oppga, justerer jeg linjen og skriver hva som ble endret.",
    "Oppgjøret er butikkreditt på korthaien.no. Når kortene er godkjent, får du en rabattkode på e-post som du bruker i kassen.",
  ];
}

// K-00034, K-00035 … Fortløpende fra nummerserien. Ordrene fra før heter
// KH-ÅÅMMDD-NNNN og beholder det.
async function nyttOrdrenummer(_nå: Date): Promise<string> {
  const { nesteNummer } = await import("./db.js");
  return nesteNummer("kjop");
}

// ── utløp ────────────────────────────────────────────────────────────────────
// Uten dette blir kvoter liggende reservert av kunder som aldri sender pakken.
export async function utløpGamleOrdrer(): Promise<number> {
  const r = await db().execute({
    sql: `UPDATE orders SET status = 'expired'
           WHERE status = 'pending' AND expires_at < ?`,
    args: [new Date().toISOString()],
  });
  return r.rowsAffected || 0;
}

export async function hentOrdre(orderNo: string) {
  const o = await db().execute({ sql: "SELECT * FROM orders WHERE order_no = ?", args: [orderNo] });
  if (!o.rows[0]) return null;
  const l = await db().execute({
    sql: `SELECT * FROM order_lines WHERE order_id = ? AND fjernet_at IS NULL
           ORDER BY ${SORTERING}`,
    args: [o.rows[0].id],
  });
  return { ...o.rows[0], linjer: l.rows };
}

// ── endring ved mottak ───────────────────────────────────────────────────────
// Du endrer tilstand på en linje, og prisen skal følge trappen for settet.
// Regnestykket må gjøres her og ikke i admin — klienten skal aldri kunne
// bestemme et beløp, heller ikke din egen.
export async function regnOmLinje(
  linjeId: number,
  endring: { condition?: Condition; qty?: number; qty_received?: number }
): Promise<{ unit_ore: number; condition: Condition }> {
  const s = await hentSettings();
  const r = await db().execute({ sql: "SELECT * FROM order_lines WHERE id = ?", args: [linjeId] });
  const linje: any = r.rows[0];
  if (!linje) throw new HttpFeil(404, "Fant ikke linjen");

  // En egendefinert linje har ingen tilstand og ingen utregnet pris. Antall
  // kan endres, resten står — beløpet er avtalt med kunden, ikke beregnet.
  if (String(linje.kilde) === "annet") {
    const felt: string[] = [];
    const args: any[] = [];
    for (const [navn, verdi] of [["qty", endring.qty], ["qty_received", endring.qty_received]] as const) {
      if (verdi !== undefined) {
        const n = Math.floor(Number(verdi));
        if (!Number.isFinite(n) || n < 0) throw new HttpFeil(400, `Ugyldig ${navn}`);
        felt.push(`${navn} = ?`);
        args.push(n);
      }
    }
    if (felt.length) {
      args.push(linjeId);
      await db().execute({ sql: `UPDATE order_lines SET ${felt.join(", ")} WHERE id = ?`, args });
    }
    return { unit_ore: Number(linje.unit_ore || 0), condition: String(linje.condition) as Condition };
  }

  const condition = (endring.condition || String(linje.condition)) as Condition;
  if (!CONDITIONS.includes(condition)) throw new HttpFeil(400, "Ukjent condition");

  const k = await db().execute({ sql: "SELECT * FROM cards WHERE id = ?", args: [String(linje.card_id)] });
  const kort: any = k.rows[0];
  // Kortet kan være borte etter en ny Scryfall-import. Da beholder vi prisen
  // linjen ble frosset med heller enn å nulle den ut.
  let unitØre = Number(linje.unit_ore || 0);
  if (kort) {
    const regel = await hentSetRule(String(kort.set_code), s);
    const manuell = await hentManuellPris(String(linje.card_id), String(linje.finish));
    const egne = await hentEgneConditionsFor(String(linje.card_id));
    const ny = prisØre(kort, String(linje.finish), condition, regel, s, manuell, egne);
    // Tar jeg ikke imot tilstanden fra dette settet, blir prisen 0. Det er et
    // gyldig utfall — linjen betales ikke — men den skal ikke stilltiende
    // beholde gammel pris.
    unitØre = ny;
  }

  const felt: string[] = ["condition = ?", "unit_ore = ?", "unit_nok = ?"];
  const args: any[] = [condition, unitØre, Math.round(unitØre / 100)];
  for (const [navn, verdi] of [["qty", endring.qty], ["qty_received", endring.qty_received]] as const) {
    if (verdi !== undefined) {
      const n = Math.floor(Number(verdi));
      if (!Number.isFinite(n) || n < 0) throw new HttpFeil(400, `Ugyldig ${navn}`);
      felt.push(`${navn} = ?`);
      args.push(n);
    }
  }
  args.push(linjeId);
  await db().execute({ sql: `UPDATE order_lines SET ${felt.join(", ")} WHERE id = ?`, args });
  return { unit_ore: unitØre, condition };
}

// Totalen regnes alltid på det som faktisk er mottatt når det tallet finnes.
// Salgsverdien av kjøpsordrer: hva kortene er verdt til dine egne salgspriser,
// i tilstanden de ble mottatt i. Fjernede linjer og «annet» (displayer o.l.
// uten kort) er ikke med.
export async function oppdaterSalgsverdi(orderIds: number[]): Promise<void> {
  const ider = [...new Set(orderIds.filter((x) => Number.isFinite(x)))];
  if (!ider.length) return;
  const { hentSalgsOppsett, salgsprisØre } = await import("./salgspris.js");
  const opp = await hentSalgsOppsett();
  const ph = ider.map(() => "?").join(",");
  const l = await db().execute({
    sql: `SELECT l.order_id, l.card_id, l.finish, l.condition, COALESCE(l.qty_received, l.qty) AS q,
                 c.usd, c.usd_foil, c.rarity
            FROM order_lines l JOIN cards c ON c.id = l.card_id
           WHERE l.order_id IN (${ph}) AND l.fjernet_at IS NULL AND COALESCE(l.kilde, '') <> 'annet'`,
    args: ider,
  });
  const kort = [...new Set((l.rows as any[]).map((x) => String(x.card_id)))];
  const salg = new Map<string, number>();
  const usd = new Map<string, number>();
  for (let i = 0; i < kort.length; i += 400) {
    const del = kort.slice(i, i + 400);
    const p2 = del.map(() => "?").join(",");
    const [a, b] = await Promise.all([
      db().execute({ sql: `SELECT card_id, finish, nm_ore FROM card_sale_prices WHERE card_id IN (${p2})`, args: del }),
      db().execute({ sql: `SELECT card_id, finish, usd FROM card_prices WHERE card_id IN (${p2})`, args: del }),
    ]);
    for (const x of a.rows as any[]) salg.set(`${x.card_id}:${x.finish}`, Number(x.nm_ore));
    for (const x of b.rows as any[]) usd.set(`${x.card_id}:${x.finish}`, Number(x.usd));
  }
  const sum = new Map<number, number>(ider.map((id) => [id, 0]));
  for (const x of l.rows as any[]) {
    const k = `${x.card_id}:${x.finish}`;
    const stk = salgsprisØre(x, String(x.finish), String(x.condition) as any, opp, salg.get(k) ?? null, usd.get(k) ?? null);
    sum.set(Number(x.order_id), (sum.get(Number(x.order_id)) || 0) + stk * Number(x.q || 0));
  }
  const setninger = [...sum.entries()].map(([id, ore]) => ({
    sql: "UPDATE orders SET salgsverdi_ore = ? WHERE id = ?",
    args: [ore, id],
  }));
  for (let i = 0; i < setninger.length; i += 200) await db().batch(setninger.slice(i, i + 200), "write");
}

export async function oppdaterTotal(orderId: number): Promise<number> {
  const r = await db().execute({
    sql: `SELECT COALESCE(SUM(unit_ore * COALESCE(qty_received, qty)), 0) AS n
            FROM order_lines WHERE order_id = ? AND fjernet_at IS NULL`,
    args: [orderId],
  });
  const ore = Number(r.rows[0]?.n || 0);
  await db().execute({
    sql: "UPDATE orders SET total_ore = ?, total_nok = ? WHERE id = ?",
    args: [ore, Math.round(ore / 100), orderId],
  });
  await oppdaterSalgsverdi([orderId]).catch((e) => console.error("Salgsverdien feilet:", e?.message));
  return ore;
}

// ── egendefinerte linjer ─────────────────────────────────────────────────────
// Noen kunder selger mer enn enkeltkort: et display, en eske bulk, en samling
// sleeves. Slike linjer har ingen card_id og ingen tilstand, og prisen er
// avtalt og ikke utregnet. De teller i totalen kunden får og i statistikken,
// men føres aldri på lager — du legger varen inn i butikken selv.
export async function leggTilAnnet(
  orderId: number,
  input: { tekst: string; qty: number; ore: number }
) {
  const tekst = String(input.tekst || "").trim();
  if (!tekst) throw new HttpFeil(400, "Skriv hva linjen gjelder");
  if (tekst.length > 120) throw new HttpFeil(400, "Teksten er for lang");

  const qty = Math.floor(Number(input.qty));
  if (!Number.isFinite(qty) || qty < 1) throw new HttpFeil(400, "Antall må være minst 1");

  const ore = Math.round(Number(input.ore));
  if (!Number.isFinite(ore) || ore < 0) throw new HttpFeil(400, "Ugyldig beløp");

  const o = await db().execute({ sql: "SELECT id FROM orders WHERE id = ?", args: [orderId] });
  if (!o.rows[0]) throw new HttpFeil(404, "Fant ikke ordren");

  // Tom card_id er det som gjør linjen usynlig for kvote og lager: alle de
  // spørringene slår opp mot ekte kort-ID-er.
  await db().execute({
    sql: `INSERT INTO order_lines
            (order_id, card_id, finish, condition, condition_start, qty, qty_received,
             unit_nok, unit_ore, unit_ore_start, card_name, set_code, set_name,
             collector_number, rarity, kilde)
          VALUES (?, '', '', '—', '—', ?, ?, ?, ?, ?, ?, '', 'Annet', NULL, NULL, 'annet')`,
    args: [orderId, qty, qty, Math.round(ore / 100), ore, ore, tekst],
  });
  return oppdaterTotal(orderId);
}

// ── linjer lagt til ved mottak ───────────────────────────────────────────────
// Kunden sендte et annet trykk enn hen trodde. Det er helt vanlig, og skal
// kunne rettes uten at ordren må gjøres om.
export async function leggTilLinje(
  orderId: number,
  input: { card_id: string; finish: string; condition: Condition; qty: number }
) {
  const s = await hentSettings();
  const k = await db().execute({ sql: "SELECT * FROM cards WHERE id = ?", args: [input.card_id] });
  const kort: any = k.rows[0];
  if (!kort) throw new HttpFeil(404, "Fant ikke kortet");
  if (!CONDITIONS.includes(input.condition)) throw new HttpFeil(400, "Ukjent condition");
  const qty = Math.floor(Number(input.qty));
  if (!Number.isFinite(qty) || qty < 1) throw new HttpFeil(400, "Antall må være minst 1");

  const regel = await hentSetRule(String(kort.set_code), s);
  const manuell = await hentManuellPris(input.card_id, input.finish);
  const egne = await hentEgneConditionsFor(input.card_id);
  // Kortet lå i pakken. Da prises det som om du ville kjøpt det.
  const { ore } = await prisVedMottak(kort, input.finish, input.condition, regel, s, manuell, egne);

  const sett = await db().execute({ sql: "SELECT COALESCE(visningsnavn, name) AS name FROM sets WHERE code = ?", args: [String(kort.set_code)] });
  await db().execute({
    sql: `INSERT INTO order_lines
            (order_id, card_id, finish, condition, condition_start, qty, qty_received,
             unit_nok, unit_ore, unit_ore_start, card_name, set_code, set_name,
             collector_number, rarity, kilde)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'admin')`,
    args: [
      orderId, input.card_id, input.finish, input.condition, input.condition,
      qty, qty, Math.round(ore / 100), ore, ore,
      String(kort.name), String(kort.set_code), String(sett.rows[0]?.name || kort.set_code),
      kort.collector_number ? String(kort.collector_number) : null,
      kort.rarity ? String(kort.rarity) : null,
    ],
  });
  return oppdaterTotal(orderId);
}

// Fjerning er en merking, ikke en sletting. Kunden skal kunne få vite at
// kortet ikke kom fram — og en slettet rad forklarer ingenting.
export async function fjernLinje(linjeId: number, angre = false): Promise<number> {
  const r = await db().execute({ sql: "SELECT order_id FROM order_lines WHERE id = ?", args: [linjeId] });
  if (!r.rows[0]) throw new HttpFeil(404, "Fant ikke linjen");
  await db().execute({
    sql: "UPDATE order_lines SET fjernet_at = ? WHERE id = ?",
    args: [angre ? null : new Date().toISOString(), linjeId],
  });
  return oppdaterTotal(Number(r.rows[0].order_id));
}

// ─────────────────────────────────────────────────────────────────────────────
// PRIS VED MOTTAK
// ─────────────────────────────────────────────────────────────────────────────
// Kjøpssiden sier hva du *ville* kjøpt. Ved mottak er kortet allerede kommet,
// og da skal det prises som om du ville kjøpt det — også om settet er avslått
// eller tilstanden ikke står på lista. Alternativet er null kroner for et kort
// du faktisk beholder, og det er ingen rimelig pris.
//
// Trappen og kjøpsandelen gjelder fortsatt. Det er bare portvokterne som
// settes til side.
async function prisVedMottak(
  kort: any,
  finish: string,
  condition: Condition,
  regel: any,
  s: any,
  manuell: number | null,
  egne: Condition[] | null
): Promise<{ ore: number; standard: boolean }> {
  const vanlig = prisØre(kort, finish, condition, regel, s, manuell, egne);
  if (vanlig > 0) return { ore: vanlig, standard: false };

  // Serienummererte kort holdes utenfor med vilje. De har ingen pålitelig
  // markedspris. Tokens prises som andre kort.
  if (Number(kort.er_serialized)) return { ore: 0, standard: false };

  const usd = manuell && manuell > 0 ? manuell : prisenFor(kort, finish);
  if (!usd || usd <= 0) return { ore: 0, standard: false };

  const ore = beregnØre(
    usd,
    condition,
    { ladder: { ...s.default_ladder, ...regel.ladder }, buy_pct: regel.buy_pct },
    s
  );
  return { ore, standard: ore > 0 };
}

// Kunden trodde det var Innistrad, men sendte Ultimate Masters. Da byttes
// kortet på linjen, ikke hele ordren — antall og tilstand står, og prisen
// regnes om etter det nye settet.
export async function byttKort(linjeId: number, cardId: string, finish?: string) {
  const s = await hentSettings();
  const l = await db().execute({ sql: "SELECT * FROM order_lines WHERE id = ?", args: [linjeId] });
  const linje: any = l.rows[0];
  if (!linje) throw new HttpFeil(404, "Fant ikke linjen");

  const k = await db().execute({
    sql: `SELECT c.*, COALESCE(s.visningsnavn, s.name) AS set_name FROM cards c
            LEFT JOIN sets s ON s.code = c.set_code WHERE c.id = ?`,
    args: [cardId],
  });
  const kort: any = k.rows[0];
  if (!kort) throw new HttpFeil(404, "Fant ikke kortet");

  const nyFinish = finish === "foil" ? "foil" : finish === "nonfoil" ? finish : String(linje.finish);
  const condition = String(linje.condition) as Condition;
  const regel = await hentSetRule(String(kort.set_code), s);
  const manuell = await hentManuellPris(cardId, nyFinish);
  const egne = await hentEgneConditionsFor(cardId);
  const { ore, standard } = await prisVedMottak(kort, nyFinish, condition, regel, s, manuell, egne);

  // Byttet gjennomføres uansett — kortet ligger fysisk i hånden din, og admin
  // skal kunne føre det som faktisk kom. Men tre ting bør sies høyt, for de
  // ville ellers gått stille forbi.
  const advarsler: string[] = [];
  if (standard) {
    advarsler.push(
      `${kort.set_name} er ikke på kjøpslista for ${condition}. Prisen er regnet etter standardtrappen.`
    );
  } else if (!regel.enabled) {
    advarsler.push(`${kort.set_name} er slått av på kjøpssiden. Prisen er regnet ut likevel.`);
  }
  if (ore === 0) {
    advarsler.push(`Prisen ble 0 kr — kortet har ingen markedspris. Sett en manuell pris.`);
  }
  {
    const brukt = await db().execute({
      sql: `SELECT COALESCE(SUM(COALESCE(l.qty_received, l.qty)), 0) AS n
              FROM order_lines l JOIN orders o ON o.id = l.order_id
             WHERE l.card_id = ? AND l.finish = ? AND l.fjernet_at IS NULL
               AND l.id <> ? AND o.status IN ('pending','received','stocked')`,
      args: [cardId, nyFinish, linjeId],
    });
    const kvote = nyFinish === "foil" ? regel.wanted_foil : regel.wanted_default;
    const etter = Number(brukt.rows[0]?.n || 0) + Number(linje.qty_received ?? linje.qty);
    if (kvote > 0 && etter > kvote) {
      advarsler.push(`Du har nå ${etter} av dette kortet i åpne ordrer, mot en kvote på ${kvote}.`);
    }
  }

  await db().execute({
    sql: `UPDATE order_lines
             SET card_id = ?, finish = ?, card_name = ?, set_code = ?, set_name = ?,
                 collector_number = ?, rarity = ?, unit_ore = ?, unit_nok = ?,
                 set_name_start = COALESCE(set_name_start, ?)
           WHERE id = ?`,
    args: [
      cardId, nyFinish, String(kort.name), String(kort.set_code), String(kort.set_name),
      kort.collector_number ? String(kort.collector_number) : null,
      kort.rarity ? String(kort.rarity) : null,
      ore, Math.round(ore / 100),
      String(linje.set_name),
      linjeId,
    ],
  });
  return { total: await oppdaterTotal(Number(linje.order_id)), advarsler };
}

// ── endringslogg ─────────────────────────────────────────────────────────────
// Utledet, ikke lagret. Alt som trengs ligger allerede frosset på linjene, og
// en egen loggtabell ville før eller siden kommet i utakt med virkeligheten.
export type Endring = { hva: string; tekst: string };

export async function endringslogg(orderId: number): Promise<Endring[]> {
  const r = await db().execute({
    sql: `SELECT * FROM order_lines WHERE order_id = ? ORDER BY ${SORTERING}`,
    args: [orderId],
  });
  const ut: Endring[] = [];
  for (const l of r.rows as any[]) {
    const navn = `${l.card_name} (${l.set_name}${l.finish === "foil" ? ", foil" : ""})`;
    if (l.fjernet_at) {
      ut.push({ hva: "fjernet", tekst: `${navn}: kom ikke fram, tatt ut av ordren` });
      continue;
    }
    if (String(l.kilde) === "admin") {
      ut.push({ hva: "lagt_til", tekst: `${navn}: lagt til ved mottak, ${l.qty} stk. i ${l.condition}` });
      continue;
    }
    if (l.set_name_start && l.set_name_start !== l.set_name) {
      ut.push({
        hva: "utgave",
        tekst: `${l.card_name}: oppgitt som ${l.set_name_start}, var ${l.set_name}`,
      });
    }
    if (l.condition_start && l.condition_start !== l.condition) {
      ut.push({ hva: "condition", tekst: `${navn}: oppgitt ${l.condition_start}, vurdert til ${l.condition}` });
    }
    const mottatt = l.qty_received === null || l.qty_received === undefined ? null : Number(l.qty_received);
    if (mottatt !== null && mottatt !== Number(l.qty)) {
      ut.push({ hva: "antall", tekst: `${navn}: oppgitt ${l.qty} stk., mottatt ${mottatt}` });
    }
  }
  return ut;
}

// ── rabattkode ───────────────────────────────────────────────────────────────
// Koden lages manuelt i Mystore som et fastbeløp. Her lagres den bare, slik at
// den kan sendes i mottakseposten og slås opp igjen senere.
export async function settRabattkode(orderId: number, kode: string | null, notat?: string | null) {
  const ren = (kode || "").trim() || null;
  await db().execute({
    sql: "UPDATE orders SET discount_code = ?, credit_note = ? WHERE id = ?",
    args: [ren, notat ?? null, orderId],
  });
}

export async function markerKredittSendt(orderId: number) {
  const r = await db().execute({ sql: "SELECT discount_code FROM orders WHERE id = ?", args: [orderId] });
  if (!r.rows[0]) throw new HttpFeil(404, "Fant ikke ordren");
  if (!r.rows[0].discount_code) throw new HttpFeil(400, "Legg inn rabattkoden før du sender den");
  await db().execute({
    sql: "UPDATE orders SET credit_sent_at = ? WHERE id = ?",
    args: [new Date().toISOString(), orderId],
  });
}

// ── oppgjør som kreditt ──────────────────────────────────────────────────────
// Etter overgangen fra Mystore: oppgjøret føres rett i kredittboka på
// e-postadressen på ordren, i stedet for en rabattkode laget i Mystore.
// Kunden trenger ikke konto — kreditten venter på adressen til hen logger
// inn eller lager konto med den. Kan kjøres flere ganger uten at kreditten
// føres to ganger.
export async function gjørOppSomKreditt(orderId: number, notat?: string | null) {
  const r = await db().execute({ sql: "SELECT * FROM orders WHERE id = ?", args: [orderId] });
  const o: any = r.rows[0];
  if (!o) throw new HttpFeil(404, "Fant ikke ordren");
  const email = String(o.email || "").trim().toLowerCase();
  if (!email.includes("@")) throw new HttpFeil(400, "Ordren har ingen e-postadresse å føre kreditten på.");
  const ore = Number(o.total_ore || 0);
  if (!(ore > 0)) throw new HttpFeil(400, "Ordren har ingen sum å gjøre opp.");
  const nå = new Date().toISOString();
  const tx = await db().transaction("write");
  try {
    const før = await tx.execute({
      sql: "SELECT 1 FROM kreditt_bevegelser WHERE order_no = ? AND grunn = 'kjopsordre' LIMIT 1",
      args: [o.order_no],
    });
    if (!før.rows.length) {
      await tx.execute({
        sql: `INSERT INTO kreditt_bevegelser (email, ore, grunn, notat, order_no, created_at)
              VALUES (?, ?, 'kjopsordre', ?, ?, ?)`,
        args: [email, ore, `Oppgjør for kjøpsordre ${o.order_no}`, o.order_no, nå],
      });
    }
    await tx.execute({
      sql: "UPDATE orders SET discount_code = NULL, credit_note = ?, credit_sent_at = COALESCE(credit_sent_at, ?) WHERE id = ?",
      args: [notat ?? null, nå, orderId],
    });
    await tx.commit();
  } catch (e) {
    await tx.rollback().catch(() => {});
    throw e;
  } finally {
    tx.close();
  }
}

export class HttpFeil extends Error {
  status: number;
  data: any;
  constructor(status: number, melding: string, data?: any) {
    super(melding);
    this.status = status;
    this.data = data;
  }
}
