import test from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";

const DB = `/tmp/visning-${process.pid}.db`;
rmSync(DB, { force: true });
process.env.DATABASE_URL = `file:${DB}`;

const { db, migrate, normaliser, settSetting } = await import("../src/db.ts");
const { søk } = await import("../src/catalog.ts");
const { lagOrdre } = await import("../src/orders.ts");
const { parseBulk } = await import("../src/bulk.ts");
const { løsBulk } = await import("../src/catalog.ts");

await migrate();
process.on("exit", () => rmSync(DB, { force: true }));
await settSetting("min_order_ore", 1);

await db().execute(
  "INSERT INTO sets (code,name,released_at,card_count,parent_code) VALUES ('leb','Limited Edition Beta','1993-10-04',302,NULL)"
);
await db().execute({
  sql: `INSERT INTO set_rules (set_code,enabled,wanted_default,wanted_foil,conditions,ladder,buy_pct,updated_at)
        VALUES ('leb',1,8,0,?,?,NULL,'2026-01-01')`,
  args: [JSON.stringify(["NM"]), JSON.stringify({ NM: 100 })],
});
await db().execute({
  sql: `INSERT INTO cards (id,oracle_id,name,name_norm,front_norm,back_norm,variant,set_code,
                           collector_number,rarity,usd,usd_foil,has_nonfoil,has_foil,image_uri,released_at)
        VALUES ('bolt','bolt','Lightning Bolt',?,NULL,NULL,'vanlig','leb','162','common',50,NULL,1,0,NULL,'1993-10-04')`,
  args: [normaliser("Lightning Bolt")],
});

test("uten eget navn brukes Scryfalls", async () => {
  const t = await søk({ q: "Lightning Bolt" });
  assert.equal(t[0].set_name, "Limited Edition Beta");
});

test("eget navn slår gjennom i søket", async () => {
  await db().execute("UPDATE sets SET visningsnavn = 'Beta' WHERE code = 'leb'");
  const t = await søk({ q: "Lightning Bolt" });
  assert.equal(t[0].set_name, "Beta");
});

test("eget navn følger med i bulk og fryses på ordren", async () => {
  const r = await løsBulk(parseBulk("2 Lightning Bolt"));
  assert.equal(r[0].valg[0].set_name, "Beta");

  const o = await lagOrdre({
    customer_name: "Kari",
    email: "kari@example.com",
    linjer: [{ card_id: "bolt", finish: "nonfoil", condition: "NM", qty: 1 }],
  });
  assert.equal(o.linjer[0].set_name, "Beta");
});

test("Scryfall-navnet blir stående, så importen kan oppdatere det", async () => {
  const r = await db().execute("SELECT name, visningsnavn FROM sets WHERE code = 'leb'");
  assert.equal(r.rows[0].name, "Limited Edition Beta");
  assert.equal(r.rows[0].visningsnavn, "Beta");
});

test("tomt navn gir Scryfalls tilbake", async () => {
  await db().execute("UPDATE sets SET visningsnavn = NULL WHERE code = 'leb'");
  const t = await søk({ q: "Lightning Bolt" });
  assert.equal(t[0].set_name, "Limited Edition Beta");
});
