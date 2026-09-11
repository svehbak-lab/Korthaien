import test from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";

const DB = `/tmp/kortcond-${process.pid}.db`;
rmSync(DB, { force: true });
process.env.DATABASE_URL = `file:${DB}`;

const { db, migrate, normaliser, settSetting } = await import("../src/db.ts");
const { søk } = await import("../src/catalog.ts");
const { lagOrdre } = await import("../src/orders.ts");

await migrate();
process.on("exit", () => rmSync(DB, { force: true }));
await settSetting("usd_nok", 10);
await settSetting("min_order_ore", 1);

await db().execute(
  "INSERT INTO sets (code,name,released_at,card_count,parent_code) VALUES ('leb','Beta','1993-10-04',302,NULL)"
);
// Settet tar bare NM, men trappen har satser for alle fire.
await db().execute({
  sql: `INSERT INTO set_rules (set_code,enabled,wanted_default,wanted_foil,conditions,ladder,buy_pct,updated_at)
        VALUES ('leb',1,8,0,?,?,NULL,'2026-01-01')`,
  args: [JSON.stringify(["NM"]), JSON.stringify({ NM: 100, EX: 85, VG: 70, G: 55 })],
});
for (const [id, navn] of [["lotus", "Black Lotus"], ["bolt", "Lightning Bolt"]]) {
  await db().execute({
    sql: `INSERT INTO cards (id,oracle_id,name,name_norm,front_norm,back_norm,variant,set_code,
                             collector_number,rarity,usd,usd_foil,has_nonfoil,has_foil,image_uri,released_at)
          VALUES (?,?,?,?,NULL,NULL,'vanlig','leb','1','rare',100,NULL,1,0,NULL,'1993-10-04')`,
    args: [id, id, navn, normaliser(navn)],
  });
}

test("uten egen regel følger kortet settet", async () => {
  const t = await søk({ q: "Black Lotus" });
  assert.deepEqual(t[0].conditions.map((c) => c.condition), ["NM"]);
});

test("en tilstand settet ikke tar, kan ikke bestilles via API-et heller", async () => {
  // Trappen har en sats for G, men settet tar bare NM. Uten sjekken ville
  // denne fått pris.
  await assert.rejects(
    lagOrdre({
      customer_name: "Kari",
      email: "kari@example.com",
      linjer: [{ card_id: "lotus", finish: "nonfoil", condition: "G", qty: 1 }],
    }),
    /Ingen av kortene/
  );
});

test("egen regel på ett kort slår settets", async () => {
  await db().execute({
    sql: `INSERT INTO card_conditions (card_id, conditions, updated_at)
          VALUES ('lotus', ?, '2026-09-10')`,
    args: [JSON.stringify(["NM", "EX", "VG", "G"])],
  });

  const t = await søk({ q: "Black Lotus" });
  assert.deepEqual(t[0].conditions.map((c) => c.condition), ["NM", "EX", "VG", "G"]);
  // $100 × 10 × 70 % × 55 % = 385 kr
  assert.equal(t[0].conditions.find((c) => c.condition === "G").ore, 38500);
});

test("de andre kortene i settet er upåvirket", async () => {
  const t = await søk({ q: "Lightning Bolt" });
  assert.deepEqual(t[0].conditions.map((c) => c.condition), ["NM"]);
});

test("nå kan kortet bestilles i den dårlige tilstanden", async () => {
  const o = await lagOrdre({
    customer_name: "Kari",
    email: "kari@example.com",
    linjer: [{ card_id: "lotus", finish: "nonfoil", condition: "G", qty: 1 }],
  });
  assert.equal(o.linjer[0].unit_ore, 38500);
});

test("fjernes regelen, følger kortet settet igjen", async () => {
  await db().execute("DELETE FROM card_conditions WHERE card_id = 'lotus'");
  const t = await søk({ q: "Black Lotus" });
  assert.deepEqual(t[0].conditions.map((c) => c.condition), ["NM"]);
});
