import test, { after } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";

const DB = `/tmp/lekkasje-${process.pid}.db`;
rmSync(DB, { force: true });
process.env.DATABASE_URL = `file:${DB}`;
process.env.ADMIN_PASSWORD = "hemmelig";
process.env.SESSION_SECRET = "test";
process.env.PORT = "3197";

const { db, migrate, normaliser, settSetting } = await import("../src/db.ts");
await migrate();
process.on("exit", () => rmSync(DB, { force: true }));
await settSetting("min_order_ore", 1);

await db().execute(
  "INSERT INTO sets (code,name,released_at,card_count,parent_code) VALUES ('tst','Testsett','2020-01-01',9,NULL)"
);
await db().execute({
  sql: `INSERT INTO set_rules (set_code,enabled,wanted_default,wanted_foil,conditions,ladder,buy_pct,updated_at)
        VALUES ('tst',1,8,0,?,?,NULL,'2026-01-01')`,
  args: [JSON.stringify(["NM"]), JSON.stringify({ NM: 100 })],
});
await db().execute({
  sql: `INSERT INTO cards (id,oracle_id,name,name_norm,front_norm,back_norm,variant,set_code,
                           collector_number,rarity,usd,usd_foil,has_nonfoil,has_foil,image_uri,released_at)
        VALUES ('k','k','Testkort',?,NULL,NULL,'vanlig','tst','1','rare',50,NULL,1,0,NULL,'2020-01-01')`,
  args: [normaliser("Testkort")],
});

const { lagOrdre, settRabattkode, markerKredittSendt } = await import("../src/orders.ts");
const { stopp } = await import("../src/server.ts");
await new Promise((r) => setTimeout(r, 700));
after(() => stopp());

const o = await lagOrdre({
  customer_name: "Kari Nordmann",
  email: "kari@example.com",
  phone: "91234567",
  linjer: [{ card_id: "k", finish: "nonfoil", condition: "NM", qty: 1 }],
});
const r = await db().execute({ sql: "SELECT id FROM orders WHERE order_no = ?", args: [o.order_no] });
await settRabattkode(Number(r.rows[0].id), "hhrl5l", "internt notat");
await markerKredittSendt(Number(r.rows[0].id));

const hent = async (sti) => {
  const svar = await fetch(`http://localhost:3197${sti}`);
  return { status: svar.status, tekst: await svar.text() };
};

test("oppslaget krever e-post", async () => {
  const uten = await hent(`/api/orders/${o.order_no}`);
  assert.equal(uten.status, 404);
  const feil = await hent(`/api/orders/${o.order_no}?epost=noen.andre@example.com`);
  assert.equal(feil.status, 404);
});

test("rabattkoden kommer aldri ut av det offentlige oppslaget", async () => {
  const svar = await hent(`/api/orders/${o.order_no}?epost=kari@example.com`);
  assert.equal(svar.status, 200);
  // Ikke bare feltet — koden skal ikke finnes noe sted i svaret.
  assert.ok(!svar.tekst.includes("hhrl5l"), "koden lekket i svaret");
  const d = JSON.parse(svar.tekst);
  assert.equal(d.discount_code, undefined);
  assert.equal(d.credit_sent, true);
  assert.ok(d.credit_sent_at);
});

test("kundedata og interne notater holdes utenfor", async () => {
  const svar = await hent(`/api/orders/${o.order_no}?epost=kari@example.com`);
  const d = JSON.parse(svar.tekst);
  assert.equal(d.email, undefined);
  assert.equal(d.phone, undefined);
  assert.equal(d.admin_note, undefined);
  assert.equal(d.credit_note, undefined);
  assert.ok(!svar.tekst.includes("internt notat"));
  // Kvitteringen skal fortsatt være der.
  assert.equal(d.order_no, o.order_no);
  assert.equal(d.linjer.length, 1);
});
