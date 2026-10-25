import { harVipps } from "./vipps.js";
import { overgangsstatus, gjennomførOvergang } from "./overgang.js";
import { erAdmin } from "./auth.js";
import { lagerkilde, settBokSomLagerkilde } from "./lager.js";
import { leggTilØnske, fjernØnske, hentØnsker, varsleØnsker, ØnskeFeil } from "./onskeliste.js";
import { bulkSøk } from "./bulksok.js";
import { sjekkKode, KodeFeil, alleKoder, opprettKode, importerKoder, justerSaldo, endreKode, bevegelser as kodeBevegelser, lagKode } from "./rabattkoder.js";
import { randomBytes } from "node:crypto";
import "dotenv/config";
import express from "express";
import cookieParser from "cookie-parser";
import { db, migrate, hentSettings, settSetting, normaliser, CONDITIONS, type Settings } from "./db.js";
import { søk, løsBulk, tilbudFor } from "./catalog.js";
import { sendBekreftelse, varsleMeg, varsleStatus, sendOppgjør, sendKontakt } from "./epost.js";
import { bokførOrdre, reverserOrdre, beholdning, historikk, settBeholdning, avvikMotMystore } from "./lager.js";
import {
  hentIntervaller, lagreIntervaller, finnHull, salgsprisForSett, settManuellSalg,
  butikkvisning, kortdetaljer,
} from "./salgspris.js";
import { hentFrakt, leggTilFrakt, endreFrakt, slåAvFrakt } from "./frakt.js";
import {
  hentProdukter, hentProdukt, leggTilProdukt, endreProdukt, slåAvProdukt,
  antallPerType, erType,
} from "./produkter.js";
import { settinfo } from "./settinfo.js";
import { HOLDER_KVOTE, frigiKvote } from "./quota.js";
import { forsideSett } from "./forside.js";
import { aktivtBanner, lagreBilde, hentBilde } from "./toppbanner.js";
import { kontoer, bevegelser, saldo, leggTil as leggTilKreditt, settSaldo } from "./kreditt.js";
import { parseBulk, MAX_LINJER } from "./bulk.js";
import {
  lagOrdre, hentOrdre, utløpGamleOrdrer, regnOmLinje, oppdaterTotal,
  leggTilLinje,
  leggTilAnnet, fjernLinje, byttKort, endringslogg, instruksjoner, SORTERING,
  settRabattkode, markerKredittSendt, gjørOppSomKreditt, HttpFeil,
} from "./orders.js";
import { hentSetRule } from "./pricing.js";
import { importerScryfall } from "./import-scryfall.js";
import { synkMystore, gjettKategorier, harMystore } from "./mystore.js";
import {
  krevAdmin, sjekkPassord, settCookie, fjernCookie,
  totpStatus, startTotp, bekreftTotp, slåAvTotp, sjekkAndreTrinn,
} from "./auth.js";
import { byggIndeks, foreslå } from "./settnavn.js";
import { grense, REGLER } from "./ratelimit.js";
import { ordreStatistikk, lagerrapport, lagerhistorikk, lagreLagermåling } from "./statistikk.js";
import { salgsrapport, salgslistePdf, oppsummeringPdf, sjekkPeriode } from "./rapporter.js";
import {
  COOKIE as KUNDE_COOKIE, KontoFeil, registrer, loggInn, nySesjon, avsluttSesjon, settKundeCookie,
  fjernKundeCookie, kundeValgfri, krevKunde, oppdaterProfil, byttPassord, lagTilbakestilling,
  brukTilbakestilling, harGoogle, googleUrl, googleKunde, lagBekreftelse, bekreftEpost, importerMystoreKunder, kundeoversikt,
} from "./kunder.js";
import {
  SalgFeil, prisKurv, åpneKasse, avbrytKasse, stripeHendelse, hentOrdre as hentSalgsordre, lagerForPlukk, offentlig, kundensOrdrer,
  tilhørerKunde, riktigMerke, tilgjengeligKreditt, adminOrdrer, settStatus, kanseller,
  salgsstatistikk, utløpGamle, harStripe, oppdaterVippsOrdre, butikkUrl, RESERVASJON_MIN,
} from "./salg.js";
import { bevegelser as kredittBevegelser } from "./kreditt.js";
import { sendTilbakestilling, sendBekreftEpost } from "./epost.js";
import { kuppliste, vaktelisteSammendrag, settKuppOppsett, kjørKuppjakt, egenliste, settRettet } from "./kupp.js";

const app = express();
// Render setter X-Forwarded-For. Uten dette ser alle brukere ut som én
// adresse, og rate limiting ville rammet alle samtidig.
app.set("trust proxy", 1);
// Stripe signerer den rå kroppen. Webhooken må derfor få den før
// JSON-tolkingen under gjør den om til et objekt.
app.post("/api/stripe/webhook", express.raw({ type: "application/json", limit: "1mb" }), async (req: any, res: any) => {
  try {
    await stripeHendelse(req.body, String(req.headers["stripe-signature"] || ""));
    res.json({ ok: true });
  } catch (e: any) {
    const status = e instanceof SalgFeil ? e.status : 500;
    if (status >= 500) console.error("Stripe-webhook feilet:", e);
    // 4xx for ugyldig signatur; 5xx får Stripe til å prøve igjen senere.
    res.status(status).json({ feil: e?.message || "feil" });
  }
});
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

// Frontend ligger på eget subdomene, så CORS må være eksplisitt.
// SHOP_URL er alltid med, så butikken på korthaien.no ikke trenger å legges
// inn to steder.
const TILLATT = [
  ...(process.env.CORS_ORIGIN || "http://localhost:5173").split(",").map((s) => s.trim()),
  ...(() => { try { return process.env.SHOP_URL ? [new URL(process.env.SHOP_URL).origin] : []; } catch { return []; } })(),
  ...(process.env.BUTIKK_ORIGIN || "").split(",").map((s) => s.trim()).filter(Boolean),
];
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && TILLATT.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  }
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

const fang = (fn: any) => (req: any, res: any, next: any) => Promise.resolve(fn(req, res, next)).catch(next);

// ── publikum ─────────────────────────────────────────────────────────────────
app.get("/api/health", fang(async (_req: any, res: any) => {
  const k = await db().execute("SELECT COUNT(*) AS n FROM cards");
  res.json({ ok: true, kort: Number(k.rows[0]?.n || 0), mystore: harMystore() });
}));

// Kundesiden trenger adressen, minstesummen og fristen. Alt annet i settings
// er internt og deles ikke.
app.get("/api/config", grense(REGLER.søk), fang(async (_req: any, res: any) => {
  const s = await hentSettings();
  res.json({
    min_order_ore: s.min_order_ore,
    order_expiry_days: s.order_expiry_days,
    ship_to: s.ship_to,
    oppgjor: "butikkreditt",
    // Butikkens utseende. Står her slik at den dagen butikken flyttes ut av
    // admin, henter den temaet fra en rute den allerede har lov til å lese.
    tema: s.tema,
    // Foretaket. Offentlige opplysninger, og returssiden trenger dem.
    firmanavn: s.firmanavn,
    org_nr: s.org_nr,
    retur_frakt: s.retur_frakt,
    tix_kreditt_ore: s.tix_kreditt_ore,
  });
}));

// Kontaktskjemaet. Aapen rute, saa den har samme grense som ordreinnsending:
// en som vil fylle innboksen min skal ikke kunne gjoere det raskere enn en
// som vil selge meg kort.
app.post("/api/kontakt", grense(REGLER.ordre), fang(async (req: any, res: any) => {
  const navn = String(req.body?.navn || "").trim();
  const epost = String(req.body?.epost || "").trim();
  const melding = String(req.body?.melding || "").trim();
  const emne = String(req.body?.emne || "").trim();

  if (!navn || !epost.includes("@") || melding.length < 5) {
    throw new HttpFeil(400, "Fyll inn navn, e-post og en melding.");
  }
  // Lange meldinger er nesten alltid noen andre enn en kunde.
  if (melding.length > 4000) throw new HttpFeil(400, "Meldingen er for lang.");

  const utfall = await sendKontakt({ navn, epost, melding, emne });
  if (!utfall.sendt) throw new HttpFeil(502, "Fikk ikke sendt meldingen. Prøv igjen, eller send e-post direkte.");
  res.json({ ok: true });
}));

app.get("/api/sets", grense(REGLER.søk), fang(async (_req: any, res: any) => {
  // Bare sett jeg faktisk kjøper fra vises i filteret.
  const r = await db().execute(`
    SELECT s.code, COALESCE(s.visningsnavn, s.name) AS name, s.released_at,
           r.wanted_default, r.conditions
      FROM set_rules r JOIN sets s ON s.code = r.set_code
     WHERE r.enabled = 1 ORDER BY name COLLATE NOCASE`);
  res.json(r.rows);
}));

app.get("/api/search", grense(REGLER.søk), fang(async (req: any, res: any) => {
  const q = String(req.query.q || "").trim();
  const set = String(req.query.set || "").trim();
  if (!q && !set) return res.json([]);
  if (q && q.length < 2) return res.json([]);
  res.json(await søk({ q, set, rarity: String(req.query.rarity || "") }));
}));

app.post("/api/bulk", grense(REGLER.bulk), fang(async (req: any, res: any) => {
  const tekst = String(req.body?.tekst || "");
  if (!tekst.trim()) throw new HttpFeil(400, "Tom liste");
  const linjer = parseBulk(tekst);
  const antallLinjer = tekst.split(/\r?\n/).filter((l) => l.trim()).length;
  res.json({
    maks: MAX_LINJER,
    kuttet: antallLinjer > MAX_LINJER ? antallLinjer - MAX_LINJER : 0,
    resultat: await løsBulk(linjer),
  });
}));

// Kurven gjenopprettes herfra. Kunden sender kort-ID-ene den husker, og får
// dagens priser og kvoter tilbake — aldri motsatt vei.
app.post("/api/quote", grense(REGLER.pris), fang(async (req: any, res: any) => {
  const linjer = Array.isArray(req.body?.linjer) ? req.body.linjer : [];
  res.json(await tilbudFor(linjer));
}));

// Sendingen ventes ikke på. At ordren er lagret er det som betyr noe — en
// treg e-posttjeneste skal ikke gjøre at kunden tror innsendingen feilet.
function iBakgrunnen(navn: string, p: Promise<{ sendt: boolean; grunn?: string }>) {
  p.then((r) => {
    if (!r.sendt) console.error(`E-post «${navn}» ble ikke sendt: ${r.grunn}`);
  }).catch((e) => console.error(`E-post «${navn}» kastet:`, e?.message));
}

app.post("/api/orders", grense(REGLER.ordre), fang(async (req: any, res: any) => {
  await utløpGamleOrdrer();
  const ordre = await lagOrdre({
    customer_name: req.body?.customer_name,
    email: req.body?.email,
    phone: req.body?.phone,
    note: req.body?.note,
    vilkar_godtatt: req.body?.vilkar_godtatt === true,
    linjer: req.body?.linjer || [],
  });

  const medKunde = { ...ordre, email: req.body?.email, customer_name: req.body?.customer_name,
                     phone: req.body?.phone, note: req.body?.note };
  iBakgrunnen("bekreftelse", sendBekreftelse(medKunde));
  iBakgrunnen("varsel", varsleMeg(medKunde));

  res.status(201).json(ordre);
}));

// Kunden kan skrive «k-34» eller «K34»; det er K-00034. Gamle numre
// (KH-ÅÅMMDD-NNNN) slås opp som de er, bare med store bokstaver.
function normaliserKjøpsnummer(inn: string): string {
  const t = String(inn || "").trim().toUpperCase();
  const m = /^K-?\s*0*(\d{1,7})$/.exec(t);
  return m ? `K-${m[1].padStart(5, "0")}` : t;
}

