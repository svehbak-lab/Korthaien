import test from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";

const DB = `/tmp/jobb-${process.pid}.db`;
rmSync(DB, { force: true });
process.env.DATABASE_URL = `file:${DB}`;
process.env.RESEND_KEY = "test";
process.env.EPOST_TIL_MEG = "korthaien@gmail.com";

const { db, migrate } = await import("../src/db.ts");
await migrate();
process.on("exit", () => rmSync(DB, { force: true }));

const sendt = [];
const ekte = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  if (String(url).includes("api.resend.com")) {
    sendt.push(JSON.parse(opts.body));
    return new Response(JSON.stringify({ id: "x" }), { status: 200 });
  }
  return ekte(url, opts);
};

test("synken feiler når nøkkelen mangler, i stedet for å melde suksess", async () => {
  const før = { url: process.env.MYSTORE_URL, key: process.env.MYSTORE_KEY };
  delete process.env.MYSTORE_URL;
  delete process.env.MYSTORE_KEY;

  const { synkMystore } = await import("../src/mystore.ts");
  await assert.rejects(synkMystore(() => {}), /ikke satt/);

  if (før.url) process.env.MYSTORE_URL = før.url;
  if (før.key) process.env.MYSTORE_KEY = før.key;
});

test("en jobbfeil varsles på e-post", async () => {
  sendt.length = 0;
  const { varsleJobbfeil } = await import("../src/epost.ts");
  const r = await varsleJobbfeil("mystore", new Error("Mystore svarte 403"));
  assert.equal(r.sendt, true);
  assert.equal(sendt[0].to[0], "korthaien@gmail.com");
  assert.match(sendt[0].subject, /mystore/);
  assert.match(sendt[0].text, /403/);
});

test("helsesjekken ser at beholdningen er utdatert", async () => {
  const { helsesjekk } = await import("../src/helse.ts");

  const tom = await helsesjekk(() => {});
  assert.ok(tom.some((f) => /aldri synket/.test(f.hva)), "tom tabell er også et funn");

  const gammel = new Date(Date.now() - 100 * 3600000).toISOString();
  await db().execute({
    sql: `INSERT INTO mystore_stock (card_id,finish,qty,product_id,product_name,category,synced_at)
          VALUES ('x','nonfoil',1,'p','Kort','Rare',?)`,
    args: [gammel],
  });
  const utdatert = await helsesjekk(() => {});
  const funn = utdatert.find((f) => /utdatert/.test(f.hva));
  assert.ok(funn, "hundre timer gammel beholdning skal fanges");
  assert.equal(funn.alvor, "feil", "over tre døgn er en feil, ikke en advarsel");
});

test("fersk beholdning gir ingen anmerkning", async () => {
  await db().execute({
    sql: "UPDATE mystore_stock SET synced_at = ?",
    args: [new Date().toISOString()],
  });
  const { helsesjekk } = await import("../src/helse.ts");
  const funn = await helsesjekk(() => {});
  assert.ok(!funn.some((f) => /utdatert|aldri synket/.test(f.hva)));
});
