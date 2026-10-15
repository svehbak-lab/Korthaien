import test from "node:test";
import assert from "node:assert/strict";

const { pakkUtSSE, hentNyttelast, tolkSøk } = await import("../src/kortjakt.ts");
const { passerTrykk, kuppgrenseØre, finnTreff, nesteBolk, erUsikkert } = await import("../src/kupp.ts");

// Ekte svar fra Kortjakt, forkortet. Formen er det som betyr noe: SSE-innpakning,
// structuredContent ved siden av tekstblokken, og butikker som ikke ble sjekket.
const SSE = `event: message
data: ${JSON.stringify({
  result: {
    content: [{ type: "text", text: '{"card":"Sol Ring"}' }],
    structuredContent: {
      card: "Sol Ring",
      name_verified: true,
      shops: [
        { shop: "collectible", shop_name: "Collectible", status: "no_match", offers_total: 0, offers: [] },
        {
          shop: "midgard",
          shop_name: "Midgard Games",
          status: "ok",
          offers_total: 1,
          offers: [
            {
              title: "3rd Edition 274: Sol Ring (U)",
              price_nok: 235,
              in_stock: false,
              quantity: null,
              url: "https://midgardgames.no/products/3rd-edition-274-sol-ring-u",
              condition: "VG/G",
              set_name: "3rd Edition",
              collector_number: "274",
              foil: false,
            },
          ],
        },
        {
          shop: "tryllepapp",
          shop_name: "Tryllepapp",
          status: "ok",
          offers_total: 1,
          offers: [
            {
              title: "Sol Ring - Revised (Uncommon)",
              price_nok: 203.73,
              in_stock: true,
              quantity: 1,
              url: "https://tryllepapp.no/products/sol-ring-revised-uncommon-5804",
              condition: "English · Good",
              set_name: "Revised Edition",
              collector_number: "274",
              foil: false,
            },
          ],
        },
        { shop: "altakube", shop_name: "Alta Kube", status: "no_budget", offers_total: 0, offers: [] },
        {
          shop: "korthaien",
          shop_name: "Korthaien",
          status: "ok",
          offers_total: 1,
          offers: [
            {
              title: "Sol Ring",
              price_nok: 99,
              in_stock: true,
              url: "https://www.korthaien.no/products/sol-ring",
              collector_number: "274",
              foil: false,
            },
          ],
        },
      ],
    },
  },
})}

`;

const KORT = {
  card_id: "abc",
  finish: "nonfoil",
  name: "Sol Ring",
  set_code: "3ed",
  set_name: "Revised Edition",
  collector_number: "274",
  rarity: "uncommon",
  salg_ore: 40000,
  marked_ore: 28000,
};

test("SSE-innpakningen pakkes ut", () => {
  const d = pakkUtSSE(SSE);
  assert.equal(d.result.structuredContent.card, "Sol Ring");
});

test("rå JSON virker også, om innpakningen forsvinner", () => {
  assert.equal(pakkUtSSE('{"result":{"structuredContent":{"card":"X"}}}').result.structuredContent.card, "X");
});

test("en feil fra Kortjakt kastes, i stedet for å bli tolket som tomt svar", () => {
  assert.throws(
    () => hentNyttelast({ error: { message: "ukjent verktøy" } }),
    /ukjent verktøy/
  );
});

test("structuredContent foretrekkes framfor tekstblokken", () => {
  const n = hentNyttelast(pakkUtSSE(SSE));
  assert.equal(n.shops.length, 5);
});

test("butikker som ikke ble sjekket skilles fra dem som ikke har kortet", () => {
  const s = tolkSøk(hentNyttelast(pakkUtSSE(SSE)));
  // no_match betyr spurt og ikke funnet. no_budget betyr ikke spurt.
  assert.deepEqual(s.usjekkede, ["altakube"]);
  assert.equal(s.butikker.find((b) => b.shop === "collectible").spurt, true);
});

test("priser leses som øre", () => {
  const s = tolkSøk(hentNyttelast(pakkUtSSE(SSE)));
  const t = s.butikker.find((b) => b.shop === "tryllepapp").tilbud[0];
  assert.equal(t.pris_ore, 20373);
});

