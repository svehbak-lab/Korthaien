import test from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";

const DB = `/tmp/overgang-${process.pid}.db`;
rmSync(DB, { force: true });
process.env.DATABASE_URL = `file:${DB}`;
delete process.env.LAGERKILDE;

const { db, migrate, hentSettings } = await import("../src/db.ts");
const { overgangsstatus, gjennomførOvergang } = await import("../src/overgang.ts");
const { lagerkilde, settBokSomLagerkilde } = await import("../src/lager.ts");

await migrate();
process.on("exit", () => rmSync(DB, { force: true }));

test("overgang nekter med tomt speil", async () => {
  await assert.rejects(gjennomførOvergang(), /tomt/);
  assert.equal(lagerkilde(), "mystore");
});

test("overgang tømmer boken og fører inn Mystore-beholdningen", async () => {
  const nå = new Date().toISOString();
  await db().execute({
    sql: `INSERT INTO lager_bevegelser (card_id, finish, condition, antall, grunn, created_at) VALUES ('gammel','nonfoil','NM',5,'kjop',?)`,
    args: [nå],
  });
  for (const [id, fin, qty] of [["a", "nonfoil", 3], ["a", "foil", 1], ["b", "nonfoil", 0]]) {
    await db().execute({
      sql: `INSERT INTO mystore_stock (card_id, finish, qty, synced_at, inn_at) VALUES (?,?,?,?,?)`,
      args: [id, fin, qty, nå, "2026-01-02T00:00:00Z"],
    });
  }
  const før = await overgangsstatus();
  assert.equal(før.mystore.kort, 2);
  assert.equal(før.mystore.stk, 4);

  const etter = await gjennomførOvergang();
  assert.equal(etter.lagerkilde, "bok");
  assert.deepEqual(etter.bok, [{ grunn: "mystore", rader: 2, stk: 4 }]);
  const r = await db().execute("SELECT card_id, created_at FROM lager_bevegelser ORDER BY card_id");
  assert.ok(r.rows.every((x) => x.card_id === "a" && x.created_at === "2026-01-02T00:00:00Z"));
  assert.equal((await hentSettings()).lagerkilde, "bok");
  assert.equal((await hentSettings()).krev_konto, true);
  settBokSomLagerkilde(false);
});

test("overgang nekter med usendte salgsordrer", async () => {
  const cols = (await db().execute("PRAGMA table_info(salgsordrer)")).rows.map((c) => String(c.name));
  assert.ok(cols.includes("status"));
  await db().execute("UPDATE settings SET value = '\"mystore\"' WHERE key = 'lagerkilde'");
  // Minste gyldige rad: fyll alle NOT NULL-kolonner uten standardverdi.
  const info = (await db().execute("PRAGMA table_info(salgsordrer)")).rows;
  const felt = info.filter((c) => Number(c.notnull) && c.dflt_value == null && !Number(c.pk));
  const navn = ["status", ...felt.map((c) => String(c.name)).filter((n) => n !== "status")];
  const verdier = navn.map((n) => (n === "status" ? "betalt" : /_ore$|antall/.test(n) ? 0 : "x"));
  await db().execute({ sql: `INSERT INTO salgsordrer (${navn.join(",")}) VALUES (${navn.map(() => "?").join(",")})`, args: verdier });
  await assert.rejects(gjennomførOvergang(), /usendte/);
});
