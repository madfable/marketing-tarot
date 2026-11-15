// Exercises the send-reading function without touching the network.
// Stubs global fetch, checks validation and the outgoing Resend/Mailchimp calls,
// and writes dist/email-preview.html so you can eyeball the email template.
// Run: npm test
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

process.env.DRY_RUN = "0";
process.env.RESEND_API_KEY = "re_test_key";
process.env.FROM_EMAIL = "Kelly <hello@example.test>";
process.env.SITE_URL = "https://tarot.example.test/";
process.env.SERVICES_URL = "https://example.test/services";
process.env.MAILCHIMP_API_KEY = "mc_test-us21";
process.env.MAILCHIMP_SERVER_PREFIX = "us21";
process.env.MAILCHIMP_LIST_ID = "abc123";
process.env.ALLOWED_ORIGINS = "https://merlinitemarketing.com";
process.env.RATE_LIMIT_PER_IP = "100000";
process.env.RATE_LIMIT_PER_EMAIL = "100000";

const calls = [];
globalThis.fetch = async (url, init) => {
  calls.push({ url: String(url), init });
  if (String(url).includes("resend.com")) {
    return new Response(JSON.stringify({ id: "msg_1" }), { status: 200 });
  }
  if (String(url).includes("mailchimp.com")) {
    const body = JSON.parse(init.body);
    if (body.email_address === "dupe@example.test") {
      return new Response(JSON.stringify({ title: "Member Exists" }), { status: 400 });
    }
    return new Response(JSON.stringify({ id: "m1" }), { status: 200 });
  }
  throw new Error("unexpected fetch " + url);
};

const { default: handler, rateLimit } = await import("../netlify/functions/send-reading.mjs");
const deck = (await import("../netlify/lib/deck.mjs")).default;
const { esc } = await import("../netlify/lib/reading-email.mjs");

function post(body, headers = {}) {
  return handler(new Request("http://localhost/api/send-reading", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "http://localhost", ...headers },
    body: JSON.stringify(body)
  }));
}

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log("ok   -", name); }
  catch (err) { console.error("FAIL -", name, "\n     ", err.message); process.exitCode = 1; }
}

await test("rejects a bad email", async () => {
  const res = await post({ email: "nope", spread: 0, cards: [1, 2, 3, 4] });
  assert.equal(res.status, 400);
});

await test("rejects a bad spread index", async () => {
  const res = await post({ email: "a@b.co", spread: 99, cards: [1, 2, 3, 4] });
  assert.equal(res.status, 400);
});

await test("rejects repeated or out-of-range cards", async () => {
  assert.equal((await post({ email: "a@b.co", spread: 0, cards: [1, 1, 3, 4] })).status, 400);
  assert.equal((await post({ email: "a@b.co", spread: 0, cards: [1, 2, 3, 78] })).status, 400);
  assert.equal((await post({ email: "a@b.co", spread: 0, cards: [1, 2, 3] })).status, 400);
});

await test("honeypot filled -> pretends success, sends nothing", async () => {
  calls.length = 0;
  const res = await post({ email: "a@b.co", spread: 0, cards: [1, 2, 3, 4], website: "http://spam" });
  assert.equal(res.status, 200);
  assert.equal(calls.length, 0);
});

await test("sends the reading via Resend with the right cards", async () => {
  calls.length = 0;
  const cards = [0, 22, 45, 77];
  const res = await post({ email: "reader@example.test", spread: 2, cards, newsletter: false });
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.ok, true);
  assert.equal(calls.length, 1);
  const sent = JSON.parse(calls[0].init.body);
  assert.deepEqual(sent.to, ["reader@example.test"]);
  assert.match(sent.subject, /I'm about to launch something new/);
  for (const id of cards) {
    assert.ok(sent.html.includes(esc(deck.cards[id].name)), `html mentions ${deck.cards[id].name}`);
    assert.ok(sent.text.includes(deck.cards[id].marketing_meaning), `text has meaning for ${deck.cards[id].name}`);
  }
  for (const pos of deck.spreads[2].positions) assert.ok(sent.html.includes(esc(pos)), `html has position "${pos}"`);
  assert.ok(sent.html.includes("https://tarot.example.test/cards/the-fool.jpg"), "card image url");
  assert.ok(sent.html.includes(esc("https://tarot.example.test/#q=2&c=0,22,45,77")), "view online link");
  assert.ok(sent.text.includes("https://tarot.example.test/#q=2&c=0,22,45,77"), "view online link in plain text");
  assert.ok(sent.html.includes('href="https://example.test/services"'), "services link in footer");
  assert.ok(sent.html.includes("that&#39;s what I do!"), "footer copy");
  assert.ok(sent.html.includes("inspiration. <a href="), "space kept before footer link");

  mkdirSync(join(root, "dist"), { recursive: true });
  writeFileSync(join(root, "dist", "email-preview.html"), sent.html);
});