app.get("/api/orders/:orderNo", grense(REGLER.søk), fang(async (req: any, res: any) => {
  const o = await hentOrdre(normaliserKjøpsnummer(String(req.params.orderNo)));
  if (!o) throw new HttpFeil(404, "Fant ikke ordren");
  // Ordrenummeret alene er ikke hemmelig nok — det er kort og datobasert, og
  // uten innlogging er e-posten det eneste vi kan sjekke mot.
  const oppgitt = String(req.query.epost || "").trim().toLowerCase();
  if (!oppgitt || oppgitt !== String((o as any).email || "").toLowerCase()) {
    throw new HttpFeil(404, "Fant ikke ordren");
  }
  // Publikumsvisningen viser kvittering, ikke kundedata utover navnet.
  //
  // Rabattkoden holdes utenfor med vilje. Ordrenummeret er fire siffer per
  // dato, og en e-postadresse er ingen hemmelighet — til sammen er det ikke
  // sterkt nok til å beskytte et beløp. Koden sendes bare på e-post, til
  // adressen kunden selv oppga. Her sier vi bare at den er sendt.
  const { email, phone, admin_note, credit_note, discount_code, ...trygt } = o as any;
  res.json({ ...trygt, credit_sent: !!(o as any).credit_sent_at });
}));

// ── admin ────────────────────────────────────────────────────────────────────
// Innloggingen begrenses hardere enn resten. Ett passord uten brukernavn er
// en fristende ting å gjette på.
app.post("/api/admin/login", grense(REGLER.innlogging), fang(async (req: any, res: any) => {
  if (!sjekkPassord(req.body?.password)) {
    return res.status(401).json({ feil: "Feil passord" });
  }
  const status = await totpStatus();
  if (status.påslått) {
    const kode = String(req.body?.kode || "").trim();
    // Riktig passord uten kode er ikke en feil — det er halve innloggingen.
    // Klienten trenger å vite forskjellen for å be om koden.
    if (!kode) return res.status(401).json({ feil: "Engangskode mangler", trengerKode: true });
    if (!(await sjekkAndreTrinn(kode))) {
      return res.status(401).json({ feil: "Engangskoden stemmer ikke", trengerKode: true });
    }
  }
  settCookie(res);
  res.json({ ok: true });
}));

// ── engangskode ──────────────────────────────────────────────────────────────
// Alle oppsettsrutene krever at du allerede er logget inn. Uten det kunne
// hvem som helst slått av totrinns for deg.
app.get("/api/admin/totp", krevAdmin, fang(async (_req: any, res: any) => {
  res.json(await totpStatus());
}));

app.post("/api/admin/totp/start", krevAdmin, fang(async (_req: any, res: any) => {
  res.json(await startTotp());
}));

app.post("/api/admin/totp/bekreft", krevAdmin, fang(async (req: any, res: any) => {
  try {
    // Reservekodene vises her og aldri igjen — bare hashene lagres.
    res.json({ ok: true, reservekoder: await bekreftTotp(String(req.body?.kode || "")) });
  } catch (e: any) {
    throw new HttpFeil(400, e?.message || "Klarte ikke slå på engangskode");
  }
}));

app.delete("/api/admin/totp", krevAdmin, fang(async (req: any, res: any) => {
  // Å slå av krever passordet på nytt. Et åpent admin-vindu skal ikke holde
  // for å fjerne andre trinn.
  if (!sjekkPassord(req.body?.password)) throw new HttpFeil(401, "Feil passord");
  await slåAvTotp();
  res.json({ ok: true });
}));

app.post("/api/admin/logout", (_req, res) => {
  fjernCookie(res);
  res.json({ ok: true });
});

app.get("/api/admin/me", krevAdmin, (_req, res) => res.json({ ok: true }));

// Kortene settes i hylla. Én handling, to virkninger — og de to hoerer
// sammen, for det er samme hendelse:
//
//   1. Kortene foeres inn i varebeholdningen, med antallet og tilstanden du
//      satte ved kontroll.
//   2. Kvoten slippes, fordi beholdningen fra naa teller dem. Gjorde den
//      ikke det, ville de samme kortene telt to ganger.
//
// Tidspunktet er ditt. Det kan vaere samme dag som oppgjoeret, det kan vaere
// fire maaneder senere. Ordren ligger og venter til du rekker det, og helt
// til da holder den kvoten sin.
app.post("/api/admin/orders/:id/frigi", krevAdmin, fang(async (req: any, res: any) => {
  const id = Number(req.params.id);
  const f = await db().execute({ sql: "SELECT id FROM orders WHERE id = ?", args: [id] });
  if (!f.rows.length) throw new HttpFeil(404, "Fant ikke ordren.");
  // Bokfoeringen foerst. Feiler den, skal kvoten ikke slippes — da ville
  // kortene vaert borte fra begge sider av regnestykket.
  const lager = await bokførOrdre(id);
  res.json({ kvote_frigitt_at: await frigiKvote(id), lager });
}));

app.get("/api/admin/orders", krevAdmin, fang(async (req: any, res: any) => {
  await utløpGamleOrdrer();
  const arkiv = String(req.query.arkiv || "") === "1";
  // Skillet gaar paa kvoten, ikke paa statusen. En ordre som er gjort opp
  // men ikke frigitt holder fortsatt kortene dine reservert, og da er den
  // fortsatt din — knappen som frigir dem maa vaere til aa finne uten aa
  // lete i arkivet.
  const r = await db().execute(
    arkiv
      ? `SELECT * FROM orders
          WHERE status IN ('cancelled','expired')
             OR (status = 'stocked' AND kvote_frigitt_at IS NOT NULL)
          ORDER BY created_at DESC LIMIT 300`
      : `SELECT * FROM orders
          WHERE status IN ('pending','received')
             OR (status = 'stocked' AND kvote_frigitt_at IS NULL)
          ORDER BY created_at DESC LIMIT 300`
  );
  const ider = r.rows.map((o: any) => o.id);
  let linjer: any[] = [];
  if (ider.length) {
    const l = await db().execute({
      // Fjernede linjer blir med hit — admin må kunne se og angre dem.
      // Kundens visning filtrerer dem bort i hentOrdre.
      sql: `SELECT * FROM order_lines WHERE order_id IN (${ider.map(() => "?").join(",")})
            ORDER BY fjernet_at IS NOT NULL, ${SORTERING}`,
      args: ider,
    });
    linjer = l.rows;
  }
  res.json(
    r.rows.map((o: any) => ({ ...o, linjer: linjer.filter((l) => l.order_id === o.id) }))
  );
}));

app.patch("/api/admin/orders/:id", krevAdmin, fang(async (req: any, res: any) => {
  const id = Number(req.params.id);
  const { status, admin_note } = req.body || {};
  if (status && !["pending", "received", "stocked", "cancelled", "expired"].includes(status)) {
    throw new HttpFeil(400, "Ukjent status");
  }
  if (status) {
    const før = await db().execute({ sql: "SELECT status FROM orders WHERE id = ?", args: [id] });
    // Går ordren ut av «gjort opp», skal kortene ut av lageret igjen. Ellers
    // står det kort der som aldri kom inn, og den feilen er vanskelig å finne
    // et halvår senere.
    if (String(før.rows[0]?.status) === "stocked" && status !== "stocked") {
      await reverserOrdre(id);
    }
    await db().execute({
      sql: "UPDATE orders SET status = ?, received_at = ? WHERE id = ?",
      args: [status, ["received", "stocked"].includes(status) ? new Date().toISOString() : null, id],
    });
    // Kunden varsles som standard. «varsle: false» er for endringer hen ikke
    // trenger å vite om — en status du rettet fordi du klikket feil.
    // «stocked» varsles ikke herfra: den e-posten er oppgjøret, med koden.
    if (req.body?.varsle !== false && status !== "stocked") {
      iBakgrunnen(`status ${status}`, varsleStatus(id, status));
    }
  }
  if (admin_note !== undefined) {
    await db().execute({ sql: "UPDATE orders SET admin_note = ? WHERE id = ?", args: [admin_note, id] });
  }
  await oppdaterTotal(id);
  res.json({ ok: true });
}));

// Justering av linjer ved mottak. Endrer du tilstand, følger prisen trappen
// for settet automatisk — du skal ikke måtte regne prosenter i hodet.
app.patch("/api/admin/lines/:id", krevAdmin, fang(async (req: any, res: any) => {
  const id = Number(req.params.id);
  const { qty, qty_received, condition } = req.body || {};
  if (condition === undefined && qty === undefined && qty_received === undefined && !req.body?.card_id) {
    throw new HttpFeil(400, "Ingenting å endre");
  }
  if (req.body?.card_id) {
    // Bytte av trykk: antall og tilstand står, prisen regnes om etter settet.
    const ut = await byttKort(id, String(req.body.card_id), req.body?.finish);
    return res.json({ ok: true, total_ore: ut.total, advarsler: ut.advarsler });
  }
  const ut = await regnOmLinje(id, { condition, qty, qty_received });
  const l = await db().execute({ sql: "SELECT order_id FROM order_lines WHERE id = ?", args: [id] });
  const total = l.rows[0] ? await oppdaterTotal(Number(l.rows[0].order_id)) : 0;
  res.json({ ok: true, ...ut, total_ore: total });
}));

// Fjerning merker linjen i stedet for å slette den, slik at endringsloggen
// fortsatt kan fortelle kunden at kortet ikke kom fram.
app.delete("/api/admin/lines/:id", krevAdmin, fang(async (req: any, res: any) => {
  const total = await fjernLinje(Number(req.params.id), String(req.query.angre || "") === "1");
  res.json({ ok: true, total_ore: total });
}));

// Kunden sendte et annet trykk enn hen trodde — legg til riktig linje her.
app.post("/api/admin/orders/:id/lines", krevAdmin, fang(async (req: any, res: any) => {
  const { card_id, finish, condition, qty } = req.body || {};
  const total = await leggTilLinje(Number(req.params.id), {
    card_id: String(card_id || ""),
    finish: finish === "foil" ? "foil" : "nonfoil",
    condition,
    qty: Number(qty || 1),
  });
  res.json({ ok: true, total_ore: total });
}));

// Egendefinert linje: display, bulkeske, eller annet som ikke er et kort.
app.post("/api/admin/orders/:id/annet", krevAdmin, fang(async (req: any, res: any) => {
  const { tekst, qty, ore } = req.body || {};
  const total = await leggTilAnnet(Number(req.params.id), {
    tekst: String(tekst || ""),
    qty: Number(qty || 1),
    ore: Number(ore || 0),
  });
  res.json({ ok: true, total_ore: total });
}));

// Sender en av e-postene til deg selv, med ekte innhold fra en ordre. Bedre
// enn å oppdage at oppsettet er feil på den første kunden.
app.post("/api/admin/orders/:id/testepost", krevAdmin, fang(async (req: any, res: any) => {
  const id = Number(req.params.id);
  const hvilken = String(req.body?.hvilken || "bekreftelse");
  const o = await db().execute({ sql: "SELECT * FROM orders WHERE id = ?", args: [id] });
  if (!o.rows[0]) throw new HttpFeil(404, "Fant ikke ordren");

  // Kundens adresse byttes ut med din, så en test aldri når en kunde.
  const min = process.env.EPOST_TIL_MEG || "korthaien@gmail.com";
  await db().execute({ sql: "UPDATE orders SET email = ? WHERE id = ?", args: [min, id] });
  try {
    let r;
    if (hvilken === "oppgjor") r = await sendOppgjør(id);
    else if (hvilken === "mottatt") r = await varsleStatus(id, "received");
    else {
      const full = await hentOrdre(String(o.rows[0].order_no));
      const s = await hentSettings();
      r = await sendBekreftelse({
        ...full,
        email: min,
        instruksjoner: instruksjoner(
          String(o.rows[0].order_no),
          s.ship_to,
          new Date(String(o.rows[0].expires_at))
        ),
      });
    }
    res.json(r);
  } finally {
    // Adressen settes alltid tilbake, også hvis sendingen feilet.
    await db().execute({
      sql: "UPDATE orders SET email = ? WHERE id = ?",
      args: [String(o.rows[0].email), id],
    });
  }
}));

// ── salgspriser ──────────────────────────────────────────────────────────────
app.get("/api/admin/salgspriser", krevAdmin, fang(async (_req: any, res: any) => {
  const intervaller = await hentIntervaller();
  res.json({ intervaller, advarsler: finnHull(intervaller) });
}));

app.put("/api/admin/salgspriser", krevAdmin, fang(async (req: any, res: any) => {
  const rader = Array.isArray(req.body?.intervaller) ? req.body.intervaller : [];
  // Overlapp og hull sier vi fra om, men vi nekter ikke — noen ganger er et
  // hull med vilje, og da skal ikke systemet krangle.
  const advarsler = finnHull(rader);
  const antall = await lagreIntervaller(rader);
  res.json({ ok: true, antall, advarsler });
}));

