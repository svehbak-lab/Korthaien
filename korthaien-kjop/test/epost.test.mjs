import test, { before } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";

const DB = `/tmp/epost-${process.pid}.db`;
rmSync(DB, { force: true });
process.env.DATABASE_URL = `file:${DB}`;
process.env.RESEND_KEY = "test-nokkel";
process.env.EPOST_FRA = "Korthaien <ordre@korthaien.no>";
process.env.EPOST_SVAR = "korthaien@gmail.com";
process.env.EPOST_TIL_MEG = "korthaien@gmail.com";

const { db, migrate, normaliser, settSetting } = await import("../src/db.ts");
const { lagOrdre, regnOmLinje, oppdaterTotal, settRabattkode, instruksjoner, fjernLinje } =
  await import("../src/orders.ts");
const { sendBekreftelse, varsleMeg, varsleStatus, sendOppgjør } = await import("../src/epost.ts");

await migrate();
process.on("exit", () => rmSync(DB, { force: true }));
await settSetting("usd_nok", 10);
await settSetting("min_order_ore", 1);

// Fanger opp det som ville blitt sendt, i stedet for å sende det.
const sendt = [];
const ekteFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  if (String(url).includes("api.resend.com")) {
    sendt.push({ auth: opts.headers.Authorization, ...JSON.parse(opts.body) });
    return new Response(JSON.stringify({ id: "test" }), { status: 200 });
  }
  return ekteFetch(url, opts);
};

await db().execute(
  "INSERT INTO sets (code,name,released_at,card_count,parent_code) VALUES ('isd','Innistrad','2011-09-30',264,NULL)"
);
await db().execute({
  sql: `INSERT INTO set_rules (set_code,enabled,wanted_default,wanted_foil,conditions,ladder,buy_pct,updated_at)
        VALUES ('isd',1,20,0,?,?,NULL,'2026-01-01')`,
  args: [JSON.stringify(["NM", "EX"]), JSON.stringify({ NM: 100, EX: 80 })],
});
// Et kortnavn med tegn som må unnslippes i HTML.
await db().execute({
  sql: `INSERT INTO cards (id,oracle_id,name,name_norm,front_norm,back_norm,variant,set_code,
                           collector_number,rarity,usd,usd_foil,has_nonfoil,has_foil,image_uri,released_at)
        VALUES ('lil','lil','Liliana <of> the "Veil"',?,NULL,NULL,'vanlig','isd','105','mythic',10,NULL,1,0,NULL,'2011-09-30')`,
  args: [normaliser("Liliana of the Veil")],
});

async function nyOrdre(note) {
  await db().execute("UPDATE orders SET status = 'cancelled'");
  const o = await lagOrdre({
    customer_name: "Kari <Nordmann>",
    email: "kari@example.com",
    phone: "91234567",
    note,
    linjer: [{ card_id: "lil", finish: "nonfoil", condition: "NM", qty: 2 }],
  });
  const r = await db().execute({
    sql: `SELECT o.id AS oid, l.id AS lid FROM orders o JOIN order_lines l ON l.order_id = o.id
           WHERE o.order_no = ?`,
    args: [o.order_no],
  });
  return { ...o, oid: Number(r.rows[0].oid), lid: Number(r.rows[0].lid) };
}

before(() => { sendt.length = 0; });

test("bekreftelsen går til kunden og har ordrenummer og sum", async () => {
  sendt.length = 0;
  const o = await nyOrdre();
  const r = await sendBekreftelse({ ...o, email: "kari@example.com" });
  assert.equal(r.sendt, true);

  const brev = sendt.at(-1);
  assert.equal(brev.to[0], "kari@example.com");
  assert.equal(brev.from, "Korthaien <ordre@korthaien.no>");
  assert.equal(brev.reply_to, "korthaien@gmail.com", "svar må gå til Gmail, ikke til et domene uten MX");
  assert.ok(brev.subject.includes(o.order_no));
  assert.ok(brev.html.includes("140 kr"));
  assert.ok(brev.text.includes(o.order_no), "det skal finnes en ren tekstversjon");
});

