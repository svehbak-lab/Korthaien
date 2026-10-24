// Raden med nye sett på forsiden.
//
// Poenget med den er at den oppdaterer seg selv. Innhold som endrer seg ofte
// skal ikke gå gjennom et menneske — hverken Svein eller meg. Testene her
// holder fast ved nettopp det: at lista følger lageret, og at den ikke kan
// vise et sett det ikke er noe å kjøpe i.

import test from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";

const DB = `/tmp/forside-${process.pid}.db`;
rmSync(DB, { force: true });
process.env.DATABASE_URL = `file:${DB}`;
// Disse testene legger kort i lagerboken; butikken skal lese derfra.
process.env.LAGERKILDE = "bok";

const { db, migrate, normaliser, settSetting } = await import("../src/db.ts");
const { forsideSett } = await import("../src/forside.ts");

await migrate();
process.on("exit", () => rmSync(DB, { force: true }));

// Fire sett med ulik utgivelsesdato. «gammelt» har kort på lager, «tomt» har
// ingen — og skal derfor aldri vises.
for (const [kode, navn, utgitt] of [
  ["nyest", "Nyeste Sett", "2026-09-01"],
  ["midt", "Midt Sett", "2025-04-10"],
  ["gammelt", "Gammelt Sett", "2003-07-28"],
  ["tomt", "Tomt Sett", "2026-10-01"],
]) {
  await db().execute({
    sql: "INSERT INTO sets (code,name,released_at,card_count,parent_code) VALUES (?,?,?,10,NULL)",
    args: [kode, navn, utgitt],
  });
}

let n = 0;
async function leggInn(sett, navn, usd, påLager) {
  const id = `k${n++}`;
  await db().execute({
    sql: `INSERT INTO cards (id,oracle_id,name,name_norm,front_norm,back_norm,variant,set_code,
                             collector_number,rarity,usd,usd_foil,has_nonfoil,has_foil,image_uri,released_at)
          VALUES (?,?,?,?,NULL,NULL,'vanlig',?,?,'rare',?,NULL,1,0,?,'2020-01-01')`,
    args: [id, "o-" + id, navn, normaliser(navn), sett, String(n), usd, `/bilde/${id}.jpg`],
  });
  if (påLager) {
    await db().execute({
      sql: `INSERT INTO lager_bevegelser (card_id,finish,condition,antall,grunn,created_at)
            VALUES (?,'nonfoil','NM',?,'manuell','2026-01-01T00:00:00Z')`,
      args: [id, påLager],
    });
  }
  return id;
}

await leggInn("nyest", "Billig Kort", 1, 2);
const dyrest = await leggInn("nyest", "Dyrt Kort", 400, 1);
await leggInn("midt", "Midtkort", 12, 3);
await leggInn("gammelt", "Gammelkort", 9, 1);
await leggInn("tomt", "Aldri Solgt", 99, 0);

test("lista er settene du har kort i, nyeste først", async () => {
  const ut = await forsideSett(5);
  assert.deepEqual(ut.map((s) => s.code), ["nyest", "midt", "gammelt"]);
});

test("et sett uten kort på lager kommer ikke med", async () => {
  // En rute som leder til et tomt sett er verre enn én rute mindre.
  const ut = await forsideSett(5);
  assert.equal(ut.find((s) => s.code === "tomt"), undefined);
});

test("bildet er det dyreste kortet du har i settet", async () => {
  // Det er kortet folk kjenner settet igjen på.
  const nyest = (await forsideSett(6)).find((s) => s.code === "nyest");
  assert.equal(nyest.kort_navn, "Dyrt Kort");
  assert.equal(nyest.image_uri, `/bilde/${dyrest}.jpg`);
});

test("antallet kort i settet telles", async () => {
  const nyest = (await forsideSett(6)).find((s) => s.code === "nyest");
  assert.equal(nyest.kort, 2);
});

test("lista følger lageret av seg selv", async () => {
  // Kjernen i det hele: kommer det kort inn i et sett, dukker settet opp
  // uten at noen har gjort noe.
  await leggInn("tomt", "Nå Har Vi Et", 50, 4);
  const ut = await forsideSett(5);
  assert.equal(ut[0].code, "tomt", "det nyeste settet skal ligge først");
  assert.equal(ut[0].kort_navn, "Nå Har Vi Et");
});

test("forside_sett overstyrer, i din rekkefølge", async () => {
  await settSetting("forside_sett", ["gammelt", "nyest"]);
  assert.deepEqual((await forsideSett(6)).map((s) => s.code), ["gammelt", "nyest"]);
});

test("et overstyrt sett uten kort faller likevel ut", async () => {
  await settSetting("forside_sett", ["gammelt", "finnesikke"]);
  assert.deepEqual((await forsideSett(6)).map((s) => s.code), ["gammelt"]);
});

test("tom liste betyr automatisk igjen", async () => {
  await settSetting("forside_sett", []);
  assert.equal((await forsideSett(6))[0].code, "tomt");
});

test("antallet begrenses", async () => {
  assert.equal((await forsideSett(2)).length, 2);
});

test("sortering nyeste gir det som sist ble lagt inn", async () => {
  const { butikkvisning } = await import("../src/salgspris.ts");
  const { lagreIntervaller } = await import("../src/salgspris.ts");
  await lagreIntervaller([{ rarity: "alle", usd_fra: 0, usd_til: 10000, pris_ore: 5000 }]);

  // Et kort som ble lagt inn i dag skal ligge foran et som ble lagt inn i fjor.
  const sent = await leggInn("midt", "Kom I Dag", 3, 0);
  await db().execute({
    sql: `INSERT INTO lager_bevegelser (card_id,finish,condition,antall,grunn,created_at)
          VALUES (?,'nonfoil','NM',1,'manuell','2026-10-23T12:00:00Z')`,
    args: [sent],
  });
  // ...og en linje som TAR kort ut skal ikke gjøre et gammelt kort nytt.
  const gammelt = (await db().execute("SELECT card_id FROM lager_bevegelser WHERE antall > 0 ORDER BY id LIMIT 1")).rows[0].card_id;
  await db().execute({
    sql: `INSERT INTO lager_bevegelser (card_id,finish,condition,antall,grunn,created_at)
          VALUES (?,'nonfoil','NM',-1,'salg','2026-10-24T12:00:00Z')`,
    args: [gammelt],
  });

  const d = await butikkvisning({ sortering: "nyeste", baresalg: true, perSide: 10 });
  assert.equal(d.kort[0].id, sent, "det sist innlagte kortet skal ligge først");
  assert.notEqual(d.kort[0].id, gammelt, "et uttak gjør ikke et kort nytt");
});

test("settflisen får illustrasjonen alene fra Scryfall, ikke hele kortet", async () => {
  const { kunstAv } = await import("../src/forside.ts");
  assert.equal(
    kunstAv("https://cards.scryfall.io/normal/front/6/d/6da045f8.jpg?1562"),
    "https://cards.scryfall.io/art_crop/front/6/d/6da045f8.jpg?1562"
  );
  assert.equal(kunstAv("/bilde/k1.jpg"), null);
  assert.equal(kunstAv(null), null);
});