app.get("/api/admin/salgspriser/:sett", krevAdmin, fang(async (req: any, res: any) => {
  res.json(await salgsprisForSett(String(req.params.sett)));
}));

// Forhåndsvisning av butikken, inne i admin. Flyttes ut når salgssiden
// bygges — inntil da er dette stedet å se om prisene stemmer.
app.get("/api/admin/butikk", krevAdmin, fang(async (req: any, res: any) => {
  // Settet er valgfritt: uten det søker vi på tvers av alle sett.
  const sett = String(req.query.sett || "").toLowerCase();
  const tall = (v: any) => (v === undefined || v === "" ? undefined : Number(v));
  res.json(
    await butikkvisning({
      sett,
      q: req.query.q ? String(req.query.q) : undefined,
      tekst: req.query.tekst ? String(req.query.tekst) : undefined,
      rarity: req.query.rarity ? String(req.query.rarity) : undefined,
      farge: req.query.farge ? String(req.query.farge) : undefined,
      fargeEksakt: String(req.query.fargeEksakt || "") === "1",
      type: req.query.type ? String(req.query.type) : undefined,
      baresalg: String(req.query.baresalg || "") === "1",
      prisFra: tall(req.query.prisFra),
      prisTil: tall(req.query.prisTil),
      finish: req.query.finish ? String(req.query.finish) : undefined,
      sortering: req.query.sortering ? String(req.query.sortering) : undefined,
      side: tall(req.query.side),
      perSide: tall(req.query.perSide),
    })
  );
}));

// ── toppbildet og opplastede bilder ──────────────────────────────────────────
app.get("/api/butikk/toppbanner", grense(REGLER.søk), fang(async (_req: any, res: any) => {
  res.json({ banner: await aktivtBanner() });
}));

// Et bilde endres aldri — et nytt bilde får ny id — så det kan mellomlagres
// for alltid.
app.get("/api/bilder/:id", fang(async (req: any, res: any) => {
  const b = await hentBilde(Number(req.params.id));
  if (!b) throw new HttpFeil(404, "Fant ikke bildet");
  res.setHeader("Content-Type", b.mime);
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.send(b.data);
}));

app.post(
  "/api/admin/bilder",
  krevAdmin,
  express.raw({ type: ["image/jpeg", "image/png", "image/webp"], limit: "8mb" }),
  fang(async (req: any, res: any) => {
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw new HttpFeil(400, "Fant ikke noe bilde i forespørselen.");
    try {
      res.json(await lagreBilde(req.body));
    } catch (e: any) {
      throw new HttpFeil(400, e.message);
    }
  })
);

// Hent et bilde fra en lenke og lagre en kopi hos oss. En lenke til en annen
// side er lånt: fjerner de bildet eller flytter det, står produktet uten.
app.post("/api/admin/bilder/fra-lenke", krevAdmin, fang(async (req: any, res: any) => {
  const url = String(req.body?.url || "").trim();
  if (!/^https?:\/\//i.test(url)) throw new HttpFeil(400, "Lenken må begynne med https://.");
  let svar: Response;
  try {
    svar = await fetch(url, { signal: AbortSignal.timeout(15_000), headers: { "User-Agent": "Korthaien/1.0" } });
  } catch {
    throw new HttpFeil(400, "Fikk ikke hentet bildet fra lenken.");
  }
  if (!svar.ok) throw new HttpFeil(400, `Siden svarte ${svar.status}. Er lenken til selve bildet?`);
  const lengde = Number(svar.headers.get("content-length") || 0);
  if (lengde > 8 * 1024 * 1024) throw new HttpFeil(400, "Bildet er større enn 8 MB.");
  const data = Buffer.from(await svar.arrayBuffer());
  if (data.length > 8 * 1024 * 1024) throw new HttpFeil(400, "Bildet er større enn 8 MB.");
  try {
    res.json(await lagreBilde(data));
  } catch {
    throw new HttpFeil(400, "Lenken peker ikke på et bilde (JPEG, PNG eller WebP). Høyreklikk på bildet og velg «Kopier bildeadresse».");
  }
}));

// Raden med nyeste sett paa forsiden. Oppdaterer seg selv fra lageret med
// mindre forside_sett er satt i innstillingene.
app.get("/api/admin/butikk/nyeste", krevAdmin, fang(async (req: any, res: any) => {
  res.json({ sett: await forsideSett(Number(req.query.antall) || 5) });
}));

app.get("/api/admin/butikk/kort/:id", krevAdmin, fang(async (req: any, res: any) => {
  const d = await kortdetaljer(String(req.params.id));
  if (!d) throw new HttpFeil(404, "Fant ikke kortet");
  res.json(d);
}));

app.put("/api/admin/salgspris/:cardId", krevAdmin, fang(async (req: any, res: any) => {
  const finish = req.body?.finish === "foil" ? "foil" : "nonfoil";
  const ore = req.body?.nm_ore === null || req.body?.nm_ore === "" ? null : Number(req.body?.nm_ore);
  if (ore !== null && (!Number.isFinite(ore) || ore < 0)) throw new HttpFeil(400, "Ugyldig beløp");
  await settManuellSalg(String(req.params.cardId), finish, ore);
  res.json({ ok: true, nm_ore: ore });
}));

// ── varelager ────────────────────────────────────────────────────────────────
// Beholdningen for ett sett, med alle tilstander og begge finisher per kort.
app.get("/api/admin/statistikk", krevAdmin, fang(async (_req: any, res: any) => {
  res.json(await ordreStatistikk());
}));

app.put("/api/admin/sets/:kode/grunnsett", krevAdmin, fang(async (req: any, res: any) => {
  const kode = String(req.params.kode || "").toLowerCase();
  const rå = req.body?.grunnsett_til;
  const til = rå === null || rå === undefined || rå === "" ? null : Math.trunc(Number(rå));
  if (til !== null && (!Number.isFinite(til) || til < 0 || til > 2000)) {
    return res.status(400).json({ feil: "Ugyldig samlernummer" });
  }
  // Settet har ikke nødvendigvis en regel fra før — du kan vurdere å kjøpe
  // et sett du ikke kjøper enkeltkort fra.
  await db().execute({
    sql: `INSERT INTO set_rules (set_code, grunnsett_til, updated_at)
               VALUES (?, ?, ?)
          ON CONFLICT(set_code) DO UPDATE SET grunnsett_til = excluded.grunnsett_til,
                                              updated_at = excluded.updated_at`,
    args: [kode, til, new Date().toISOString()],
  });
  res.json({ ok: true, set_code: kode, grunnsett_til: til });
}));

app.get("/api/admin/kupp", krevAdmin, fang(async (req: any, res: any) => {
  res.json(
    await kuppliste({
      visBorte: String(req.query.visBorte || "") === "1",
      minAvvik: Number(req.query.minAvvik || 0),
    })
  );
}));

app.post("/api/admin/kupp/rettet", krevAdmin, fang(async (req: any, res: any) => {
  const b = req.body || {};
  if (!b.card_id || !b.finish) throw new HttpFeil(400, "card_id og finish må være med");
  await settRettet(String(b.card_id), String(b.finish), Number(b.pris_ore || 0), !!b.på);
  res.json({ ok: true });
}));

app.get("/api/admin/kupp/egne", krevAdmin, fang(async (req: any, res: any) => {
  // Nye klienter filtrerer selv og sender ingenting hit. Gamle sender
  // parameterne, og da gjør serveren jobben — slik at de to aldri kan være
  // i utakt og begge tro at den andre filtrerer.
  res.json(
    await egenliste({
      retning: req.query.retning ? String(req.query.retning) : undefined,
      minKr: req.query.minKr !== undefined ? Number(req.query.minKr) : undefined,
      visFerdige:
        req.query.visFerdige !== undefined
          ? String(req.query.visFerdige) === "1"
          : undefined,
    })
  );
}));

app.get("/api/admin/kupp/vakteliste", krevAdmin, fang(async (_req: any, res: any) => {
  res.json(await vaktelisteSammendrag());
}));

app.post("/api/admin/kupp/oppsett", krevAdmin, fang(async (req: any, res: any) => {
  res.json(await settKuppOppsett(req.body || {}));
}));

app.get("/api/admin/lagerhistorikk", krevAdmin, fang(async (_req: any, res: any) => {
  res.json(await lagerhistorikk());
}));

app.get("/api/admin/lagerrapport", krevAdmin, fang(async (_req: any, res: any) => {
  res.json(await lagerrapport());
}));

// ── kundekonto ───────────────────────────────────────────────────────────────
// Kunden logges inn med en egen cookie, adskilt fra admin. Butikken bor
// foreløpig i admin, men rutene er offentlige, så siden kan flyttes til
// korthaien.no uten at noe her endres.
app.get("/api/konto/meg", kundeValgfri, fang(async (req: any, res: any) => {
  res.json({
    kunde: req.kunde || null,
    google: harGoogle(),
    // Kreditten vises først når adressen er bekreftet. Ellers kunne hvem som
    // helst registrere en annens adresse og se saldoen.
    kreditt_ore: req.kunde?.bekreftet ? await tilgjengeligKreditt(req.kunde.email) : 0,
  });
}));

app.post("/api/konto/registrer", grense(REGLER.konto), fang(async (req: any, res: any) => {
  let k;
  try {
    k = await registrer({ email: req.body?.email, passord: req.body?.passord, navn: req.body?.navn });
  } catch (e: any) {
    // Kunde fra før (Mystore-importen) uten passord: send lenken for å velge
    // passord. Den beviser at hen eier adressen, så kreditt og historikk
    // følger med.
    if (e?.message === "uten_passord") {
      const t = await lagTilbakestilling(req.body?.email);
      if (t) await sendTilbakestilling(t.email, `${butikkUrl()}/?nyttpassord=${encodeURIComponent(t.token)}`);
      throw new HttpFeil(409, "Du er allerede kunde hos Korthaien. Vi har sendt deg en e-post med en lenke der du velger passord.");
    }
    throw e;
  }
  const token = await lagBekreftelse(k.id);
  await sendBekreftEpost(k.email, `${butikkUrl()}/?bekreft=${encodeURIComponent(token)}`);
  settKundeCookie(res, await nySesjon(k.id));
  res.json({ kunde: k });
}));

app.post("/api/konto/send-bekreftelse", krevKunde, grense(REGLER.konto), fang(async (req: any, res: any) => {
  if (!req.kunde.bekreftet) {
    const token = await lagBekreftelse(req.kunde.id);
    await sendBekreftEpost(req.kunde.email, `${butikkUrl()}/?bekreft=${encodeURIComponent(token)}`);
  }
  res.json({ ok: true });
}));

// Lenken bekrefter adressen, men logger ikke inn: den som trykker, er den
// som eier innboksen, ikke nødvendigvis den som har nettleseren åpen.
app.post("/api/konto/bekreft", grense(REGLER.konto), fang(async (req: any, res: any) => {
  const k = await bekreftEpost(req.body?.token);
  res.json({ ok: true, email: k.email });
}));

app.post("/api/konto/logg-inn", grense(REGLER.konto), fang(async (req: any, res: any) => {
  const k = await loggInn(req.body?.email, req.body?.passord);
  settKundeCookie(res, await nySesjon(k.id));
  res.json({ kunde: k });
}));

app.post("/api/konto/logg-ut", fang(async (req: any, res: any) => {
  await avsluttSesjon(req.cookies?.[KUNDE_COOKIE]);
  fjernKundeCookie(res);
  res.json({ ok: true });
}));

app.put("/api/konto/profil", krevKunde, fang(async (req: any, res: any) => {
  res.json({ kunde: await oppdaterProfil(req.kunde.id, req.body || {}) });
}));

app.put("/api/konto/passord", krevKunde, grense(REGLER.konto), fang(async (req: any, res: any) => {
  await byttPassord(req.kunde.id, req.body?.gammelt, req.body?.nytt, req.cookies?.[KUNDE_COOKIE]);
  res.json({ ok: true });
}));

// Svarer det samme enten adressen finnes eller ikke. Ellers kunne hvem som
// helst slå opp hvem som er kunde.
app.post("/api/konto/glemt", grense(REGLER.konto), fang(async (req: any, res: any) => {
  const t = await lagTilbakestilling(req.body?.email);
  if (t) await sendTilbakestilling(t.email, `${butikkUrl()}/?nyttpassord=${encodeURIComponent(t.token)}`);
  res.json({ ok: true });
}));

app.post("/api/konto/nytt-passord", grense(REGLER.konto), fang(async (req: any, res: any) => {
  const k = await brukTilbakestilling(req.body?.token, req.body?.passord);
  settKundeCookie(res, await nySesjon(k.id));
  res.json({ kunde: k });
}));

const googleTilbake = (req: any) => `${req.protocol}://${req.get("host")}/api/konto/google/tilbake`;

app.get("/api/konto/google", (req: any, res: any) => {
  if (!harGoogle()) return res.status(404).send("Google-innlogging er ikke satt opp.");
  // state i en kortlevd cookie: svaret fra Google må høre til en innlogging
  // som startet her, ellers kan noen logge deg inn på sin egen konto.
  const state = randomBytes(16).toString("hex");
  res.cookie("kh_gstate", state, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: 600_000 });
  res.redirect(googleUrl(googleTilbake(req), state));
});

