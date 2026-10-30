// Beskjed til kunden fra salgsordren i admin: står øverst i e-posten, og
// føres i notatet på ordren.
import test from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";

const DB = `/tmp/kundebeskjed-${process.pid}.db`;
rmSync(DB, { force: true });
process.env.DATABASE_URL = `file:${DB}`;
process.env.RESEND_KEY = "test-nokkel";
process.env.EPOST_TIL_MEG = "meg@korthaien.no";

const { db, migrate } = await import("../src/db.ts");
const { varsleSendt, sendJustering, sendKansellering } = await import("../src/epost.ts");
const salg = await import("../src/salg.ts");

await migrate();
process.on("exit", () => rmSync(DB, { force: true }));

const sendt = [];
const ekteFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  if (String(url).includes("api.resend.com")) {
    sendt.push(JSON.parse(opts.body));
    return new Response(JSON.stringify({ id: "test" }), { status: 200 });
  }
  return ekteFetch(url, opts);
};

const r = await db().execute({
  sql: `INSERT INTO salgsordrer (ordrenr, kunde_navn, email, status, created_at, frakt_navn)
        VALUES ('S-90001', 'Kari', 'kari@example.com', 'betalt', '2026-10-30T10:00:00Z', 'Brev')`,
  args: [],
});
const id = Number(r.lastInsertRowid);

test("beskjeden står øverst, unnsluppet, og gir meg kopi ved sending", async () => {
  sendt.length = 0;
  await varsleSendt(id, "Fant ikke <Ragavan>.\nBeklager!");
  const e = sendt[0];
  assert.deepEqual(e.bcc, ["meg@korthaien.no"]);
  assert.ok(e.html.indexOf("Beskjed fra Korthaien") < e.html.indexOf("Pakken er på vei"));
  assert.match(e.html, /Fant ikke &lt;Ragavan&gt;/);
  assert.match(e.text, /^BESKJED FRA KORTHAIEN\nFant ikke <Ragavan>/);
});

test("uten beskjed: ingen boks og ingen kopi", async () => {
  sendt.length = 0;
  await varsleSendt(id, "   ");
  assert.equal(sendt[0].bcc, undefined);
  assert.doesNotMatch(sendt[0].html, /Beskjed fra Korthaien/);
});

test("rettelse og kansellering har beskjeden øverst", async () => {
  sendt.length = 0;
  const penger = { refusjon_ore: 5000, til_kort_ore: 5000, til_kreditt_ore: 0, til_gavekort_ore: 0, betalt_med: "kort" };
  await sendJustering(id, { linjer: [{ card_name: "Ragavan", fra: 1, til: 0 }], ...penger, beskjed: "Har bestilt nytt." });
  await sendKansellering(id, { ...penger, beskjed: "Lageret var feil." });
  assert.ok(sendt[0].html.indexOf("Har bestilt nytt.") < sendt[0].html.indexOf("Endring i ordren din"));
  assert.ok(sendt[1].html.indexOf("Lageret var feil.") < sendt[1].html.indexOf("Ordren er kansellert"));
});

test("merk som sendt med beskjed fører den i notatet", async () => {
  const o = await salg.settStatus("S-90001", { status: "sendt", beskjed: "Kommer i to pakker." });
  assert.match(String(o.admin_notat), /Beskjed til kunden \(sendt, .*\): Kommer i to pakker\./);
});
