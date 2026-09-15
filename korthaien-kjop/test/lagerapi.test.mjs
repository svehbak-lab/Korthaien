import test, { after } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";

const DB = `/tmp/lagerapi-${process.pid}.db`;
rmSync(DB, { force: true });
process.env.DATABASE_URL = `file:${DB}`;
process.env.ADMIN_PASSWORD = "hemmelig";
process.env.SESSION_SECRET = "test";
process.env.PORT = "3262";

const { db, migrate, normaliser } = await import("../src/db.ts");
await migrate();
process.on("exit", () => rmSync(DB, { force: true }));

await db().execute(
  "INSERT INTO sets (code,name,released_at,card_count,parent_code) VALUES ('isd','Innistrad','2011-09-30',264,NULL)"
);
for (const [id, navn, nr, foil] of [
  ["lil", "Liliana of the Veil", "105", 1],
  ["bulk", "Ambush Viper", "196", 1],
  ["kunbare", "Kun Vanlig", "200", 0],
]) {
  await db().execute({
    sql: `INSERT INTO cards (id,oracle_id,name,name_norm,front_norm,back_norm,variant,set_code,
                             collector_number,rarity,usd,usd_foil,has_nonfoil,has_foil,image_uri,released_at)
          VALUES (?,?,?,?,NULL,NULL,'vanlig','isd',?,'rare',1,2,1,?,NULL,'2011-09-30')`,
    args: [id, id, navn, normaliser(navn), nr, foil],
  });
}

const { stopp } = await import("../src/server.ts");
await new Promise((r) => setTimeout(r, 800));
after(() => stopp());

const BASE = "http://localhost:3262";
let cookie = "";
async function kall(sti, opts = {}) {
  const r = await fetch(BASE + sti, {
    ...opts,
    headers: {
      ...(opts.body ? { "Content-Type": "application/json" } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      "X-Forwarded-For": "203.0.113.9",
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const satt = r.headers.get("set-cookie");
  if (satt) cookie = satt.split(";")[0];
  const t = await r.text();
  return { status: r.status, data: t ? JSON.parse(t) : null };
}

test("lageret er ikke åpent for hvem som helst", async () => {
  const r = await fetch(`${BASE}/api/admin/lager?sett=isd`);
  assert.equal(r.status, 401);
});

test("logg inn", async () => {
  assert.equal((await kall("/api/admin/login", { method: "POST", body: { password: "hemmelig" } })).status, 200);
});

test("tomt lager gir kortene med null", async () => {
  const r = await kall("/api/admin/lager?sett=isd");
  assert.equal(r.status, 200);
  assert.equal(r.data.kort.length, 3);
  assert.equal(r.data.stykker, 0);
  assert.deepEqual(r.data.kort[0].lager, {});
});

test("beholdning settes, og tallet er en beholdning og ikke et tillegg", async () => {
  const første = await kall("/api/admin/lager/lil", {
    method: "PUT",
    body: { finish: "nonfoil", condition: "NM", antall: 7 },
  });
  assert.deepEqual(første.data, { før: 0, etter: 7, endring: 7 });

  const andre = await kall("/api/admin/lager/lil", {
    method: "PUT",
    body: { finish: "nonfoil", condition: "NM", antall: 4 },
  });
  assert.deepEqual(andre.data, { før: 7, etter: 4, endring: -3 }, "fire betyr fire, ikke elleve");
});

test("finish og tilstand holdes fra hverandre", async () => {
  await kall("/api/admin/lager/lil", { method: "PUT", body: { finish: "foil", condition: "NM", antall: 2 } });
  await kall("/api/admin/lager/lil", { method: "PUT", body: { finish: "nonfoil", condition: "EX", antall: 3 } });

  const r = await kall("/api/admin/lager?sett=isd");
  const lil = r.data.kort.find((k) => k.id === "lil");
  assert.deepEqual(lil.lager, { "nonfoil:NM": 4, "nonfoil:EX": 3, "foil:NM": 2 });
  assert.equal(r.data.stykker, 9);
});

test("ugyldige verdier avvises", async () => {
  assert.equal(
    (await kall("/api/admin/lager/lil", { method: "PUT", body: { finish: "nonfoil", condition: "XX", antall: 1 } })).status,
    400
  );
  assert.equal(
    (await kall("/api/admin/lager/lil", { method: "PUT", body: { finish: "nonfoil", condition: "NM", antall: -5 } })).status,
    400
  );
});

test("historikken viser hver endring, ikke bare den siste", async () => {
  const r = await kall("/api/admin/lager/lil/historikk?finish=nonfoil");
  const nm = r.data.filter((x) => x.condition === "NM");
  assert.equal(nm.length, 2, "7 inn og 3 ut er to bevegelser");
  assert.deepEqual(nm.map((x) => x.antall).sort((a, b) => a - b), [-3, 7]);
});

test("sammendraget teller kort og eksemplarer", async () => {
  const r = await kall("/api/admin/lager-sammendrag");
  assert.equal(Number(r.data.kort), 1);
  assert.equal(Number(r.data.stykker), 9);
  assert.ok(Array.isArray(r.data.fordeling));
});

test("kortlista er sortert på samlernummer som tall, ikke som tekst", async () => {
  const r = await kall("/api/admin/lager?sett=isd");
  assert.deepEqual(r.data.kort.map((k) => k.collector_number), ["105", "196", "200"]);
});
