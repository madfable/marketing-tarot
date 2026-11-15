// POST /api/send-reading
// Body: { email, newsletter, spread, cards, website }
// Emails the reading (via Resend) and optionally subscribes the address to the
// newsletter (via Mailchimp). The reading is rebuilt here from deck.json, so
// the client only ever sends a question index and four card ids.
//
// Abuse controls: JSON content type required (so cross-site "simple" POSTs are refused),
// the request Origin must be this site or one in ALLOWED_ORIGINS, a honeypot field, and
// a small in-memory rate limit per IP and per recipient. The in-memory limit resets when
// the function instance recycles, so for a busy site add a persistent store or a
// Turnstile/hCaptcha check on the form.
//
// Environment variables (set in Netlify > Site configuration > Environment variables):
//   RESEND_API_KEY           required to send mail
//   FROM_EMAIL               e.g. "Kelly at Merlinite Marketing <hello@merlinitemarketing.com>"
//   REPLY_TO                 optional
//   SITE_URL                 where the widget is hosted, e.g. https://madfable.github.io/marketing-tarot
//   SERVICES_URL             optional, defaults to https://merlinitemarketing.com/services
//   MAILCHIMP_API_KEY        optional; newsletter opt-in is skipped if unset
//   MAILCHIMP_SERVER_PREFIX  e.g. us21 (the part after the dash in the API key)
//   MAILCHIMP_LIST_ID        the audience id
//   MAILCHIMP_DOUBLE_OPT_IN  defaults to on (Mailchimp emails a confirmation link); "0" subscribes directly
//   ALLOWED_ORIGINS          comma-separated origins allowed to call this, e.g. the GitHub Pages
//                            origin and/or https://merlinitemarketing.com. Same-origin is always allowed.
//   RATE_LIMIT_PER_IP        requests per IP per hour (default 10)
//   RATE_LIMIT_PER_EMAIL     requests per recipient per day (default 3)
//   DRY_RUN                  "1" to log instead of calling Resend/Mailchimp (local dev)

import deck from "../lib/deck.mjs"; // generated from data/deck.json by scripts/build-deck.mjs
import { buildReadingEmail, validateReading } from "../lib/reading-email.mjs";

export const config = { path: "/api/send-reading" };

const DEFAULT_SERVICES_URL = "https://merlinitemarketing.com/services";

export default async function handler(request) {
  const env = process.env;
  const origin = request.headers.get("origin") || "";
  const originOk = isAllowedOrigin(origin, request, env);
  const cors = originOk && origin ? corsHeaders(origin) : {};

  if (request.method === "OPTIONS") {
    return new Response(null, { status: originOk ? 204 : 403, headers: cors });
  }
  if (request.method !== "POST") {
    return json({ ok: false, error: "Method not allowed" }, 405, cors);
  }
  if (!originOk) {
    return json({ ok: false, error: "Origin not allowed" }, 403, cors);
  }
  if (!/^application\/json\b/i.test(request.headers.get("content-type") || "")) {
    return json({ ok: false, error: "Send JSON" }, 415, cors);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Body must be JSON" }, 400, cors);
  }
  if (!body || typeof body !== "object") {
    return json({ ok: false, error: "Body must be a JSON object" }, 400, cors);
  }

  // Honeypot: real people never see this field.
  if (typeof body.website === "string" && body.website.trim() !== "") {
    return json({ ok: true }, 200, cors);
  }

  const email = typeof body.email === "string" ? body.email.trim() : "";
  if (!looksLikeEmail(email)) {
    return json({ ok: false, error: "Please enter a valid email address" }, 400, cors);
  }

  const spread = Number(body.spread);
  const cards = Array.isArray(body.cards) ? body.cards.map(Number) : null;
  const problem = validateReading(deck, spread, cards);
  if (problem) {
    return json({ ok: false, error: problem }, 400, cors);
  }

  const ip = clientIp(request);
  if (!rateLimit.allow("ip:" + ip, Number(env.RATE_LIMIT_PER_IP) || 10, 60 * 60 * 1000) ||
      !rateLimit.allow("email:" + email.toLowerCase(), Number(env.RATE_LIMIT_PER_EMAIL) || 3, 24 * 60 * 60 * 1000)) {
    return json({ ok: false, error: "Too many requests, please try again later" }, 429, cors);
  }

  const wantsNewsletter = body.newsletter === true;
  const siteUrl = (env.SITE_URL || "").replace(/\/+$/, "");
  const message = buildReadingEmail(deck, spread, cards, {
    siteUrl,
    servicesUrl: env.SERVICES_URL || DEFAULT_SERVICES_URL
  });

  if (env.DRY_RUN === "1") {
    console.log(`[dry run] would email ${email} "${message.subject}" (${message.html.length} chars)` +
      (wantsNewsletter ? " and subscribe to newsletter" : ""));
    return json({ ok: true, dryRun: true, newsletter: wantsNewsletter }, 200, cors);
  }

  if (!env.RESEND_API_KEY || !env.FROM_EMAIL) {
    console.error("send-reading: RESEND_API_KEY and FROM_EMAIL must be set");
    return json({ ok: false, error: "Email isn't set up yet" }, 500, cors);
  }

  try {
    await sendWithResend(env, email, message);
  } catch (err) {
    console.error("send-reading: Resend failed:", err && err.message);
    return json({ ok: false, error: "Couldn't send the email" }, 502, cors);
  }

  let subscribed = false;
  if (wantsNewsletter && env.MAILCHIMP_API_KEY && env.MAILCHIMP_LIST_ID && env.MAILCHIMP_SERVER_PREFIX) {
    try {
      subscribed = await subscribeWithMailchimp(env, email);
    } catch (err) {
      // The reading went out, so don't fail the request over the newsletter.
      console.error("send-reading: Mailchimp failed:", err && err.message);
    }
  }

  return json({ ok: true, newsletter: subscribed }, 200, cors);
}