app.get("/api/konto/google/tilbake", async (req: any, res: any) => {
  const tilbake = (q: string) => res.redirect(`${butikkUrl()}/?${q}`);
  try {
    if (!req.query.state || req.query.state !== req.cookies?.kh_gstate) return tilbake("innlogging=feil");
    res.clearCookie("kh_gstate");
    if (!req.query.code) return tilbake("innlogging=avbrutt");
    const k = await googleKunde(String(req.query.code), googleTilbake(req));
    settKundeCookie(res, await nySesjon(k.id));
    tilbake("innlogging=ok");
  } catch (e: any) {
    console.error("Google-innlogging feilet:", e?.message);
    tilbake("innlogging=feil");
  }
});

app.get("/api/konto/onskeliste", krevKunde, fang(async (req: any, res: any) => {
  res.json({ onsker: await hentØnsker(req.kunde.id) });
}));
app.post("/api/konto/onskeliste", krevKunde, fang(async (req: any, res: any) => {
  res.json({ onsker: await leggTilØnske(req.kunde.id, req.body || {}) });
}));
app.delete("/api/konto/onskeliste/:id", krevKunde, fang(async (req: any, res: any) => {
  res.json({ onsker: await fjernØnske(req.kunde.id, Number(req.params.id)) });
}));

app.get("/api/konto/ordrer", krevKunde, fang(async (req: any, res: any) => {
  res.json({ ordrer: await kundensOrdrer(req.kunde) });
}));

app.get("/api/konto/ordrer/:nr", krevKunde, fang(async (req: any, res: any) => {
  const o = await hentSalgsordre(String(req.params.nr));
  if (!o || !(await tilhørerKunde(o, req.kunde))) throw new HttpFeil(404, "Fant ikke ordren");
  res.json({ ordre: offentlig(o) });
}));

// Kort kunden har solgt til Korthaien (innkjøpsordrene). Følger
// e-postadressen, så bare når den er bekreftet — ellers kunne hvem som helst
// registrere en annens adresse og se salgene deres.
app.get("/api/konto/salg", krevKunde, fang(async (req: any, res: any) => {
  if (!req.kunde.bekreftet) return res.json({ bekreftet: false, ordrer: [] });
  const epost = String(req.kunde.email).trim().toLowerCase();
  const r = await db().execute({
    sql: `SELECT o.id, o.order_no, o.status, o.created_at, o.received_at, o.credit_sent_at,
                 o.total_ore, o.quoted_ore, o.discount_code
            FROM orders o
           WHERE lower(trim(o.email)) = ? AND o.status NOT IN ('expired')
           ORDER BY o.created_at DESC LIMIT 200`,
    args: [epost],
  });
  const ider = r.rows.map((x: any) => Number(x.id));
  const linjer = ider.length
    ? await db().execute({
        sql: `SELECT order_id, card_name, set_name, finish, condition, qty, unit_ore
                FROM order_lines WHERE order_id IN (${ider.map(() => "?").join(",")}) AND fjernet_at IS NULL
               ORDER BY set_name, card_name`,
        args: ider,
      })
    : { rows: [] as any[] };
  const perOrdre = new Map<number, any[]>();
  for (const l of linjer.rows as any[]) {
    const k = Number(l.order_id);
    if (!perOrdre.has(k)) perOrdre.set(k, []);
    perOrdre.get(k)!.push({ card_name: l.card_name, set_name: l.set_name, finish: l.finish, condition: l.condition, antall: Number(l.qty), enhet_ore: Number(l.unit_ore) });
  }
  res.json({
    bekreftet: true,
    ordrer: (r.rows as any[]).map((o) => ({
      ordrenr: o.order_no, status: o.status, created_at: o.created_at, received_at: o.received_at,
      oppgjort_at: o.credit_sent_at, sum_ore: Number(o.total_ore) || Number(o.quoted_ore) || 0,
      linjer: perOrdre.get(Number(o.id)) || [],
    })),
  });
}));

app.get("/api/konto/kreditt", krevKunde, fang(async (req: any, res: any) => {
  if (!req.kunde.bekreftet) return res.json({ bekreftet: false, tilgjengelig_ore: 0, bevegelser: [] });
  res.json({
    bekreftet: true,
    tilgjengelig_ore: await tilgjengeligKreditt(req.kunde.email),
    bevegelser: await kredittBevegelser(req.kunde.email),
  });
}));

// ── butikk: kurv og kasse ────────────────────────────────────────────────────
// ── den offentlige butikken ─────────────────────────────────────────────────
// Samme data som forhåndsvisningen i admin har fått fra /api/admin/…, men
// åpent og med søketaket. Både butikken på korthaien.no og fanen i admin
// bruker disse, så de kan ikke vise ulike ting.
const offentligAdresse = (a: string) =>
  String(a || "").split(/\r?\n/).filter((l) => !/^[\s+()\d-]{8,}$/.test(l.trim())).join("\n").trim();

app.get("/api/butikk/foretak", grense(REGLER.butikk), fang(async (req: any, res: any) => {
  const s = await hentSettings();
  res.json({
    tema: s.tema,
    vis_sealed: s.vis_sealed !== false,
    tix_kreditt_ore: s.tix_kreditt_ore,
    firmanavn: s.firmanavn,
    org_nr: s.org_nr,
    retur_frakt: s.retur_frakt,
    ship_to: offentligAdresse(s.ship_to),
    overgang_dato: s.overgang_dato || "",
    stengt: s.stengt?.aktiv ? { aktiv: true, tittel: s.stengt.tittel || "", tekst: s.stengt.tekst || "" } : null,
    admin: erAdmin(req),
  });
}));

app.get("/api/butikk/katalog", grense(REGLER.butikk), fang(async (req: any, res: any) => {
  const sett = String(req.query.sett || "").toLowerCase();
  const tall = (v: any) => (v === undefined || v === "" ? undefined : Number(v));
  res.json(
    await butikkvisning({
      sett,
      q: req.query.q ? String(req.query.q) : undefined,
      tekst: req.query.tekst ? String(req.query.tekst) : undefined,
      rarity: req.query.rarity ? String(req.query.rarity) : undefined,
      farge: req.query.farge ? String(req.query.farge) : undefined,
      fargeEksakt: String(req.query.fargeEksakt || "") === "1",
      type: req.query.type ? String(req.query.type) : undefined,
      baresalg: String(req.query.baresalg || "") === "1",
      prisFra: tall(req.query.prisFra),
      prisTil: tall(req.query.prisTil),
      finish: req.query.finish ? String(req.query.finish) : undefined,
      sortering: req.query.sortering ? String(req.query.sortering) : undefined,
      side: tall(req.query.side),
      perSide: tall(req.query.perSide) === undefined ? undefined : Math.min(100, tall(req.query.perSide)!),
    })
  );
}));

app.get("/api/butikk/nyeste", grense(REGLER.butikk), fang(async (req: any, res: any) => {
  res.json({ sett: await forsideSett(Math.min(12, Number(req.query.antall) || 5)) });
}));

app.get("/api/butikk/kort/:id", grense(REGLER.butikk), fang(async (req: any, res: any) => {
  const d = await kortdetaljer(String(req.params.id));
  if (!d) throw new HttpFeil(404, "Fant ikke kortet");
  res.json(d);
}));

app.get("/api/butikk/sett/:kode", grense(REGLER.butikk), fang(async (req: any, res: any) => {
  const info = await settinfo(String(req.params.kode));
  if (!info) throw new HttpFeil(404, "Fant ikke settet.");
  res.json({ info });
}));

app.get("/api/butikk/settliste", grense(REGLER.butikk), fang(async (_req: any, res: any) => {
  const r = await db().execute(`
    SELECT s.code, COALESCE(s.visningsnavn, s.name) AS name, s.released_at, s.card_count, s.parent_code,
           r.enabled
      FROM sets s JOIN set_rules r ON r.set_code = s.code
     WHERE r.enabled = 1
     ORDER BY name COLLATE NOCASE`);
  res.json({ sett: r.rows });
}));

app.get("/api/butikk/produkter", grense(REGLER.butikk), fang(async (req: any, res: any) => {
  const s = await hentSettings();
  if (s.vis_sealed === false) return res.json({ produkter: [], antall: {} });
  const type = String(req.query.type || "");
  res.json({
    produkter: await hentProdukter({
      type: erType(type) ? type : undefined,
      set_code: String(req.query.sett || "") || undefined,
      barePåLager: true,
    }),
    antall: await antallPerType(),
  });
}));

app.get("/api/butikk/frakt", grense(REGLER.butikk), fang(async (_req: any, res: any) => {
  res.json({ alternativer: await hentFrakt(true) });
}));

app.get("/api/butikk/oppsett", fang(async (_req: any, res: any) => {
  const { hentFrakt } = await import("./frakt.js");
  res.json({
    frakt: await hentFrakt(true),
    betaling: harStripe(),
    vipps: harVipps(),
    google: harGoogle(),
    reservasjon_min: RESERVASJON_MIN,
    overgang_dato: (await hentSettings()).overgang_dato || "",
  });
}));

// Bulksøk: lim inn en liste, se hva som er på lager.
app.post("/api/butikk/bulksok", grense(REGLER.bulk), fang(async (req: any, res: any) => {
  const tekst = String(req.body?.tekst || "");
  if (tekst.length > 60_000) throw new HttpFeil(400, "Lista er for lang.");
  res.json(await bulkSøk(tekst, !!req.body?.kun_foil));
}));

// Kassen sjekker en rabattkode før kunden betaler. Eget tak, så ingen kan
// prøve seg gjennom koder i stor skala.
app.post("/api/butikk/rabattkode", grense(REGLER.kode), fang(async (req: any, res: any) => {
  res.json(await sjekkKode(String(req.body?.kode || "")));
}));

app.post("/api/butikk/kurv", grense(REGLER.pris), fang(async (req: any, res: any) => {
  await utløpGamle();
  res.json({ linjer: await prisKurv(req.body?.linjer || []) });
}));

app.post("/api/butikk/kasse", grense(REGLER.kasse), kundeValgfri, fang(async (req: any, res: any) => {
  // Under overgangen er butikken stengt for kundene. Admin kan fortsatt
  // prøvekjøpe.
  if ((await hentSettings()).stengt?.aktiv && !erAdmin(req)) {
    throw new HttpFeil(503, "Butikken er stengt mens vi bytter til ny løsning. Prøv igjen litt senere.");
  }
  res.json(await åpneKasse(req.body || {}, req.kunde || null));
}));

// ── overgangen fra Mystore ──────────────────────────────────────────────────
// Én knapp som tømmer lagerboken og fører Mystore-beholdningen inn som
// startbeholdning, i én transaksjon, og så bytter butikken til lagerboken.
// GET viser hva som vil skje; POST gjør det. Nekter hvis det finnes betalte,
// usendte salgsordrer: salgsbevegelsene deres ville forsvunnet med boken.
app.get("/api/admin/overgang", krevAdmin, fang(async (_req: any, res: any) => {
  res.json(await overgangsstatus());
}));