test("grensen regnes av salgsprisen", () => {
  assert.equal(kuppgrenseØre(40000, 25), 30000);
  assert.equal(kuppgrenseØre(10000, 50), 5000);
});

test("et tilbud som ikke er på lager er ikke et kupp", () => {
  const s = tolkSøk(hentNyttelast(pakkUtSSE(SSE)));
  const midgard = s.butikker.find((b) => b.shop === "midgard").tilbud[0];
  assert.equal(midgard.pris_ore, 23500); // under grensen på 300 kr
  assert.equal(passerTrykk(midgard, KORT), false); // men in_stock er false
});

test("feil samlernummer er et annet trykk", () => {
  const t = { pris_ore: 100, in_stock: true, collector_number: "275", foil: false };
  assert.equal(passerTrykk(t, KORT), false);
});

test("ledende nuller skiller ikke to like numre", () => {
  const t = { pris_ore: 100, in_stock: true, collector_number: "0274", foil: false };
  assert.equal(passerTrykk(t, KORT), true);
});

test("foil og vanlig blandes ikke", () => {
  const t = { pris_ore: 100, in_stock: true, collector_number: "274", foil: true };
  assert.equal(passerTrykk(t, KORT), false);
});

test("uten samlernummer godtas tilbudet, men merkes usikkert", () => {
  const t = { pris_ore: 100, in_stock: true, collector_number: null, foil: false };
  assert.equal(passerTrykk(t, KORT), true);
  assert.equal(erUsikkert(t, KORT), true);
});

test("Korthaien er ikke en konkurrent", () => {
  const s = tolkSøk(hentNyttelast(pakkUtSSE(SSE)));
  const treff = finnTreff(s, KORT, 25);
  // Korthaien har kortet til 99 kr, godt under grensen — men er oss selv.
  assert.equal(treff.some((t) => t.shop === "korthaien"), false);
});

test("Tryllepapp under grensen er et treff, med riktig avvik", () => {
  const treff = finnTreff(tolkSøk(hentNyttelast(pakkUtSSE(SSE))), KORT, 25);
  assert.equal(treff.length, 1);
  assert.equal(treff[0].shop, "tryllepapp");
  // 203,73 av 400 kr er 49 % under.
  assert.equal(treff[0].avvik_pct, 49);
});

test("strengere grense fjerner treffet", () => {
  assert.equal(finnTreff(tolkSøk(hentNyttelast(pakkUtSSE(SSE))), KORT, 60).length, 0);
});

test("rotasjonen tar aldri sjekkede først, så de eldste", () => {
  const liste = [
    { card_id: "a", finish: "nonfoil" },
    { card_id: "b", finish: "nonfoil" },
    { card_id: "c", finish: "nonfoil" },
  ];
  const sist = new Map([
    ["a:nonfoil", "2026-10-10T00:00:00Z"],
    ["b:nonfoil", null],
    ["c:nonfoil", "2026-10-01T00:00:00Z"],
  ]);
  assert.deepEqual(
    nesteBolk(liste, sist, 2).map((k) => k.card_id),
    ["b", "c"]
  );
});

test("et kort som ble hoppet over står øverst neste gang", () => {
  const liste = [
    { card_id: "a", finish: "nonfoil" },
    { card_id: "b", finish: "nonfoil" },
  ];
  // a ble sjekket, b falt ut av gårsdagens kjøring og har aldri vært innom.
  const sist = new Map([["a:nonfoil", "2026-10-14T00:00:00Z"]]);
  assert.equal(nesteBolk(liste, sist, 1)[0].card_id, "b");
});

test("foil og vanlig av samme kort roterer hver for seg", () => {
  const liste = [
    { card_id: "a", finish: "nonfoil" },
    { card_id: "a", finish: "foil" },
  ];
  const sist = new Map([["a:nonfoil", "2026-10-14T00:00:00Z"]]);
  assert.deepEqual(nesteBolk(liste, sist, 1), [{ card_id: "a", finish: "foil" }]);
});
