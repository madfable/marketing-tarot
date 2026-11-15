// Local preview: serves site/ and mounts the send-reading function at /api/send-reading.
// Runs the function in DRY_RUN mode unless you set DRY_RUN=0 (and the Resend env vars).
// Usage: node scripts/dev-server.mjs   (then open http://localhost:8787)
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, normalize, extname, sep } from "node:path";

process.env.DRY_RUN ??= "1";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const siteDir = join(root, "site");
const testDir = join(root, "test");
const port = Number(process.env.PORT || 8787);

const { default: sendReading, config: fnConfig } = await import("../netlify/functions/send-reading.mjs");
const fnPath = (fnConfig && fnConfig.path) || "/api/send-reading";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8"
};

// Resolves a URL path inside `dir`, refusing anything that escapes it.
function safePath(dir, urlPath) {
  const p = normalize(join(dir, decodeURIComponent(urlPath)));
  return p === dir || p.startsWith(dir + sep) ? p : null;
}

async function handle(req, res) {
  const url = new URL(req.url, `http://localhost:${port}`);

  if (url.pathname === fnPath) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const request = new Request(url, {
      method: req.method,
      headers: req.headers,
      body: chunks.length ? Buffer.concat(chunks) : undefined
    });
    const response = await sendReading(request);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
    console.log(`${req.method} ${url.pathname} -> ${response.status}`);
    return;
  }

  // /test/embed.html: the real Squarespace snippet, pointed at this server, inside a fake host page.
  if (url.pathname === "/test/embed.html") {
    const snippet = (await readFile(join(root, "squarespace", "iframe-embed.html"), "utf8"))
      .replace(/src="https:\/\/[^"]+"/, `src="http://localhost:${port}/"`);
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" });
    res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Embed test</title></head>` +
      `<body style="margin:0;background:#dde;font-family:sans-serif"><p style="padding:12px;margin:0">Fake Squarespace page. Below is squarespace/iframe-embed.html with its src pointed at this dev server.</p>${snippet}</body></html>`);
    return;
  }

  // /test/ serves the browser test suite from test/ (never deployed; site/ has no such folder).
  let filePath;
  if (url.pathname === "/test" || url.pathname.startsWith("/test/")) {
    filePath = safePath(testDir, url.pathname.slice(5) || "/");
  } else {
    filePath = safePath(siteDir, url.pathname);
  }
  if (!filePath) { res.writeHead(403); res.end("Forbidden"); return; }

  try {
    if ((await stat(filePath)).isDirectory()) filePath = join(filePath, "index.html");
    const data = await readFile(filePath);
    res.writeHead(200, {
      "Content-Type": MIME[extname(filePath).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-cache"
    });
    res.end(data);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  }
}

createServer((req, res) => {
  handle(req, res).catch((err) => {
    console.error(`${req.method} ${req.url} failed:`, err && err.message);
    if (!res.headersSent) res.writeHead(err instanceof URIError ? 400 : 500, { "Content-Type": "text/plain" });
    res.end(err instanceof URIError ? "Bad request" : "Server error");
  });
}).listen(port, "127.0.0.1", () => {
  console.log(`Marketing Tarot dev server: http://localhost:${port}  (DRY_RUN=${process.env.DRY_RUN})`);
  console.log(`Widget test suite:          http://localhost:${port}/test/`);
});
