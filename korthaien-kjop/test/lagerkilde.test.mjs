// Butikkens lager fram til overgangen: Mystore-speilet, ikke lagerboken.
// Lagerboken fikk Mystore-beholdningen én gang og har ikke fulgt med siden;
// speilet oppdateres hver natt. Salg fra den nye butikken trekkes fra.

import test from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";

const DB = `/tmp/lagerkilde-${process.pid}.db`;
rmSync(DB, { force: true });
process.env.DATABASE_URL = `file:${DB}`;
delete process.env.LAGERKILDE;

const { db, migrate, normaliser } = await import("../src/db.ts");
const { beholdning, lagerkilde } = await import("../src/lager.ts");
const { forsideSett } = await import("../src/forside.ts");
const salg = await import("../src/salg.ts");
const { settManuellSalg } = await import("../src/salgspris.ts");
await migrate();
process.on("exit", () => rmSync(DB, { force: true }));

await db().execute("INSERT INTO sets (code,name,released_at,card_count,parent_code) VALUES ('ny','Nytt Sett','2026-10-01',10,NULL),('gml','Gammelt','2020-01-01',10,NULL)");
for (const [id, sett] of [["k1", "ny"], ["k2", "gml"]]) {
  await db().execute({
    sql: `INSERT INTO cards (id,oracle_id,name,name_norm,variant,set_code,collector_number,rarity,usd,has_nonfoil,has_foil,image_uri,released_at)
          VALUES (?,?,?,?,'vanlig',?,'1','rare',1,1,0,'/b.jpg','2020-01-01')`,
    args: [id, "o" + id, id, normaliser(id), sett],
  });
  await settManuellSalg(id, "nonfoil", 1000);
}
// Boken (fra september): k2 med 3 stk. Speilet (i dag): k1 med 2, k2 solgt ut.
await db().execute("INSERT INTO lager_bevegelser (card_id,finish,condition,antall,grunn,created_at) VALUES ('k2','nonfoil','NM',3,'mystore','2026-09-01')");
const nå = new Date().toISOString();
await db().execute({ sql: "INSERT INTO mystore_stock (card_id,finish,qty,synced_at,inn_at) VALUES ('k1','nonfoil',2,?,?),('k2','nonfoil',0,?,NULL)", args: [nå, nå, nå] });

test("standard er Mystore-speilet", () => {
  assert.equal(lagerkilde(), "mystore");
});

test("butikken viser det som står i Mystore, ikke det som står i boken", async () => {
  const b = await beholdning(["k1", "k2"]);
  assert.equal(b.get("k1:nonfoil:NM"), 2);
  assert.equal(b.get("k2:nonfoil:NM") || 0, 0);
  assert.deepEqual((await forsideSett(5)).map((s) => s.code), ["ny"]);
});

test("salg fra den nye butikken trekkes fra speilets antall", async () => {
  await db().execute("INSERT INTO lager_bevegelser (card_id,finish,condition,antall,grunn,created_at) VALUES ('k1','nonfoil','NM',-1,'salg','2026-10-24')");
  const l = await salg.prisKurv([{ card_id: "k1", finish: "nonfoil", condition: "NM", antall: 2 }]);
  assert.equal(l[0].tilgjengelig, 1);
});

test("med LAGERKILDE=bok leser butikken lagerboken", async () => {
  process.env.LAGERKILDE = "bok";
  const b = await beholdning(["k1", "k2"]);
  assert.equal(b.get("k2:nonfoil:NM"), 3);
  delete process.env.LAGERKILDE;
});
