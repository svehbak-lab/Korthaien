import test from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";

const DB = `/tmp/komplette-${process.pid}.db`;
rmSync(DB, { force: true });
process.env.DATABASE_URL = `file:${DB}`;

const { db, migrate, normaliser } = await import("../src/db.ts");
await migrate();
process.on("exit", () => rmSync(DB, { force: true }));
const { settBokSomLagerkilde, førBevegelser } = await import("../src/lager.ts");
settBokSomLagerkilde(true);
const { komplettSett, manglerISett } = await import("../src/komplette.ts");

await db().execute("INSERT INTO sets (code,name,released_at,card_count,parent_code,printed_size) VALUES ('tst','Testsett','2020-01-01',6,NULL,4)");
await db().execute("INSERT INTO sets (code,name,released_at,card_count,parent_code,printed_size) VALUES ('hel','Helsett','2020-01-01',2,NULL,2)");
const kort = [
  ["a1", "tst", "1", "Alfa"], ["a2", "tst", "2", "Beta"], ["a2p", "tst", "2†", "Beta"],
  ["a3", "tst", "3", "Gamma"], ["a4", "tst", "4", "Delta"], ["a5", "tst", "5", "Variant"],
  ["h1", "hel", "1", "En"], ["h2", "hel", "2", "To"],
];
for (const [id, sett, nr, navn] of kort) {
  await db().execute({
    sql: `INSERT INTO cards (id,oracle_id,name,name_norm,front_norm,back_norm,variant,set_code,
                             collector_number,rarity,usd,usd_foil,has_nonfoil,has_foil,image_uri,released_at)
          VALUES (?,?,?,?,NULL,NULL,'vanlig',?,?,'common',1,2,1,1,NULL,'2020-01-01')`,
    args: [id, id, navn, normaliser(navn), sett, nr],
  });
}
const inn = (card_id, antall, finish = "nonfoil") => ({ card_id, finish, condition: "NM", antall, grunn: "manuell" });
await førBevegelser([inn("a1", 2), inn("a2p", 1, "foil"), inn("a5", 3), inn("h1", 2), inn("h2", 3)]);

test("prosent, mangler og antall komplette sett (begge finisher)", async () => {
  const { sett } = await komplettSett("alle");
  const hel = sett.find((s) => s.set_code === "hel");
  const tst = sett.find((s) => s.set_code === "tst");
  assert.deepEqual([hel.har, hel.størrelse, hel.prosent, hel.komplette], [2, 2, 100, 2]);
  // 1 og 2† (teller for 2) — variant nr. 5 ligger over størrelsen og teller ikke.
  assert.deepEqual([tst.har, tst.mangler, tst.prosent, tst.komplette], [2, 2, 50, 0]);
  assert.equal(sett[0].set_code, "hel");
});

test("vanlig og foil telles hver for seg", async () => {
  const vanlig = (await komplettSett("nonfoil")).sett.find((s) => s.set_code === "tst");
  const foil = (await komplettSett("foil")).sett.find((s) => s.set_code === "tst");
  // Vanlig: bare nr. 1. Foil: bare 2† (teller for 2).
  assert.deepEqual([vanlig.har, vanlig.størrelse, vanlig.prosent], [1, 4, 25]);
  assert.deepEqual([foil.har, foil.størrelse, foil.prosent], [1, 4, 25]);
  assert.deepEqual((await manglerISett("tst", "foil")).kort.map((k) => k.nummer), ["1", "3", "4"]);
});

test("et nummer som ikke finnes i foil, hører ikke til foilsettet", async () => {
  await db().execute("UPDATE cards SET has_foil = 0 WHERE id = 'a4'");
  const foil = (await komplettSett("foil")).sett.find((s) => s.set_code === "tst");
  assert.equal(foil.størrelse, 3);
  await db().execute("UPDATE cards SET has_foil = 1 WHERE id = 'a4'");
});

test("manglende kort i ett sett", async () => {
  const { kort } = await manglerISett("tst", "alle");
  assert.deepEqual(kort.map((k) => [k.nummer, k.name]), [["3", "Gamma"], ["4", "Delta"]]);
});
