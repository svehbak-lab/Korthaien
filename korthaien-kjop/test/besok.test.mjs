import test from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";

const DB = `/tmp/besok-${process.pid}.db`;
rmSync(DB, { force: true });
process.env.DATABASE_URL = `file:${DB}`;
const { db, migrate } = await import("../src/db.ts");
const { registrer, skrivBesøk, besøkPerDag, erNettleser, MAKS_TREFF_MENNESKE } = await import("../src/besok.ts");
await migrate();
process.on("exit", () => rmSync(DB, { force: true }));

const FF = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Firefox/133.0";
const dag = new Date("2026-11-28T12:00:00Z");

test("samme besøkende telles én gang per dag, ulike telles hver for seg", async () => {
  for (let i = 0; i < 10; i++) await registrer("1.1.1.1", FF, dag);
  await registrer("2.2.2.2", FF, dag);
  await skrivBesøk();
  await registrer("1.1.1.1", FF, dag); // etter skriving: legges til, ny rad lages ikke
  const n = await besøkPerDag("2026-11-28");
  assert.equal(n.get("2026-11-28"), 2);
  const r = await db().execute("SELECT treff FROM besok ORDER BY treff DESC");
  assert.equal(Number(r.rows[0].treff), 11);
});

test("ingen IP lagres", async () => {
  const r = await db().execute("SELECT hash FROM besok");
  for (const x of r.rows) assert.ok(!String(x.hash).includes("1.1.1.1"));
});

test("en som henter langt mer enn et menneske, telles ikke", async () => {
  for (let i = 0; i <= MAKS_TREFF_MENNESKE; i++) await registrer("3.3.3.3", FF, dag);
  const n = await besøkPerDag("2026-11-28");
  assert.equal(n.get("2026-11-28"), 2);
});

test("roboter og skript gjenkjennes", () => {
  const req = (agent, lang = "nb-NO") => ({ headers: { "user-agent": agent, ...(lang ? { "accept-language": lang } : {}) } });
  assert.equal(erNettleser(req(FF)), true);
  assert.equal(erNettleser(req(FF, null)), false);
  assert.equal(erNettleser(req("Googlebot/2.1")), false);
  assert.equal(erNettleser(req("python-requests/2.31")), false);
  assert.equal(erNettleser(req("Mozilla/5.0 HeadlessChrome/120")), false);
  assert.equal(erNettleser(req("")), false);
});
