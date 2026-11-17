import test from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";

const DB = `/tmp/lagersaldo-${process.pid}.db`;
rmSync(DB, { force: true });
process.env.DATABASE_URL = `file:${DB}`;
const { db, migrate } = await import("../src/db.ts");
await migrate();
process.on("exit", () => rmSync(DB, { force: true }));
const { kontrollerLagersaldo } = await import("../src/lagersaldo.ts");

const før = (card, antall, dato = "2026-11-01") => db().execute({
  sql: "INSERT INTO lager_bevegelser (card_id,finish,condition,antall,grunn,created_at) VALUES (?, 'nonfoil', 'NM', ?, 'manuell', ?)",
  args: [card, antall, dato],
});
const saldo = async (card) => (await db().execute({ sql: "SELECT antall, sist_inn FROM lager_saldo WHERE card_id = ?", args: [card] })).rows[0];

test("saldoen følger bevegelsene: inn, ut, endring og sletting", async () => {
  await før("a", 3, "2026-11-01");
  await før("a", 2, "2026-11-05");
  await før("a", -1, "2026-11-09");
  let s = await saldo("a");
  assert.equal(Number(s.antall), 4);
  assert.equal(s.sist_inn, "2026-11-05");
  await db().execute("UPDATE lager_bevegelser SET antall = 5 WHERE card_id = 'a' AND antall = 3");
  assert.equal(Number((await saldo("a")).antall), 6);
  await db().execute("DELETE FROM lager_bevegelser WHERE card_id = 'a' AND antall = -1");
  assert.equal(Number((await saldo("a")).antall), 7);
  assert.equal(await kontrollerLagersaldo(), 0);
});

test("kontrollen bygger saldoen på nytt når den har sklidd", async () => {
  await db().execute("UPDATE lager_saldo SET antall = 99 WHERE card_id = 'a'");
  assert.equal(await kontrollerLagersaldo(), 1);
  assert.equal(Number((await saldo("a")).antall), 7);
});
