import { test } from "node:test";
import assert from "node:assert/strict";
import { oppgirBehandling } from "../src/varianter.js";

// Navnene er hentet fra mystore_unmatched. Disse sier alle «dette er ikke
// standardutgaven», med ord Scryfall ikke nødvendigvis bruker.
test("parentes med behandling gjenkjennes", () => {
  for (const navn of [
    "Shao Jun (Showcase)",
    "Shao Jun (Showcase) (Foil)",
    "Timeless Dragon (Retro Frame)",
    "Kellan, Daring Traveler (Extended Art)",
    "Mox Jasper (Promo Pack)",
    "Spell Queller (Prerelease Foil)",
    "Urza's Tower (Schematic Art)",
    "Island (Fullart)",
  ]) {
    assert.equal(oppgirBehandling(navn), true, navn);
  }
});

// Den farlige retningen: disse må IKKE regnes som en behandling, ellers
// flyttes vanlige kort bort fra grunnutgaven sin.
test("foil, nummer og splittkort er ikke en behandling", () => {
  for (const navn of [
    "Sailors' Bane (foil)",
    "Plains (FOIL)",
    "Mountain (Foil)",
    "Island (Non-Foil)",
    "Zombie Army Token (009)",
    "Swamp (0277)",
    "Forest (#297)",
    "Plains (250 A)",
    "Melira, the Living Cure (333 - Manga)",
    "Determined (Bound/Determined)",
    "Fire // Ice",
    "Ajani's Pridemate",
    "Island ()",
  ]) {
    assert.equal(oppgirBehandling(navn), false, navn);
  }
});

// Flere parenteser: det holder at én av dem er en behandling.
test("behandling funnet i én av flere parenteser", () => {
  assert.equal(oppgirBehandling("Forest (#297) (Retro Frame)"), true);
  assert.equal(oppgirBehandling("Adewale, Breaker of Chains (Showcase) (Foil)"), true);
  assert.equal(oppgirBehandling("Mox Jasper (Promo Pack, Foil)"), true);
});
