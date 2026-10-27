import test from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";

const DB = `/tmp/token-${process.pid}.db`;
rmSync(DB, { force: true });
process.env.DATABASE_URL = `file:${DB}`;
process.env.LAGERKILDE = "bok";

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
  "INSERT INTO sets (code,name,released_at,card_count,parent_code,set_type) VALUES ('tbfz','Battle for Zendikar Tokens','2015-10-02',18,'bfz','token')"
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
    // Et token med pris hos Scryfall kjøpes inn som andre kort.
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

test("tokens med pris tilbys på kjøpssiden når token-settet er slått på", async () => {
  const engel = await søk({ q: "Angel" });
  assert.equal(engel.length, 1);
  assert.ok(engel[0].conditions[0].ore > 0);
  // Uten pris er det ingenting å by — som for andre kort.
  const drage = await søk({ q: "Dragon" });
  assert.ok(drage.every((t) => t.conditions.every((c) => !c.ore)));
});

test("vanlige kort i samme sett er upåvirket", async () => {
  const t = await søk({ q: "Gideon" });
  assert.equal(t.length, 1);
  assert.ok(t[0].conditions[0].ore > 0);
});

test("et token med pris kan bestilles; et uten pris kan ikke", async () => {
  const o = await lagOrdre({
    customer_name: "Kari",
    email: "kari@example.com",
    vilkar_godtatt: true,
    linjer: [{ card_id: "engel", finish: "nonfoil", condition: "NM", qty: 1 }],
  });
  assert.ok(o.order_no);
  await assert.rejects(
    lagOrdre({
      customer_name: "Kari",
      email: "kari@example.com",
      vilkar_godtatt: true,
      linjer: [{ card_id: "drage", finish: "nonfoil", condition: "NM", qty: 1 }],
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

test("butikken viser tokens på lager, også under hovedsettet, men ikke på forsiden", async () => {
  const { butikkvisning } = await import("../src/salgspris.ts");
  const { settManuellSalg } = await import("../src/salgspris.ts");
  await settManuellSalg("drage", "nonfoil", 500);
  const alle = await butikkvisning({ sett: "", q: "Dragon", baresalg: true });
  assert.ok(alle.kort.some((k) => k.id === "drage"));
  const iSettet = await butikkvisning({ sett: "bfz", baresalg: true });
  assert.ok(iSettet.kort.some((k) => k.id === "drage"));
  const forsiden = await butikkvisning({ sett: "", baresalg: true, utenTokens: true });
  assert.ok(!forsiden.kort.some((k) => k.id === "drage"));
});

test("kort på lager uten pris listes, og forsvinner når de får pris", async () => {
  const { utenPrisPåLager, settManuellSalg } = await import("../src/salgspris.ts");
  await settManuellSalg("drage", "nonfoil", null);
  let liste = await utenPrisPåLager();
  assert.ok(liste.some((k) => k.card_id === "drage" && k.antall === 25 && k.er_token));
  await settManuellSalg("drage", "nonfoil", 500);
  liste = await utenPrisPåLager();
  assert.ok(!liste.some((k) => k.card_id === "drage"));
});

test("søk på «token» finner tokens, også sammen med navnet", async () => {
  const { butikkvisning } = await import("../src/salgspris.ts");
  const a = await butikkvisning({ sett: "", q: "token", baresalg: true });
  assert.ok(a.kort.some((k) => k.id === "drage"));
  const b = await butikkvisning({ sett: "", q: "Dragon Token", baresalg: true });
  assert.ok(b.kort.some((k) => k.id === "drage"));
});

test("tokens vises som «Navn Token» i butikken", async () => {
  const { butikkvisning, tokenNavn } = await import("../src/salgspris.ts");
  const a = await butikkvisning({ sett: "", q: "Dragon Token", baresalg: true });
  assert.equal(a.kort.find((k) => k.id === "drage").name, "Dragon Token");
  assert.equal(tokenNavn("Wrenn and Six Emblem", 1), "Wrenn and Six Emblem");
  assert.equal(tokenNavn("Lightning Bolt", 0), "Lightning Bolt");
});

test("kort på lager uten pris telles ikke i fanene (ingen tom liste med tall over)", async () => {
  const { butikkvisning, settManuellSalg } = await import("../src/salgspris.ts");
  await settManuellSalg("drage", "nonfoil", null);
  const r = await butikkvisning({ sett: "", q: "Dragon", baresalg: true });
  assert.equal(r.totalt, 0);
  assert.equal(r.kort.length, 0);
  await settManuellSalg("drage", "nonfoil", 500);
  const r2 = await butikkvisning({ sett: "", q: "Dragon", baresalg: true });
  assert.equal(r2.totalt, 1);
  assert.equal(r2.kort.length, 1);
});
