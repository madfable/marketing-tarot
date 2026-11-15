// Local preview: serves site/ and mounts the send-reading function at /api/send-reading.
// Runs the function in DRY_RUN mode unless you set DRY_RUN=0 (and the Resend env vars).
// Usage: node scripts/dev-server.mjs   (then open http://localhost:8787)
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, normalize, extname } from "node:path";

process.env.DRY_RUN ??= "1";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const siteDir = join(root, "site");
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

createServer(async (req, res) => {
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

  let filePath = normalize(join(siteDir, decodeURIComponent(url.pathname)));
  if (!filePath.startsWith(siteDir)) {
    res.writeHead(403); res.end("Forbidden"); return;
  }
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
}).listen(port, () => {
  console.log(`Marketing Tarot dev server: http://localhost:${port}  (DRY_RUN=${process.env.DRY_RUN})`);
});
