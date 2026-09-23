import test from "node:test";
import assert from "node:assert/strict";

const { grupper, summer, forrigeMåned, osloMåned } = await import("../src/statistikk.ts");

test("måneden avgjøres i norsk tid, ikke UTC", () => {
  // 30. april 23:30 UTC er 1. mai i Norge (sommertid, +2).
  assert.equal(osloMåned("2026-04-30T23:30:00.000Z"), "2026-05");
  // 31. desember 23:30 UTC er fortsatt desember (vintertid, +1).
  assert.equal(osloMåned("2026-12-31T23:30:00.000Z"), "2027-01");
  assert.equal(osloMåned("2026-12-31T22:30:00.000Z"), "2026-12");
});

test("kansellerte og utløpte holdes utenfor omsetningen", () => {
  const m = grupper([
    { created_at: "2026-09-05T10:00:00.000Z", status: "stocked", total_ore: 100_00 },
    { created_at: "2026-09-06T10:00:00.000Z", status: "pending", total_ore: 50_00 },
    { created_at: "2026-09-07T10:00:00.000Z", status: "cancelled", total_ore: 999_00 },
    { created_at: "2026-09-08T10:00:00.000Z", status: "expired", total_ore: 1_00 },
  ]);
  assert.equal(m.length, 1);
  assert.equal(m[0].antall, 2);
  assert.equal(m[0].sum_ore, 150_00);
  assert.equal(m[0].avlyst, 2);
  assert.equal(m[0].avlyst_ore, 1000_00);
});

test("mottatt og lagerført teller med, ikke bare gjort opp", () => {
  const m = grupper([
    { created_at: "2026-09-05T10:00:00.000Z", status: "received", total_ore: 40_00 },
    { created_at: "2026-09-05T11:00:00.000Z", status: "stocked", total_ore: 60_00 },
  ]);
  assert.equal(m[0].antall, 2);
  assert.equal(m[0].sum_ore, 100_00);
});

test("månedene sorteres nyest først", () => {
  const m = grupper([
    { created_at: "2026-07-05T10:00:00.000Z", status: "stocked", total_ore: 10_00 },
    { created_at: "2026-09-05T10:00:00.000Z", status: "stocked", total_ore: 10_00 },
    { created_at: "2026-08-05T10:00:00.000Z", status: "stocked", total_ore: 10_00 },
  ]);
  assert.deepEqual(m.map((x) => x.mnd), ["2026-09", "2026-08", "2026-07"]);
});

test("årssummen legger sammen månedene i året", () => {
  const m = grupper([
    { created_at: "2026-02-05T10:00:00.000Z", status: "stocked", total_ore: 300_00 },
    { created_at: "2026-09-05T10:00:00.000Z", status: "stocked", total_ore: 200_00 },
    { created_at: "2025-09-05T10:00:00.000Z", status: "stocked", total_ore: 999_00 },
  ]);
  const år = summer(m, "2026");
  assert.equal(år.antall, 2);
  assert.equal(år.sum_ore, 500_00);
});

test("forrige måned krysser årsskiftet", () => {
  assert.equal(forrigeMåned("2026-01"), "2025-12");
  assert.equal(forrigeMåned("2026-09"), "2026-08");
});

test("tom liste gir ingen måneder, ikke krasj", () => {
  assert.deepEqual(grupper([]), []);
  assert.equal(summer([], "2026").sum_ore, 0);
});
