// Sealed og komplette sett i handlekurven: pris, beholdning, mva på sealed,
// og beholdningen tilbake ved kansellering.
import test from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";

const DB = `/tmp/produktkurv-${process.pid}.db`;
rmSync(DB, { force: true });
process.env.DATABASE_URL = `file:${DB}`;
process.env.LAGERKILDE = "bok";
delete process.env.STRIPE_SECRET_KEY;
delete process.env.RESEND_KEY;
const { db, migrate } = await import("../src/db.ts");
const salg = await import("../src/salg.ts");
const koder = await import("../src/rabattkoder.ts");
const { leggTilProdukt, hentProdukt } = await import("../src/produkter.ts");
await migrate();
process.on("exit", () => rmSync(DB, { force: true }));

const boks = await leggTilProdukt({ type: "sealed", navn: "Samlerboks", pris_ore: 300000, antall: 2 });
const sett = await leggTilProdukt({ type: "komplettsett", navn: "Komplett DSK", pris_ore: 150000, antall: 1, set_code: "dsk" });
const f = await db().execute({ sql: "INSERT INTO frakt_alternativer (navn,pris_ore,forsikret_ore,sortering,aktiv,created_at) VALUES ('Pakke',10000,1000000,0,1,?) RETURNING id", args: [new Date().toISOString()] });
const kasse = (linjer, kode) => ({
  navn: "Gjest", email: "gjest@eksempel.no", adresse: "Gata 1", postnr: "0150", poststed: "Oslo",
  frakt_id: Number(f.rows[0].id), vilkar: true, linjer, rabattkode: kode,
});

test("produkter prises og har beholdning i kurven", async () => {
  const l = await salg.prisKurv([{ card_id: `p:${boks}`, antall: 3 }, { card_id: `p:${sett}`, antall: 1 }]);
  const b = l.find((x) => x.card_id === `p:${boks}`);
  assert.equal(b.enhet_ore, 300000);
  assert.equal(b.tilgjengelig, 2);
  assert.match(b.feil, /Bare 2/);
  assert.equal(l.find((x) => x.card_id === `p:${sett}`).set_name, "Komplette sett");
});

test("betalt med gavekort: beholdningen trekkes, sealed føres med mva, og alt kommer tilbake ved kansellering", async () => {
  await koder.opprettKode({ kode: "STOR", type: "saldo", saldo_ore: 1000000 });
  const r = await salg.åpneKasse(kasse([{ card_id: `p:${boks}`, antall: 1 }, { card_id: `p:${sett}`, antall: 1 }], "STOR"), null);
  assert.equal(r.betalt, true);
  assert.equal((await hentProdukt(boks)).antall, 1);
  assert.equal((await hentProdukt(sett)).antall, 0);
  const o = await salg.hentOrdre(r.ordrenr);
  assert.equal(Number(o.mva_varer_ore), 300000); // bare sealed
  assert.equal(o.linjer.length, 2);
  assert.ok(o.linjer.every((x) => x.produkt));
  await salg.kanseller(r.ordrenr, "Test", "kreditt");
  assert.equal((await hentProdukt(boks)).antall, 2);
  assert.equal((await hentProdukt(sett)).antall, 1);
});
