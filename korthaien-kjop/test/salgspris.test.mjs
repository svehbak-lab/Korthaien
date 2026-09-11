import test from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";

const DB = `/tmp/salg-${process.pid}.db`;
rmSync(DB, { force: true });
process.env.DATABASE_URL = `file:${DB}`;

const { db, migrate, normaliser, settSetting } = await import("../src/db.ts");
const {
  lagreIntervaller, hentIntervaller, finnHull, finnIntervall,
  salgsprisØre, salgspriser, hentSalgsOppsett, settManuellSalg, salgsprisForSett,
} = await import("../src/salgspris.ts");

await migrate();
process.on("exit", () => rmSync(DB, { force: true }));
await settSetting("usd_nok", 10);

// Slik Svein beskrev det: rare under 0,90 koster 10 kroner, 0,91–1,40 koster 15.
const INTERVALLER = [
  { rarity: "common", usd_fra: 0, usd_til: 0.9, pris_ore: 300 },
  { rarity: "common", usd_fra: 0.91, usd_til: 2, pris_ore: 800 },
  { rarity: "rare", usd_fra: 0, usd_til: 0.9, pris_ore: 1000 },
  { rarity: "rare", usd_fra: 0.91, usd_til: 1.4, pris_ore: 1500 },
  { rarity: "rare", usd_fra: 1.41, usd_til: 5, pris_ore: 4000 },
  { rarity: "alle", usd_fra: 0, usd_til: 0.5, pris_ore: 200 },
];

test("intervallene lagres og leses tilbake", async () => {
  assert.equal(await lagreIntervaller(INTERVALLER), 6);
  const ut = await hentIntervaller();
  assert.equal(ut.length, 6);
  assert.equal(ut.find((i) => i.rarity === "rare" && i.usd_fra === 0.91).pris_ore, 1500);
});

test("prisen er flat innenfor intervallet", async () => {
  const opp = await hentSalgsOppsett();
  // Både 0,20 og 0,80 er samme rare, og koster det samme.
  assert.equal(salgsprisØre({ usd: 0.2, rarity: "rare" }, "nonfoil", "NM", opp), 1000);
  assert.equal(salgsprisØre({ usd: 0.8, rarity: "rare" }, "nonfoil", "NM", opp), 1000);
  assert.equal(salgsprisØre({ usd: 0.95, rarity: "rare" }, "nonfoil", "NM", opp), 1500);
});

test("raritet avgjør hvilket intervall som gjelder", async () => {
  const opp = await hentSalgsOppsett();
  assert.equal(salgsprisØre({ usd: 0.5, rarity: "rare" }, "nonfoil", "NM", opp), 1000);
  assert.equal(salgsprisØre({ usd: 0.5, rarity: "common" }, "nonfoil", "NM", opp), 300);
});

test("en egen regel for rariteten slår regelen for alle", async () => {
  const opp = await hentSalgsOppsett();
  // 0,30 treffer både «rare 0–0,9» og «alle 0–0,5». Den mest spesifikke vinner.
  assert.equal(finnIntervall(opp.intervaller, "rare", 0.3).pris_ore, 1000);
  // Mythic har ingen egen regel, og faller til «alle».
  assert.equal(finnIntervall(opp.intervaller, "mythic", 0.3).pris_ore, 200);
});

test("kort dyrere enn alle intervallene prises av markedet", async () => {
  const opp = await hentSalgsOppsett();
  // $40 × 10 kr × faktor 1,0 = 400 kr
  assert.equal(salgsprisØre({ usd: 40, rarity: "rare" }, "nonfoil", "NM", opp), 40000);
});

test("faktoren styrer påslaget på de dyre kortene", async () => {
  await settSetting("salg_faktor", 1.2);
  const opp = await hentSalgsOppsett();
  assert.equal(salgsprisØre({ usd: 40, rarity: "rare" }, "nonfoil", "NM", opp), 48000);
  await settSetting("salg_faktor", 1.0);
});

test("salgstrappen trekker fra for tilstand, og er ikke kjøpstrappen", async () => {
  await settSetting("buy_pct", 70);
  const opp = await hentSalgsOppsett();
  const alle = salgspriser({ usd: 0.5, rarity: "rare" }, "nonfoil", opp);
  assert.deepEqual(alle, [
    { condition: "NM", ore: 1000 },
    { condition: "EX", ore: 900 },   // 85 % av 10 kr, rundet til krone
    { condition: "VG", ore: 700 },
    { condition: "G", ore: 600 },    // 55 % = 5,50 → 6 kr
  ]);
});