await test("newsletter opt-in calls Mailchimp; duplicate member is fine", async () => {
  calls.length = 0;
  let res = await post({ email: "new@example.test", spread: 0, cards: [5, 6, 7, 8], newsletter: true });
  assert.equal((await res.json()).newsletter, true);
  assert.equal(calls.length, 2);
  assert.match(calls[1].url, /us21\.api\.mailchimp\.com\/3\.0\/lists\/abc123\/members/);
  assert.equal(JSON.parse(calls[1].init.body).status, "pending", "double opt-in by default");

  calls.length = 0;
  res = await post({ email: "dupe@example.test", spread: 0, cards: [5, 6, 7, 8], newsletter: true });
  assert.equal((await res.json()).newsletter, true);
});

await test("newsletter unchecked never calls Mailchimp", async () => {
  calls.length = 0;
  await post({ email: "quiet@example.test", spread: 0, cards: [5, 6, 7, 8], newsletter: false });
  assert.equal(calls.length, 1);
});

await test("origins: same-origin and allow-listed pass, others and missing are refused", async () => {
  const allowed = await post({ email: "a@b.co", spread: 0, cards: [1, 2, 3, 4] }, { Origin: "https://merlinitemarketing.com" });
  assert.equal(allowed.status, 200);
  assert.equal(allowed.headers.get("access-control-allow-origin"), "https://merlinitemarketing.com");
  const same = await post({ email: "a@b.co", spread: 0, cards: [1, 2, 3, 4] }, { Origin: "http://localhost" });
  assert.equal(same.status, 200);
  const other = await post({ email: "a@b.co", spread: 0, cards: [1, 2, 3, 4] }, { Origin: "https://evil.test" });
  assert.equal(other.status, 403);
  assert.equal(other.headers.get("access-control-allow-origin"), null);
  const none = await handler(new Request("http://localhost/api/send-reading", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "a@b.co", spread: 0, cards: [1, 2, 3, 4] }) }));
  assert.equal(none.status, 403, "no Origin header (curl) is refused");
  const preflight = await handler(new Request("http://localhost/api/send-reading", { method: "OPTIONS", headers: { Origin: "https://merlinitemarketing.com" } }));
  assert.equal(preflight.status, 204);
  const badPreflight = await handler(new Request("http://localhost/api/send-reading", { method: "OPTIONS", headers: { Origin: "https://evil.test" } }));
  assert.equal(badPreflight.status, 403);
});

await test("non-JSON content type is refused (blocks cross-site simple POSTs)", async () => {
  calls.length = 0;
  const res = await post({ email: "a@b.co", spread: 0, cards: [1, 2, 3, 4] }, { "Content-Type": "text/plain" });
  assert.equal(res.status, 415);
  assert.equal(calls.length, 0);
});

await test("rate limit per recipient and per IP", async () => {
  rateLimit.reset();
  process.env.RATE_LIMIT_PER_EMAIL = "2";
  process.env.RATE_LIMIT_PER_IP = "5";
  try {
    assert.equal((await post({ email: "limit@example.test", spread: 0, cards: [1, 2, 3, 4] })).status, 200);
    assert.equal((await post({ email: "LIMIT@example.test", spread: 0, cards: [1, 2, 3, 4] })).status, 200, "case-insensitive");
    assert.equal((await post({ email: "limit@example.test", spread: 0, cards: [1, 2, 3, 4] })).status, 429);
    assert.equal((await post({ email: "other@example.test", spread: 0, cards: [1, 2, 3, 4] })).status, 200);
    assert.equal((await post({ email: "other2@example.test", spread: 0, cards: [1, 2, 3, 4] })).status, 200);
    assert.equal((await post({ email: "other3@example.test", spread: 0, cards: [1, 2, 3, 4] })).status, 429, "per-IP limit hit");
    const otherIp = await post({ email: "other3@example.test", spread: 0, cards: [1, 2, 3, 4] }, { "x-forwarded-for": "203.0.113.9" });
    assert.equal(otherIp.status, 200, "a different IP is counted separately");
  } finally {
    rateLimit.reset();
    process.env.RATE_LIMIT_PER_EMAIL = "100000";
    process.env.RATE_LIMIT_PER_IP = "100000";
  }
});

await test("MAILCHIMP_DOUBLE_OPT_IN=0 subscribes directly", async () => {
  process.env.MAILCHIMP_DOUBLE_OPT_IN = "0";
  calls.length = 0;
  try {
    await post({ email: "direct@example.test", spread: 0, cards: [5, 6, 7, 8], newsletter: true });
    assert.equal(JSON.parse(calls[1].init.body).status, "subscribed");
  } finally {
    delete process.env.MAILCHIMP_DOUBLE_OPT_IN;
  }
});

