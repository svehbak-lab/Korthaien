// Toppbildet på forsiden. Teksten skal følge datoen, så banneret aldri kan
// stå igjen med en dato som er passert.

import test from "node:test";
import assert from "node:assert/strict";
import { rmSync, readFileSync } from "node:fs";

const DB = `/tmp/toppbanner-${process.pid}.db`;
rmSync(DB, { force: true });
process.env.DATABASE_URL = `file:${DB}`;

const { migrate, settSetting } = await import("../src/db.ts");
const { bannertekst, aktivtBanner, bildeinfo, lagreBilde, hentBilde } = await import("../src/toppbanner.ts");
await migrate();
process.on("exit", () => rmSync(DB, { force: true }));

test("før utgivelsen: «Kommer», så «Ute nå» i 30 dager, så ingenting", () => {
  assert.equal(bannertekst("2026-11-13", "2026-10-24"), "Kommer 13. november");
  assert.equal(bannertekst("2026-11-13", "2026-11-12"), "Kommer 13. november");
  assert.equal(bannertekst("2026-11-13", "2026-11-13"), "Ute nå");
  assert.equal(bannertekst("2026-11-13", "2026-12-12"), "Ute nå");
  assert.equal(bannertekst("2026-11-13", "2026-12-13"), null);
  assert.equal(bannertekst(null, "2026-10-24"), null);
});

test("bildets type og størrelse leses fra filen selv", () => {
  // 1×1 PNG
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  assert.deepEqual(bildeinfo(png), { mime: "image/png", bredde: 1, hoyde: 1 });
  assert.equal(bildeinfo(Buffer.from("<svg></svg>")), null);
  assert.equal(bildeinfo(Buffer.from("GIF89a....")), null);
});

test("banneret vises bare når det er slått på, har bilde og datoen gir tekst", async () => {
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  const b = await lagreBilde(png);
  assert.ok((await hentBilde(b.id)).data.equals(png));
  await settSetting("toppbanner", { bilde_id: b.id, dato: "2026-11-13", aktiv: false });
  assert.equal(await aktivtBanner("2026-10-24"), null);
  await settSetting("toppbanner", { bilde_id: b.id, dato: "2026-11-13", aktiv: true });
  assert.equal((await aktivtBanner("2026-10-24")).tekst, "Kommer 13. november");
  assert.equal(await aktivtBanner("2027-01-01"), null);
});
