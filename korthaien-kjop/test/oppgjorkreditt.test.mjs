// Kjøpsordre gjort opp som kreditt (etter overgangen): kreditten føres på
// e-postadressen, én gang, og ordren merkes som gjort opp uten kode.
import test from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";

const DB = `/tmp/oppgjorkreditt-${process.pid}.db`;
rmSync(DB, { force: true });
process.env.DATABASE_URL = `file:${DB}`;
delete process.env.RESEND_KEY;

const { db, migrate } = await import("../src/db.ts");
const { gjørOppSomKreditt } = await import("../src/orders.ts");
const { saldo } = await import("../src/kreditt.ts");

await migrate();
process.on("exit", () => rmSync(DB, { force: true }));

test("oppgjør som kreditt føres én gang på e-postadressen", async () => {
  const nå = new Date().toISOString();
  const r = await db().execute({
    sql: `INSERT INTO orders (order_no, customer_name, email, status, total_nok, total_ore, quoted_ore, created_at, expires_at)
          VALUES ('K-1001', 'Ola', ' Ola@Eksempel.no ', 'received', 123, 12345, 12345, ?, ?) RETURNING id`,
    args: [nå, nå],
  });
  const id = Number(r.rows[0].id);
  await gjørOppSomKreditt(id, "Ett kort var EX");
  await gjørOppSomKreditt(id, "Ett kort var EX");
  assert.equal(await saldo("ola@eksempel.no"), 12345);
  const o = (await db().execute({ sql: "SELECT * FROM orders WHERE id = ?", args: [id] })).rows[0];
  assert.equal(o.discount_code, null);
  assert.ok(o.credit_sent_at);
  assert.equal(o.credit_note, "Ett kort var EX");
});
