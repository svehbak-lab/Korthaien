import test from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";

const DB = `/tmp/kortinfo-${process.pid}.db`;
rmSync(DB, { force: true });
process.env.DATABASE_URL = `file:${DB}`;

const { db, migrate } = await import("../src/db.ts");
const { skrivBolk } = await import("../src/import-scryfall.ts");

await migrate();
process.on("exit", () => rmSync(DB, { force: true }));

// Former hentet fra Scryfalls faktiske data. Det er formen som er poenget,
// ikke tallene: enkeltsidig, transform, splitt, og planeswalker.
const KORT = [
  {
    id: "sheoldred",
    oracle_id: "o-sheoldred",
    name: "Sheoldred, the Apocalypse",
    set: "dmu",
    collector_number: "107",
    rarity: "mythic",
    finishes: ["nonfoil", "foil"],
    released_at: "2022-09-09",
    prices: { usd: "64.99", usd_foil: "89.99" },
    image_uris: { normal: "https://cards.scryfall.io/normal/sheoldred.jpg" },
    type_line: "Legendary Creature — Phyrexian Praetor",
    oracle_text: "Deathtouch\nWhenever you draw a card, you gain 2 life.",
    mana_cost: "{2}{B}{B}",
    cmc: 4,
    colors: ["B"],
    color_identity: ["B"],
    power: "4",
    toughness: "5",
    keywords: ["Deathtouch"],
    artist: "Chris Rahn",
    legalities: { standard: "legal", modern: "legal", vintage: "legal" },
    reserved: false,
  },
  {
    // Transform: verken tekst eller manakostnad ligger på kortet selv.
    id: "fable",
    oracle_id: "o-fable",
    name: "Fable of the Mirror-Breaker // Reflection of Kiki-Jiki",
    set: "neo",
    collector_number: "141",
    rarity: "rare",
    finishes: ["nonfoil", "foil"],
    released_at: "2022-02-18",
    prices: { usd: "18.50", usd_foil: "22.00" },
    type_line: "Enchantment — Saga // Enchantment Creature — Goblin Shaman",
    cmc: 3,
    color_identity: ["R"],
    artist: "Yusuke Mochizuki",
    legalities: { modern: "legal" },
    card_faces: [
      {
        image_uris: { normal: "https://cards.scryfall.io/normal/fable-a.jpg" },
        type_line: "Enchantment — Saga",
        oracle_text: "I — Create a 2/2 red Goblin Shaman creature token.",
        mana_cost: "{2}{R}",
        colors: ["R"],
      },
      {
        type_line: "Enchantment Creature — Goblin Shaman",
        oracle_text: "Whenever you tap a nontoken creature for mana, add one extra mana.",
        mana_cost: "",
        colors: ["R"],
        power: "2",
        toughness: "2",
      },
    ],
  },
  {
    // Planeswalker: loyalty i stedet for styrke og livskraft.
    id: "jace",
    oracle_id: "o-jace",
    name: "Jace, the Mind Sculptor",
    set: "wwk",
    collector_number: "31",
    rarity: "mythic",
    finishes: ["nonfoil", "foil"],
    released_at: "2010-02-05",
    prices: { usd: "89.99", usd_foil: null },
    image_uris: { normal: "https://cards.scryfall.io/normal/jace.jpg" },
    type_line: "Legendary Planeswalker — Jace",
    oracle_text: "+2: Look at the top card of target player's library.",
    mana_cost: "{2}{U}{U}",
    cmc: 4,
    colors: ["U"],
    color_identity: ["U"],
    loyalty: "3",
    artist: "Jason Chan",
    legalities: { legacy: "legal", modern: "not_legal" },
    reserved: false,
  },
  {
    // Reservelistekort uten pris — akkurat den kombinasjonen som gjør at
    // Scryfall-prisen ikke er til å stole på.
    id: "lotus",
    oracle_id: "o-lotus",
    name: "Black Lotus",
    set: "leb",
    collector_number: "233",
    rarity: "rare",
    finishes: ["nonfoil"],
    released_at: "1993-10-04",
    prices: { usd: null, usd_foil: null },
    image_uris: { normal: "https://cards.scryfall.io/normal/lotus.jpg" },
    type_line: "Artifact",
    oracle_text: "{T}, Sacrifice Black Lotus: Add three mana of any one color.",
    mana_cost: "{0}",
    cmc: 0,
    colors: [],
    color_identity: [],
    artist: "Christopher Rush",
    legalities: { vintage: "restricted", legacy: "banned" },
    reserved: true,
  },
];

