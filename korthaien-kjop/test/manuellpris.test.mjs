import test from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";

const DB = `/tmp/manuell-${process.pid}.db`;
rmSync(DB, { force: true });
process.env.DATABASE_URL = `file:${DB}`;

const { db, migrate, normaliser, settSetting } = await import("../src/db.ts");
const { prisØre } = await import("../src/pricing.ts");
const { søk } = await import("../src/catalog.ts");
const { lagOrdre } = await import("../src/orders.ts");

await migrate();
process.on("exit", () => rmSync(DB, { force: true }));
await settSetting("usd_nok", 9.33);

await db().execute(
  "INSERT INTO sets (code,name,released_at,card_count,parent_code) VALUES ('leb','Limited Edition Beta','1993-10-04',302,NULL)"
);
// Beta tar NM, EX og VG med hver sin sats.
await db().execute({
  sql: `INSERT INTO set_rules (set_code,enabled,wanted_default,wanted_foil,conditions,ladder,updated_at)
        VALUES ('leb',1,8,0,?,?,'2026-01-01')`,
  args: [JSON.stringify(["NM", "EX", "VG"]), JSON.stringify({ NM: 100, EX: 85, VG: 70 })],
});
await db().execute({
  sql: `INSERT INTO cards (id,oracle_id,name,name_norm,front_norm,back_norm,variant,set_code,
                           collector_number,rarity,usd,usd_foil,has_nonfoil,has_foil,image_uri,released_at)
        VALUES ('jet','jet','Mox Jet',?,NULL,NULL,'vanlig','leb','262','rare',4000,NULL,1,0,NULL,'1993-10-04')`,
  args: [normaliser("Mox Jet")],
});

const trapp = { ladder: { NM: 100, EX: 85, VG: 70, G: 55 } };
const s = { usd_nok: 9.33, buy_pct: 70, min_buy_ore: 1 };

test("manuell dollarpris går gjennom kurs, buy_pct og trapp", () => {
  // Card Kingdom tar $13 000. 13 000 × 9,33 × 70 % = 84 903 kr for NM.
  assert.equal(prisØre({ usd: 4000 }, "nonfoil", "NM", trapp, s, 13000), 8_490_300);
  assert.equal(prisØre({ usd: 4000 }, "nonfoil", "EX", trapp, s, 13000), 7_216_755);
  assert.equal(prisØre({ usd: 4000 }, "nonfoil", "VG", trapp, s, 13000), 5_943_210);
  assert.equal(prisØre({ usd: 4000 }, "nonfoil", "G", trapp, s, 13000), 4_669_665);
});

test("uten manuell pris gjelder Scryfall som før", () => {
  // $4000 × 9,33 × 70 % = 26 124 kr
  assert.equal(prisØre({ usd: 4000 }, "nonfoil", "NM", trapp, s, null), 2_612_400);
});

test("en condition uten sats i trappen kjøpes ikke, også med manuell pris", () => {
  const beta = { ladder: { NM: 100, EX: 80 } };
  assert.equal(prisØre({ usd: 4000 }, "nonfoil", "G", beta, s, 13000), 0);
});

test("søket viser den manuelle prisen, ikke Scryfall-prisen", async () => {
  const før = await søk({ q: "Mox Jet" });
  assert.equal(før[0].conditions.find((c) => c.condition === "NM").ore, 2_612_400);

  await db().execute({
    sql: `INSERT INTO card_prices (card_id, finish, usd, kilde, updated_at)
          VALUES ('jet','nonfoil',13000,'Card Kingdom','2026-09-08')`,
  });

  const etter = await søk({ q: "Mox Jet" });
  const c = etter[0].conditions;
  assert.equal(c.find((x) => x.condition === "NM").ore, 8_490_300);
  assert.equal(c.find((x) => x.condition === "EX").ore, 7_216_755);
  assert.equal(c.find((x) => x.condition === "VG").ore, 5_943_210);
});

test("ordren fryser den manuelle prisen, ikke Scryfall-prisen", async () => {
  const o = await lagOrdre({
    customer_name: "Kari Nordmann",
    email: "kari@example.com",
    linjer: [{ card_id: "jet", finish: "nonfoil", condition: "EX", qty: 1 }],
  });
  assert.equal(o.linjer[0].unit_ore, 7_216_755);
  assert.equal(o.total_ore, 7_216_755);
});
