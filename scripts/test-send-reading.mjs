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

const { default: handler } = await import("../netlify/functions/send-reading.mjs");
const deck = (await import("../netlify/lib/deck.mjs")).default;
const { esc } = await import("../netlify/lib/reading-email.mjs");

function post(body, headers = {}) {
  return handler(new Request("http://localhost/api/send-reading", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
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
  assert.equal(JSON.parse(calls[1].init.body).status, "subscribed");

  calls.length = 0;
  res = await post({ email: "dupe@example.test", spread: 0, cards: [5, 6, 7, 8], newsletter: true });
  assert.equal((await res.json()).newsletter, true);
});

await test("newsletter unchecked never calls Mailchimp", async () => {
  calls.length = 0;
  await post({ email: "quiet@example.test", spread: 0, cards: [5, 6, 7, 8], newsletter: false });
  assert.equal(calls.length, 1);
});

await test("CORS headers only for allowed origins", async () => {
  const allowed = await post({ email: "a@b.co", spread: 0, cards: [1, 2, 3, 4] }, { Origin: "https://merlinitemarketing.com" });
  assert.equal(allowed.headers.get("access-control-allow-origin"), "https://merlinitemarketing.com");
  const other = await post({ email: "a@b.co", spread: 0, cards: [1, 2, 3, 4] }, { Origin: "https://evil.test" });
  assert.equal(other.headers.get("access-control-allow-origin"), null);
  const preflight = await handler(new Request("http://localhost/api/send-reading", { method: "OPTIONS", headers: { Origin: "https://merlinitemarketing.com" } }));
  assert.equal(preflight.status, 204);
});

console.log(`\n${passed} test group(s) passed${process.exitCode ? ", with failures" : ""}.`);
console.log("Email preview written to dist/email-preview.html");