app.post("/api/admin/overgang", krevAdmin, fang(async (req: any, res: any) => {
  if (String(req.body?.bekreft || "") !== "OVERGANG") throw new HttpFeil(400, "Skriv OVERGANG for å bekrefte.");
  try {
    res.json({ ok: true, ...(await gjennomførOvergang()) });
  } catch (e: any) {
    if (e?.status) throw new HttpFeil(e.status, e.message);
    throw e;
  }
}));

app.post("/api/butikk/kasse/:nr/avbryt", fang(async (req: any, res: any) => {
  await avbrytKasse(String(req.params.nr), String(req.body?.m || ""));
  res.json({ ok: true });
}));

// Kvitteringen etter betaling. Åpnes med merket fra lenken, så en gjest kan
// se ordren sin uten konto — men ingen kan bla seg gjennom andres.
app.get("/api/butikk/ordre/:nr", fang(async (req: any, res: any) => {
  const nr = String(req.params.nr);
  if (!riktigMerke(nr, String(req.query.m || ""))) throw new HttpFeil(404, "Fant ikke ordren");
  // Vipps sier ikke fra selv. Kommer kunden tilbake fra Vipps, spør vi.
  await oppdaterVippsOrdre(nr);
  const o = await hentSalgsordre(nr);
  if (!o) throw new HttpFeil(404, "Fant ikke ordren");
  res.json({ ordre: offentlig(o) });
}));

// ── salgsordrer i admin ──────────────────────────────────────────────────────
app.get("/api/admin/salg/ordrer", krevAdmin, fang(async (req: any, res: any) => {
  res.json(await adminOrdrer(String(req.query.status || "pakkes")));
}));

// Bilde og lagerbeholdning nå, så du kan se kunsten og ta stikkprøver av
// lageret mens du plukker. Bare i admin. Brukes også i svaret etter en
// statusendring eller kansellering — ellers forsvant bildene og «På lager»
// fra skjermen så snart du merket ordren som sendt.
async function medBilderOgLager(o: any) {
  if (!o) return o;
  const ider = o.linjer.map((l: any) => String(l.card_id));
  const [lagerNå, bilder] = await Promise.all([
    lagerForPlukk(ider),
    ider.length
      ? db().execute({ sql: `SELECT id, image_uri FROM cards WHERE id IN (${ider.map(() => "?").join(",")})`, args: ider })
      : Promise.resolve({ rows: [] as any[] }),
  ]);
  const bilde = new Map((bilder.rows as any[]).map((x) => [String(x.id), x.image_uri]));
  o.linjer = o.linjer.map((l: any) => ({
    ...l,
    image_uri: bilde.get(String(l.card_id)) || null,
    paa_lager: lagerNå.get(`${l.card_id}:${l.finish}:${l.condition}`) || { hylle: 0, ledig: 0 },
  }));
  return o;
}

app.get("/api/admin/salg/ordrer/:nr", krevAdmin, fang(async (req: any, res: any) => {
  const o = await hentSalgsordre(String(req.params.nr));
  if (!o) throw new HttpFeil(404, "Fant ikke ordren");
  res.json({ ordre: await medBilderOgLager(o) });
}));

app.patch("/api/admin/salg/ordrer/:nr", krevAdmin, fang(async (req: any, res: any) => {
  res.json({ ordre: await medBilderOgLager(await settStatus(String(req.params.nr), req.body || {})) });
}));

app.post("/api/admin/salg/ordrer/:nr/kanseller", krevAdmin, fang(async (req: any, res: any) => {
  const måte = req.body?.maate === "kreditt" ? "kreditt" : "kort";
  res.json({ ordre: await medBilderOgLager(await kanseller(String(req.params.nr), String(req.body?.grunn || ""), måte)) });
}));

app.get("/api/admin/salg/statistikk", krevAdmin, fang(async (_req: any, res: any) => {
  res.json(await salgsstatistikk());
}));

// ── rapporter ────────────────────────────────────────────────────────────────
// Samme kjøring for skjermen og begge PDF-ene: periode inn, salgsrader ut.
function periode(req: any): { fra: string; til: string } {
  const fra = String(req.query.fra || "");
  const til = String(req.query.til || "");
  try {
    sjekkPeriode(fra, til);
  } catch (e: any) {
    throw new HttpFeil(400, e.message);
  }
  return { fra, til };
}

app.get("/api/admin/rapporter/salg", krevAdmin, fang(async (req: any, res: any) => {
  const { fra, til } = periode(req);
  res.json(await salgsrapport(fra, til));
}));

app.get("/api/admin/rapporter/salg.pdf", krevAdmin, fang(async (req: any, res: any) => {
  const { fra, til } = periode(req);
  const type = req.query.type === "oppsummering" ? "oppsummering" : "liste";
  const rapport = await salgsrapport(fra, til);
  const pdf = type === "oppsummering" ? await oppsummeringPdf(rapport) : await salgslistePdf(rapport);
  const navn = `${type === "oppsummering" ? "salgsoppsummering" : "salgsliste"}_${fra}_${til}.pdf`;
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${navn}"`);
  res.setHeader("Cache-Control", "no-store");
  res.send(pdf);
}));

app.get("/api/admin/lager", krevAdmin, fang(async (req: any, res: any) => {
  const sett = String(req.query.sett || "").toLowerCase();
  // Uten sett: søk på navn i alle sett. Minst tre tegn, og et tak, så et
  // søk på «the» ikke henter halve katalogen.
  const q = normaliser(String(req.query.q || ""));
  if (!sett && q.length < 3) throw new HttpFeil(400, "Velg et sett, eller søk på minst tre bokstaver.");
  const r = await db().execute({
    sql: `SELECT c.id, c.name, c.collector_number, c.rarity, c.variant,
                 c.has_foil, c.has_nonfoil, c.er_token, c.set_code,
                 COALESCE(s.visningsnavn, s.name) AS set_name,
                 b.finish, b.condition, b.n
            FROM ${sett ? "cards c" : `(SELECT * FROM cards WHERE name_norm LIKE ? ORDER BY name, released_at DESC LIMIT 300) c`}
            LEFT JOIN sets s ON s.code = c.set_code
            LEFT JOIN (
              SELECT card_id, finish, condition, SUM(antall) AS n
                FROM lager_bevegelser GROUP BY card_id, finish, condition
            ) b ON b.card_id = c.id
           ${sett ? "WHERE c.set_code = ?" : ""}
           ORDER BY ${sett ? "CAST(c.collector_number AS INTEGER), c.collector_number" : "c.name, c.released_at DESC, c.set_code, CAST(c.collector_number AS INTEGER)"}`,
    args: [sett || `%${q}%`],
  });

  // Én rad per kort, med beholdningen samlet i et kart. Databasen gir én rad
  // per kombinasjon, og det er klienten dårlig tjent med.
  const kart = new Map<string, any>();
  for (const x of r.rows as any[]) {
    const id = String(x.id);
    if (!kart.has(id)) {
      kart.set(id, {
        id, name: x.name, collector_number: x.collector_number, rarity: x.rarity,
        variant: x.variant, has_foil: x.has_foil, has_nonfoil: x.has_nonfoil,
        er_token: x.er_token, set_code: x.set_code, set_name: x.set_name, lager: {},
      });
    }
    if (x.finish && Number(x.n)) {
      kart.get(id).lager[`${x.finish}:${x.condition}`] = Number(x.n);
    }
  }
  const kort = [...kart.values()];
  res.json({
    kort,
    stykker: kort.reduce((n, k) => n + Object.values(k.lager).reduce((a: any, b: any) => a + b, 0), 0),
  });
}));

// Du oppgir beholdningen, ikke differansen. Bevegelsen regnes ut her, så du
// slipper å regne i hodet når du sitter med en bunke foran deg.
app.put("/api/admin/lager/:cardId", krevAdmin, fang(async (req: any, res: any) => {
  const { finish, condition, antall, grunn } = req.body || {};
  if (!CONDITIONS.includes(condition)) throw new HttpFeil(400, "Ukjent condition");
  const n = Number(antall);
  if (!Number.isFinite(n) || n < 0) throw new HttpFeil(400, "Antall må være null eller mer");
  const ut = await settBeholdning(
    String(req.params.cardId),
    finish === "foil" ? "foil" : "nonfoil",
    condition,
    n,
    grunn === "telling" ? "telling" : "manuell"
  );
  res.json(ut);
}));

app.get("/api/admin/lager/:cardId/historikk", krevAdmin, fang(async (req: any, res: any) => {
  res.json(await historikk(String(req.params.cardId), req.query.finish ? String(req.query.finish) : undefined));
}));

// Samlet oversikt. Salgsverdi kommer først når prismotoren finnes.
app.get("/api/admin/lager-sammendrag", krevAdmin, fang(async (_req: any, res: any) => {
  const r = await db().execute(`
    SELECT COUNT(DISTINCT card_id) AS kort, COALESCE(SUM(antall), 0) AS stykker
      FROM lager_bevegelser`);
  const perTilstand = await db().execute(`
    SELECT condition, finish, SUM(antall) AS n FROM lager_bevegelser
     GROUP BY condition, finish HAVING n <> 0 ORDER BY n DESC`);
  res.json({ ...r.rows[0], fordeling: perTilstand.rows, avvik: await avvikMotMystore(25) });
}));

app.get("/api/admin/orders/:id/logg", krevAdmin, fang(async (req: any, res: any) => {
  res.json(await endringslogg(Number(req.params.id)));
}));

// Tom eller manglende verdi betyr «følg den globale satsen». 0 er ikke det
// samme — det ville betydd at du ikke betaler noe.
// Ditt eget navn på et sett. Tomt felt betyr at Scryfalls navn gjelder igjen.
app.put("/api/admin/sets/:code/navn", krevAdmin, fang(async (req: any, res: any) => {
  const navn = String(req.body?.visningsnavn ?? "").trim();
  await db().execute({
    sql: "UPDATE sets SET visningsnavn = ? WHERE code = ?",
    args: [navn || null, String(req.params.code).toLowerCase()],
  });
  res.json({ ok: true, visningsnavn: navn || null });
}));

function kjøpsandel(v: any): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 200) throw new HttpFeil(400, "Kjøpsandel må være mellom 0 og 200 %");
  return n;
}

app.get("/api/admin/sets", krevAdmin, fang(async (_req: any, res: any) => {
  const s = await hentSettings();
  const r = await db().execute(`
    SELECT s.code, COALESCE(s.visningsnavn, s.name) AS name, s.name AS scryfall_navn,
           s.visningsnavn, s.released_at, s.card_count,
           r.enabled, r.wanted_default, r.wanted_foil, r.conditions, r.ladder,
           -- Sett som Invocations finnes bare i foil. Der kjøper du ingenting
           -- før foil-antallet er satt, siden foil aldri arver det vanlige.
           NOT EXISTS (SELECT 1 FROM cards c WHERE c.set_code = s.code AND c.has_nonfoil = 1)
             AND EXISTS (SELECT 1 FROM cards c WHERE c.set_code = s.code) AS bare_foil,
           -- Kort med eget antall følger ikke settets tall. Uten dette ser
           -- settets tall ut som hele sannheten, og det er det ikke.
           (SELECT COUNT(*) FROM card_wants w
              JOIN cards c ON c.id = w.card_id
             WHERE c.set_code = s.code) AS egne_antall
      FROM sets s LEFT JOIN set_rules r ON r.set_code = s.code
     ORDER BY name COLLATE NOCASE`);
  res.json({
    standard: { conditions: s.default_conditions, ladder: s.default_ladder },
    sett: r.rows,
  });
}));

