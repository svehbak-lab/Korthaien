// «Om settet»-fanen, og svaret som avgjør om Sealed-fanen vises.
//
// Det som er verdt å holde fast ved: tallene er regnet ut og ikke skrevet,
// de teller forskjellige kort og ikke eksemplarer, og ett og samme svar
// bestemmer både om Sealed-fanen vises og hva som står i den. To kall kunne
// blitt uenige; ett kan ikke.

import test from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";

const DB = `/tmp/settinfo-${process.pid}.db`;
rmSync(DB, { force: true });
process.env.DATABASE_URL = `file:${DB}`;
// Disse testene legger kort i lagerboken; butikken skal lese derfra.
process.env.LAGERKILDE = "bok";

const { migrate, db } = await import("../src/db.ts");
const { settinfo } = await import("../src/settinfo.ts");
const { leggTilProdukt } = await import("../src/produkter.ts");

await migrate();
process.on("exit", () => rmSync(DB, { force: true }));

const NÅ = new Date().toISOString();

async function leggSett(code, name, utgitt, antall, parent = null) {
  await db().execute({
    sql: `INSERT INTO sets (code, name, released_at, card_count, parent_code)
          VALUES (?,?,?,?,?)`,
    args: [code, name, utgitt, antall, parent],
  });
}

async function leggKort(id, set_code, rarity) {
  await db().execute({
    sql: `INSERT INTO cards (id, oracle_id, name, name_norm, set_code,
                             collector_number, rarity, er_token,
                             has_nonfoil, has_foil)
          VALUES (?,?,?,?,?,?,?,0,1,0)`,
    args: [id, "o-" + id, "Kort " + id, "kort " + id, set_code, id, rarity],
  });
}

async function leggPåLager(card_id, antall) {
  await db().execute({
    sql: `INSERT INTO lager_bevegelser (card_id, finish, condition, antall, grunn, created_at)
          VALUES (?, 'nonfoil', 'NM', ?, 'test', ?)`,
    args: [card_id, antall, NÅ],
  });
}

await leggSett("blb", "Bloomburrow", "2024-08-02", 281);
await leggSett("blc", "Bloomburrow Commander", "2024-08-02", 100, "blb");
await leggSett("isd", "Innistrad", "2011-09-30", 264);

await leggKort("1", "blb", "common");
await leggKort("2", "blb", "common");
await leggKort("3", "blb", "rare");
await leggKort("4", "blb", "mythic");
await leggKort("5", "blb", "mythic"); // ikke på lager
await leggKort("6", "isd", "rare");

await leggPåLager("1", 4);
await leggPåLager("2", 1);
await leggPåLager("3", 2);
await leggPåLager("4", 1);
await leggPåLager("6", 3);

test("et ukjent sett gir null, ikke et tomt skall", async () => {
  // Fanen skal ikke kunne stå og vise nuller for et sett som ikke finnes.
  assert.equal(await settinfo("finnesikke"), null);
  assert.equal(await settinfo(""), null);
});

test("navn og utgivelse kommer fra settet", async () => {
  const i = await settinfo("blb");
  assert.equal(i.navn, "Bloomburrow");
  assert.equal(i.utgitt, "2024-08-02");
  assert.equal(i.kort_i_settet, 281);
});

test("settkoden tåler store bokstaver", async () => {
  const i = await settinfo("BLB");
  assert.equal(i.code, "blb");
});

test("tallene skiller forskjellige kort fra eksemplarer", async () => {
  const i = await settinfo("blb");
  // Fire forskjellige kort ligger inne; det femte har ingen bevegelser.
  assert.equal(i.ulike_på_lager, 4);
  // Men åtte eksemplarer: 4 + 1 + 2 + 1.
  assert.equal(i.eksemplarer, 8);
});

test("rarietene teller bare det som ligger inne", async () => {
  const i = await settinfo("blb");
  const kart = Object.fromEntries(i.rariteter.map((r) => [r.raritet, r.antall]));
  assert.equal(kart.common, 2);
  assert.equal(kart.rare, 1);
  // Det femte kortet er mytisk, men har ingen bevegelser.
  assert.equal(kart.mythic, 1);
});

test("rarietene står i rekkefølge, sjeldnest sist", async () => {
  const i = await settinfo("blb");
  assert.deepEqual(i.rariteter.map((r) => r.raritet), ["common", "rare", "mythic"]);
});

test("et sett vet om slektningene sine", async () => {
  const i = await settinfo("blb");
  assert.deepEqual(i.slektninger, [{ code: "blc", navn: "Bloomburrow Commander" }]);

  // Og veien tilbake: Commander-settet finner hovedsettet.
  const c = await settinfo("blc");
  assert.ok(c.slektninger.some((x) => x.code === "blb"));
  // Men ikke seg selv.
  assert.ok(!c.slektninger.some((x) => x.code === "blc"));
});

test("et sett uten slektninger får en tom liste, ikke seg selv", async () => {
  const i = await settinfo("isd");
  assert.deepEqual(i.slektninger, []);
});

test("sealed-fanen vises bare når det finnes sealed i settet", async () => {
  // Før: ingenting.
  assert.equal((await settinfo("blb")).sealed, 0);

  await leggTilProdukt({ type: "sealed", navn: "Bloomburrow display", pris_ore: 300000, antall: 1, set_code: "blb" });
  assert.equal((await settinfo("blb")).sealed, 1);

  // Og den smitter ikke over på nabosettet.
  assert.equal((await settinfo("isd")).sealed, 0);
});

test("et utsolgt produkt teller ikke", async () => {
  // Ellers ville fanen stått der og åpnet en tom liste.
  await leggTilProdukt({ type: "sealed", navn: "Utsolgt bundle", pris_ore: 50000, antall: 0, set_code: "isd" });
  assert.equal((await settinfo("isd")).sealed, 0);
});

test("komplette sett telles for seg", async () => {
  await leggTilProdukt({ type: "komplettsett", navn: "Komplett Innistrad", pris_ore: 900000, antall: 1, set_code: "isd" });
  const i = await settinfo("isd");
  assert.equal(i.komplettsett, 1);
  assert.equal(i.sealed, 0, "de to skal ikke blandes");
});
