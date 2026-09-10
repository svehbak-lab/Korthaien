import "dotenv/config";
import express from "express";
import cookieParser from "cookie-parser";
import { db, migrate, hentSettings, settSetting, normaliser, CONDITIONS, type Settings } from "./db.js";
import { søk, løsBulk, tilbudFor } from "./catalog.js";
import { parseBulk, MAX_LINJER } from "./bulk.js";
import {
  lagOrdre, hentOrdre, utløpGamleOrdrer, regnOmLinje, oppdaterTotal,
  settRabattkode, markerKredittSendt, HttpFeil,
} from "./orders.js";
import { hentSetRule } from "./pricing.js";
import { importerScryfall } from "./import-scryfall.js";
import { synkMystore, gjettKategorier, harMystore } from "./mystore.js";
import { krevAdmin, sjekkPassord, settCookie, fjernCookie } from "./auth.js";
import { byggIndeks, foreslå } from "./settnavn.js";
import { grense, REGLER } from "./ratelimit.js";

const app = express();
// Render setter X-Forwarded-For. Uten dette ser alle brukere ut som én
// adresse, og rate limiting ville rammet alle samtidig.
app.set("trust proxy", 1);
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

// Frontend ligger på eget subdomene, så CORS må være eksplisitt.
const TILLATT = (process.env.CORS_ORIGIN || "http://localhost:5173").split(",").map((s) => s.trim());
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
  });
}));

