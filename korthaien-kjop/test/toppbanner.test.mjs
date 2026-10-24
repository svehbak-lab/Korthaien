// Toppbildet på forsiden: bilde, egen tekst, plassering og eventuelt sett.

import test from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";

const DB = `/tmp/toppbanner-${process.pid}.db`;
rmSync(DB, { force: true });
process.env.DATABASE_URL = `file:${DB}`;

const { migrate, settSetting } = await import("../src/db.ts");
const { aktivtBanner, bildeinfo, lagreBilde, hentBilde } = await import("../src/toppbanner.ts");
await migrate();
process.on("exit", () => rmSync(DB, { force: true }));

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

test("bildets type og størrelse leses fra filen selv", () => {
  assert.deepEqual(bildeinfo(PNG), { mime: "image/png", bredde: 1, hoyde: 1 });
  assert.equal(bildeinfo(Buffer.from("<svg></svg>")), null);
  assert.equal(bildeinfo(Buffer.from("GIF89a....")), null);
});

test("banneret vises når det er slått på og har bilde, med teksten du skrev", async () => {
  const b = await lagreBilde(PNG);
  assert.ok((await hentBilde(b.id)).data.equals(PNG));
  await settSetting("toppbanner", { bilde_id: b.id, tekst: "Forhåndsbestill nå", plassering: "knapp", sett: "tfc", aktiv: false });
  assert.equal(await aktivtBanner(), null);
  await settSetting("toppbanner", { bilde_id: b.id, tekst: "Forhåndsbestill nå", plassering: "knapp", sett: "tfc", aktiv: true });
  const a = await aktivtBanner();
  assert.equal(a.tekst, "Forhåndsbestill nå");
  assert.equal(a.plassering, "knapp");
  assert.equal(a.sett, "tfc");
  // Uten tekst er det bare bildet.
  await settSetting("toppbanner", { bilde_id: b.id, tekst: "", aktiv: true });
  const u = await aktivtBanner();
  assert.equal(u.tekst, null);
  assert.equal(u.plassering, "hjorne");
});
