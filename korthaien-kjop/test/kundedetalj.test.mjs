// Kundesiden i admin: konto, kjøp, salg til butikken og ønskeliste for én
// e-postadresse — også ordrer lagt som gjest og med annen skrivemåte.
import test from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";

const DB = `/tmp/kundedetalj-${process.pid}.db`;
rmSync(DB, { force: true });
process.env.DATABASE_URL = `file:${DB}`;
delete process.env.RESEND_KEY;

const { db, migrate } = await import("../src/db.ts");
const konto = await import("../src/kunder.ts");
await migrate();
process.on("exit", () => rmSync(DB, { force: true }));
const nå = new Date().toISOString();

test("kunden med kjøp, salg til butikken og ønskeliste", async () => {
  const k = await konto.registrer({ email: "kari@eksempel.no", passord: "passord123", navn: "Kari" });
  const so = (nr, status, stripe, kreditt, kunde = k.id, email = "kari@eksempel.no") =>
    db().execute({
      sql: `INSERT INTO salgsordrer (ordrenr, kunde_navn, email, kunde_id, status, created_at, betalt_at, antall_kort, stripe_ore, kreditt_ore)
            VALUES (?, 'Kari', ?, ?, ?, ?, ?, 2, ?, ?)`,
      args: [nr, email, kunde, status, nå, nå, stripe, kreditt],
    });
  await so("S-1", "sendt", 10000, 5000);
  await so("S-2", "kansellert", 3000, 0);
  await so("S-3", "utlopt", 3000, 0); // forlatt kasse, vises ikke
  await so("S-4", "betalt", 2000, 0, null, "KARI@eksempel.no"); // gjest, annen skrivemåte
  await db().execute({
    sql: `INSERT INTO orders (order_no, customer_name, email, status, total_nok, total_ore, quoted_ore, created_at, expires_at, credit_sent_at)
          VALUES ('K-1', 'Kari', ' Kari@Eksempel.no ', 'stocked', 80, 8000, 9000, ?, ?, ?)`,
    args: [nå, nå, nå],
  });
  await db().execute({
    sql: `INSERT INTO orders (order_no, customer_name, email, status, total_nok, total_ore, quoted_ore, created_at, expires_at)
          VALUES ('K-2', 'Kari', 'kari@eksempel.no', 'pending', 0, 0, 4000, ?, ?)`,
    args: [nå, nå],
  });
  await db().execute({
    sql: "INSERT INTO onskeliste (kunde_id, oracle_id, navn, created_at) VALUES (?, 'x', 'Ragavan', ?)",
    args: [k.id, nå],
  });

  const d = await konto.kundeDetalj("Kari@Eksempel.no");
  assert.equal(d.kunde.navn, "Kari");
  assert.deepEqual(d.salgsordrer.map((o) => o.ordrenr).sort(), ["S-1", "S-2", "S-4"]);
  assert.deepEqual(d.kjøpsordrer.map((o) => o.order_no).sort(), ["K-1", "K-2"]);
  // Kjøpt: S-1 (150 kr) og S-4 (20 kr); den kansellerte teller ikke.
  assert.equal(d.tall.kjøpt_ore, 17000);
  assert.equal(d.tall.kjøpt_ordrer, 2);
  // Solgt: bare den oppgjorte.
  assert.equal(d.tall.solgt_ore, 8000);
  assert.equal(d.tall.solgt_ordrer, 1);
  assert.equal(d.ønskeliste[0].navn, "Ragavan");
});

test("adresse uten konto viser ordrene likevel", async () => {
  await db().execute({
    sql: `INSERT INTO orders (order_no, customer_name, email, status, total_nok, total_ore, quoted_ore, created_at, expires_at)
          VALUES ('K-9', 'Per', 'per@eksempel.no', 'received', 0, 0, 1000, ?, ?)`,
    args: [nå, nå],
  });
  const d = await konto.kundeDetalj("per@eksempel.no");
  assert.equal(d.kunde, null);
  assert.equal(d.kjøpsordrer.length, 1);
});