test("prisene rundes til hele kroner", async () => {
  const opp = await hentSalgsOppsett();
  // 85 % av 15 kr er 12,75. Butikkpriser har ikke øre.
  assert.equal(salgsprisØre({ usd: 1, rarity: "rare" }, "nonfoil", "EX", opp), 1300);
});

test("avrundingen kan slås av", async () => {
  await settSetting("salg_avrunding", 1);
  const opp = await hentSalgsOppsett();
  assert.equal(salgsprisØre({ usd: 1, rarity: "rare" }, "nonfoil", "EX", opp), 1275);
  await settSetting("salg_avrunding", 100);
});

test("manuell pris slår intervallet", async () => {
  const opp = await hentSalgsOppsett();
  assert.equal(salgsprisØre({ usd: 0.2, rarity: "rare" }, "nonfoil", "NM", opp, 25000), 25000);
  // Og trappen gjelder fortsatt: 85 % av 250 kr = 212,50 → 213
  assert.equal(salgsprisØre({ usd: 0.2, rarity: "rare" }, "nonfoil", "EX", opp, 25000), 21300);
});

test("din egen dollarpris brukes når Scryfall mangler", async () => {
  const opp = await hentSalgsOppsett();
  // Scryfall har ingenting, men du har satt 3 dollar. Da treffer intervallet.
  assert.equal(salgsprisØre({ usd: null, rarity: "rare" }, "nonfoil", "NM", opp, null, 3), 4000);
});

test("uten pris i det hele tatt er kortet ikke til salgs", async () => {
  const opp = await hentSalgsOppsett();
  assert.equal(salgsprisØre({ usd: null, rarity: "rare" }, "nonfoil", "NM", opp), 0);
});

test("foil prises av foil-prisen", async () => {
  const opp = await hentSalgsOppsett();
  const kort = { usd: 0.2, usd_foil: 1.0, rarity: "rare" };
  assert.equal(salgsprisØre(kort, "nonfoil", "NM", opp), 1000);
  assert.equal(salgsprisØre(kort, "foil", "NM", opp), 1500);
});

test("overlappende intervaller varsles i stedet for å velges stilltiende", () => {
  const feil = finnHull([
    { rarity: "rare", usd_fra: 0, usd_til: 1, pris_ore: 1000 },
    { rarity: "rare", usd_fra: 0.5, usd_til: 2, pris_ore: 2000 },
  ]);
  assert.equal(feil.length, 1);
  assert.match(feil[0], /overlapper/);
});

test("et åpent intervall med noe over seg varsles også", () => {
  const feil = finnHull([
    { rarity: "rare", usd_fra: 0, usd_til: null, pris_ore: 1000 },
    { rarity: "rare", usd_fra: 5, usd_til: 10, pris_ore: 5000 },
  ]);
  assert.match(feil[0], /åpent/);
});

test("hele settet prises, med manuell overstyring der den finnes", async () => {
  await db().execute(
    "INSERT INTO sets (code,name,released_at,card_count,parent_code) VALUES ('tst','Testsett','2020-01-01',2,NULL)"
  );
  for (const [id, navn, rar, usd] of [
    ["a", "Billig Rare", "rare", 0.3],
    ["b", "Dyr Rare", "rare", 30],
  ]) {
    await db().execute({
      sql: `INSERT INTO cards (id,oracle_id,name,name_norm,front_norm,back_norm,variant,set_code,
                               collector_number,rarity,usd,usd_foil,has_nonfoil,has_foil,image_uri,released_at)
            VALUES (?,?,?,?,NULL,NULL,'vanlig','tst','1',?,?,NULL,1,0,NULL,'2020-01-01')`,
      args: [id, id, navn, normaliser(navn), rar, usd],
    });
  }
  await settManuellSalg("b", "nonfoil", 99900);

  const r = await salgsprisForSett("tst");
  const a = r.kort.find((k) => k.id === "a");
  const b = r.kort.find((k) => k.id === "b");
  assert.equal(a.priser.nonfoil.nm, 1000, "avledet av intervallet");
  assert.equal(a.priser.nonfoil.manuell, null);
  assert.equal(b.priser.nonfoil.nm, 99900, "manuell pris gjelder");
  assert.equal(b.priser.nonfoil.manuell, 99900);
});

test("manuell salgspris kan fjernes igjen", async () => {
  await settManuellSalg("b", "nonfoil", null);
  const r = await salgsprisForSett("tst");
  const b = r.kort.find((k) => k.id === "b");
  assert.equal(b.priser.nonfoil.manuell, null);
  assert.equal(b.priser.nonfoil.nm, 30000, "tilbake til markedspris");
});