app.get("/api/sets", grense(REGLER.søk), fang(async (_req: any, res: any) => {
  // Bare sett jeg faktisk kjøper fra vises i filteret.
  const r = await db().execute(`
    SELECT s.code, s.name, s.released_at, r.wanted_default, r.conditions
      FROM set_rules r JOIN sets s ON s.code = r.set_code
     WHERE r.enabled = 1 ORDER BY s.released_at DESC`);
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
app.post("/api/quote", grense(REGLER.bulk), fang(async (req: any, res: any) => {
  const linjer = Array.isArray(req.body?.linjer) ? req.body.linjer : [];
  res.json(await tilbudFor(linjer));
}));

app.post("/api/orders", grense(REGLER.ordre), fang(async (req: any, res: any) => {
  await utløpGamleOrdrer();
  const ordre = await lagOrdre({
    customer_name: req.body?.customer_name,
    email: req.body?.email,
    phone: req.body?.phone,
    note: req.body?.note,
    linjer: req.body?.linjer || [],
  });
  res.status(201).json(ordre);
}));

app.get("/api/orders/:orderNo", grense(REGLER.søk), fang(async (req: any, res: any) => {
  const o = await hentOrdre(String(req.params.orderNo));
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
app.post("/api/admin/login", grense(REGLER.innlogging), (req, res) => {
  if (!sjekkPassord(req.body?.password)) {
    return res.status(401).json({ feil: "Feil passord" });
  }
  settCookie(res);
  res.json({ ok: true });
});

app.post("/api/admin/logout", (_req, res) => {
  fjernCookie(res);
  res.json({ ok: true });
});

app.get("/api/admin/me", krevAdmin, (_req, res) => res.json({ ok: true }));

app.get("/api/admin/orders", krevAdmin, fang(async (req: any, res: any) => {
  await utløpGamleOrdrer();
  const arkiv = String(req.query.arkiv || "") === "1";
  // Mottatte ordrer er fortsatt aktive: de holder kvote til de er lagerført.
  const status = arkiv ? ["stocked", "cancelled", "expired"] : ["pending", "received"];
  const r = await db().execute({
    sql: `SELECT * FROM orders WHERE status IN (${status.map(() => "?").join(",")})
          ORDER BY created_at DESC LIMIT 300`,
    args: status,
  });
  const ider = r.rows.map((o: any) => o.id);
  let linjer: any[] = [];
  if (ider.length) {
    const l = await db().execute({
      sql: `SELECT * FROM order_lines WHERE order_id IN (${ider.map(() => "?").join(",")})
            ORDER BY set_name, card_name`,
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
    await db().execute({
      sql: "UPDATE orders SET status = ?, received_at = ? WHERE id = ?",
      args: [status, ["received", "stocked"].includes(status) ? new Date().toISOString() : null, id],
    });
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
  if (condition === undefined && qty === undefined && qty_received === undefined) {
    throw new HttpFeil(400, "Ingenting å endre");
  }
  const ut = await regnOmLinje(id, { condition, qty, qty_received });
  const l = await db().execute({ sql: "SELECT order_id FROM order_lines WHERE id = ?", args: [id] });
  const total = l.rows[0] ? await oppdaterTotal(Number(l.rows[0].order_id)) : 0;
  res.json({ ok: true, ...ut, total_ore: total });
}));

app.delete("/api/admin/lines/:id", krevAdmin, fang(async (req: any, res: any) => {
  const id = Number(req.params.id);
  const l = await db().execute({ sql: "SELECT order_id FROM order_lines WHERE id = ?", args: [id] });
  await db().execute({ sql: "DELETE FROM order_lines WHERE id = ?", args: [id] });
  if (l.rows[0]) await oppdaterTotal(Number(l.rows[0].order_id));
  res.json({ ok: true });
}));

// Tom eller manglende verdi betyr «følg den globale satsen». 0 er ikke det
// samme — det ville betydd at du ikke betaler noe.
function kjøpsandel(v: any): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 200) throw new HttpFeil(400, "Kjøpsandel må være mellom 0 og 200 %");
  return n;
}

app.get("/api/admin/sets", krevAdmin, fang(async (_req: any, res: any) => {
  const s = await hentSettings();
  const r = await db().execute(`
    SELECT s.code, s.name, s.released_at, s.card_count,
           r.enabled, r.wanted_default, r.wanted_foil, r.conditions, r.ladder
      FROM sets s LEFT JOIN set_rules r ON r.set_code = s.code
     ORDER BY s.released_at DESC`);
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
                 c.has_foil, c.image_uri, c.variant, c.set_code,
                 (SELECT wanted FROM card_wants w WHERE w.card_id = c.id AND w.finish='nonfoil') AS want_nonfoil,
                 (SELECT wanted FROM card_wants w WHERE w.card_id = c.id AND w.finish='foil')    AS want_foil,
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
                   WHERE l.card_id = c.id AND l.finish='nonfoil' AND o.status IN ('pending','received')) AS res_nonfoil,
                 (SELECT COALESCE(SUM(l.qty),0) FROM order_lines l JOIN orders o ON o.id = l.order_id
                   WHERE l.card_id = c.id AND l.finish='foil' AND o.status IN ('pending','received')) AS res_foil
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
    sql: `SELECT c.id, c.name, c.set_code, s.name AS set_name, c.collector_number,
                 c.rarity, c.image_uri, c.has_foil, c.released_at
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
  await settRabattkode(id, req.body?.discount_code ?? null, req.body?.credit_note ?? null);
  if (req.body?.sendt) await markerKredittSendt(id);
  const r = await db().execute({ sql: "SELECT * FROM orders WHERE id = ?", args: [id] });
  if (!r.rows[0]) throw new HttpFeil(404, "Fant ikke ordren");
  res.json(r.rows[0]);
}));

app.get("/api/admin/settings", krevAdmin, fang(async (_req: any, res: any) => {
  res.json(await hentSettings());
}));

app.put("/api/admin/settings", krevAdmin, fang(async (req: any, res: any) => {
  const lov: (keyof Settings)[] = [
    "usd_nok", "buy_pct", "min_buy_ore", "min_order_ore", "default_conditions",
    "default_ladder", "order_expiry_days", "ship_to",
  ];
  for (const [k, v] of Object.entries(req.body || {})) {
    if (lov.includes(k as any)) await settSetting(k as keyof Settings, v);
  }
  res.json(await hentSettings());
}));

app.post("/api/admin/jobs/:navn", krevAdmin, fang(async (req: any, res: any) => {
  const navn = String(req.params.navn);
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
  if (navn === "mystore") {
    res.json({ ok: true, melding: "Synk startet." });
    synkMystore().catch((e) => console.error("Mystore-synk feilet:", e));
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
  .then(() => {
    server = app.listen(PORT, () => console.log(`Korthaien Kjøp lytter på :${PORT}`));
    // Rydder reservasjoner hver time, så kvoter ikke blir stående låst.
    // unref, slik at en test som importerer serveren ikke holdes i live av
    // en timer som aldri skal rekke å slå til.
    ryddeTimer = setInterval(() => utløpGamleOrdrer().catch(console.error), 3600_000);
    ryddeTimer.unref?.();
  })
  .catch((e) => {
    console.error("Klarte ikke migrere databasen:", e);
    process.exit(1);
  });
