import test from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
const DB = `/tmp/foreldet-${process.pid}.db`;
rmSync(DB, { force: true });
process.env.DATABASE_URL = `file:${DB}`;
const { db, migrate, normaliser } = await import("../src/db.ts");
await migrate();
process.on("exit", () => rmSync(DB, { force: true }));

await db().execute("INSERT INTO sets (code,name,released_at,card_count,parent_code) VALUES ('c21','Commander 2021','2021-04-23',400,NULL)");
await db().execute("INSERT INTO set_rules (set_code,enabled,wanted_default,wanted_foil,conditions,ladder,updated_at) VALUES ('c21',1,8,0,NULL,NULL,'2026-01-01')");
for (const [id, nr, variant] of [["kort-37","37","vanlig"], ["kort-364","364","extended"]]) {
  await db().execute({
    sql: `INSERT INTO cards (id,oracle_id,name,name_norm,front_norm,back_norm,variant,set_code,collector_number,rarity,usd,usd_foil,has_nonfoil,has_foil,image_uri,released_at)
          VALUES (?,?,'Bold Plagiarist',?,NULL,NULL,?, 'c21',?,'rare',2.5,NULL,1,1,NULL,NULL)`,
    args: [id, id, normaliser("Bold Plagiarist"), variant, nr],
  });
}

// Slik dataene så ut hos deg: samme produkt koblet til to kort, fra to kjøringer
const gammel = "2026-09-08T11:26:21.000Z";
const ny = "2026-09-08T12:27:29.000Z";
await db().execute({ sql: `INSERT INTO mystore_stock (card_id,finish,qty,product_id,synced_at) VALUES ('kort-364','nonfoil',3,'46618',?)`, args: [gammel] });

test("gammel kobling fjernes når produktet flytter til et annet kort", async () => {
  // Det synken nå gjør: slett andre rader for produktet, så skriv den nye.
  await db().batch([
    { sql: `DELETE FROM mystore_stock WHERE product_id = ? AND NOT (card_id = ? AND finish = ?)`,
      args: ["46618", "kort-37", "nonfoil"] },
    { sql: `INSERT INTO mystore_stock (card_id,finish,qty,product_id,synced_at) VALUES (?,?,?,?,?)
            ON CONFLICT(card_id,finish) DO UPDATE SET qty=excluded.qty, product_id=excluded.product_id, synced_at=excluded.synced_at`,
      args: ["kort-37", "nonfoil", 3, "46618", ny] },
  ], "write");

  const r = await db().execute("SELECT card_id FROM mystore_stock WHERE product_id='46618'");
  assert.equal(r.rows.length, 1, "bare én kobling per produkt");
  assert.equal(r.rows[0].card_id, "kort-37");
});

test("foreldede rader fra tidligere kjøringer ryddes bort", async () => {
  // En rad ingen synk har rørt på siden forrige gang — produktet finnes ikke
  // lenger, eller har byttet kategori.
  await db().execute({ sql: `INSERT INTO mystore_stock (card_id,finish,qty,product_id,synced_at) VALUES ('kort-364','foil',9,'gammelt',?)`, args: [gammel] });
  const før = await db().execute("SELECT COUNT(*) AS n FROM mystore_stock");
  assert.equal(Number(før.rows[0].n), 2);

  await db().execute({
    sql: `DELETE FROM mystore_stock WHERE synced_at < ?
           AND card_id IN (SELECT id FROM cards WHERE set_code IN
               (SELECT set_code FROM set_rules WHERE enabled = 1))`,
    args: [ny],
  });

  const etter = await db().execute("SELECT card_id, product_id FROM mystore_stock");
  assert.equal(etter.rows.length, 1, "den foreldede raden er borte");
  assert.equal(etter.rows[0].product_id, "46618", "den ferske står igjen");
});

test("sett som ikke synkes røres ikke", async () => {
  // Et sett du har slått av skal beholde koblingene sine — de blir jo ikke
  // oppdatert, og skal ikke slettes av den grunn.
  await db().execute("INSERT INTO sets (code,name,released_at,card_count,parent_code) VALUES ('inv','Invasion','2000-10-02',350,NULL)");
  await db().execute({
    sql: `INSERT INTO cards (id,oracle_id,name,name_norm,front_norm,back_norm,variant,set_code,collector_number,rarity,usd,usd_foil,has_nonfoil,has_foil,image_uri,released_at)
          VALUES ('inv-1','inv-1','Void',?,NULL,NULL,'vanlig','inv','163','rare',1,NULL,1,0,NULL,NULL)`,
    args: [normaliser("Void")],
  });
  await db().execute({ sql: `INSERT INTO mystore_stock (card_id,finish,qty,product_id,synced_at) VALUES ('inv-1','nonfoil',5,'p-inv',?)`, args: [gammel] });

  await db().execute({
    sql: `DELETE FROM mystore_stock WHERE synced_at < ?
           AND card_id IN (SELECT id FROM cards WHERE set_code IN
               (SELECT set_code FROM set_rules WHERE enabled = 1))`,
    args: [ny],
  });

  const r = await db().execute("SELECT card_id FROM mystore_stock WHERE product_id='p-inv'");
  assert.equal(r.rows.length, 1, "Invasion er ikke slått på, så raden står");
});
