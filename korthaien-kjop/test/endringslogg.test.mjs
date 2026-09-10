import test from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";

const DB = `/tmp/logg-${process.pid}.db`;
rmSync(DB, { force: true });
process.env.DATABASE_URL = `file:${DB}`;

const { db, migrate, normaliser, settSetting } = await import("../src/db.ts");
const { lagOrdre, regnOmLinje, oppdaterTotal, leggTilLinje, fjernLinje, endringslogg, hentOrdre } =
  await import("../src/orders.ts");

await migrate();
process.on("exit", () => rmSync(DB, { force: true }));
await settSetting("usd_nok", 10);
await settSetting("min_order_ore", 1);

await db().execute(
  "INSERT INTO sets (code,name,released_at,card_count,parent_code) VALUES ('isd','Innistrad','2011-09-30',264,NULL)"
);
await db().execute(
  "INSERT INTO sets (code,name,released_at,card_count,parent_code) VALUES ('uma','Ultimate Masters','2018-12-07',254,NULL)"
);
for (const k of ["isd", "uma"]) {
  await db().execute({
    sql: `INSERT INTO set_rules (set_code,enabled,wanted_default,wanted_foil,conditions,ladder,buy_pct,updated_at)
          VALUES (?,1,8,0,?,?,NULL,'2026-01-01')`,
    args: [k, JSON.stringify(["NM", "EX"]), JSON.stringify({ NM: 100, EX: 80 })],
  });
  await db().execute({
    sql: `INSERT INTO cards (id,oracle_id,name,name_norm,front_norm,back_norm,variant,set_code,
                             collector_number,rarity,usd,usd_foil,has_nonfoil,has_foil,image_uri,released_at)
          VALUES (?,'lil','Liliana of the Veil',?,NULL,NULL,'vanlig',?,'105','mythic',10,NULL,1,0,NULL,'2011-09-30')`,
    args: [`lil-${k}`, normaliser("Liliana of the Veil"), k],
  });
}

async function nyOrdre() {
  // Hver ordre reserverer to av åtte. Uten å slippe de forrige er kvoten
  // tom etter fjerde test, og feilen ser ut som noe helt annet.
  await db().execute("UPDATE orders SET status = 'cancelled'");
  const o = await lagOrdre({
    customer_name: "Kari Nordmann",
    email: "kari@example.com",
    phone: "91234567",
    linjer: [{ card_id: "lil-isd", finish: "nonfoil", condition: "NM", qty: 2 }],
  });
  const r = await db().execute({
    sql: `SELECT o.id AS oid, l.id AS lid FROM orders o JOIN order_lines l ON l.order_id = o.id
           WHERE o.order_no = ?`,
    args: [o.order_no],
  });
  return { ...o, oid: Number(r.rows[0].oid), lid: Number(r.rows[0].lid) };
}

test("en uendret ordre har ingenting i loggen", async () => {
  const o = await nyOrdre();
  assert.deepEqual(await endringslogg(o.oid), []);
});

test("endret tilstand står i loggen med begge verdiene", async () => {
  const o = await nyOrdre();
  await regnOmLinje(o.lid, { condition: "EX" });
  const logg = await endringslogg(o.oid);
  assert.equal(logg.length, 1);
  assert.equal(logg[0].hva, "condition");
  assert.match(logg[0].tekst, /oppgitt NM, vurdert til EX/);
});

test("avvik i antall står i loggen", async () => {
  const o = await nyOrdre();
  await regnOmLinje(o.lid, { qty_received: 1 });
  const logg = await endringslogg(o.oid);
  assert.equal(logg[0].hva, "antall");
  assert.match(logg[0].tekst, /oppgitt 2 stk\., mottatt 1/);
});

test("feil utgave: fjern den ene og legg til den andre", async () => {
  const o = await nyOrdre();
  // Kunden trodde det var Innistrad, men sendte Ultimate Masters.
  await fjernLinje(o.lid);
  const total = await leggTilLinje(o.oid, {
    card_id: "lil-uma",
    finish: "nonfoil",
    condition: "NM",
    qty: 2,
  });
  assert.equal(total, 2 * 10 * 10 * 0.7 * 100, "totalen følger den nye linjen");

  const logg = await endringslogg(o.oid);
  assert.equal(logg.length, 2);
  assert.ok(logg.some((e) => e.hva === "fjernet" && /Innistrad/.test(e.tekst)));
  assert.ok(logg.some((e) => e.hva === "lagt_til" && /Ultimate Masters/.test(e.tekst)));
});

test("en fjernet linje teller ikke i totalen", async () => {
  const o = await nyOrdre();
  assert.equal(o.total_ore, 14000);
  assert.equal(await fjernLinje(o.lid), 0);
});

test("fjerning kan angres", async () => {
  const o = await nyOrdre();
  await fjernLinje(o.lid);
  assert.equal(await fjernLinje(o.lid, true), 14000);
  assert.deepEqual(await endringslogg(o.oid), []);
});

test("kunden ser ikke fjernede linjer i kvitteringen", async () => {
  const o = await nyOrdre();
  await fjernLinje(o.lid);
  const sett = await hentOrdre(o.order_no);
  assert.equal(sett.linjer.length, 0);
});

test("en linje lagt til ved mottak prises på server, ikke av klienten", async () => {
  const o = await nyOrdre();
  await leggTilLinje(o.oid, { card_id: "lil-uma", finish: "nonfoil", condition: "EX", qty: 1 });
  const l = await db().execute({
    sql: "SELECT * FROM order_lines WHERE order_id = ? AND kilde = 'admin'",
    args: [o.oid],
  });
  // $10 × 10 × 70 % × 80 % = 56 kr
  assert.equal(Number(l.rows[0].unit_ore), 5600);
  assert.equal(Number(l.rows[0].qty_received), 1, "lagt til betyr mottatt");
});

test("ugyldige linjer avvises", async () => {
  const o = await nyOrdre();
  await assert.rejects(
    leggTilLinje(o.oid, { card_id: "finnes-ikke", finish: "nonfoil", condition: "NM", qty: 1 }),
    /Fant ikke kortet/
  );
  await assert.rejects(
    leggTilLinje(o.oid, { card_id: "lil-uma", finish: "nonfoil", condition: "NM", qty: 0 }),
    /minst 1/
  );
});

test("det kunden ble forespeilet endres aldri av justeringene", async () => {
  const o = await nyOrdre();
  await regnOmLinje(o.lid, { condition: "EX", qty_received: 1 });
  await oppdaterTotal(o.oid);
  const r = await db().execute({ sql: "SELECT * FROM orders WHERE id = ?", args: [o.oid] });
  assert.equal(Number(r.rows[0].quoted_ore), 14000);
  assert.equal(Number(r.rows[0].total_ore), 5600);
});
