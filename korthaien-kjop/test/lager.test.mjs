import test from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";

const DB = `/tmp/lager-${process.pid}.db`;
rmSync(DB, { force: true });
process.env.DATABASE_URL = `file:${DB}`;

const { db, migrate, normaliser, settSetting } = await import("../src/db.ts");
const { lagOrdre, regnOmLinje, oppdaterTotal, fjernLinje, settRabattkode, markerKredittSendt } =
  await import("../src/orders.ts");
const {
  førBevegelser, beholdningFor, beholdning, bokførOrdre, reverserOrdre,
  settBeholdning, åpningsbeholdningFraMystore, historikk,
} = await import("../src/lager.ts");

await migrate();
process.on("exit", () => rmSync(DB, { force: true }));
await settSetting("usd_nok", 10);
await settSetting("min_order_ore", 1);

await db().execute(
  "INSERT INTO sets (code,name,released_at,card_count,parent_code) VALUES ('isd','Innistrad','2011-09-30',264,NULL)"
);
await db().execute({
  sql: `INSERT INTO set_rules (set_code,enabled,wanted_default,wanted_foil,conditions,ladder,buy_pct,updated_at)
        VALUES ('isd',1,40,10,?,?,NULL,'2026-01-01')`,
  args: [JSON.stringify(["NM", "EX"]), JSON.stringify({ NM: 100, EX: 80 })],
});
for (const [id, navn] of [["lil", "Liliana of the Veil"], ["bolt", "Brimstone Volley"]]) {
  await db().execute({
    sql: `INSERT INTO cards (id,oracle_id,name,name_norm,front_norm,back_norm,variant,set_code,
                             collector_number,rarity,usd,usd_foil,has_nonfoil,has_foil,image_uri,released_at)
          VALUES (?,?,?,?,NULL,NULL,'vanlig','isd','1','mythic',10,12,1,1,NULL,'2011-09-30')`,
    args: [id, id, navn, normaliser(navn)],
  });
}

async function nyOrdre(linjer) {
  await db().execute("UPDATE orders SET status = 'cancelled'");
  const o = await lagOrdre({ customer_name: "Kari", email: "kari@example.com", linjer });
  const r = await db().execute({
    sql: `SELECT o.id AS oid, l.id AS lid, l.card_id FROM orders o
            JOIN order_lines l ON l.order_id = o.id WHERE o.order_no = ?
           ORDER BY l.id`,
    args: [o.order_no],
  });
  return { ...o, oid: Number(r.rows[0].oid), linjeIder: r.rows.map((x) => Number(x.lid)) };
}

test("beholdningen er summen av bevegelsene", async () => {
  await førBevegelser([
    { card_id: "lil", finish: "nonfoil", condition: "NM", antall: 4, grunn: "manuell" },
    { card_id: "lil", finish: "nonfoil", condition: "NM", antall: -1, grunn: "salg" },
  ]);
  assert.equal(await beholdningFor("lil", "nonfoil", "NM"), 3);
});

test("tilstand og finish holdes fra hverandre", async () => {
  await førBevegelser([
    { card_id: "lil", finish: "nonfoil", condition: "EX", antall: 2, grunn: "manuell" },
    { card_id: "lil", finish: "foil", condition: "NM", antall: 1, grunn: "manuell" },
  ]);
  assert.equal(await beholdningFor("lil", "nonfoil", "NM"), 3);
  assert.equal(await beholdningFor("lil", "nonfoil", "EX"), 2);
  assert.equal(await beholdningFor("lil", "foil", "NM"), 1);
});

test("oppgjør fører kortene inn på lager", async () => {
  const o = await nyOrdre([
    { card_id: "bolt", finish: "nonfoil", condition: "NM", qty: 3 },
    { card_id: "bolt", finish: "foil", condition: "EX", qty: 2 },
  ]);
  const r = await bokførOrdre(o.oid);
  assert.equal(r.ført, 2);
  assert.equal(await beholdningFor("bolt", "nonfoil", "NM"), 3);
  assert.equal(await beholdningFor("bolt", "foil", "EX"), 2);
});

