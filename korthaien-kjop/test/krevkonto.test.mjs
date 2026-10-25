// Konto påkrevd (etter overgangen): kassen og innsending av kort avviser
// gjester, og innsending bruker e-posten fra kontoen.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";

const DB = `/tmp/krevkonto-${process.pid}.db`;
rmSync(DB, { force: true });
process.env.DATABASE_URL = `file:${DB}`;
process.env.ADMIN_PASSWORD = "hemmelig";
process.env.SESSION_SECRET = "test";
process.env.PORT = "3263";
delete process.env.RESEND_KEY;

const { db, migrate, settSetting } = await import("../src/db.ts");
await migrate();
process.on("exit", () => rmSync(DB, { force: true }));
const konto = await import("../src/kunder.ts");

const { stopp } = await import("../src/server.ts");
await new Promise((r) => setTimeout(r, 800));
after(() => stopp());

const BASE = "http://localhost:3263";
const post = (sti, body, cookie = "") =>
  fetch(BASE + sti, { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify(body) });

test("uten krav: gjest når fram til valideringen", async () => {
  const r = await post("/api/butikk/kasse", {});
  assert.notEqual(r.status, 401);
});

test("med krav: gjest avvises i kassen og ved innsending", async () => {
  await settSetting("krev_konto", true);
  assert.equal((await post("/api/butikk/kasse", {})).status, 401);
  assert.equal((await post("/api/orders", { linjer: [] })).status, 401);
  const c = await (await fetch(BASE + "/api/config")).json();
  assert.equal(c.krev_konto, true);
});

test("med krav: ubekreftet konto avvises, bekreftet slipper gjennom", async () => {
  const k = await konto.registrer({ email: "per@eksempel.no", passord: "hemmelig123", navn: "Per" });
  const inn = await post("/api/konto/logg-inn", { email: "per@eksempel.no", passord: "hemmelig123" });
  const cookie = (inn.headers.get("set-cookie") || "").split(";")[0];
  assert.ok(cookie);
  assert.equal((await post("/api/butikk/kasse", {}, cookie)).status, 403);
  await db().execute({ sql: "UPDATE kunder SET epost_bekreftet_at = ? WHERE id = ?", args: [new Date().toISOString(), k.id] });
  const r = await post("/api/butikk/kasse", {}, cookie);
  assert.ok(![401, 403].includes(r.status), `fikk ${r.status}`);
});
