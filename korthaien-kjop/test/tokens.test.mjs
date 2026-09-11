import test from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";

const DB = `/tmp/token-${process.pid}.db`;
rmSync(DB, { force: true });
process.env.DATABASE_URL = `file:${DB}`;

const { db, migrate, normaliser, settSetting } = await import("../src/db.ts");
const { skrivBolk } = await import("../src/import-scryfall.ts");
const { søk } = await import("../src/catalog.ts");
const { lagOrdre } = await import("../src/orders.ts");
const { førBevegelser, beholdningFor } = await import("../src/lager.ts");

await migrate();
process.on("exit", () => rmSync(DB, { force: true }));
await settSetting("min_order_ore", 1);

// Token-settet peker på hovedsettet, slik Scryfall gjør det.
await db().execute(
  "INSERT INTO sets (code,name,released_at,card_count,parent_code) VALUES ('bfz','Battle for Zendikar','2015-10-02',274,NULL)"
);
await db().execute(
  "INSERT INTO sets (code,name,released_at,card_count,parent_code) VALUES ('tbfz','Battle for Zendikar Tokens','2015-10-02',18,'bfz')"
);
for (const kode of ["bfz", "tbfz"]) {
  await db().execute({
    sql: `INSERT INTO set_rules (set_code,enabled,wanted_default,wanted_foil,conditions,ladder,buy_pct,updated_at)
          VALUES (?,1,8,8,?,?,NULL,'2026-01-01')`,
    args: [kode, JSON.stringify(["NM"]), JSON.stringify({ NM: 100 })],
  });
}

await skrivBolk([
  {
    id: "drage", oracle_id: "o-drage", name: "Dragon", set: "tbfz",
    collector_number: "8", rarity: "common", finishes: ["nonfoil", "foil"],
    released_at: "2015-10-02", prices: { usd: null, usd_foil: null },
    layout: "token", type_line: "Token Creature — Dragon",
    image_uris: { normal: "https://cards.scryfall.io/normal/drage.jpg" },
  },
  {
    // Et token med pris hos Scryfall skal likevel ikke kunne kjøpes inn.
    id: "engel", oracle_id: "o-engel", name: "Angel", set: "tbfz",
    collector_number: "3", rarity: "common", finishes: ["nonfoil"],
    released_at: "2015-10-02", prices: { usd: "1.50", usd_foil: null },
    layout: "token", type_line: "Token Creature — Angel",
  },
  {
    id: "ekte", oracle_id: "o-ekte", name: "Gideon, Ally of Zendikar", set: "bfz",
    collector_number: "29", rarity: "mythic", finishes: ["nonfoil"],
    released_at: "2015-10-02", prices: { usd: "12.00", usd_foil: null },
    layout: "normal", type_line: "Legendary Planeswalker — Gideon",
  },
]);

test("tokens merkes ved import", async () => {
  const r = await db().execute("SELECT id, er_token FROM cards ORDER BY id");
  const kart = Object.fromEntries(r.rows.map((x) => [x.id, Number(x.er_token)]));
  assert.equal(kart.drage, 1);
  assert.equal(kart.engel, 1);
  assert.equal(kart.ekte, 0);
});

test("tokens tilbys ikke på kjøpssiden, selv med pris", async () => {
  assert.deepEqual(await søk({ q: "Angel" }), []);
  assert.deepEqual(await søk({ q: "Dragon" }), []);
});

test("vanlige kort i samme sett er upåvirket", async () => {
  const t = await søk({ q: "Gideon" });
  assert.equal(t.length, 1);
  assert.ok(t[0].conditions[0].ore > 0);
});

test("et token kan ikke bestilles rett mot API-et heller", async () => {
  await assert.rejects(
    lagOrdre({
      customer_name: "Kari",
      email: "kari@example.com",
      linjer: [{ card_id: "engel", finish: "nonfoil", condition: "NM", qty: 1 }],
    }),
    /Ingen av kortene/
  );
});

test("men tokens kan ligge på lager, siden de selges", async () => {
  await førBevegelser([
    { card_id: "drage", finish: "nonfoil", condition: "NM", antall: 25, grunn: "manuell" },
  ]);
  assert.equal(await beholdningFor("drage", "nonfoil", "NM"), 25);
});