await db().execute(
  "INSERT INTO sets (code,name,released_at,card_count,parent_code) VALUES ('dmu','Dominaria United','2022-09-09',281,NULL)"
);
await skrivBolk(KORT);

const hent = async (id) =>
  (await db().execute({ sql: "SELECT * FROM cards WHERE id = ?", args: [id] })).rows[0];

test("vanlig kort får tekst, type, kostnad og kunstner", async () => {
  const k = await hent("sheoldred");
  assert.equal(k.type_line, "Legendary Creature — Phyrexian Praetor");
  assert.match(k.oracle_text, /Deathtouch/);
  assert.equal(k.mana_cost, "{2}{B}{B}");
  assert.equal(Number(k.cmc), 4);
  assert.equal(k.power, "4");
  assert.equal(k.toughness, "5");
  assert.equal(k.artist, "Chris Rahn");
  assert.equal(Number(k.reserved), 0);
});

test("farger og lovlighet lagres som lister det går an å filtrere på", async () => {
  const k = await hent("sheoldred");
  assert.deepEqual(JSON.parse(k.colors), ["B"]);
  assert.deepEqual(JSON.parse(k.color_identity), ["B"]);
  assert.deepEqual(JSON.parse(k.keywords), ["Deathtouch"]);
  assert.equal(JSON.parse(k.legalities).modern, "legal");
});

test("dobbeltsidige kort får tekst fra begge sider", async () => {
  const k = await hent("fable");
  // Uten sammenslåingen ville dette feltet vært tomt.
  assert.match(k.oracle_text, /Goblin Shaman creature token/);
  assert.match(k.oracle_text, /tap a nontoken creature/);
  assert.match(k.mana_cost, /\{2\}\{R\}/);
  assert.equal(k.type_line, "Enchantment — Saga // Enchantment Creature — Goblin Shaman");
});

test("styrke og livskraft leses fra forsiden, ikke baksiden", async () => {
  const k = await hent("fable");
  // Baksiden er 2/2, forsiden er en saga uten styrke. Forsiden gjelder.
  assert.equal(k.power, null);
});

test("farger utledes fra sidene når kortet mangler dem", async () => {
  const k = await hent("fable");
  assert.deepEqual(JSON.parse(k.colors), ["R"]);
});

test("planeswalkere får lojalitet", async () => {
  const k = await hent("jace");
  assert.equal(k.loyalty, "3");
  assert.equal(k.power, null);
});

test("reservelistekort merkes", async () => {
  assert.equal(Number((await hent("lotus")).reserved), 1);
  assert.equal(Number((await hent("jace")).reserved), 0);
});

test("tomme lister lagres som ingenting, ikke som tom liste", async () => {
  // Black Lotus er fargeløs. «[]» i basen ville gjort filtrering vanskeligere
  // enn å ikke ha noe der.
  assert.equal((await hent("lotus")).colors, null);
});

test("ny import oppdaterer opplysningene uten å røre resten", async () => {
  const endret = structuredClone(KORT[0]);
  endret.oracle_text = "Deathtouch\nOppdatert tekst fra Scryfall.";
  endret.prices = { usd: "70.00", usd_foil: "95.00" };
  await skrivBolk([endret]);

  const k = await hent("sheoldred");
  assert.match(k.oracle_text, /Oppdatert tekst/);
  assert.equal(Number(k.usd), 70);
  assert.equal(k.name_norm, "sheoldredtheapocalypse", "navneindeksen står");
});
