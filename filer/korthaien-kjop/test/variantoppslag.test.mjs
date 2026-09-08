import test from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
const DB = `/tmp/vo-${process.pid}.db`;
rmSync(DB, { force: true });
process.env.DATABASE_URL = `file:${DB}`;
const { db, migrate, normaliser } = await import("../src/db.ts");
const { variantFraNavn, skillUtNummer, skillUtBokstav } = await import("../src/varianter.ts");
await migrate();
process.on("exit", () => rmSync(DB, { force: true }));

await db().execute("INSERT INTO sets (code,name,released_at,card_count,parent_code) VALUES ('cmr','Commander Legends','2020-11-20',700,NULL)");
await db().execute("INSERT INTO sets (code,name,released_at,card_count,parent_code) VALUES ('m20','Core Set 2020','2019-07-12',300,NULL)");
await db().execute("INSERT INTO sets (code,name,released_at,card_count,parent_code) VALUES ('3ed','Revised','1994-04-01',306,NULL)");

async function kort(id, navn, sett, nr, variant, usd) {
  await db().execute({
    sql: `INSERT INTO cards (id,oracle_id,name,name_norm,front_norm,back_norm,variant,set_code,collector_number,rarity,usd,usd_foil,has_nonfoil,has_foil,image_uri,released_at)
          VALUES (?,?,?,?,NULL,NULL,?,?,?,'rare',?,NULL,1,1,NULL,NULL)`,
    args: [id, id, navn, normaliser(navn), variant, sett, nr, usd],
  });
}
// Samme kort i to versjoner med ulik pris — kjernen i problemet
await kort("cmr-40", "Bold Plagiarist", "cmr", "40", "vanlig", 2.5);
await kort("cmr-641", "Bold Plagiarist", "cmr", "641", "extended", 9.0);
// Basic lands, som bare skilles av nummer
await kort("m20-265", "Island", "m20", "265", "vanlig", 0.1);
await kort("m20-267", "Island", "m20", "267", "vanlig", 0.3);
for (const [i, nr] of ["104", "105", "106"].entries())
  await kort(`3ed-${nr}`, "Swamp", "3ed", nr, "vanlig", 0.5 + i);

// Samme oppslag som synken gjør
async function slåOpp(produktnavn, setCode) {
  const variant = variantFraNavn(produktnavn);
  const utenFoil = produktnavn.replace(/\bfoil\b/gi, "");
  let rent = utenFoil.replace(/\([^)]*\)/g, "").trim();
  const mn = skillUtNummer(rent);
  let nummer = mn.nummer;
  rent = mn.navn;
  let posisjon = null;
  if (!nummer) {
    const mb = skillUtBokstav(rent);
    posisjon = mb.posisjon;
    rent = mb.navn;
  }
  const n = normaliser(rent);
  if (nummer) {
    const r = await db().execute({
      sql: `SELECT id FROM cards WHERE set_code = ? AND lower(collector_number) = ? AND name_norm = ? LIMIT 1`,
      args: [setCode, nummer, n],
    });
    if (r.rows[0]) return r.rows[0].id;
  }
  const r = await db().execute({
    sql: `SELECT c.id FROM cards c LEFT JOIN sets s ON s.code = c.set_code
           WHERE c.set_code = ? AND c.name_norm = ?
           ORDER BY (c.variant = ?) DESC, CAST(c.collector_number AS INTEGER) ASC
           LIMIT 1 OFFSET ?`,
    args: [setCode, n, variant, posisjon || 0],
  });
  return r.rows[0]?.id ?? null;
}

test("extended art treffer extended art, ikke den vanlige", async () => {
  assert.equal(await slåOpp("Bold Plagiarist (Extended Art)", "cmr"), "cmr-641");
});

test("vanlig utgave treffer den vanlige", async () => {
  assert.equal(await slåOpp("Bold Plagiarist", "cmr"), "cmr-40");
});

test("foil endrer ikke hvilken versjon som velges", async () => {
  assert.equal(await slåOpp("Bold Plagiarist (Extended Art) (foil)", "cmr"), "cmr-641");
  assert.equal(await slåOpp("Bold Plagiarist (foil)", "cmr"), "cmr-40");
});

test("samlernummer i navnet gir riktig basic land", async () => {
  assert.equal(await slåOpp("Island 267 (foil)", "m20"), "m20-267");
  assert.equal(await slåOpp("Island 265", "m20"), "m20-265");
});

test("bokstav gir riktig basic land i Revised", async () => {
  assert.equal(await slåOpp("Swamp A", "3ed"), "3ed-104");
  assert.equal(await slåOpp("Swamp B", "3ed"), "3ed-105");
  assert.equal(await slåOpp("Swamp C", "3ed"), "3ed-106");
});

test("feil nummer faller tilbake på navnet i stedet for å bomme", async () => {
  // 999 finnes ikke. Da skal vi få et Island, ikke ingenting.
  assert.equal(await slåOpp("Island 999", "m20"), "m20-265");
});
