import test from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";

const DB = `/tmp/serial-${process.pid}.db`;
rmSync(DB, { force: true });
process.env.DATABASE_URL = `file:${DB}`;

const { db, migrate, normaliser, settSetting } = await import("../src/db.ts");
const { skrivBolk } = await import("../src/import-scryfall.ts");
const { søk, løsBulk } = await import("../src/catalog.ts");
const { parseBulk } = await import("../src/bulk.ts");
const { lagOrdre } = await import("../src/orders.ts");

await migrate();
process.on("exit", () => rmSync(DB, { force: true }));
await settSetting("min_order_ore", 1);
await settSetting("usd_nok", 10);

await db().execute(
  "INSERT INTO sets (code,name,released_at,card_count,parent_code) VALUES ('lci','Lost Caverns','2023-11-17',291,NULL)"
);
await db().execute({
  sql: `INSERT INTO set_rules (set_code,enabled,wanted_default,wanted_foil,conditions,ladder,buy_pct,updated_at)
        VALUES ('lci',1,8,8,?,?,NULL,'2026-01-01')`,
  args: [JSON.stringify(["NM"]), JSON.stringify({ NM: 100 })],
});

await skrivBolk([
  {
    id: "vanlig", oracle_id: "mary", name: "Mary Read and Anne Bonny", set: "lci",
    collector_number: "120", rarity: "rare", finishes: ["nonfoil", "foil"],
    released_at: "2023-11-17", prices: { usd: "1.20", usd_foil: "2.50" },
    type_line: "Legendary Creature — Human Pirate", layout: "normal",
  },
  {
    // Samme kort, men serienummerert. Prisen sier ingenting om hva et vanlig
    // eksemplar er verdt.
    id: "serial", oracle_id: "mary", name: "Mary Read and Anne Bonny", set: "lci",
    collector_number: "0120", rarity: "rare", finishes: ["foil"],
    released_at: "2023-11-17", prices: { usd: null, usd_foil: "780.00" },
    type_line: "Legendary Creature — Human Pirate", layout: "normal",
    promo_types: ["serialized", "borderless"],
  },
]);

test("serienummererte kort merkes ved import", async () => {
  const r = await db().execute("SELECT id, er_serialized FROM cards ORDER BY id");
  const kart = Object.fromEntries(r.rows.map((x) => [x.id, Number(x.er_serialized)]));
  assert.equal(kart.serial, 1);
  assert.equal(kart.vanlig, 0);
});

test("de vises ikke på kjøpssiden", async () => {
  const t = await søk({ q: "Mary Read" });
  assert.equal(t.length, 2, "vanlig og foil av det ordinære kortet");
  assert.ok(t.every((x) => x.card_id === "vanlig"));
});

test("de kommer ikke opp i bulk heller", async () => {
  const r = await løsBulk(parseBulk("1 Mary Read and Anne Bonny"));
  const ider = r[0].valg.map((v) => v.card_id);
  assert.ok(!ider.includes("serial"));
});

test("og kan ikke bestilles rett mot API-et", async () => {
  await assert.rejects(
    lagOrdre({
      customer_name: "Kari",
      email: "kari@example.com",
      linjer: [{ card_id: "serial", finish: "foil", condition: "NM", qty: 1 }],
    }),
    /Ingen av kortene/
  );
});

test("det ordinære kortet er upåvirket", async () => {
  const t = await søk({ q: "Mary Read" });
  const foil = t.find((x) => x.finish === "foil");
  assert.ok(foil.conditions[0].ore > 0);
});
