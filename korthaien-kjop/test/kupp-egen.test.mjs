import test from "node:test";
import assert from "node:assert/strict";

const { tolkSøk } = await import("../src/kortjakt.ts");
const { finnEgneAvvik, finnTreff } = await import("../src/kupp.ts");

const svar = (korthaienPris, opts = {}) =>
  tolkSøk({
    card: "Sol Ring",
    shops: [
      {
        shop: "korthaien",
        shop_name: "Korthaien",
        status: opts.status || "ok",
        offers:
          korthaienPris == null
            ? []
            : [
                {
                  title: "Sol Ring - Revised",
                  price_nok: korthaienPris,
                  in_stock: opts.in_stock ?? true,
                  quantity: 2,
                  url: "https://www.korthaien.no/products/sol-ring",
                  condition: "NM",
                  collector_number: opts.nummer === undefined ? "274" : opts.nummer,
                  foil: false,
                },
              ],
      },
      {
        shop: "tryllepapp",
        shop_name: "Tryllepapp",
        status: "ok",
        offers: [
          {
            title: "Sol Ring",
            price_nok: 150,
            in_stock: true,
            url: "https://tryllepapp.no/x",
            collector_number: "274",
            foil: false,
          },
        ],
      },
    ],
  });

const KORT = {
  card_id: "abc",
  finish: "nonfoil",
  name: "Sol Ring",
  set_code: "3ed",
  set_name: "Revised Edition",
  collector_number: "274",
  rarity: "uncommon",
  salg_ore: 40000, // 400 kr
  marked_ore: 28000,
};

test("en pris godt under din egen salgspris gir positivt avvik", () => {
  const r = finnEgneAvvik(svar(200), KORT, 25);
  assert.equal(r.length, 1);
  assert.equal(r[0].avvik_pct, 50); // 200 av 400
});

test("en pris godt over gir negativt avvik", () => {
  const r = finnEgneAvvik(svar(800), KORT, 25);
  assert.equal(r.length, 1);
  assert.equal(r[0].avvik_pct, -100); // 800 av 400
});

test("en pris innenfor grensen rapporteres ikke", () => {
  assert.equal(finnEgneAvvik(svar(380), KORT, 25).length, 0);
  assert.equal(finnEgneAvvik(svar(420), KORT, 25).length, 0);
});

test("grensen gjelder begge veier like mye", () => {
  assert.equal(finnEgneAvvik(svar(300), KORT, 25).length, 1); // 25 % under
  assert.equal(finnEgneAvvik(svar(500), KORT, 25).length, 1); // 25 % over
});

test("ble ikke butikken spurt, rapporteres ingenting", () => {
  // no_budget betyr at Kortjakt ikke rakk å sjekke oss. Det er noe annet enn
  // at prisen er riktig, og skal ikke se ut som et rent resultat.
  assert.equal(finnEgneAvvik(svar(100, { status: "no_budget" }), KORT, 25).length, 0);
});

test("utsolgte varer teller ikke", () => {
  assert.equal(finnEgneAvvik(svar(100, { in_stock: false }), KORT, 25).length, 0);
});

test("et annet trykk er et annet kort", () => {
  assert.equal(finnEgneAvvik(svar(100, { nummer: "275" }), KORT, 25).length, 0);
});

test("uten samlernummer godtas raden, men merkes usikker", () => {
  const r = finnEgneAvvik(svar(100, { nummer: null }), KORT, 25);
  assert.equal(r.length, 1);
  assert.equal(r[0].usikker, true);
});

test("de to listene blander seg ikke", () => {
  // Korthaien til 100 kr er et stort eget avvik, men skal aldri bli et «kupp».
  const s = svar(100);
  assert.equal(finnTreff(s, KORT, 25).some((t) => t.shop === "korthaien"), false);
  assert.equal(finnEgneAvvik(s, KORT, 25).length, 1);
  // Tryllepapp til 150 er et kupp, men hører ikke hjemme i egen-lista.
  assert.equal(finnTreff(s, KORT, 25).length, 1);
});

test("uten salgspris kan ingenting måles", () => {
  assert.equal(finnEgneAvvik(svar(100), { ...KORT, salg_ore: 0 }, 25).length, 0);
});

test("størst avvik står først, uansett retning", () => {
  const s = tolkSøk({
    card: "X",
    shops: [
      {
        shop: "korthaien",
        status: "ok",
        offers: [
          { title: "a", price_nok: 380, in_stock: true, url: "u1", collector_number: "274", foil: false },
          { title: "b", price_nok: 50, in_stock: true, url: "u2", collector_number: "274", foil: false },
          { title: "c", price_nok: 700, in_stock: true, url: "u3", collector_number: "274", foil: false },
        ],
      },
    ],
  });
  const r = finnEgneAvvik(s, KORT, 10);
  assert.deepEqual(r.map((x) => x.tilbud.url), ["u2", "u3"]);
});
