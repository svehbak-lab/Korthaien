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

test("displaykort kobles bare til displayutgaven; NTL og Oversized er vanlige kort i sitt sett", async () => {
  const { erDisplayProdukt, oppgirBehandling } = await import("../src/varianter.ts");
  assert.equal(erDisplayProdukt("The Wise Mothman (Display Commander) (Not Tournament Legal)"), true);
  assert.equal(erDisplayProdukt("The Wise Mothman (Showcase)"), false);
  // Collector's Edition, World Championship Decks og Vanguard: ordene sier
  // hva slags sett det er, ikke at det er en annen utgave i settet.
  assert.equal(oppgirBehandling("Black Lotus (Not Tournament Legal)"), false);
  assert.equal(oppgirBehandling("Gix (Oversized)"), false);
  assert.equal(oppgirBehandling("The Wise Mothman (Showcase)"), true);

  // En displaykobling til et kort som ikke er displayutgaven, ryddes ved
  // oppstart. Et NTL-produkt koblet til sitt eget kort, blir stående.
  await db().execute({
    sql: `INSERT INTO mystore_stock (card_id,finish,qty,product_id,product_name,synced_at)
          VALUES ('k2','foil',1,'p-mothman','The Wise Mothman (Display Commander) (Not Tournament Legal)',?),
                 ('k1','foil',1,'p-ce','Black Lotus (Not Tournament Legal)',?)`,
    args: [new Date().toISOString(), new Date().toISOString()],
  });
  await migrate();
  const r = await db().execute("SELECT product_id FROM mystore_stock WHERE product_id IN ('p-mothman','p-ce')");
  assert.deepEqual(r.rows.map((x) => x.product_id), ["p-ce"]);
});

test("scroll-showcase kobles bare når produktet sier «scroll»", async () => {
  const { erScrollProdukt } = await import("../src/varianter.ts");
  assert.equal(erScrollProdukt("Gandalf the Grey (Scroll Showcase)"), true);
  assert.equal(erScrollProdukt("Gandalf the Grey (Showcase)"), false);

  await db().execute({
    sql: `INSERT INTO cards (id,oracle_id,name,name_norm,variant,set_code,collector_number,rarity,usd,has_nonfoil,has_foil,image_uri,released_at,er_scroll)
          VALUES ('g322','og','Gandalf the Grey','gandalf the grey','showcase','gml','322','rare',1,1,1,'/b.jpg','2023-06-23',0),
                 ('g658','og','Gandalf the Grey','gandalf the grey','showcase','gml','658','rare',1,1,1,'/b.jpg','2023-06-23',1)`,
  });
  const t = new Date().toISOString();
  await db().execute({
    sql: `INSERT INTO mystore_stock (card_id,finish,qty,product_id,product_name,synced_at)
          VALUES ('g658','nonfoil',1,'p-gandalf','Gandalf the Grey (Showcase)',?),
                 ('g658','foil',1,'p-scroll','Gandalf the Grey (Scroll Showcase)',?)`,
    args: [t, t],
  });
  await migrate();
  const r = await db().execute("SELECT product_id FROM mystore_stock WHERE card_id = 'g658'");
  assert.deepEqual(r.rows.map((x) => x.product_id), ["p-scroll"]);
});
