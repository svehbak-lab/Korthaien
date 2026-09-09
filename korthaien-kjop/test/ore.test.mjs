import test from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";

const DB = `/tmp/ore-${process.pid}.db`;
rmSync(DB, { force: true });
process.env.DATABASE_URL = `file:${DB}`;

const { db, migrate, normaliser, settSetting } = await import("../src/db.ts");
const { lagOrdre, regnOmLinje, oppdaterTotal, settRabattkode, markerKredittSendt } =
  await import("../src/orders.ts");

await migrate();
process.on("exit", () => rmSync(DB, { force: true }));

// Kursen settes eksplisitt, ellers avhenger tallene under av standardverdien
// — og den endrer seg når dollaren gjør det.
await settSetting("usd_nok", 10.6);

await db().execute(
  "INSERT INTO sets (code,name,released_at,card_count,parent_code) VALUES ('lea','Limited Edition Alpha','1993-08-05',295,NULL)"
);
// Alpha tar imot både NM og EX — det er her tilstandsendring gir mening.
await db().execute({
  sql: `INSERT INTO set_rules (set_code,enabled,wanted_default,wanted_foil,conditions,ladder,updated_at)
        VALUES ('lea',1,8,0,?,?,'2026-01-01')`,
  args: [JSON.stringify(["NM", "EX"]), JSON.stringify({ NM: 100, EX: 80 })],
});

async function nyttKort(id, navn, usd) {
  await db().execute({
    sql: `INSERT INTO cards (id,oracle_id,name,name_norm,front_norm,back_norm,variant,set_code,
                             collector_number,rarity,usd,usd_foil,has_nonfoil,has_foil,image_uri,released_at)
          VALUES (?,?,?,?,NULL,NULL,'vanlig','lea','1','rare',?,NULL,1,0,NULL,'1993-08-05')`,
    args: [id, id, navn, normaliser(navn), usd],
  });
}

await nyttKort("dyrt", "Black Lotus", 100);
await nyttKort("billig", "Mons Goblin Raiders", 0.01);

const kunde = { customer_name: "Kari Nordmann", email: "kari@example.com" };

test("billige kort får en pris i øre i stedet for å bli null", async () => {
  // $0,01 × 10,6 × 70 % = 7,42 øre → 7 øre. Kunden skal se 0,07 kr, ikke 0 kr.
  const o = await lagOrdre({
    ...kunde,
    linjer: [
      { card_id: "dyrt", finish: "nonfoil", condition: "NM", qty: 1 },
      { card_id: "billig", finish: "nonfoil", condition: "NM", qty: 3 },
    ],
  });
  const billig = o.linjer.find((l) => l.card_id === "billig");
  assert.equal(billig.unit_ore, 7);
  assert.equal(o.total_ore, 74200 + 21);
});

test("ordrer under minstesummen avvises med beløpet i beskjeden", async () => {
  await assert.rejects(
    lagOrdre({ ...kunde, linjer: [{ card_id: "billig", finish: "nonfoil", condition: "NM", qty: 2 }] }),
    (e) => {
      assert.equal(e.status, 400);
      assert.match(e.message, /minst 200 kr/);
      assert.equal(e.data.total_ore, 14);
      return true;
    }
  );
});

test("minstesummen kan settes ned", async () => {
  await settSetting("min_order_ore", 1);
  const o = await lagOrdre({
    ...kunde,
    linjer: [{ card_id: "billig", finish: "nonfoil", condition: "NM", qty: 2 }],
  });
  assert.equal(o.total_ore, 14);
  await settSetting("min_order_ore", 20000);
});

test("endret tilstand regner prisen om etter trappen for settet", async () => {
  const o = await lagOrdre({
    ...kunde,
    linjer: [{ card_id: "dyrt", finish: "nonfoil", condition: "NM", qty: 1 }],
  });
  const r = await db().execute({
    sql: `SELECT l.id, l.order_id FROM order_lines l
            JOIN orders o ON o.id = l.order_id WHERE o.order_no = ?`,
    args: [o.order_no],
  });
  const linjeId = Number(r.rows[0].id);
  const ordreId = Number(r.rows[0].order_id);

  const ut = await regnOmLinje(linjeId, { condition: "EX" });
  // 74200 øre × 80 % = 59360
  assert.equal(ut.unit_ore, 59360);
  assert.equal(await oppdaterTotal(ordreId), 59360);

  // Alpha tar ikke imot VG. Da blir linjen null — ikke stilltiende stående
  // på gammel pris.
  const vg = await regnOmLinje(linjeId, { condition: "VG" });
  assert.equal(vg.unit_ore, 0);
});

test("mottatt antall styrer totalen når det er satt", async () => {
  const o = await lagOrdre({
    ...kunde,
    linjer: [{ card_id: "dyrt", finish: "nonfoil", condition: "NM", qty: 2 }],
  });
  const r = await db().execute({
    sql: `SELECT l.id, l.order_id FROM order_lines l
            JOIN orders o ON o.id = l.order_id WHERE o.order_no = ?`,
    args: [o.order_no],
  });
  await regnOmLinje(Number(r.rows[0].id), { qty_received: 1 });
  assert.equal(await oppdaterTotal(Number(r.rows[0].order_id)), 74200);
});

test("rabattkoden må ligge inne før kreditten kan markeres som sendt", async () => {
  const o = await lagOrdre({
    ...kunde,
    linjer: [{ card_id: "dyrt", finish: "nonfoil", condition: "NM", qty: 1 }],
  });
  const r = await db().execute({ sql: "SELECT id FROM orders WHERE order_no = ?", args: [o.order_no] });
  const id = Number(r.rows[0].id);

  await assert.rejects(markerKredittSendt(id), /rabattkoden/i);

  await settRabattkode(id, "hhrl5l", "742 kr");
  await markerKredittSendt(id);

  const etter = await db().execute({ sql: "SELECT * FROM orders WHERE id = ?", args: [id] });
  assert.equal(etter.rows[0].discount_code, "hhrl5l");
  assert.ok(etter.rows[0].credit_sent_at);
});
