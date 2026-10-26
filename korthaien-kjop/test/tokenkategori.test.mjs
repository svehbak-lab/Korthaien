// Mystore har egne token-kategorier («Strixhaven: School of Mages Tokens»).
// De skal kobles til Scryfalls token-sett for hovedsettet.
import test from "node:test";
import assert from "node:assert/strict";
process.env.DATABASE_URL = `file:/tmp/tokkat-${process.pid}.db`;
const { knyttTilSett } = await import("../src/mystore.ts");
const { byggIndeks } = await import("../src/settnavn.ts");

test("token-kategori kobles til token-settet til hovedsettet", () => {
  const indeks = byggIndeks([
    { code: "stx", name: "Strixhaven: School of Mages" },
    { code: "tstx", name: "Strixhaven Tokens" },
    { code: "sta", name: "Strixhaven Mystical Archive" },
  ]);
  const kat = [
    { id: "1", navn: "Strixhaven: School of Mages", forelder: null },
    { id: "2", navn: "Strixhaven: School of Mages Tokens", forelder: null },
  ];
  const k = knyttTilSett(kat, indeks, new Map(), new Map([["stx", "tstx"]]));
  assert.equal(k.get("1").set_code, "stx");
  assert.equal(k.get("2").set_code, "tstx");
  assert.equal(k.get("2").regel, "token-sett");
});
