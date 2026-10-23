// Migreringen som innførte kvote_frigitt_at.
//
// Den farlige dagen er den første. Kolonnen kommer, og alt som ikke har en
// verdi regnes som «ikke frigitt» — altså som om hver eneste historiske
// ordre fortsatt reserverer kortene sine. Hadde backfillen manglet, ville
// kjøpslista stengt seg selv den natta oppdateringen gikk ut.
//
// Derfor bygges basen her slik den så ut før: orders uten kolonnen, med
// ordrer i den. Så kjøres migreringen, og vi ser hva som skjedde med dem.

import test from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";

const DB = `/tmp/frigimig-${process.pid}.db`;
rmSync(DB, { force: true });
process.env.DATABASE_URL = `file:${DB}`;

const { db, migrate } = await import("../src/db.ts");
process.on("exit", () => rmSync(DB, { force: true }));

// Tabellen slik den var, uten kvote_frigitt_at. schema.sql bruker
// CREATE TABLE IF NOT EXISTS, så denne blir stående, og migreringen må
// legge til kolonnen selv — nøyaktig som i den ekte basen.
await db().execute(`
  CREATE TABLE orders (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    order_no       TEXT NOT NULL UNIQUE,
    customer_name  TEXT NOT NULL,
    email          TEXT NOT NULL,
    status         TEXT NOT NULL,
    total_nok      INTEGER NOT NULL DEFAULT 0,
    created_at     TEXT NOT NULL,
    expires_at     TEXT NOT NULL,
    received_at    TEXT,
    credit_sent_at TEXT)`);

const GAMMEL = "2026-01-15T10:00:00.000Z";
const OPPGJORT = "2026-02-01T12:00:00.000Z";

async function legg(nr, status, credit = null, mottatt = null) {
  await db().execute({
    sql: `INSERT INTO orders (order_no, customer_name, email, status,
                              created_at, expires_at, received_at, credit_sent_at)
          VALUES (?,?,?,?,?,?,?,?)`,
    args: [nr, "Kari", "kari@example.com", status, GAMMEL, GAMMEL, mottatt, credit],
  });
}

await legg("K-1", "stocked", OPPGJORT, GAMMEL);
await legg("K-2", "cancelled");
await legg("K-3", "expired");
await legg("K-4", "received", null, GAMMEL);
await legg("K-5", "pending");

await migrate();

const hent = async (nr) =>
  (await db().execute({ sql: "SELECT * FROM orders WHERE order_no = ?", args: [nr] })).rows[0];

test("kolonnen kom på plass", async () => {
  const r = await db().execute("SELECT * FROM orders LIMIT 1");
  assert.ok("kvote_frigitt_at" in r.rows[0]);
});

test("gamle gjorte opp ordrer ble regnet som frigitt", async () => {
  // Ellers ville de begynt å spise kvote i natt, uten at noe nytt var sendt
  // inn — og kjøpslista hadde stengt seg selv.
  const o = await hent("K-1");
  assert.equal(o.kvote_frigitt_at, OPPGJORT, "tidspunktet for oppgjøret, ikke nå");
});

test("kansellerte og utløpte er også ute av løpet", async () => {
  assert.ok((await hent("K-2")).kvote_frigitt_at);
  assert.ok((await hent("K-3")).kvote_frigitt_at);
});

test("ordrer som fortsatt er i spill ble ikke rørt", async () => {
  // De skal holde kvoten sin videre. Hadde backfillen tatt dem, ville den
  // frigitt kort som ligger uåpnet i posten.
  assert.equal((await hent("K-4")).kvote_frigitt_at, null);
  assert.equal((await hent("K-5")).kvote_frigitt_at, null);
});

test("migreringen går ikke om igjen", async () => {
  // Kjørte backfillen ved hver oppstart, ville den frigitt enhver ordre du
  // nettopp har gjort opp og ikke rukket å legge inn — altså selve feilen
  // dette skulle rette.
  await db().execute({
    sql: `INSERT INTO orders (order_no, customer_name, email, status,
                              created_at, expires_at, credit_sent_at)
          VALUES ('K-6','Kari','kari@example.com','stocked',?,?,?)`,
    args: [GAMMEL, GAMMEL, OPPGJORT],
  });
  await migrate();
  assert.equal((await hent("K-6")).kvote_frigitt_at, null, "den nye skal fortsatt holde kvoten");
});
