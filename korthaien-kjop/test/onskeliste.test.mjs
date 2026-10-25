// Ønskelista: beskjed når kortet er på lager, én gang per gang det kommer inn.
import test from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";

const DB = `/tmp/onskeliste-${process.pid}.db`;
rmSync(DB, { force: true });
process.env.DATABASE_URL = `file:${DB}`;
process.env.LAGERKILDE = "bok";
const { db, migrate, normaliser } = await import("../src/db.ts");
const ø = await import("../src/onskeliste.ts");
const konto = await import("../src/kunder.ts");
await migrate();
process.on("exit", () => rmSync(DB, { force: true }));

await db().execute("INSERT INTO sets (code,name,released_at,card_count) VALUES ('a','Alfa','2020-01-01',1),('b','Beta','2021-01-01',1)");
for (const [id, sett] of [["k-a", "a"], ["k-b", "b"]]) {
  await db().execute({
    sql: `INSERT INTO cards (id,oracle_id,name,name_norm,variant,set_code,collector_number,rarity,usd,has_nonfoil,has_foil,released_at)
          VALUES (?, 'or-1', 'Sol Ring', ?, 'vanlig', ?, '1', 'uncommon', 1, 1, 1, '2020-01-01')`,
    args: [id, normaliser("Sol Ring"), sett],
  });
}
const k = await konto.registrer({ email: "kari@eksempel.no", passord: "hemmelig123" });
await db().execute({ sql: "UPDATE kunder SET epost_bekreftet_at = ? WHERE id = ?", args: [new Date().toISOString(), k.id] });
const sendt = [];
const send = async (e, kort) => sendt.push({ e, kort });

test("hvilken som helst utgave: beskjed når én av dem kommer inn, og bare én gang", async () => {
  const liste = await ø.leggTilØnske(k.id, { card_id: "k-a", hvilken: "alle" });
  assert.equal(liste.length, 1);
  assert.equal(liste[0].på_lager, 0);
  assert.deepEqual(await ø.varsleØnsker(send), { varslet: 0, nullstilt: 0 });

  await db().execute("INSERT INTO lager_bevegelser (card_id,finish,condition,antall,grunn,created_at) VALUES ('k-b','nonfoil','NM',1,'manuell','2026-01-01')");
  assert.equal((await ø.varsleØnsker(send)).varslet, 1);
  assert.equal(sendt.length, 1);
  assert.match(sendt[0].kort[0].url, /kort=k-b/);
  // Fortsatt på lager: ingen ny e-post.
  assert.equal((await ø.varsleØnsker(send)).varslet, 0);

  // Utsolgt og inn igjen: ny beskjed.
  await db().execute("INSERT INTO lager_bevegelser (card_id,finish,condition,antall,grunn,created_at) VALUES ('k-b','nonfoil','NM',-1,'salg','2026-01-02')");
  assert.equal((await ø.varsleØnsker(send)).nullstilt, 1);
  await db().execute("INSERT INTO lager_bevegelser (card_id,finish,condition,antall,grunn,created_at) VALUES ('k-b','nonfoil','NM',1,'manuell','2026-01-03')");
  assert.equal((await ø.varsleØnsker(send)).varslet, 1);
});

test("bestemt utgave og bare foil teller bare den", async () => {
  await ø.leggTilØnske(k.id, { card_id: "k-a", hvilken: "denne", finish: "foil" });
  const liste = await ø.hentØnsker(k.id);
  const bestemt = liste.find((x) => x.card_id === "k-a");
  assert.equal(bestemt.på_lager, 0); // k-b er på lager, men ikke k-a foil
  await ø.fjernØnske(k.id, bestemt.id);
  assert.equal((await ø.hentØnsker(k.id)).length, 1);
});
