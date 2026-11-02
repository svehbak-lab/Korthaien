// Kunden sletter kontoen selv: innlogging og personopplysninger går, ordrer
// og kreditt står igjen, og en ny Mystore-import lager den ikke på nytt.
import test from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";

const DB = `/tmp/slettkonto-${process.pid}.db`;
rmSync(DB, { force: true });
process.env.DATABASE_URL = `file:${DB}`;
delete process.env.RESEND_KEY;

const { db, migrate } = await import("../src/db.ts");
const konto = await import("../src/kunder.ts");
const kreditt = await import("../src/kreditt.ts");

await migrate();
process.on("exit", () => rmSync(DB, { force: true }));

const nå = new Date().toISOString();

test("feil passord stopper; riktig passord sletter alt utenom ordrer og kreditt", async () => {
  const k = await konto.registrer({ email: "ola@eksempel.no", passord: "passord123", navn: "Ola" });
  await konto.oppdaterProfil(k.id, { telefon: "91234567", adresse: "Gata 1", postnr: "0150", poststed: "Oslo" });
  await konto.nySesjon(k.id);
  await kreditt.leggTil({ email: k.email, ore: 25000, grunn: "manuell" });
  await db().execute({
    sql: `INSERT INTO salgsordrer (ordrenr, kunde_navn, email, kunde_id, status, created_at) VALUES ('S-1', 'Ola', ?, ?, 'sendt', ?)`,
    args: [k.email, k.id, nå],
  });
  await db().execute({
    sql: `INSERT INTO onskeliste (kunde_id, oracle_id, navn, created_at) VALUES (?, 'x', 'Ragavan', ?)`,
    args: [k.id, nå],
  });

  await assert.rejects(konto.slettKonto(k.id, { passord: "feil" }), /Passordet stemmer ikke/);
  const r = await konto.slettKonto(k.id, { passord: "passord123" });
  assert.equal(r.kreditt_ore, 25000);

  const n = async (sql) => Number((await db().execute({ sql, args: [k.id] })).rows[0].n);
  assert.equal(await n("SELECT COUNT(*) n FROM kunder WHERE id = ?"), 0);
  assert.equal(await n("SELECT COUNT(*) n FROM kunde_sesjoner WHERE kunde_id = ?"), 0);
  assert.equal(await n("SELECT COUNT(*) n FROM onskeliste WHERE kunde_id = ?"), 0);
  // Ordren står, uten kobling til kontoen. Kreditten står på adressen.
  const o = (await db().execute("SELECT kunde_id, email FROM salgsordrer WHERE ordrenr = 'S-1'")).rows[0];
  assert.equal(o.kunde_id, null);
  assert.equal(o.email, "ola@eksempel.no");
  assert.equal(await kreditt.saldo("ola@eksempel.no"), 25000);
  await assert.rejects(konto.loggInn("ola@eksempel.no", "passord123"));

  // Ny import fra Mystore tar ikke kontoen inn igjen.
  const csv = "Fornavn;Etternavn;E-post;Ordrer\nOla;N;ola@eksempel.no;3\nKari;N;kari@eksempel.no;1\n";
  const imp = await konto.importerMystoreKunder(csv);
  assert.equal(imp.slettet, 1);
  assert.equal(imp.nye, 1);

  // Lager kunden konto igjen, er kreditten der.
  const ny = await konto.registrer({ email: "ola@eksempel.no", passord: "passord456" });
  assert.ok(ny.id);
  assert.equal(await kreditt.saldo(ny.email), 25000);
});

test("ordre som ikke er sendt, eller kort som ikke er gjort opp, stopper slettingen", async () => {
  const k = await konto.registrer({ email: "per@eksempel.no", passord: "passord123" });
  await db().execute({
    sql: `INSERT INTO salgsordrer (ordrenr, kunde_navn, email, kunde_id, status, created_at) VALUES ('S-2', 'Per', ?, ?, 'betalt', ?)`,
    args: [k.email, k.id, nå],
  });
  await assert.rejects(konto.slettKonto(k.id, { passord: "passord123" }), /ikke er sendt ennå \(S-2\)/);
  await db().execute("UPDATE salgsordrer SET status = 'sendt' WHERE ordrenr = 'S-2'");

  await db().execute({
    sql: `INSERT INTO orders (order_no, customer_name, email, status, total_nok, total_ore, quoted_ore, created_at, expires_at)
          VALUES ('K-9', 'Per', ?, 'received', 10, 1000, 1000, ?, ?)`,
    args: [k.email, nå, nå],
  });
  await assert.rejects(konto.slettKonto(k.id, { passord: "passord123" }), /ikke er gjort opp ennå \(K-9\)/);
  await db().execute("UPDATE orders SET status = 'stocked' WHERE order_no = 'K-9'");
  await konto.slettKonto(k.id, { passord: "passord123" });
});

test("konto uten passord (Google) bekrefter med SLETT", async () => {
  const r = await db().execute({
    sql: `INSERT INTO kunder (email, navn, google_sub, created_at) VALUES ('g@eksempel.no', 'G', 'sub-1', ?) RETURNING id`,
    args: [nå],
  });
  const id = Number(r.rows[0].id);
  await assert.rejects(konto.slettKonto(id, { bekreft: "ja" }), /SLETT/);
  await konto.slettKonto(id, { bekreft: "slett" });
  assert.equal((await db().execute("SELECT COUNT(*) n FROM kunder WHERE google_sub = 'sub-1'")).rows[0].n, 0);
});
