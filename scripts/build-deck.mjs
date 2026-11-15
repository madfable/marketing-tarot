// Turns data/deck.json (Kelly's file, the source of truth) into site/deck.js, a plain
// script the widget loads without fetch(). Validates the file first. Run: npm run build:deck
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "data", "deck.json");
const out = join(root, "site", "deck.js");

const deck = JSON.parse(readFileSync(src, "utf8"));

// Light validation so a bad edit to deck.json fails here, not on the live page.
const errors = [];
if (!Array.isArray(deck.cards) || deck.cards.length !== 78) errors.push("expected 78 cards");
deck.cards.forEach((c, i) => {
  if (c.id !== i) errors.push(`card ${i} has id ${c.id}`);
  for (const k of ["name", "classic_meaning", "marketing_meaning"]) {
    if (!c[k]) errors.push(`card ${i} (${c.name || "?"}) is missing ${k}`);
  }
});
if (!Array.isArray(deck.spreads) || deck.spreads.length === 0) errors.push("no spreads");
deck.spreads.forEach((s, i) => {
  if (!s.question) errors.push(`spread ${i} has no question`);
  if (!Array.isArray(s.positions) || s.positions.length !== (deck.cards_per_reading || 4)) {
    errors.push(`spread ${i} (${s.question}) needs ${deck.cards_per_reading || 4} positions`);
  }
});
if (!deck.footer) errors.push("missing footer text");
if (errors.length) {
  console.error("deck.json problems:\n - " + errors.join("\n - "));
  process.exit(1);
}

const banner = "// Generated from data/deck.json by scripts/build-deck.mjs. Edit the JSON, not this file.\n";
writeFileSync(out, banner + "window.MARKETING_TAROT_DECK = " + JSON.stringify(deck, null, 2) + ";\n");
console.log(`wrote site/deck.js (${deck.cards.length} cards, ${deck.spreads.length} spreads)`);