test("to klikk på «gjør opp» gir ikke kortene to ganger", async () => {
  const o = await nyOrdre([{ card_id: "bolt", finish: "nonfoil", condition: "NM", qty: 5 }]);
  await bokførOrdre(o.oid);
  const igjen = await bokførOrdre(o.oid);
  assert.equal(igjen.ført, 0);
  assert.match(igjen.grunn, /allerede/);
});

test("mottatt antall går foran oppgitt", async () => {
  const før = await beholdningFor("lil", "nonfoil", "NM");
  const o = await nyOrdre([{ card_id: "lil", finish: "nonfoil", condition: "NM", qty: 4 }]);
  // Kunden oppga fire, men bare to lå i konvolutten.
  await regnOmLinje(o.linjeIder[0], { qty_received: 2 });
  await oppdaterTotal(o.oid);
  await bokførOrdre(o.oid);
  assert.equal(await beholdningFor("lil", "nonfoil", "NM"), før + 2);
});

test("fjernede linjer føres ikke inn", async () => {
  const før = await beholdningFor("bolt", "nonfoil", "EX");
  const o = await nyOrdre([
    { card_id: "bolt", finish: "nonfoil", condition: "EX", qty: 3 },
    { card_id: "lil", finish: "nonfoil", condition: "EX", qty: 1 },
  ]);
  await fjernLinje(o.linjeIder[0]);
  await bokførOrdre(o.oid);
  assert.equal(await beholdningFor("bolt", "nonfoil", "EX"), før, "den fjernede kom ikke inn");
});

test("reversering tar kortene ut igjen, som motpost", async () => {
  const før = await beholdningFor("bolt", "nonfoil", "NM");
  const o = await nyOrdre([{ card_id: "bolt", finish: "nonfoil", condition: "NM", qty: 6 }]);
  await bokførOrdre(o.oid);
  assert.equal(await beholdningFor("bolt", "nonfoil", "NM"), før + 6);

  await reverserOrdre(o.oid);
  assert.equal(await beholdningFor("bolt", "nonfoil", "NM"), før);

  // Motpost, ikke sletting: begge linjene skal fortsatt finnes.
  const h = await historikk("bolt", "nonfoil");
  const knyttet = h.filter((x) => Number(x.order_id) === o.oid);
  assert.equal(knyttet.length, 2);
  assert.ok(knyttet.some((x) => x.grunn === "reversert"));
});

test("reversering av en ordre uten bevegelser gjør ingenting", async () => {
  const o = await nyOrdre([{ card_id: "lil", finish: "foil", condition: "NM", qty: 1 }]);
  const r = await reverserOrdre(o.oid);
  assert.equal(r.ført, 0);
});

test("manuell justering oppgis som beholdning, ikke som differanse", async () => {
  await settBeholdning("lil", "foil", "EX", 12);
  assert.equal(await beholdningFor("lil", "foil", "EX"), 12);

  // Teller du og finner sju, skrives differansen som egen bevegelse.
  const r = await settBeholdning("lil", "foil", "EX", 7, "telling");
  assert.equal(r.før, 12);
  assert.equal(r.endring, -5);
  assert.equal(await beholdningFor("lil", "foil", "EX"), 7);
});

test("åpningsbeholdningen hentes fra Mystore, og bare én gang", async () => {
  await db().execute(`INSERT INTO mystore_stock (card_id,finish,qty,product_id,product_name,category,synced_at)
    VALUES ('lil','nonfoil',9,'p1','Liliana','Innistrad','2026-09-11')`);
  const stille = () => {};
  const først = await åpningsbeholdningFraMystore(stille);
  assert.equal(først.kort, 1);
  assert.equal(først.stykker, 9);

  const igjen = await åpningsbeholdningFraMystore(stille);
  assert.equal(igjen.kort, 0, "skal ikke kunne kjøres to ganger");
});

test("historikken forteller hvor kortene kom fra", async () => {
  const h = await historikk("bolt");
  assert.ok(h.length > 0);
  assert.ok(h.some((x) => x.grunn === "ordre" && x.order_no), "ordrenummeret følger med");
});

test("beholdning i bulk gir bare det som faktisk står på lager", async () => {
  const k = await beholdning(["lil", "bolt", "finnes-ikke"]);
  assert.ok(k.has("lil:nonfoil:NM"));
  assert.ok(!k.has("finnes-ikke:nonfoil:NM"));
});
