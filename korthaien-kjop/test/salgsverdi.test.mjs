// Salgsverdien på kjøpsordrer: dine salgspriser × tilstand × mottatt antall.
import test from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";

const DB = `/tmp/salgsverdi-${process.pid}.db`;
rmSync(DB, { force: true });
process.env.DATABASE_URL = `file:${DB}`;

const { db, migrate } = await import("../src/db.ts");
const { oppdaterSalgsverdi } = await import("../src/orders.ts");
const { settManuellSalg } = await import("../src/salgspris.ts");
const { ordreStatistikk } = await import("../src/statistikk.ts");
await migrate();
process.on("exit", () => rmSync(DB, { force: true }));

test("salgsverdien følger tilstand, mottatt antall og fjernede linjer", async () => {
  await db().execute("INSERT INTO sets (code,name,released_at,card_count) VALUES ('aaa','Alfa','2020-01-01',10)");
  for (const id of ["a", "b"]) {
    await db().execute({
      sql: `INSERT INTO cards (id,oracle_id,name,name_norm,set_code,collector_number,rarity,usd,has_nonfoil,has_foil)
            VALUES (?,?,?,?, 'aaa','1','rare',1,1,0)`,
      args: [id, id, id, id],
    });
    await settManuellSalg(id, "nonfoil", 10000);
  }
  const nå = new Date().toISOString();
  const o = await db().execute({
    sql: `INSERT INTO orders (order_no, customer_name, email, status, total_ore, created_at, expires_at)
          VALUES ('K-1','Kari','k@x.no','received', 5000, ?, ?) RETURNING id`,
    args: [nå, nå],
  });
  const id = Number(o.rows[0].id);
  const linje = (card, cond, qty, mottatt, fjernet = null) => db().execute({
    sql: `INSERT INTO order_lines (order_id, card_id, finish, condition, qty, qty_received, unit_nok, unit_ore, card_name, set_code, set_name, fjernet_at)
          VALUES (?, ?, 'nonfoil', ?, ?, ?, 0, 1000, ?, 'aaa', 'Alfa', ?)`,
    args: [id, card, cond, qty, mottatt, card, fjernet],
  });
  await linje("a", "NM", 2, null);     // 2 × 100 kr
  await linje("b", "EX", 3, 1);        // 1 mottatt × 85 kr
  await linje("a", "NM", 5, null, nå); // fjernet
  await oppdaterSalgsverdi([id]);
  const r = await db().execute({ sql: "SELECT salgsverdi_ore FROM orders WHERE id = ?", args: [id] });
  assert.equal(Number(r.rows[0].salgsverdi_ore), 20000 + 8500);
  const st = await ordreStatistikk();
  assert.equal(st.denneMåneden.salg_ore, 28500);
});