app.put("/api/admin/sets/:code", krevAdmin, fang(async (req: any, res: any) => {
  const code = String(req.params.code).toLowerCase();
  const { enabled, wanted_default, wanted_foil, conditions, ladder } = req.body || {};
  if (conditions && (!Array.isArray(conditions) || conditions.some((c: any) => !CONDITIONS.includes(c)))) {
    throw new HttpFeil(400, "Ugyldig condition-liste");
  }
  if (ladder && typeof ladder === "object") {
    for (const [k, v] of Object.entries(ladder)) {
      if (!CONDITIONS.includes(k as any)) throw new HttpFeil(400, `Ukjent condition i trappen: ${k}`);
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0 || n > 200) throw new HttpFeil(400, `Ugyldig prosent for ${k}`);
    }
  }
  const wanted = Math.max(0, Math.floor(Number(wanted_default ?? 0)) || 0);
  const wantedFoil = Math.max(0, Math.floor(Number(wanted_foil ?? 0)) || 0);
  await db().execute({
    sql: `INSERT INTO set_rules (set_code, enabled, wanted_default, wanted_foil, conditions, ladder, buy_pct, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(set_code) DO UPDATE SET
            enabled = excluded.enabled, wanted_default = excluded.wanted_default,
            wanted_foil = excluded.wanted_foil,
            conditions = excluded.conditions, ladder = excluded.ladder,
            buy_pct = excluded.buy_pct,
            updated_at = excluded.updated_at`,
    args: [
      code,
      enabled ? 1 : 0,
      wanted,
      wantedFoil,
      conditions ? JSON.stringify(conditions) : null,
      ladder ? JSON.stringify(ladder) : null,
      kjøpsandel(req.body?.buy_pct),
      new Date().toISOString(),
    ],
  });
  res.json({ ok: true, regel: await hentSetRule(code) });
}));

// Masseoppdatering. Å sette samme antall på hundre sett ett og ett er ikke
// arbeid noen skal gjøre for hånd.
app.put("/api/admin/sets", krevAdmin, fang(async (req: any, res: any) => {
  const { codes, enabled, wanted_default, wanted_foil, conditions } = req.body || {};
  if (!Array.isArray(codes) || !codes.length) throw new HttpFeil(400, "Ingen sett valgt");
  if (codes.length > 2000) throw new HttpFeil(400, "For mange sett i én operasjon");
  if (conditions && (!Array.isArray(conditions) || conditions.some((c: any) => !CONDITIONS.includes(c)))) {
    throw new HttpFeil(400, "Ugyldig condition-liste");
  }
  const s = await hentSettings();
  const nå = new Date().toISOString();

  // Bare feltene som faktisk er sendt endres. Sender du bare antall, beholder
  // settene sine egne conditions.
  const setninger = codes.map((kode: any) => {
    const c = String(kode).toLowerCase();
    const ladder = conditions
      ? JSON.stringify(
          Object.fromEntries(conditions.map((k: string) => [k, s.default_ladder[k] ?? 100]))
        )
      : null;
    return {
      sql: `INSERT INTO set_rules (set_code, enabled, wanted_default, wanted_foil, conditions, ladder, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(set_code) DO UPDATE SET
              enabled = ${enabled === undefined ? "set_rules.enabled" : "excluded.enabled"},
              wanted_default = ${wanted_default === undefined ? "set_rules.wanted_default" : "excluded.wanted_default"},
              wanted_foil = ${wanted_foil === undefined ? "set_rules.wanted_foil" : "excluded.wanted_foil"},
              conditions = ${conditions === undefined ? "set_rules.conditions" : "excluded.conditions"},
              ladder = ${conditions === undefined ? "set_rules.ladder" : "excluded.ladder"},
              updated_at = excluded.updated_at`,
      args: [
        c,
        enabled === undefined ? 0 : enabled ? 1 : 0,
        wanted_default === undefined ? 0 : Math.max(0, Math.floor(Number(wanted_default)) || 0),
        wanted_foil === undefined ? 0 : Math.max(0, Math.floor(Number(wanted_foil)) || 0),
        conditions ? JSON.stringify(conditions) : null,
        ladder,
        nå,
      ],
    };
  });

  for (let i = 0; i < setninger.length; i += 200) {
    await db().batch(setninger.slice(i, i + 200), "write");
  }
  res.json({ ok: true, antall: codes.length });
}));

app.get("/api/admin/cards", krevAdmin, fang(async (req: any, res: any) => {
  const set = String(req.query.set || "").toLowerCase();
  if (!set) throw new HttpFeil(400, "Mangler ?set=");
  // product_id skiller «ingen på lager» fra «ikke koblet». Uten det ser de to
  // helt like ut, og du kan ikke se om kortet i lista faktisk peker på et
  // produkt hos deg.
  const r = await db().execute({
    sql: `SELECT c.id, c.name, c.collector_number, c.rarity, c.usd, c.usd_foil,
                 c.has_foil, c.has_nonfoil, c.image_uri, c.variant, c.set_code,
                 (SELECT wanted FROM card_wants w WHERE w.card_id = c.id AND w.finish='nonfoil') AS want_nonfoil,
                 (SELECT wanted FROM card_wants w WHERE w.card_id = c.id AND w.finish='foil')    AS want_foil,
                 (SELECT conditions FROM card_conditions cc WHERE cc.card_id = c.id) AS egne_conditions,
                 (SELECT usd FROM card_prices p WHERE p.card_id = c.id AND p.finish='nonfoil') AS pris_nonfoil,
                 (SELECT usd FROM card_prices p WHERE p.card_id = c.id AND p.finish='foil')    AS pris_foil,
                 (SELECT qty        FROM mystore_stock m WHERE m.card_id = c.id AND m.finish='nonfoil') AS stock_nonfoil,
                 (SELECT product_id   FROM mystore_stock m WHERE m.card_id = c.id AND m.finish='nonfoil') AS prod_nonfoil,
                 (SELECT product_name FROM mystore_stock m WHERE m.card_id = c.id AND m.finish='nonfoil') AS pnavn_nonfoil,
                 (SELECT category     FROM mystore_stock m WHERE m.card_id = c.id AND m.finish='nonfoil') AS pkat_nonfoil,
                 (SELECT qty        FROM mystore_stock m WHERE m.card_id = c.id AND m.finish='foil')    AS stock_foil,
                 (SELECT product_id   FROM mystore_stock m WHERE m.card_id = c.id AND m.finish='foil')    AS prod_foil,
                 (SELECT product_name FROM mystore_stock m WHERE m.card_id = c.id AND m.finish='foil')    AS pnavn_foil,
                 (SELECT category     FROM mystore_stock m WHERE m.card_id = c.id AND m.finish='foil')    AS pkat_foil,
                 (SELECT COALESCE(SUM(l.qty),0) FROM order_lines l JOIN orders o ON o.id = l.order_id
                   WHERE l.card_id = c.id AND l.finish='nonfoil' AND ${HOLDER_KVOTE}) AS res_nonfoil,
                 (SELECT COALESCE(SUM(l.qty),0) FROM order_lines l JOIN orders o ON o.id = l.order_id
                   WHERE l.card_id = c.id AND l.finish='foil' AND ${HOLDER_KVOTE}) AS res_foil
            FROM cards c WHERE c.set_code = ?
           ORDER BY CAST(c.collector_number AS INTEGER), c.name`,
    args: [set],
  });
  // Innstillingene følger med, ellers kan ikke manuell prising vise hva et
  // dollarbeløp faktisk blir i kroner mens du skriver.
  res.json({ regel: await hentSetRule(set), settings: await hentSettings(), kort: r.rows });
}));

// Sett antall for mange kort samtidig — en hel raritet, eller et utvalg.
// Å klikke seg gjennom 300 commons er ikke arbeid noen skal gjøre.
app.put("/api/admin/cards/wants", krevAdmin, fang(async (req: any, res: any) => {
  const { set_code, rarity, card_ids, finish, wanted, nullstill } = req.body || {};
  if (finish !== "nonfoil" && finish !== "foil") throw new HttpFeil(400, "Ukjent finish");
  const n = Math.max(0, Math.floor(Number(wanted)) || 0);

  let ider: string[];
  if (Array.isArray(card_ids) && card_ids.length) {
    ider = card_ids.map(String).slice(0, 5000);
  } else if (set_code) {
    const args: any[] = [String(set_code).toLowerCase()];
    let sql = "SELECT id FROM cards WHERE set_code = ?";
    if (rarity) {
      sql += " AND rarity = ?";
      args.push(String(rarity).toLowerCase());
    }
    // Foil settes bare på kort som faktisk finnes i foil.
    if (finish === "foil") sql += " AND has_foil = 1";
    const r = await db().execute({ sql, args });
    ider = r.rows.map((x: any) => String(x.id));
  } else {
    throw new HttpFeil(400, "Oppgi enten card_ids eller set_code");
  }
  if (!ider.length) return res.json({ ok: true, antall: 0 });

  const nå = new Date().toISOString();
  for (let i = 0; i < ider.length; i += 300) {
    const del = ider.slice(i, i + 300);
    if (nullstill) {
      await db().execute({
        sql: `DELETE FROM card_wants WHERE finish = ? AND card_id IN (${del.map(() => "?").join(",")})`,
        args: [finish, ...del],
      });
    } else {
      await db().batch(
        del.map((id) => ({
          sql: `INSERT INTO card_wants (card_id, finish, wanted, updated_at) VALUES (?, ?, ?, ?)
                ON CONFLICT(card_id, finish) DO UPDATE SET wanted = excluded.wanted, updated_at = excluded.updated_at`,
          args: [id, finish, n, nå],
        })),
        "write"
      );
    }
  }
  res.json({ ok: true, antall: ider.length });
}));

app.put("/api/admin/cards/:id/want", krevAdmin, fang(async (req: any, res: any) => {
  const { finish, wanted } = req.body || {};
  if (finish !== "nonfoil" && finish !== "foil") throw new HttpFeil(400, "Ukjent finish");
  const n = Math.floor(Number(wanted));
  if (!Number.isFinite(n) || n < 0) throw new HttpFeil(400, "Ugyldig antall");
  await db().execute({
    sql: `INSERT INTO card_wants (card_id, finish, wanted, updated_at) VALUES (?, ?, ?, ?)
          ON CONFLICT(card_id, finish) DO UPDATE SET wanted = excluded.wanted, updated_at = excluded.updated_at`,
    args: [String(req.params.id), finish, n, new Date().toISOString()],
  });
  res.json({ ok: true });
}));

app.delete("/api/admin/cards/:id/want", krevAdmin, fang(async (req: any, res: any) => {
  await db().execute({
    sql: "DELETE FROM card_wants WHERE card_id = ? AND finish = ?",
    args: [String(req.params.id), String(req.query.finish || "nonfoil")],
  });
  res.json({ ok: true });
}));

// ── admin: kobling av Mystore-produkter ──────────────────────────────────────
// Kategorier som ikke lot seg knytte til et sett. Én kobling her fikser alle
// produktene i grenen, så dette er langt mer effektivt enn å koble enkeltkort.
// Manuell markedspris i dollar på ett kort.
app.put("/api/admin/cards/:id/pris", krevAdmin, fang(async (req: any, res: any) => {
  const finish = String(req.body?.finish || "nonfoil");
  if (finish !== "nonfoil" && finish !== "foil") throw new HttpFeil(400, "Ukjent finish");
  const usd = Number(req.body?.usd);
  if (!Number.isFinite(usd) || usd <= 0) throw new HttpFeil(400, "Oppgi en pris i dollar");
  await db().execute({
    sql: `INSERT INTO card_prices (card_id, finish, usd, kilde, updated_at)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(card_id, finish) DO UPDATE SET
            usd = excluded.usd, kilde = excluded.kilde, updated_at = excluded.updated_at`,
    args: [String(req.params.id), finish, usd, req.body?.kilde || null, new Date().toISOString()],
  });
  res.json({ ok: true, usd });
}));

// Tilstander for ett bestemt kort. Tom liste betyr at settets regel gjelder.
app.put("/api/admin/cards/:id/conditions", krevAdmin, fang(async (req: any, res: any) => {
  const inn = Array.isArray(req.body?.conditions) ? req.body.conditions : [];
  const rene = CONDITIONS.filter((c) => inn.includes(c));
  const id = String(req.params.id);
  if (!rene.length) {
    await db().execute({ sql: "DELETE FROM card_conditions WHERE card_id = ?", args: [id] });
    return res.json({ ok: true, conditions: null });
  }
  await db().execute({
    sql: `INSERT INTO card_conditions (card_id, conditions, updated_at) VALUES (?, ?, ?)
          ON CONFLICT(card_id) DO UPDATE SET conditions = excluded.conditions,
                                             updated_at = excluded.updated_at`,
    args: [id, JSON.stringify(rene), new Date().toISOString()],
  });
  res.json({ ok: true, conditions: rene });
}));

app.delete("/api/admin/cards/:id/pris", krevAdmin, fang(async (req: any, res: any) => {
  await db().execute({
    sql: "DELETE FROM card_prices WHERE card_id = ? AND finish = ?",
    args: [String(req.params.id), String(req.query.finish || "nonfoil")],
  });
  res.json({ ok: true });
}));