await test("GET is rejected, non-JSON body is rejected", async () => {
  const get = await handler(new Request("http://localhost/api/send-reading", { method: "GET" }));
  assert.equal(get.status, 405);
  const bad = await handler(new Request("http://localhost/api/send-reading", { method: "POST", headers: { "Content-Type": "application/json", Origin: "http://localhost" }, body: "{not json" }));
  assert.equal(bad.status, 400);
});

await test("odd inputs: overlong email, string card ids, non-numeric cards, missing fields", async () => {
  assert.equal((await post({ email: "a".repeat(250) + "@b.co", spread: 0, cards: [1, 2, 3, 4] })).status, 400);
  assert.equal((await post({ email: "a@b.co", spread: "1", cards: ["5", "6", "7", "8"] })).status, 200, "numeric strings are accepted");
  assert.equal((await post({ email: "a@b.co", spread: 0, cards: ["x", "y", "z", "w"] })).status, 400);
  assert.equal((await post({ email: "a@b.co", spread: 0, cards: [1.5, 2, 3, 4] })).status, 400);
  assert.equal((await post({ email: "a@b.co" })).status, 400);
  assert.equal((await post({})).status, 400);
});

await test("newsletter asked for but Mailchimp not configured -> email still sent, newsletter false", async () => {
  const saved = process.env.MAILCHIMP_API_KEY;
  delete process.env.MAILCHIMP_API_KEY;
  calls.length = 0;
  const res = await post({ email: "n@example.test", spread: 0, cards: [1, 2, 3, 4], newsletter: true });
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.newsletter, false);
  assert.equal(calls.length, 1, "only Resend was called");
  process.env.MAILCHIMP_API_KEY = saved;
});

await test("Resend failure -> 502 and Mailchimp is not called", async () => {
  const realFetch = globalThis.fetch;
  calls.length = 0;
  globalThis.fetch = async (url, init) => { calls.push({ url: String(url), init }); return new Response("nope", { status: 500 }); };
  try {
    const res = await post({ email: "f@example.test", spread: 0, cards: [1, 2, 3, 4], newsletter: true });
    assert.equal(res.status, 502);
    assert.equal((await res.json()).ok, false);
    assert.equal(calls.length, 1);
  } finally {
    globalThis.fetch = realFetch;
  }
});

await test("Mailchimp failure does not fail the request", async () => {
  const realFetch = globalThis.fetch;
  calls.length = 0;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).includes("resend.com")) return new Response(JSON.stringify({ id: "x" }), { status: 200 });
    return new Response(JSON.stringify({ title: "Forbidden" }), { status: 403 });
  };
  try {
    const res = await post({ email: "m@example.test", spread: 0, cards: [1, 2, 3, 4], newsletter: true });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).newsletter, false);
  } finally {
    globalThis.fetch = realFetch;
  }
});

await test("DRY_RUN sends nothing and says so", async () => {
  process.env.DRY_RUN = "1";
  calls.length = 0;
  try {
    const res = await post({ email: "d@example.test", spread: 0, cards: [1, 2, 3, 4] });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.dryRun, true);
    assert.equal(calls.length, 0);
  } finally {
    process.env.DRY_RUN = "0";
  }
});

await test("missing provider config -> 500, nothing sent", async () => {
  const saved = process.env.RESEND_API_KEY;
  delete process.env.RESEND_API_KEY;
  calls.length = 0;
  try {
    const res = await post({ email: "c@example.test", spread: 0, cards: [1, 2, 3, 4] });
    assert.equal(res.status, 500);
    assert.equal(calls.length, 0);
  } finally {
    process.env.RESEND_API_KEY = saved;
  }
});

await test("email template: every spread and every card renders without throwing, and escapes HTML", async () => {
  const { buildReadingEmail } = await import("../netlify/lib/reading-email.mjs");
  for (let s = 0; s < deck.spreads.length; s++) {
    for (let start = 0; start < 78; start += 4) {
      const cards = [0, 1, 2, 3].map((k) => (start + k) % 78);
      const msg = buildReadingEmail(deck, s, cards, { siteUrl: "https://x.test", servicesUrl: "https://x.test/s" });
      assert.ok(msg.html.includes("<!doctype html>") && msg.text.length > 200);
      for (const id of cards) assert.ok(msg.text.includes(deck.cards[id].name), `text has ${deck.cards[id].name}`);
    }
  }
  const evil = JSON.parse(JSON.stringify(deck));
  evil.cards[0].name = "<script>alert(1)</script>";
  const msg = buildReadingEmail(evil, 0, [0, 1, 2, 3], { siteUrl: "https://x.test" });
  assert.ok(!msg.html.includes("<script>alert(1)</script>"), "card name escaped in html");
  assert.ok(msg.html.includes("&lt;script&gt;"), "escaped form present");
});

console.log(`\n${passed} test group(s) passed${process.exitCode ? ", with failures" : ""}.`);
console.log("Email preview written to dist/email-preview.html");
