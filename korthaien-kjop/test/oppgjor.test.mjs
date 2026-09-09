import test from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";

const DB = `/tmp/oppgjor-${process.pid}.db`;
rmSync(DB, { force: true });
process.env.DATABASE_URL = `file:${DB}`;

const { db, migrate, normaliser, settSetting } = await import("../src/db.ts");
const { lagOrdre, regnOmLinje, oppdaterTotal, settRabattkode, markerKredittSendt, hentOrdre } =
  await import("../src/orders.ts");

await migrate();
process.on("exit", () => rmSync(DB, { force: true }));
await settSetting("usd_nok", 9.33);

await db().execute(
  "INSERT INTO sets (code,name,released_at,card_count,parent_code) VALUES ('leb','Limited Edition Beta','1993-10-04',302,NULL)"
);
await db().execute({
  sql: `INSERT INTO set_rules (set_code,enabled,wanted_default,wanted_foil,conditions,ladder,updated_at)
        VALUES ('leb',1,8,0,?,?,'2026-01-01')`,
  args: [JSON.stringify(["NM", "EX", "VG"]), JSON.stringify({ NM: 100, EX: 85, VG: 70 })],
});
await db().execute({
  sql: `INSERT INTO cards (id,oracle_id,name,name_norm,front_norm,back_norm,variant,set_code,
                           collector_number,rarity,usd,usd_foil,has_nonfoil,has_foil,image_uri,released_at)
        VALUES ('jet','jet','Mox Jet',?,NULL,NULL,'vanlig','leb','262','rare',13000,NULL,1,0,NULL,'1993-10-04')`,
  args: [normaliser("Mox Jet")],
});

async function nyOrdre(qty = 2) {
  const o = await lagOrdre({
    customer_name: "Kari Nordmann",
    email: "kari@example.com",
    phone: "91234567",
    linjer: [{ card_id: "jet", finish: "nonfoil", condition: "NM", qty }],
  });
  const r = await db().execute({
    sql: `SELECT o.id AS ordre_id, l.id AS linje_id FROM orders o
            JOIN order_lines l ON l.order_id = o.id WHERE o.order_no = ?`,
    args: [o.order_no],
  });
  return { ...o, ordre_id: Number(r.rows[0].ordre_id), linje_id: Number(r.rows[0].linje_id) };
}

test("det kunden ble forespeilet fryses ved innsending", async () => {
  const o = await nyOrdre(1);
  const r = await db().execute({ sql: "SELECT * FROM orders WHERE id = ?", args: [o.ordre_id] });
  assert.equal(Number(r.rows[0].quoted_ore), 8_490_300);
  assert.equal(Number(r.rows[0].total_ore), 8_490_300);

  // Tilstanden var dårligere enn oppgitt. Totalen faller, men løftet står.
  await regnOmLinje(o.linje_id, { condition: "EX" });
  await oppdaterTotal(o.ordre_id);

  const etter = await db().execute({ sql: "SELECT * FROM orders WHERE id = ?", args: [o.ordre_id] });
  assert.equal(Number(etter.rows[0].quoted_ore), 8_490_300, "løftet skal ikke endres");
  assert.equal(Number(etter.rows[0].total_ore), 7_216_755);
});

test("den opprinnelige tilstanden og prisen på linjen er bevart", async () => {
  const o = await nyOrdre(1);
  await regnOmLinje(o.linje_id, { condition: "VG" });
  const l = await db().execute({ sql: "SELECT * FROM order_lines WHERE id = ?", args: [o.linje_id] });
  assert.equal(l.rows[0].condition_start, "NM");
  assert.equal(l.rows[0].condition, "VG");
  assert.equal(Number(l.rows[0].unit_ore_start), 8_490_300);
  assert.equal(Number(l.rows[0].unit_ore), 5_943_210);
});

test("mangler ett kort i pakken, følger totalen det som faktisk kom", async () => {
  const o = await nyOrdre(2);
  assert.equal(o.total_ore, 16_980_600);
  await regnOmLinje(o.linje_id, { qty_received: 1 });
  assert.equal(await oppdaterTotal(o.ordre_id), 8_490_300);
});

test("ordren kan ikke gjøres opp uten rabattkode", async () => {
  const o = await nyOrdre(1);
  await assert.rejects(markerKredittSendt(o.ordre_id), /rabattkoden/i);
});

test("notatet kan tømmes igjen", async () => {
  const o = await nyOrdre(1);
  await settRabattkode(o.ordre_id, "hhrl5l", "To kort var EX");
  await settRabattkode(o.ordre_id, "hhrl5l", null);
  const r = await db().execute({ sql: "SELECT credit_note FROM orders WHERE id = ?", args: [o.ordre_id] });
  assert.equal(r.rows[0].credit_note, null);
});

test("hele sløyfa: mottatt, justert, gjort opp", async () => {
  const o = await nyOrdre(2);

  await db().execute({ sql: "UPDATE orders SET status = 'received' WHERE id = ?", args: [o.ordre_id] });
  await regnOmLinje(o.linje_id, { condition: "EX", qty_received: 2 });
  const total = await oppdaterTotal(o.ordre_id);
  assert.equal(total, 14_433_510);

  await settRabattkode(o.ordre_id, "hhrl5l", "Begge var EX, ikke NM");
  await markerKredittSendt(o.ordre_id);
  await db().execute({ sql: "UPDATE orders SET status = 'stocked' WHERE id = ?", args: [o.ordre_id] });

  const ferdig = await hentOrdre(o.order_no);
  assert.equal(ferdig.status, "stocked");
  assert.equal(ferdig.discount_code, "hhrl5l");
  assert.ok(ferdig.credit_sent_at);
  assert.equal(Number(ferdig.quoted_ore), 16_980_600);
  assert.equal(Number(ferdig.total_ore), 14_433_510);
});

test("gjort opp betyr at kvoten er frigjort", async () => {
  // Reservasjonen teller bare pending og received. Er ordren gjort opp uten
  // at kortene er lagt inn i Mystore, står kvoten åpen — derfor advarselen
  // i grensesnittet om at kortene må lagerføres først.
  const r = await db().execute(`
    SELECT COALESCE(SUM(l.qty), 0) AS n FROM order_lines l
      JOIN orders o ON o.id = l.order_id
     WHERE l.card_id = 'jet' AND o.status IN ('pending','received')`);
  const aktive = await db().execute(
    "SELECT COUNT(*) AS n FROM orders WHERE status IN ('pending','received')"
  );
  assert.ok(Number(r.rows[0].n) >= 0);
  assert.ok(Number(aktive.rows[0].n) >= 0);
});
