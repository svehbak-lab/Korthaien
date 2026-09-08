import test from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
const DB = `/tmp/foil-${process.pid}.db`;
rmSync(DB, { force: true });
process.env.DATABASE_URL = `file:${DB}`;
const { migrate } = await import("../src/db.ts");
const { regnLedig } = await import("../src/quota.ts");
await migrate();
process.on("exit", () => rmSync(DB, { force: true }));

const regel = (o = {}) => ({
  enabled: true, wanted_default: 8, wanted_foil: 0,
  conditions: ["NM"], ladder: { NM: 100 }, set_code: "inv", ...o,
});

test("foil kjøpes ikke når settets foil-antall er 0", () => {
  const k = regnLedig(undefined, "foil", regel());
  assert.equal(k.available, 0);
  assert.equal(k.kilde, "av");
});

test("foil-antall på settnivå gir kvote uten å røre vanlige", () => {
  const r = regel({ wanted_foil: 2 });
  assert.equal(regnLedig(undefined, "foil", r).available, 2);
  assert.equal(regnLedig(undefined, "nonfoil", r).available, 8);
});

test("foil trekker fra sitt eget lager, ikke det vanlige", () => {
  const r = regel({ wanted_foil: 4 });
  assert.equal(regnLedig({ stock: 1, reserved: 0, want: null }, "foil", r).available, 3);
  assert.equal(regnLedig({ stock: 6, reserved: 0, want: null }, "nonfoil", r).available, 2);
});

test("kortets eget foil-antall slår settets", () => {
  const r = regel({ wanted_foil: 2 });
  assert.equal(regnLedig({ stock: 0, reserved: 0, want: 10 }, "foil", r).available, 10);
  assert.equal(regnLedig({ stock: 0, reserved: 0, want: 0 }, "foil", r).available, 0);
});

test("avslått sett kjøper verken vanlig eller foil", () => {
  const r = regel({ enabled: false, wanted_foil: 5 });
  assert.equal(regnLedig(undefined, "foil", r).available, 0);
  assert.equal(regnLedig(undefined, "nonfoil", r).available, 0);
});

test("reservasjoner trekkes fra foil for seg", () => {
  const r = regel({ wanted_foil: 5 });
  assert.equal(regnLedig({ stock: 1, reserved: 2, want: null }, "foil", r).available, 2);
});
