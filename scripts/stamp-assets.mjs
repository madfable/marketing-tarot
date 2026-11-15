// Adds ?v=<content hash> to the stylesheet and script links in site/index.html, so that
// when a new version is deployed the browser can never pair a cached old app.js with a
// fresh styles.css (or the other way round). GitHub Pages caches every file for 10
// minutes; with hashed links, once index.html refreshes every asset it names refreshes
// with it, and files that didn't change stay cached.
//
// Run by the Pages workflow before upload. Safe to run repeatedly (old ?v= values are
// replaced). Usage: node scripts/stamp-assets.mjs [--in=site/index.html] [--out=<path>]
//                   [--site=<folder holding the assets, default: the --in file's folder>]
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const inPath = resolve(root, arg("in", "site/index.html"));
const outPath = resolve(root, arg("out", inPath));
const siteDir = resolve(root, arg("site", dirname(inPath)));

const html = readFileSync(inPath, "utf8");
let count = 0;

// Matches href="x.css" / src="x.js" for local files (no scheme, no slash), with or
// without an existing ?v= query.
const stamped = html.replace(/\b(href|src)="([A-Za-z0-9_.-]+\.(?:css|js))(?:\?v=[A-Za-z0-9]+)?"/g, (m, attr, file) => {
  const hash = createHash("sha1").update(readFileSync(join(siteDir, file))).digest("hex").slice(0, 10);
  count++;
  return `${attr}="${file}?v=${hash}"`;
});

writeFileSync(outPath, stamped);
console.log(`stamped ${count} asset link${count === 1 ? "" : "s"} in ${outPath}`);
