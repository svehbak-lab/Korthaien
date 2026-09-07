import { db, migrate, settSetting } from "./db.js";
import { importerScryfall } from "./import-scryfall.js";
import { synkMystore } from "./mystore.js";
import { utløpGamleOrdrer } from "./orders.js";

// Kommandolinje for jobbene. Render kjører disse som cron.

const kommando = process.argv[2];

async function seed() {
  // Et lite sett ekte kortdata så du kan klikke gjennom løsningen før den
  // fulle importen er kjørt. Prisene er ikke oppdaterte — de er testdata.
  await db().batch(
    [
      { sql: `INSERT INTO sets (code,name,released_at,card_count) VALUES ('leb','Limited Edition Beta','1993-10-04',302) ON CONFLICT(code) DO NOTHING`, args: [] },
      { sql: `INSERT INTO sets (code,name,released_at,card_count) VALUES ('inv','Invasion','2000-10-02',350) ON CONFLICT(code) DO NOTHING`, args: [] },
      { sql: `INSERT INTO sets (code,name,released_at,card_count) VALUES ('mh2','Modern Horizons 2','2021-06-18',303) ON CONFLICT(code) DO NOTHING`, args: [] },
    ],
    "write"
  );

  const kort: [string, string, string, string, string, number, number | null, number][] = [
    // id, navn, sett, nummer, raritet, usd, usd_foil, has_foil
    ["seed-leb-bolt", "Lightning Bolt", "leb", "162", "common", 220, null, 0],
    ["seed-inv-bolt", "Lightning Bolt", "inv", "0", "common", 4.5, 30, 1],
    ["seed-mh2-bolt", "Lightning Bolt", "mh2", "401", "common", 3.2, 9.5, 1],
    ["seed-inv-void", "Void", "inv", "163", "rare", 1.4, 6, 1],
    ["seed-mh2-raga", "Ragavan, Nimble Pilferer", "mh2", "138", "mythic", 42, 68, 1],
    ["seed-leb-ance", "Ancestral Recall", "leb", "48", "rare", 9500, null, 0],
  ];
  await db().batch(
    kort.map(([id, navn, sett, nr, rar, usd, foil, harFoil]) => ({
      sql: `INSERT INTO cards (id,oracle_id,name,name_norm,set_code,collector_number,rarity,usd,usd_foil,has_nonfoil,has_foil,image_uri,released_at)
            VALUES (?,?,?,?,?,?,?,?,?,1,?,NULL,NULL)
            ON CONFLICT(id) DO UPDATE SET usd=excluded.usd, usd_foil=excluded.usd_foil`,
      args: [id, id, navn, navn.toLowerCase().replace(/[^a-z0-9]/g, ""), sett, nr, rar, usd, foil, harFoil],
    })),
    "write"
  );

  const nå = new Date().toISOString();
  await db().batch(
    [
      // Invasion: 8 av hvert, tar imot NM og EX
      { sql: `INSERT INTO set_rules (set_code,enabled,wanted_default,conditions,ladder,updated_at) VALUES ('inv',1,8,?,?,?)
              ON CONFLICT(set_code) DO UPDATE SET enabled=1, wanted_default=8, conditions=excluded.conditions, ladder=excluded.ladder`,
        args: [JSON.stringify(["NM", "EX"]), JSON.stringify({ NM: 100, EX: 85 }), nå] },
      // Beta: NM og EX, men ikke VG og G
      { sql: `INSERT INTO set_rules (set_code,enabled,wanted_default,conditions,ladder,updated_at) VALUES ('leb',1,2,?,?,?)
              ON CONFLICT(set_code) DO UPDATE SET enabled=1, wanted_default=2, conditions=excluded.conditions, ladder=excluded.ladder`,
        args: [JSON.stringify(["NM", "EX"]), JSON.stringify({ NM: 100, EX: 80 }), nå] },
      // MH2: bare NM, som er standarden
      { sql: `INSERT INTO set_rules (set_code,enabled,wanted_default,conditions,ladder,updated_at) VALUES ('mh2',1,4,NULL,NULL,?)
              ON CONFLICT(set_code) DO UPDATE SET enabled=1, wanted_default=4`,
        args: [nå] },
      // Du har 2 Invasion-bolts fra før, så kunden kan selge deg 6
      { sql: `INSERT INTO mystore_stock (card_id,finish,qty,product_id,synced_at) VALUES ('seed-inv-bolt','nonfoil',2,'demo',?)
              ON CONFLICT(card_id,finish) DO UPDATE SET qty=2`, args: [nå] },
    ],
    "write"
  );
  console.log("Testdata lagt inn: 3 sett, 6 kort, 2 på lager av Invasion-bolt.");
}

await migrate();

switch (kommando) {
  case "import":
    await importerScryfall();
    break;
  case "mystore":
    await synkMystore();
    break;
  case "seed":
    await seed();
    break;
  case "expire":
    console.log(`${await utløpGamleOrdrer()} ordrer utløpt.`);
    break;
  case "sett-kurs": {
    const kurs = Number(process.argv[3]);
    if (!Number.isFinite(kurs) || kurs <= 0) throw new Error("Oppgi en kurs, f.eks. 10.6");
    await settSetting("usd_nok", kurs);
    console.log(`USD/NOK satt til ${kurs}`);
    break;
  }
  default:
    console.log("Bruk: import | mystore | seed | expire | sett-kurs <tall>");
}
process.exit(0);