app.get("/api/admin/mystore/categories", krevAdmin, fang(async (req: any, res: any) => {
  const bareUkoblede = String(req.query.ukoblede || "") === "1";
  const søk = String(req.query.q || "").trim();
  const r = await db().execute({
    sql: `SELECT c.category_id, c.name, c.parent_id, c.set_code, c.manuell,
                 c.gjettet, c.forslag,
                 p.name AS parent_name, s.name AS set_name
            FROM mystore_categories c
            LEFT JOIN mystore_categories p ON p.category_id = c.parent_id
            LEFT JOIN sets s ON s.code = c.set_code
           WHERE (? = 0 OR (c.set_code IS NULL AND c.manuell = 0))
             AND (? = '' OR c.name LIKE ? OR p.name LIKE ? OR s.name LIKE ?)
             AND NOT EXISTS (SELECT 1 FROM mystore_categories b WHERE b.parent_id = c.category_id)
           ORDER BY (c.set_code IS NULL) DESC, c.name LIMIT 400`,
    args: [bareUkoblede ? 1 : 0, søk, `%${søk}%`, `%${søk}%`, `%${søk}%`],
  });
  // Forslag per kategori, så du slipper å lete i 988 sett manuelt.
  const alleSett = await db().execute("SELECT code, name FROM sets");
  const idx = byggIndeks(alleSett.rows.map((x: any) => ({ code: String(x.code), name: String(x.name) })));
  const medForslag = r.rows.map((k: any) => {
    // Forslag fra innholdsanalysen veier tyngst — de bygger på hvilke kort
    // som faktisk ligger i kategorien, ikke på hva den heter.
    let fraInnhold: any[] = [];
    try {
      fraInnhold = k.forslag ? JSON.parse(String(k.forslag)) : [];
    } catch {}
    return {
      ...k,
      fraInnhold,
      forslag: foreslå(String(k.parent_name || k.name || ""), idx, 4),
    };
  });

  const antall = await db().execute(`
    SELECT COUNT(*) AS n FROM mystore_categories c
     WHERE c.set_code IS NULL AND c.manuell = 0
       AND NOT EXISTS (SELECT 1 FROM mystore_categories b WHERE b.parent_id = c.category_id)`);
  res.json({ antall: Number(antall.rows[0]?.n || 0), kategorier: medForslag });
}));

// Fritekstsøk i alle sett, til nedtrekket i koblingsskjermen.
app.get("/api/admin/sets/search", krevAdmin, fang(async (req: any, res: any) => {
  const q = String(req.query.q || "").trim();
  const r = await db().execute({
    sql: `SELECT code, name, released_at FROM sets
           WHERE name LIKE ? OR code LIKE ?
           ORDER BY released_at DESC LIMIT 40`,
    args: [`%${q}%`, `${q}%`],
  });
  res.json(r.rows);
}));

app.put("/api/admin/mystore/categories/:id", krevAdmin, fang(async (req: any, res: any) => {
  const setCode = req.body?.set_code ? String(req.body.set_code).toLowerCase() : null;
  if (setCode) {
    const finnes = await db().execute({ sql: "SELECT 1 FROM sets WHERE code = ?", args: [setCode] });
    if (!finnes.rows.length) throw new HttpFeil(400, "Ukjent settkode");
  }
  await db().execute({
    sql: `UPDATE mystore_categories SET set_code = ?, manuell = 1 WHERE category_id = ?`,
    args: [setCode, String(req.params.id)],
  });
  res.json({ ok: true });
}));

app.get("/api/admin/mystore/unmatched", krevAdmin, fang(async (_req: any, res: any) => {
  const r = await db().execute(`
    SELECT u.* FROM mystore_unmatched u
     ORDER BY u.stock DESC, u.name LIMIT 500`);
  const antall = await db().execute("SELECT COUNT(*) AS n FROM mystore_unmatched");
  res.json({ antall: Number(antall.rows[0]?.n || 0), produkter: r.rows });
}));

// Forslag basert på produktnavnet. Sparer deg for å skrive navnet på nytt for
// hvert produkt — som regel er riktig kort blant de første treffene.
app.get("/api/admin/cards/search", krevAdmin, fang(async (req: any, res: any) => {
  const q = String(req.query.q || "").trim();
  if (q.length < 2) return res.json([]);
  // Mystore-navn har ofte settet i parentes og «foil» hengt på.
  const rent = q.replace(/\([^)]*\)/g, "").replace(/\bfoil\b/gi, "").trim();
  const norm = normaliser(rent);
  const r = await db().execute({
    sql: `SELECT c.id, c.name, c.set_code,
                 COALESCE(s.visningsnavn, s.name) AS set_name, c.collector_number,
                 c.rarity, c.image_uri, c.has_foil, c.has_nonfoil, c.released_at
            FROM cards c LEFT JOIN sets s ON s.code = c.set_code
           WHERE c.name_norm = ? OR c.name_norm LIKE ?
              OR c.front_norm = ? OR c.front_norm LIKE ?
              OR c.back_norm = ? OR c.back_norm LIKE ?
           ORDER BY (c.name_norm = ? OR c.front_norm = ? OR c.back_norm = ?) DESC, c.released_at DESC
           LIMIT 40`,
    args: [norm, norm + "%", norm, norm + "%", norm, norm + "%", norm, norm, norm],
  });
  res.json(r.rows);
}));

// Ukoblede produkter i ett bestemt sett. Brukes når du står på kortlista og
// vil koble et kort til produktet ditt manuelt.
app.get("/api/admin/mystore/unmatched-for-set", krevAdmin, fang(async (req: any, res: any) => {
  const set = String(req.query.set || "").toLowerCase();
  if (!set) throw new HttpFeil(400, "Mangler ?set=");
  const q = String(req.query.q || "").trim();
  const r = await db().execute({
    sql: `SELECT product_id, sku, name, stock, category FROM mystore_unmatched
           WHERE set_code = ? AND (? = '' OR name LIKE ?)
           ORDER BY stock DESC, name LIMIT 60`,
    args: [set, q, `%${q}%`],
  });
  res.json(r.rows);
}));

app.post("/api/admin/mystore/link", krevAdmin, fang(async (req: any, res: any) => {
  const { product_id, card_id, finish, ignored } = req.body || {};
  if (!product_id) throw new HttpFeil(400, "Mangler product_id");
  if (!ignored) {
    if (!card_id) throw new HttpFeil(400, "Mangler card_id");
    if (finish !== "nonfoil" && finish !== "foil") throw new HttpFeil(400, "Ukjent finish");
  }
  const nå = new Date().toISOString();
  await db().execute({
    sql: `INSERT INTO mystore_links (product_id, card_id, finish, ignored, kilde, updated_at)
          VALUES (?, ?, ?, ?, 'manuell', ?)
          ON CONFLICT(product_id) DO UPDATE SET
            card_id = excluded.card_id, finish = excluded.finish,
            ignored = excluded.ignored, kilde = 'manuell', updated_at = excluded.updated_at`,
    args: [String(product_id), ignored ? null : String(card_id), ignored ? null : finish, ignored ? 1 : 0, nå],
  });

  // Skriv beholdningen med én gang, så kvoten blir riktig uten å vente på
  // neste nattlige synk.
  if (!ignored) {
    const p = await db().execute({
      sql: "SELECT stock, name, category FROM mystore_unmatched WHERE product_id = ?",
      args: [String(product_id)],
    });
    if (p.rows[0]) {
      await db().execute({
        sql: `INSERT INTO mystore_stock (card_id, finish, qty, product_id, product_name, category, synced_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(card_id, finish) DO UPDATE SET
                qty = excluded.qty, product_id = excluded.product_id,
                product_name = excluded.product_name, category = excluded.category,
                synced_at = excluded.synced_at`,
        args: [
          String(card_id), finish, Number(p.rows[0].stock || 0), String(product_id),
          p.rows[0].name ? String(p.rows[0].name) : null,
          p.rows[0].category ? String(p.rows[0].category) : null, nå,
        ],
      });
    }
  }

  await db().execute({ sql: "DELETE FROM mystore_unmatched WHERE product_id = ?", args: [String(product_id)] });
  res.json({ ok: true });
}));

// ── admin: innstillinger og jobber ───────────────────────────────────────────
// Fjern en kobling som er feil. Produktet havner tilbake i Kobling ved neste
// synk, så du mister ingenting ved å angre.
app.delete("/api/admin/mystore/stock/:cardId", krevAdmin, fang(async (req: any, res: any) => {
  const finish = String(req.query.finish || "nonfoil");
  await db().execute({
    sql: "DELETE FROM mystore_stock WHERE card_id = ? AND finish = ?",
    args: [String(req.params.cardId), finish],
  });
  res.json({ ok: true });
}));

// Rabattkoden lages manuelt i Mystore og limes inn her.
app.put("/api/admin/orders/:id/kreditt", krevAdmin, fang(async (req: any, res: any) => {
  const id = Number(req.params.id);
  // Etter overgangen: oppgjøret blir kreditt i kredittboka, ikke en kode.
  if (req.body?.som_kreditt) {
    if (req.body?.sendt) {
      await gjørOppSomKreditt(id, req.body?.credit_note ?? null);
      if (req.body?.varsle !== false) iBakgrunnen("oppgjør", sendOppgjør(id));
    } else {
      await db().execute({ sql: "UPDATE orders SET credit_note = ? WHERE id = ?", args: [req.body?.credit_note ?? null, id] });
    }
    const r = await db().execute({ sql: "SELECT * FROM orders WHERE id = ?", args: [id] });
    if (!r.rows[0]) throw new HttpFeil(404, "Fant ikke ordren");
    return res.json(r.rows[0]);
  }
  await settRabattkode(id, req.body?.discount_code ?? null, req.body?.credit_note ?? null);
  if (req.body?.sendt) {
    await markerKredittSendt(id);
    // Kortene går IKKE inn på lager her. Oppgjøret er pengene til kunden;
    // innlegging på hylla er en annen handling, på et annet tidspunkt — ofte
    // mange uker senere. Det skjer med «Legg inn i beholdningen».
    //
    // Sto de to sammen, måtte beholdningen alltid vært à jour i samme
    // øyeblikk som kunden fikk betalt. Den er den aldri.
    if (req.body?.varsle !== false) iBakgrunnen("oppgjør", sendOppgjør(id));
  }
  const r = await db().execute({ sql: "SELECT * FROM orders WHERE id = ?", args: [id] });
  if (!r.rows[0]) throw new HttpFeil(404, "Fant ikke ordren");
  res.json(r.rows[0]);
}));

// ── frakt ────────────────────────────────────────────────────────────────────
app.get("/api/admin/frakt", krevAdmin, fang(async (_req: any, res: any) => {
  res.json({ alternativer: await hentFrakt() });
}));

app.post("/api/admin/frakt", krevAdmin, fang(async (req: any, res: any) => {
  try {
    res.json(await leggTilFrakt(req.body || {}));
  } catch (e: any) {
    throw new HttpFeil(400, e.message);
  }
}));

app.put("/api/admin/frakt/:id", krevAdmin, fang(async (req: any, res: any) => {
  try {
    res.json(await endreFrakt(Number(req.params.id), req.body || {}));
  } catch (e: any) {
    throw new HttpFeil(400, e.message);
  }
}));

// Slår av, sletter ikke. En ordre som er sendt med et alternativ skal
// fortsatt kunne vise hva den ble sendt med.
app.delete("/api/admin/frakt/:id", krevAdmin, fang(async (req: any, res: any) => {
  await slåAvFrakt(Number(req.params.id));
  res.json({ ok: true });
}));

// Fakta om ett sett, til «Om settet»-fanen. Samme svar sier om det finnes
// sealed i settet, saa fanen og innholdet aldri kan bli uenige.
app.get("/api/admin/butikk/sett/:kode", krevAdmin, fang(async (req: any, res: any) => {
  const info = await settinfo(String(req.params.kode));
  if (!info) throw new HttpFeil(404, "Fant ikke settet.");
  res.json({ info });
}));

