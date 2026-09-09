import test from "node:test";
import assert from "node:assert/strict";

const { parseBulk, tolkCondition } = await import("../src/bulk.ts");

const én = (s) => parseBulk(s)[0];

test("Moxfield-formatet med settkode og samlernummer", () => {
  const r = én("4 Lightning Bolt (M10) 146");
  assert.equal(r.qty, 4);
  assert.equal(r.navn, "Lightning Bolt");
  assert.equal(r.settHint, "m10");
  assert.equal(r.nummerHint, "146");
});

test("stjernemarkering for foil regnes ikke som del av navnet", () => {
  const r = én("1 Fable of the Mirror-Breaker (NEO) 144 *F*");
  assert.equal(r.navn, "Fable of the Mirror-Breaker");
  assert.equal(r.foil, true);
  assert.equal(r.settHint, "neo");
});

test("settnavn i klamme skilles fra settkode i klamme", () => {
  assert.equal(én("4 Lightning Bolt [Magic 2010]").settNavnHint, "Magic 2010");
  assert.equal(én("1 Void [INV]").settHint, "inv");
});

test("regneark: kolonner kjennes igjen på innhold, ikke på plass", () => {
  const r = én("4\tLightning Bolt\tM10\tNM");
  assert.equal(r.qty, 4);
  assert.equal(r.navn, "Lightning Bolt");
  assert.equal(r.settHint, "m10");
  assert.equal(r.condHint, "NM");
});

test("CSV med anførselstegn", () => {
  const r = én('"4","Lightning Bolt","Magic 2010"');
  assert.equal(r.qty, 4);
  assert.equal(r.navn, "Lightning Bolt");
  assert.equal(r.settNavnHint, "Magic 2010");
});

test("komma inne i kortnavnet splitter ikke linjen", () => {
  const r = én("2 Ragavan, Nimble Pilferer (MH2) 138");
  assert.equal(r.navn, "Ragavan, Nimble Pilferer");
  assert.equal(r.qty, 2);
});

test("overskriftsrad fra regneark hoppes over", () => {
  assert.equal(parseBulk("Count,Name,Edition\n4,Lightning Bolt,M10").length, 1);
});

test("nummerert liste: tallet er linjenummer, ikke antall", () => {
  assert.equal(én("3. Lightning Bolt").qty, 1);
  assert.equal(én("3) Lightning Bolt").qty, 1);
  // Uten punktum er det antall.
  assert.equal(én("3 Lightning Bolt").qty, 3);
});

test("antall skrives på mange måter", () => {
  for (const l of ["4 Bolt", "4x Bolt", "4 x Bolt", "4stk Bolt", "4 stk Bolt", "Bolt x4", "Bolt (4)"]) {
    assert.equal(én(l).qty, 4, l);
  }
});

test("pris limt med fra nettbutikk kastes", () => {
  const r = én("4 Lightning Bolt - Near Mint - kr 12");
  assert.equal(r.navn, "Lightning Bolt");
  assert.equal(r.condHint, "NM");
});

test("tilstand tolkes til firetrinnsskalaen", () => {
  assert.equal(tolkCondition("Near Mint"), "NM");
  assert.equal(tolkCondition("mint"), "NM");
  assert.equal(tolkCondition("Lightly Played"), "EX");
  assert.equal(tolkCondition("LP"), "EX");
  assert.equal(tolkCondition("Moderately Played"), "VG");
  assert.equal(tolkCondition("Heavily Played"), "G");
  assert.equal(tolkCondition("Damaged"), "G");
  assert.equal(tolkCondition("noe helt annet"), null);
});

test("et tilstandsord midt i kortnavnet spises ikke", () => {
  // «Good» er en tilstand, men her er det halve kortnavnet.
  assert.equal(én("Good-Fortune Unicorn").navn, "Good-Fortune Unicorn");
  assert.equal(én("Good-Fortune Unicorn").condHint, null);
});

test("dobbeltsidige kort beholder begge halvdelene", () => {
  assert.equal(én("2 Bonecrusher Giant // Stomp").navn, "Bonecrusher Giant // Stomp");
});

test("merkelapper fra dekkbyggere kastes", () => {
  const r = én("1 Sol Ring (LTC) 285 [Maybeboard{noPrice}]");
  assert.equal(r.navn, "Sol Ring");
  assert.equal(r.settHint, "ltc");
  assert.equal(r.nummerHint, "285");
});

test("settkode uten parentes blir et forslag, ikke en beslutning", () => {
  const r = én("1 Lightning Bolt M10");
  // Navnet står urørt — oppslaget prøver det først, og faller tilbake på
  // forslaget bare hvis hele navnet bommer.
  assert.equal(r.navn, "Lightning Bolt M10");
  assert.equal(r.settGjett, "m10");
});

test("listemarkører uten tall", () => {
  assert.equal(én("- Counterspell").navn, "Counterspell");
  assert.equal(én("• Counterspell").navn, "Counterspell");
});

test("tomme og ugyldige linjer merkes i stedet for å forsvinne", () => {
  assert.equal(parseBulk("\n\n   \n").length, 0);
  assert.ok(én("500 Lightning Bolt").feil);
});
