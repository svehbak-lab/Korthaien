import test from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";

const DB = `/tmp/terskel-${process.pid}.db`;
rmSync(DB, { force: true });
process.env.DATABASE_URL = `file:${DB}`;

const { db, migrate, normaliser, settSetting } = await import("../src/db.ts");
const { prisØre } = await import("../src/pricing.ts");
const { søk } = await import("../src/catalog.ts");
const { lagOrdre } = await import("../src/orders.ts");

await migrate();
process.on("exit", () => rmSync(DB, { force: true }));
await settSetting("usd_nok", 10);
await settSetting("min_order_ore", 1);

await db().execute(
  "INSERT INTO sets (code,name,released_at,card_count,parent_code) VALUES ('tst','Testsett','2020-01-01',300,NULL)"
);
await db().execute({
  sql: `INSERT INTO set_rules (set_code,enabled,wanted_default,wanted_foil,conditions,ladder,buy_pct,updated_at)
        VALUES ('tst',1,8,0,?,?,NULL,'2026-01-01')`,
  args: [JSON.stringify(["NM"]), JSON.stringify({ NM: 100 })],
});
async function kort(id, navn, raritet, usd) {
  await db().execute({
    sql: `INSERT INTO cards (id,oracle_id,name,name_norm,front_norm,back_norm,variant,set_code,
                             collector_number,rarity,usd,usd_foil,has_nonfoil,has_foil,image_uri,released_at)
          VALUES (?,?,?,?,NULL,NULL,'vanlig','tst','1',?,?,NULL,1,0,NULL,'2020-01-01')`,
    args: [id, id, navn, normaliser(navn), raritet, usd],
  });
}
await kort("bulk", "Billig Common", "common", 0.08);
await kort("greit", "Dyr Common", "common", 2.0);
await kort("unc", "Billig Uncommon", "uncommon", 0.2);
await kort("sjelden", "Billig Rare", "rare", 0.15);

const s = { usd_nok: 10, buy_pct: 70, min_buy_ore: 1, min_usd: { common: 0.5, uncommon: 0.5 } };
const trapp = { ladder: { NM: 100 } };

test("kort under terskelen for sin sjeldenhet kjøpes ikke", () => {
  assert.equal(prisØre({ usd: 0.08, rarity: "common" }, "nonfoil", "NM", trapp, s), 0);
  assert.equal(prisØre({ usd: 0.2, rarity: "uncommon" }, "nonfoil", "NM", trapp, s), 0);
});

test("over terskelen kjøpes det som før", () => {
  // $2 × 10 × 70 % = 14 kr
  assert.equal(prisØre({ usd: 2, rarity: "common" }, "nonfoil", "NM", trapp, s), 1400);
});

test("sjeldenheter uten terskel rammes ikke", () => {
  assert.equal(prisØre({ usd: 0.15, rarity: "rare" }, "nonfoil", "NM", trapp, s), 105);
  assert.equal(prisØre({ usd: 0.15, rarity: null }, "nonfoil", "NM", trapp, s), 105);
});

test("en manuell pris måles mot samme terskel", () => {
  // Scryfall sier 0.08, men du har satt 3 selv — da gjelder din.
  assert.equal(prisØre({ usd: 0.08, rarity: "common" }, "nonfoil", "NM", trapp, s, 3), 2100);
  // Og setter du den lavt selv, stenger terskelen fortsatt.
  assert.equal(prisØre({ usd: 5, rarity: "common" }, "nonfoil", "NM", trapp, s, 0.1), 0);
});

test("terskelen skjuler kortene fra søket", async () => {
  const før = await søk({ q: "Billig" });
  assert.equal(før.length, 3, "uten terskel vises alle tre");

  await settSetting("min_usd", { common: 0.5, uncommon: 0.5, rare: 0, mythic: 0 });
  const etter = await søk({ q: "Billig" });
  assert.equal(etter.length, 1);
  assert.equal(etter[0].name, "Billig Rare");
});

test("terskelen gjelder også en ordre sendt rett mot API-et", async () => {
  await assert.rejects(
    lagOrdre({
      customer_name: "Kari",
      email: "kari@example.com",
      linjer: [{ card_id: "bulk", finish: "nonfoil", condition: "NM", qty: 1 }],
    }),
    /Ingen av kortene/
  );
});
