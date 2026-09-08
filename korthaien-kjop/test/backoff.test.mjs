import test from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
const DB = `/tmp/backoff-${process.pid}.db`;
rmSync(DB, { force: true });
process.env.DATABASE_URL = `file:${DB}`;
process.env.MYSTORE_URL = "https://eksempel.test/api";
process.env.MYSTORE_KEY = "test";
const { migrate } = await import("../src/db.ts");
await migrate();
const { hentProdukter } = await import("../src/mystore.ts");
process.on("exit", () => rmSync(DB, { force: true }));

const ekte = globalThis.fetch;
function svar(status, body, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k) => headers[k.toLowerCase()] ?? null },
    json: async () => body,
  };
}

test("429 gir nytt forsøk i stedet for å gi opp", async () => {
  let kall = 0;
  globalThis.fetch = async () => {
    kall++;
    if (kall <= 2) return svar(429, {}, { "retry-after": "1" });
    return svar(200, {
      data: [{ id: "1", attributes: { name: { no: "Lightning Bolt" }, quantity_physical: 3, sku: "9" } }],
      links: {},
    });
  };
  const p = await hentProdukter("50", 1);
  assert.equal(kall, 3, "to avvisninger, så suksess");
  assert.equal(p.length, 1);
  assert.equal(p[0].navn, "Lightning Bolt");
  assert.equal(p[0].lager, 3);
});

test("gir opp med en forklarende melding til slutt", async () => {
  globalThis.fetch = async () => svar(429, {}, { "retry-after": "1" });
  await assert.rejects(() => hentProdukter("51", 1), /Vent noen minutter/);
});

test("andre feilkoder retries ikke", async () => {
  let kall = 0;
  globalThis.fetch = async () => {
    kall++;
    return svar(404, {});
  };
  await assert.rejects(() => hentProdukter("52", 1), /404/);
  assert.equal(kall, 1, "404 er ikke midlertidig, så ett forsøk holder");
});

test("lager leses fra quantity_physical, ikke quantity", async () => {
  globalThis.fetch = async () =>
    svar(200, {
      data: [{ id: "2", attributes: { name: { no: "Void" }, quantity: 99, quantity_physical: 4 } }],
      links: {},
    });
  const p = await hentProdukter("53", 1);
  assert.equal(p[0].lager, 4);
});

process.on("exit", () => { globalThis.fetch = ekte; });