test("HTML unnslippes, så et kortnavn ikke kan velte oppsettet", async () => {
  sendt.length = 0;
  const o = await nyOrdre();
  await sendBekreftelse({ ...o, email: "kari@example.com" });
  const brev = sendt.at(-1);
  assert.ok(!brev.html.includes("<of>"), "vinkelparenteser i kortnavn må unnslippes");
  assert.ok(brev.html.includes("&lt;of&gt;"));
});

test("varselet til meg svarer til kunden, ikke til meg selv", async () => {
  sendt.length = 0;
  const o = await nyOrdre("Sender mandag");
  const r = await varsleMeg({ ...o, email: "kari@example.com", customer_name: "Kari", phone: "91234567", note: "Sender mandag" });
  assert.equal(r.sendt, true);

  const brev = sendt.at(-1);
  assert.equal(brev.to[0], "korthaien@gmail.com");
  assert.equal(brev.reply_to, "kari@example.com");
  assert.ok(brev.html.includes("Sender mandag"), "kundens melding må være med");
  assert.ok(brev.subject.includes("140 kr"));
});

test("statusvarsel finnes for mottatt, kansellert og utløpt", async () => {
  for (const status of ["received", "cancelled", "expired"]) {
    sendt.length = 0;
    const o = await nyOrdre();
    const r = await varsleStatus(o.oid, status);
    assert.equal(r.sendt, true, status);
    assert.equal(sendt.at(-1).to[0], "kari@example.com");
  }
});

test("lagerført gir ingen egen e-post — den er oppgjøret", async () => {
  const o = await nyOrdre();
  const r = await varsleStatus(o.oid, "stocked");
  assert.equal(r.sendt, false);
});

test("oppgjør uten rabattkode sendes ikke", async () => {
  const o = await nyOrdre();
  const r = await sendOppgjør(o.oid);
  assert.equal(r.sendt, false);
  assert.match(r.grunn, /rabattkode/);
});

test("oppgjørseposten har koden, avviket og lista", async () => {
  sendt.length = 0;
  const o = await nyOrdre();
  await regnOmLinje(o.lid, { condition: "EX" });
  await oppdaterTotal(o.oid);
  await settRabattkode(o.oid, "hhrl5l", "To kort var EX, ikke NM");

  const r = await sendOppgjør(o.oid);
  assert.equal(r.sendt, true);

  const brev = sendt.at(-1);
  assert.ok(brev.html.includes("hhrl5l"), "koden må være med");
  assert.ok(brev.text.includes("hhrl5l"));
  assert.ok(brev.html.includes("To kort var EX, ikke NM"), "notatet må være med");
  assert.ok(brev.html.includes("oppgitt NM, vurdert til EX"), "endringen må forklares");
  assert.ok(brev.html.includes("140 kr"), "det kunden ble forespeilet");
  assert.ok(brev.html.includes("112 kr"), "det hen faktisk får");
});

test("fjernede kort står i forklaringen, men ikke i lista", async () => {
  sendt.length = 0;
  const o = await nyOrdre();
  await fjernLinje(o.lid);
  await settRabattkode(o.oid, "abc123", null);
  await sendOppgjør(o.oid);

  const brev = sendt.at(-1);
  assert.ok(brev.html.includes("kom ikke fram"));
});

test("uten nøkkel sendes ingenting, og ingenting krasjer", async () => {
  const før = process.env.RESEND_KEY;
  delete process.env.RESEND_KEY;
  const o = await nyOrdre();
  const r = await varsleStatus(o.oid, "received");
  assert.equal(r.sendt, false);
  assert.match(r.grunn, /RESEND_KEY/);
  process.env.RESEND_KEY = før;
});

test("en feil fra Resend velter ikke noe, den rapporteres", async () => {
  const lagret = globalThis.fetch;
  globalThis.fetch = async () => new Response("nope", { status: 422 });
  const o = await nyOrdre();
  const r = await varsleStatus(o.oid, "received");
  assert.equal(r.sendt, false);
  assert.match(r.grunn, /422/);
  globalThis.fetch = lagret;
});
