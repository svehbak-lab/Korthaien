import test from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";

const DB = `/tmp/frist-${process.pid}.db`;
rmSync(DB, { force: true });
process.env.DATABASE_URL = `file:${DB}`;
const { db, migrate } = await import("../src/db.ts");
await migrate();
process.on("exit", () => rmSync(DB, { force: true }));
const { forlengÅpneOrdrer } = await import("../src/orders.ts");

const ny = (nr, status, laget, utløp) => db().execute({
  sql: `INSERT INTO orders (order_no, customer_name, email, phone, status, total_nok, total_ore, created_at, expires_at)
        VALUES (?, 'K', 'k@x.no', '1', ?, 0, 0, ?, ?)`,
  args: [nr, status, laget, utløp],
});
const frist = async (nr) => (await db().execute({ sql: "SELECT expires_at FROM orders WHERE order_no = ?", args: [nr] })).rows[0].expires_at;

test("økt frist forlenger åpne ordrer, ikke avsluttede, og korter aldri ned", async () => {
  await ny("K-1", "pending", "2026-10-22T10:00:00.000Z", "2026-11-21T10:00:00.000Z");
  await ny("K-2", "received", "2026-10-22T10:00:00.000Z", "2026-11-21T10:00:00.000Z");
  await ny("K-3", "pending", "2026-10-22T10:00:00.000Z", "2027-01-30T10:00:00.000Z");
  assert.equal(await forlengÅpneOrdrer(60), 1);
  assert.equal(await frist("K-1"), "2026-12-21T10:00:00.000Z");
  assert.equal(await frist("K-2"), "2026-11-21T10:00:00.000Z");
  assert.equal(await frist("K-3"), "2027-01-30T10:00:00.000Z");
});

test("gjenåpnet utløpt ordre får ny frist og utløper ikke igjen med en gang", async () => {
  const { nyFristVedGjenåpning, utløpGamleOrdrer } = await import("../src/orders.ts");
  await ny("K-9", "expired", "2026-01-01T10:00:00.000Z", "2026-03-01T10:00:00.000Z");
  const id = Number((await db().execute("SELECT id FROM orders WHERE order_no = 'K-9'")).rows[0].id);
  await db().execute({ sql: "UPDATE orders SET status = 'pending' WHERE id = ?", args: [id] });
  await nyFristVedGjenåpning(id);
  assert.ok(String(await frist("K-9")) > new Date().toISOString());
  await utløpGamleOrdrer();
  const st = (await db().execute({ sql: "SELECT status FROM orders WHERE id = ?", args: [id] })).rows[0].status;
  assert.equal(st, "pending");
});
