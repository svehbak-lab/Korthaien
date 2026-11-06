// Salg per sett i Lagerrapport: betalte ordrer, uten kansellerte og forlatte
// kasser, fordelt på sett, for en periode.
import test from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";

const DB = `/tmp/salgpersett-${process.pid}.db`;
rmSync(DB, { force: true });
process.env.DATABASE_URL = `file:${DB}`;
const { db, migrate } = await import("../src/db.ts");
const { salgPerSett } = await import("../src/statistikk.ts");
await migrate();
process.on("exit", () => rmSync(DB, { force: true }));

let nr = 0;
async function ordre(status, betalt, linjer) {
  const r = await db().execute({
    sql: `INSERT INTO salgsordrer (ordrenr, kunde_navn, email, status, created_at, betalt_at)
          VALUES (?, 'K', 'k@x.no', ?, ?, ?) RETURNING id`,
    args: [`S-${++nr}`, status, betalt || new Date().toISOString(), betalt],
  });
  const id = Number(r.rows[0].id);
  for (const [sett, antall, ore, finish = "nonfoil", produkt = null] of linjer) {
    await db().execute({
      sql: `INSERT INTO salgsordre_linjer (ordre_id, card_id, finish, condition, antall, enhet_ore, card_name, set_code, set_name, produkt_id)
            VALUES (?, ?, ?, 'NM', ?, ?, 'Kort', ?, ?, ?)`,
      args: [id, produkt ? `p:${produkt}` : `${sett}-x`, finish, antall, ore, sett, sett.toUpperCase(), produkt],
    });
  }
}
const nå = Date.now();
const dagerSiden = (d) => new Date(nå - d * 86_400_000).toISOString();

await ordre("sendt", dagerSiden(1), [["blb", 3, 1000], ["mh3", 1, 50000, "foil"]]);
await ordre("betalt", dagerSiden(2), [["blb", 2, 1000]]);
await ordre("kansellert", dagerSiden(1), [["blb", 10, 1000]]);
await ordre("utlopt", null, [["blb", 10, 1000]]);
await ordre("sendt", dagerSiden(40), [["lea", 1, 900000], ["", 1, 349900, "nonfoil", 7]]);

test("totalt: kansellerte og forlatte telles ikke; sett sortert på omsetning; produkter for seg", async () => {
  const d = await salgPerSett("totalt");
  assert.deepEqual(d.sett.map((s) => s.set_code), ["lea", "mh3", "blb"]);
  const blb = d.sett.find((s) => s.set_code === "blb");
  assert.equal(blb.kort, 5);
  assert.equal(blb.ordrer, 2);
  assert.equal(blb.omsetning_ore, 5000);
  assert.equal(d.sett.find((s) => s.set_code === "mh3").foil, 1);
  assert.equal(d.ordrer, 3);
  assert.equal(d.produkter.antall, 1);
  assert.equal(d.produkter.omsetning_ore, 349900);
});

test("siste 30 dager tar ikke med ordren fra 40 dager siden", async () => {
  const d = await salgPerSett("30d");
  assert.deepEqual(d.sett.map((s) => s.set_code).sort(), ["blb", "mh3"]);
  assert.equal(d.produkter.antall, 0);
});