/* ---------- providers ---------- */

async function sendWithResend(env, to, message) {
  const payload = {
    from: env.FROM_EMAIL,
    to: [to],
    subject: message.subject,
    html: message.html,
    text: message.text
  };
  if (env.REPLY_TO) payload.reply_to = env.REPLY_TO;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${detail.slice(0, 300)}`);
  }
}

async function subscribeWithMailchimp(env, email) {
  const url = `https://${env.MAILCHIMP_SERVER_PREFIX}.api.mailchimp.com/3.0/lists/${env.MAILCHIMP_LIST_ID}/members`;
  const auth = Buffer.from(`anystring:${env.MAILCHIMP_API_KEY}`).toString("base64");
  // Double opt-in by default: the address is only added once its owner clicks Mailchimp's
  // confirmation link, so nobody can be put on the list by someone else typing their email.
  const doubleOptIn = env.MAILCHIMP_DOUBLE_OPT_IN !== "0";
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      email_address: email,
      status: doubleOptIn ? "pending" : "subscribed",
      tags: ["marketing-tarot"]
    })
  });
  if (res.ok) return true;

  const detail = await res.json().catch(() => ({}));
  // Already on the list is fine.
  if (res.status === 400 && /exists/i.test(detail.title || "")) return true;
  throw new Error(`HTTP ${res.status} ${detail.title || ""} ${detail.detail || ""}`.trim());
}

/* ---------- helpers ---------- */

function looksLikeEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s) && s.length <= 254;
}

// Browsers always send Origin on cross-origin and same-origin POSTs. A request with no
// Origin at all (curl, scripts) is refused unless ALLOWED_ORIGINS is unset and we're in
// local dev (DRY_RUN), to keep the dev server and tests simple.
function isAllowedOrigin(origin, request, env) {
  const allowed = (env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  let self = "";
  try { self = new URL(request.url).origin; } catch { /* ignore */ }
  if (origin) return origin === self || allowed.includes(origin);
  return env.DRY_RUN === "1" || env.ALLOW_NO_ORIGIN === "1";
}

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin"
  };
}

function clientIp(request) {
  const h = request.headers;
  return (h.get("x-nf-client-connection-ip") || (h.get("x-forwarded-for") || "").split(",")[0] || "unknown").trim();
}

// Sliding-window counters kept in memory for the life of the function instance.
export const rateLimit = {
  buckets: new Map(),
  allow(key, limit, windowMs) {
    const now = Date.now();
    const hits = (this.buckets.get(key) || []).filter((t) => now - t < windowMs);
    if (hits.length >= limit) { this.buckets.set(key, hits); return false; }
    hits.push(now);
    this.buckets.set(key, hits);
    if (this.buckets.size > 5000) this.buckets.clear(); // crude memory cap
    return true;
  },
  reset() { this.buckets.clear(); }
};

function json(body, status, extraHeaders) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...extraHeaders }
  });
}
