// Ordrenumrene: K-00034 og oppover for kjøpsordrer, S-15000 og oppover for
// salgsordrer. Fortløpende, og aldri det samme to ganger.

import test from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";

const DB = `/tmp/ordrenummer-${process.pid}.db`;
rmSync(DB, { force: true });
process.env.DATABASE_URL = `file:${DB}`;

const { migrate, nesteNummer } = await import("../src/db.ts");
await migrate();
process.on("exit", () => rmSync(DB, { force: true }));

test("kjøpsordrene starter på K-00034, salgsordrene på S-15000", async () => {
  assert.equal(await nesteNummer("kjop"), "K-00034");
  assert.equal(await nesteNummer("kjop"), "K-00035");
  assert.equal(await nesteNummer("salg"), "S-15000");
  assert.equal(await nesteNummer("salg"), "S-15001");
});

test("en ny migrering nullstiller ikke telleren", async () => {
  await migrate();
  assert.equal(await nesteNummer("kjop"), "K-00036");
  assert.equal(await nesteNummer("salg"), "S-15002");
});

test("mange samtidige ordrer får hvert sitt nummer", async () => {
  const numre = await Promise.all(Array.from({ length: 40 }, () => nesteNummer("salg")));
  assert.equal(new Set(numre).size, 40);
});
