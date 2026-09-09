import test from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";

const DB = `/tmp/settandel-${process.pid}.db`;
rmSync(DB, { force: true });
process.env.DATABASE_URL = `file:${DB}`;

const { db, migrate, normaliser, settSetting } = await import("../src/db.ts");
const { beregnØre, prisØre, hentSetRule, hentAlleSetRules } = await import("../src/pricing.ts");
const { søk } = await import("../src/catalog.ts");

await migrate();
process.on("exit", () => rmSync(DB, { force: true }));
await settSetting("usd_nok", 9.33);
await settSetting("buy_pct", 70);

async function nyttSett(kode, navn, andel) {
  await db().execute({
    sql: "INSERT INTO sets (code,name,released_at,card_count,parent_code) VALUES (?,?,?,?,NULL)",
    args: [kode, navn, "2020-01-01", 100],
  });
  await db().execute({
    sql: `INSERT INTO set_rules (set_code,enabled,wanted_default,wanted_foil,conditions,ladder,buy_pct,updated_at)
          VALUES (?,1,8,0,?,?,?,'2026-01-01')`,
    args: [kode, JSON.stringify(["NM", "EX"]), JSON.stringify({ NM: 100, EX: 85 }), andel],
  });
  await db().execute({
    sql: `INSERT INTO cards (id,oracle_id,name,name_norm,front_norm,back_norm,variant,set_code,
                             collector_number,rarity,usd,usd_foil,has_nonfoil,has_foil,image_uri,released_at)
          VALUES (?,?,?,?,NULL,NULL,'vanlig',?,'1','rare',100,NULL,1,0,NULL,'2020-01-01')`,
    args: [`k-${kode}`, `k-${kode}`, "Testkort", normaliser("Testkort"), kode],
  });
}

await nyttSett("vil", "Sett jeg vil ha", 80);
await nyttSett("std", "Vanlig sett", null);

test("settets egen sats slår den globale", async () => {
  const regel = await hentSetRule("vil");
  assert.equal(regel.buy_pct, 80);
  // $100 × 9,33 × 80 % = 746,40 kr
  assert.equal(beregnØre(100, "NM", regel, { usd_nok: 9.33, buy_pct: 70, min_buy_ore: 1 }), 74_640);
});

test("uten egen sats gjelder den globale", async () => {
  const regel = await hentSetRule("std");
  assert.equal(regel.buy_pct, null);
  // $100 × 9,33 × 70 % = 653,10 kr
  assert.equal(beregnØre(100, "NM", regel, { usd_nok: 9.33, buy_pct: 70, min_buy_ore: 1 }), 65_310);
});

test("trappen er relativ til settets sats, ikke til markedsprisen", async () => {
  const regel = await hentSetRule("vil");
  const s = { usd_nok: 9.33, buy_pct: 70, min_buy_ore: 1 };
  // EX = 85 % av de 80 prosentene, altså 68 % av markedsprisen.
  assert.equal(beregnØre(100, "EX", regel, s), 63_444);
});

test("satsen gjelder også manuelle dollarpriser", async () => {
  const regel = await hentSetRule("vil");
  const s = { usd_nok: 9.33, buy_pct: 70, min_buy_ore: 1 };
  assert.equal(prisØre({ usd: 100 }, "nonfoil", "NM", regel, s, 13000), 9_703_200);
});

test("null er ikke det samme som null prosent", async () => {
  await db().execute("UPDATE set_rules SET buy_pct = 0 WHERE set_code = 'std'");
  const regel = await hentSetRule("std");
  assert.equal(regel.buy_pct, 0, "0 skal bevares som et bevisst valg");
  assert.equal(beregnØre(100, "NM", regel, { usd_nok: 9.33, buy_pct: 70, min_buy_ore: 1 }), 0);
  await db().execute("UPDATE set_rules SET buy_pct = NULL WHERE set_code = 'std'");
});

test("søket bruker satsen per sett", async () => {
  const treff = await søk({ q: "Testkort" });
  const vil = treff.find((t) => t.set_code === "vil");
  const std = treff.find((t) => t.set_code === "std");
  assert.equal(vil.conditions.find((c) => c.condition === "NM").ore, 74_640);
  assert.equal(std.conditions.find((c) => c.condition === "NM").ore, 65_310);
});

test("alle regler leses med sin egen sats", async () => {
  const alle = await hentAlleSetRules();
  assert.equal(alle.get("vil").buy_pct, 80);
  assert.equal(alle.get("std").buy_pct, null);
});