// ── egne produkter ───────────────────────────────────────────────────────────
// Sealed og komplette sett. Butikken spør med bareLager=1 og får bare det som
// finnes; admin spør uten og ser alt den har lagt inn — samme skille som
// kortene har.
app.get("/api/admin/produkter", krevAdmin, fang(async (req: any, res: any) => {
  const type = String(req.query.type || "");
  res.json({
    produkter: await hentProdukter({
      type: erType(type) ? type : undefined,
      set_code: String(req.query.sett || "") || undefined,
      barePåLager: String(req.query.bareLager || "") === "1",
      bareAktive: String(req.query.alle || "") !== "1",
    }),
    antall: await antallPerType(),
  });
}));

app.get("/api/admin/produkter/:id", krevAdmin, fang(async (req: any, res: any) => {
  const p = await hentProdukt(Number(req.params.id));
  if (!p) throw new HttpFeil(404, "Fant ikke produktet.");
  res.json({ produkt: p });
}));

app.post("/api/admin/produkter", krevAdmin, fang(async (req: any, res: any) => {
  try {
    const id = await leggTilProdukt(req.body || {});
    res.json({ produkt: await hentProdukt(id) });
  } catch (e: any) {
    throw new HttpFeil(400, e.message);
  }
}));

app.put("/api/admin/produkter/:id", krevAdmin, fang(async (req: any, res: any) => {
  try {
    await endreProdukt(Number(req.params.id), req.body || {});
    res.json({ produkt: await hentProdukt(Number(req.params.id)) });
  } catch (e: any) {
    throw new HttpFeil(400, e.message);
  }
}));

// Slås av, slettes ikke — som fraktalternativene, og av samme grunn.
app.delete("/api/admin/produkter/:id", krevAdmin, fang(async (req: any, res: any) => {
  await slåAvProdukt(Number(req.params.id));
  res.json({ ok: true });
}));

// ── kreditt ──────────────────────────────────────────────────────────────────
app.get("/api/admin/kreditt", krevAdmin, fang(async (req: any, res: any) => {
  res.json({ kontoer: await kontoer(String(req.query.q || "")) });
}));

app.get("/api/admin/kreditt/:epost", krevAdmin, fang(async (req: any, res: any) => {
  const epost = String(req.params.epost);
  res.json({ epost, saldo_ore: await saldo(epost), bevegelser: await bevegelser(epost) });
}));

app.post("/api/admin/kreditt", krevAdmin, fang(async (req: any, res: any) => {
  const { epost, ore, notat, saldo_ore } = req.body || {};
  try {
    // To måter å si det samme: legg til et beløp, eller sett saldoen til et
    // tall. Den andre bokfører differansen, så boka aldri mister en linje.
    const ut =
      saldo_ore === undefined || saldo_ore === null || saldo_ore === ""
        ? await leggTilKreditt({ email: epost, ore: Number(ore), notat })
        : await settSaldo(epost, Number(saldo_ore), notat);
    res.json({ bevegelse: ut, saldo_ore: await saldo(epost) });
  } catch (e: any) {
    throw new HttpFeil(400, e.message);
  }
}));

// ── rabattkoder ─────────────────────────────────────────────────────────────
app.get("/api/admin/rabattkoder", krevAdmin, fang(async (_req: any, res: any) => {
  res.json({ koder: await alleKoder(), forslag: lagKode() });
}));
app.post("/api/admin/rabattkoder", krevAdmin, fang(async (req: any, res: any) => {
  res.json({ kode: await opprettKode(req.body || {}) });
}));
app.post("/api/admin/rabattkoder/import", krevAdmin, express.text({ type: "*/*", limit: "1mb" }), fang(async (req: any, res: any) => {
  res.json(await importerKoder(String(req.body || "")));
}));
app.get("/api/admin/rabattkoder/:id/bevegelser", krevAdmin, fang(async (req: any, res: any) => {
  res.json({ bevegelser: await kodeBevegelser(Number(req.params.id)) });
}));
app.post("/api/admin/rabattkoder/:id/saldo", krevAdmin, fang(async (req: any, res: any) => {
  res.json({ kode: await justerSaldo(Number(req.params.id), req.body || {}) });
}));
app.patch("/api/admin/rabattkoder/:id", krevAdmin, fang(async (req: any, res: any) => {
  await endreKode(Number(req.params.id), req.body || {});
  res.json({ ok: true });
}));

app.get("/api/admin/kunder", krevAdmin, fang(async (req: any, res: any) => {
  res.json(await kundeoversikt(String(req.query.q || ""), Math.max(0, Number(req.query.side) || 0)));
}));

app.post("/api/admin/kunder/import", krevAdmin, express.text({ type: "*/*", limit: "15mb" }), fang(async (req: any, res: any) => {
  res.json(await importerMystoreKunder(String(req.body || "")));
}));

app.get("/api/admin/settings", krevAdmin, fang(async (_req: any, res: any) => {
  res.json(await hentSettings());
}));

app.put("/api/admin/settings", krevAdmin, fang(async (req: any, res: any) => {
  const lov: (keyof Settings)[] = [
    "usd_nok", "buy_pct", "min_buy_ore", "min_order_ore", "min_usd",
    "salg_trapp", "salg_faktor", "salg_avrunding", "default_conditions",
    "default_ladder", "order_expiry_days", "ship_to", "tema", "forside_sett",
    "firmanavn", "org_nr", "retur_frakt", "toppbanner", "tix_kreditt_ore", "overgang_dato", "vis_sealed", "stengt",
  ];
  if (req.body && "stengt" in req.body) {
    const b = req.body.stengt;
    req.body.stengt = b
      ? { aktiv: !!b.aktiv, tittel: String(b.tittel ?? "").trim().slice(0, 120), tekst: String(b.tekst ?? "").trim().slice(0, 600) }
      : null;
  }
  if (req.body && "vis_sealed" in req.body) req.body.vis_sealed = !!req.body.vis_sealed;
  if (req.body && "overgang_dato" in req.body) {
    const d = String(req.body.overgang_dato || "").trim();
    if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new HttpFeil(400, "Datoen må være på formen ÅÅÅÅ-MM-DD.");
    req.body.overgang_dato = d;
  }
  if (req.body && "tix_kreditt_ore" in req.body) {
    const n = Math.round(Number(req.body.tix_kreditt_ore));
    if (!Number.isFinite(n) || n < 0 || n > 100000) throw new HttpFeil(400, "Ugyldig pris per tix.");
    req.body.tix_kreditt_ore = n;
  }
  // Toppbildet tas imot i en fast form, så det som lagres alltid kan leses.
  if (req.body && "toppbanner" in req.body) {
    const b = req.body.toppbanner;
    req.body.toppbanner = b
      ? {
          bilde_id: Number(b.bilde_id) > 0 ? Number(b.bilde_id) : null,
          tekst: String(b.tekst ?? "").trim().slice(0, 80) || null,
          plassering: b.plassering === "knapp" ? "knapp" : "hjorne",
          sett: /^[a-z0-9]{2,8}$/i.test(String(b.sett || "")) ? String(b.sett).toLowerCase() : null,
          aktiv: !!b.aktiv,
        }
      : null;
  }
  for (const [k, v] of Object.entries(req.body || {})) {
    if (lov.includes(k as any)) await settSetting(k as keyof Settings, v);
  }
  res.json(await hentSettings());
}));

app.post("/api/admin/jobs/:navn", krevAdmin, fang(async (req: any, res: any) => {
  const navn = String(req.params.navn);
  // Målingen skjer normalt til slutt i lagersynken. Denne er for å fylle
  // dagens punkt uten å hente hele butikken på nytt — og for å få et første
  // punkt i kurven uten å vente til natten.
  if (navn === "maaling") {
    res.json({ ok: true, melding: "Måler lageret — følg med i loggen." });
    lagreLagermåling()
      .then((m) => console.log(`Måling lagret for ${m.dato}: ${m.antall + m.antall_foil} kort.`))
      .catch((e) => console.error("Måling feilet:", e));
    return;
  }
  // Kuppjakten tar timer — ett oppslag hvert tiende sekund — så den svarer
  // med én gang og går i bakgrunnen, som importen.
  if (navn === "kupp") {
    res.json({ ok: true, melding: "Kuppjakten er startet — følg med i loggen." });
    kjørKuppjakt().catch((e) => console.error("Kuppjakt feilet:", e));
    return;
  }
  // Ti kort, uten å slå jobben på. Nok til å se at koblingen mot Kortjakt
  // virker, lite nok til at ingen merker det.
  if (navn === "kupp-prove") {
    res.json({ ok: true, melding: "Prøven er startet — ti kort, følg med i loggen." });
    kjørKuppjakt(console.log, { antall: 10, tørr: true }).catch((e) =>
      console.error("Kuppprøve feilet:", e)
    );
    return;
  }
  // Importen tar minutter. Vi svarer med én gang og lar den gå i bakgrunnen,
  // ellers ryker forespørselen på timeout hos Render.
  if (navn === "import") {
    res.json({ ok: true, melding: "Import startet — følg med i loggen." });
    importerScryfall().catch((e) => console.error("Import feilet:", e));
    return;
  }
  if (navn === "gjett") {
    res.json({ ok: true, melding: "Analysen er startet — følg med i loggen." });
    gjettKategorier().catch((e) => console.error("Gjetting feilet:", e));
    return;
  }
  if (navn === "mystore" || navn === "mystore-alle") {
    // Vanlig synk henter bare sett du kjøper fra — det er alt kvoten
    // trenger. Lagerrapporten viser derimot hele butikken, og da må også
    // settene du bare selger fra være med. «mystore-alle» henter alt.
    const alleSett = navn === "mystore-alle";
    res.json({ ok: true, melding: alleSett ? "Full synk startet." : "Synk startet." });
    synkMystore(undefined, { alleSett }).catch((e) => console.error("Mystore-synk feilet:", e));
    return;
  }
  if (navn === "expire") {
    return res.json({ ok: true, utløpt: await utløpGamleOrdrer() });
  }
  throw new HttpFeil(404, "Ukjent jobb");
}));

// ── feilhåndtering ───────────────────────────────────────────────────────────
app.use((feil: any, _req: any, res: any, _next: any) => {
  if (feil instanceof HttpFeil) {
    return res.status(feil.status).json({ feil: feil.message, ...(feil.data || {}) });
  }
  if (feil instanceof SalgFeil || feil instanceof KontoFeil || feil instanceof KodeFeil || feil instanceof ØnskeFeil) {
    return res.status(feil.status).json({ feil: feil.message, ...((feil as any).data || {}) });
  }
  console.error(feil);
  res.status(500).json({ feil: "Uventet serverfeil" });
});

const PORT = Number(process.env.PORT || 3000);

// Eksporteres så tester kan lukke serveren igjen. Uten det holder lytteren
// prosessen i live, og hele testkjøringen henger.
export let server: import("http").Server | undefined;
let ryddeTimer: NodeJS.Timeout | undefined;
export function stopp() {
  ryddeTimer && clearInterval(ryddeTimer);
  return new Promise<void>((r) => (server ? server.close(() => r()) : r()));
}

migrate()
  .then(async () => {
    // Har overgangen skjedd, leser butikken lagerboken.
    settBokSomLagerkilde((await hentSettings()).lagerkilde === "bok");
    server = app.listen(PORT, () => console.log(`Korthaien Kjøp lytter på :${PORT}`));
    // Rydder reservasjoner hver time, så kvoter ikke blir stående låst.
    // unref, slik at en test som importerer serveren ikke holdes i live av
    // en timer som aldri skal rekke å slå til.
    ryddeTimer = setInterval(() => utløpGamleOrdrer().catch(console.error), 3600_000);
    ryddeTimer.unref?.();
    // Forlatte kasser frigis hvert minutt, så kortene kommer tilbake i
    // butikken kort tid etter at kvarteret er ute.
    const kasseTimer = setInterval(() => utløpGamle(true).catch(console.error), 60_000);
    kasseTimer.unref?.();
    // Ønskelista: beskjed til kunder når kort de venter på, er på lager.
    // Lageret endres av nattsynken og av kanselleringer, så hver halvtime
    // holder. Ikke når det kjøres tester.
    if (!process.env.DATABASE_URL?.startsWith("file:/tmp")) {
      const ønskeTimer = setInterval(() => varsleØnsker().catch(console.error), 30 * 60_000);
      ønskeTimer.unref?.();
    }
  })
  .catch((e) => {
    console.error("Klarte ikke migrere databasen:", e);
    process.exit(1);
  });
