// Komplette sett: hva kortene i hovedsettet ville kostet enkeltvis, med din
// salgspris i NM. Brukes til å prise settet med en rabatt mot det.
import test from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";

const DB = `/tmp/komplett-${process.pid}.db`;
rmSync(DB, { force: true });
process.env.DATABASE_URL = `file:${DB}`;

const { db, migrate, normaliser } = await import("../src/db.ts");
const { enkeltvisVerdi } = await import("../src/produkter.ts");
const { hentSalgsOppsett, salgsprisØre } = await import("../src/salgspris.ts");
await migrate();
process.on("exit", () => rmSync(DB, { force: true }));

await db().execute(`INSERT INTO sets (code,name,released_at,card_count,parent_code) VALUES ('tst','Test','2020-01-01',6,NULL)`);
async function kort(id, nr, usd, { variant = "vanlig", token = 0 } = {}) {
  await db().execute({
    sql: `INSERT INTO cards (id,oracle_id,name,name_norm,variant,set_code,collector_number,rarity,usd,usd_foil,
                             has_nonfoil,has_foil,released_at,er_token)
          VALUES (?,?,?,?,?,'tst',?,'rare',?,?,1,1,'2020-01-01',?)`,
    args: [id, id, id, normaliser(id), variant, nr, usd, usd * 2, token],
  });
}
await kort("a", "1", 10);
await kort("b", "2", 2);
await kort("c", "3", null); // uten pris
await kort("d", "4", 50, { variant: "showcase" }); // variant, telles ikke
await kort("e", "5", 99); // utenfor hovedsettet (settet har 3)
await kort("t", "1", 1, { token: 1 }); // token, telles ikke

test("summen er din NM-pris for hvert nummer i hovedsettet; kort uten pris telles for seg", async () => {
  const opp = await hentSalgsOppsett();
  const v = (await enkeltvisVerdi([{ set_code: "tst", foil: false, antall: 3 }])).get("tst:nonfoil");
  const forventet = salgsprisØre({ usd: 10, rarity: "rare" }, "nonfoil", "NM", opp) +
                    salgsprisØre({ usd: 2, rarity: "rare" }, "nonfoil", "NM", opp);
  assert.equal(v.sum_ore, forventet);
  assert.equal(v.uten_pris, 1);

  const f = (await enkeltvisVerdi([{ set_code: "tst", foil: true, antall: 3 }])).get("tst:foil");
  assert.ok(f.sum_ore > v.sum_ore, "foilsettet regnes med foilpriser");
});

test("egen salgspris på et kort brukes", async () => {
  await db().execute(`INSERT INTO card_sale_prices (card_id, finish, nm_ore, updated_at) VALUES ('c', 'nonfoil', 50000, '2026-11-05')`);
  const v = (await enkeltvisVerdi([{ set_code: "tst", foil: false, antall: 3 }])).get("tst:nonfoil");
  assert.equal(v.uten_pris, 0);
  assert.ok(v.sum_ore >= 50000);
});

test("samme tall som grunnsettet i Lagerrapport, også når et kort i hovedsettet er merket som variant", async () => {
  await kort("f", "6", 7, { variant: "showcase" }); // i hovedsettet, men merket variant
  await db().execute(`INSERT INTO set_rules (set_code,enabled,wanted_default,wanted_foil,conditions,ladder,buy_pct,updated_at,grunnsett_til)
                      VALUES ('tst',1,4,0,'["NM"]','{"NM":100}',NULL,'2026-01-01',6)`);
  const { lagerrapport } = await import("../src/statistikk.ts");
  const g = (await lagerrapport()).sett.find((s) => s.set_code === "tst").grunnsett;
  const v = (await enkeltvisVerdi([{ set_code: "tst", foil: false, antall: 6 }])).get("tst:nonfoil");
  assert.equal(v.sum_ore, g.salg_ore);
  assert.equal(v.uten_pris, g.uten_pris);
});
