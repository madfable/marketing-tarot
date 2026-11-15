// Downloads the 78 card scans into assets/cards-src/ (NOT deployed), named by card slug
// (the-fool.jpg, ace-of-wands.jpg, ...). Run scripts/resize-cards.py afterwards to make
// the web-sized copies in site/cards/ that app.js and the email expect.  `npm run cards`
// does both.
//
// Sources (both are scans of the 1909 Pamela Colman Smith deck, public domain in the US):
//   wikimedia     https://commons.wikimedia.org/  "RWS Tarot NN ..." and "Wands01".."Pents14"
//                 files, described there as "Pam-A" scans, artist Pamela Colman Smith, 1910.
//                 Default. Commons only serves a few thumbnail sizes; asking for 640 gives 960px.
//   sacred-texts  https://www.sacred-texts.com/tarot/pkt/img/  Kelly's suggestion, but the site
//                 sits behind Cloudflare and refuses scripted downloads (HTTP 403). Kept for
//                 reference; download by hand in a browser if you'd rather use it.
//
// Usage: node scripts/download-cards.mjs [--source=wikimedia|sacred-texts] [--width=640]
//                                         [--out=assets/cards-src] [--force]
// Files that already exist are skipped unless --force is given. Rate limits (429) are retried
// with backoff, so the whole run can take a few minutes.
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const deck = JSON.parse(readFileSync(join(root, "data", "deck.json"), "utf8"));

const args = process.argv.slice(2);
const opt = (name, def) => (args.find((a) => a.startsWith(`--${name}=`)) || `--${name}=${def}`).slice(name.length + 3);
const source = opt("source", "wikimedia");
const width = Number(opt("width", "640"));
const outDir = join(root, opt("out", "assets/cards-src"));
const force = args.includes("--force");
const UA = "MarketingTarotBuild/1.0 (one-time static site asset fetch)";

const slug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

const RANK_WORDS = { ace: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, page: 11, knight: 12, queen: 13, king: 14 };
const rankOf = (card) => RANK_WORDS[card.name.split(" ")[0].toLowerCase()];

const SACRED_SUIT = { Wands: "wa", Cups: "cu", Swords: "sw", Pentacles: "pe" };
const SACRED_RANK = { 1: "ac", 11: "pa", 12: "kn", 13: "qu", 14: "ki" };
const WIKI_MAJOR = ["Fool", "Magician", "High Priestess", "Empress", "Emperor", "Hierophant", "Lovers", "Chariot", "Strength", "Hermit", "Wheel of Fortune", "Justice", "Hanged Man", "Death", "Temperance", "Devil", "Tower", "Star", "Moon", "Sun", "Judgement", "World"];
const WIKI_SUIT = { Wands: "Wands", Cups: "Cups", Swords: "Swords", Pentacles: "Pents" };

function sourceUrl(card) {
  if (source === "sacred-texts") {
    const base = "https://www.sacred-texts.com/tarot/pkt/img/";
    if (card.arcana === "major") return base + "ar" + String(card.id).padStart(2, "0") + ".jpg";
    const r = rankOf(card);
    return base + SACRED_SUIT[card.suit] + (SACRED_RANK[r] || String(r).padStart(2, "0")) + ".jpg";
  }
  if (source === "wikimedia") {
    // Special:FilePath redirects to the file; ?width= asks for a scaled rendition.
    const base = "https://commons.wikimedia.org/wiki/Special:FilePath/";
    const name = card.arcana === "major"
      ? `RWS Tarot ${String(card.id).padStart(2, "0")} ${WIKI_MAJOR[card.id]}.jpg`
      : `${WIKI_SUIT[card.suit]}${String(rankOf(card)).padStart(2, "0")}.jpg`;
    return base + encodeURIComponent(name) + (width ? `?width=${width}` : "");
  }
  throw new Error(`unknown source "${source}"`);
}

async function fetchWithRetry(url, attempts = 6) {
  let res;
  for (let attempt = 0; attempt < attempts; attempt++) {
    res = await fetch(url, { headers: { "User-Agent": UA, Accept: "image/*" }, redirect: "follow" });
    if (res.status !== 429 && res.status < 500) return res;
    const retryAfter = Number(res.headers.get("retry-after"));
    const wait = retryAfter > 0 ? retryAfter * 1000 : Math.min(60000, 3000 * 2 ** attempt);
    console.log(`    HTTP ${res.status}, waiting ${Math.round(wait / 1000)}s before retrying`);
    await sleep(wait);
  }
  return res;
}

async function download(card) {
  const dest = join(outDir, slug(card.name) + ".jpg");
  if (existsSync(dest) && !force) return { card, status: "skipped" };
  const url = sourceUrl(card);
  const res = await fetchWithRetry(url);
  if (!res.ok) return { card, status: `HTTP ${res.status}`, url };
  const type = res.headers.get("content-type") || "";
  if (!type.startsWith("image/")) return { card, status: `not an image (${type})`, url };
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 2000) return { card, status: `too small (${buf.length} bytes)`, url };
  writeFileSync(dest, buf);
  return { card, status: "ok", bytes: buf.length };
}

mkdirSync(outDir, { recursive: true });
console.log(`Downloading ${deck.cards.length} cards from ${source}${source === "wikimedia" && width ? ` (requested width ${width}px)` : ""} into ${outDir}`);

const results = [];
for (const card of deck.cards) {
  const r = await download(card);
  results.push(r);
  const tag = r.status === "ok" ? `ok (${(r.bytes / 1024).toFixed(0)} KB)` : r.status;
  console.log(`  ${slug(card.name).padEnd(22)} ${tag}${r.url && r.status !== "ok" ? "  " + r.url : ""}`);
  if (r.status === "ok") await sleep(1000); // be polite to the thumbnail servers
}

const ok = results.filter((r) => r.status === "ok").length;
const skipped = results.filter((r) => r.status === "skipped").length;
const failed = results.filter((r) => r.status !== "ok" && r.status !== "skipped");
console.log(`\n${ok} downloaded, ${skipped} already present, ${failed.length} failed.`);
if (failed.length) {
  console.log("Failed:\n  " + failed.map((r) => `${r.card.name}: ${r.status}`).join("\n  "));
  process.exitCode = 1;
} else {
  console.log("Next: python -I scripts/resize-cards.py   (makes the web-sized copies in site/cards/)");
}
