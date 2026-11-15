// Builds the emailed reading (HTML + plain text) from the deck data.
// The server rebuilds the reading from spread index + card ids, so the
// endpoint can't be used to send arbitrary text to arbitrary addresses.

export function slug(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function validateReading(deck, spread, cards) {
  const n = deck.cards_per_reading || 4;
  if (!Number.isInteger(spread) || spread < 0 || spread >= deck.spreads.length) {
    return "spread must be a valid question index";
  }
  if (!Array.isArray(cards) || cards.length !== n) return `cards must be a list of ${n} card ids`;
  const seen = new Set();
  for (const id of cards) {
    if (!Number.isInteger(id) || id < 0 || id >= deck.cards.length) return "cards contains an invalid card id";
    if (seen.has(id)) return "cards contains a repeated card";
    seen.add(id);
  }
  return null;
}

/**
 * @param {object} deck      parsed deck.json
 * @param {number} spread    index into deck.spreads
 * @param {number[]} cards   card ids in position order
 * @param {object} opts      { siteUrl, servicesUrl, cardsBaseUrl, imageExt, deckLabel }
 */
export function buildReadingEmail(deck, spread, cards, opts = {}) {
  const siteUrl = (opts.siteUrl || "").replace(/\/+$/, "");
  const servicesUrl = opts.servicesUrl || siteUrl;
  const cardsBase = opts.cardsBaseUrl || (siteUrl ? siteUrl + "/cards/" : "");
  const ext = opts.imageExt || ".jpg";
  const deckLabel = opts.deckLabel || "the classic 1909 tarot";
  const s = deck.spreads[spread];
  const picked = cards.map((id, i) => ({ card: deck.cards[id], position: s.positions[i], n: i + 1 }));
  const viewUrl = siteUrl ? `${siteUrl}/#q=${spread}&c=${cards.join(",")}` : "";
  const subject = `Your Marketing Tarot reading: ${s.question}`;

  // Footer copy from deck.json; last sentence becomes the Services link.
  const footer = deck.footer || "";
  const m = footer.match(/^(.*?)([^.!?]*[.!?]?)$/);
  const footerHtml = m && m[2].trim()
    ? `${esc(m[1] + m[2].match(/^\s*/)[0])}<a href="${esc(servicesUrl)}" style="color:#6b4e8e;">${esc(m[2].trim())}</a>`
    : esc(footer);

  const cardBlocks = picked.map(({ card, position, n }) => {
    const img = cardsBase ? `${cardsBase}${slug(card.name)}${ext}` : "";
    const imgHtml = img
      ? `<img src="${esc(img)}" width="120" alt="${esc(card.name)} card from ${esc(deckLabel)}" style="display:block;width:120px;height:auto;border-radius:8px;border:1px solid #e3d9c8;">`
      : "";
    return `
      <tr>
        <td style="padding:18px 0;border-top:1px solid #e3d9c8;">
          <p style="margin:0 0 8px;font:600 13px/1.4 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#6b4e8e;letter-spacing:.02em;">${n}. ${esc(position)}</p>
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
            <tr>
              ${imgHtml ? `<td width="132" valign="top" style="padding-right:12px;">${imgHtml}</td>` : ""}
              <td valign="top">
                <h2 style="margin:0 0 6px;font:400 20px/1.25 Georgia,'Times New Roman',serif;color:#2b2233;">${esc(card.name)}</h2>
                <p style="margin:0 0 10px;font:14px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#5b5266;"><strong style="color:#2b2233;">Classic meaning:</strong> ${esc(card.classic_meaning)}</p>
                <p style="margin:0;font:15px/1.55 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#2b2233;">${esc(card.marketing_meaning)}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>`;
  }).join("");

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f8f3ea;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f8f3ea;">
    <tr>
      <td align="center" style="padding:24px 12px;">
        <!--[if mso]><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600"><tr><td><![endif]-->
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:600px;background:#fffdf8;border:1px solid #e3d9c8;border-radius:14px;">
          <tr>
            <td style="padding:28px 24px 8px;">
              <p style="margin:0 0 4px;font:13px/1.4 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#5b5266;text-transform:uppercase;letter-spacing:.08em;">Your Marketing Tarot reading</p>
              <h1 style="margin:0 0 6px;font:400 26px/1.2 Georgia,'Times New Roman',serif;color:#2b2233;">${esc(s.question)}</h1>
              <p style="margin:0 0 12px;font:14px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#5b5266;">Each spot asks its own question. The card that landed there is the answer.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:0 24px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                ${cardBlocks}
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 24px 26px;border-top:1px solid #e3d9c8;">
              <p style="margin:0 0 10px;font:15px/1.55 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#5b5266;">${footerHtml}</p>
              ${viewUrl ? `<p style="margin:0;font:13px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#5b5266;"><a href="${esc(viewUrl)}" style="color:#6b4e8e;">View this reading online</a></p>` : ""}
            </td>
          </tr>
        </table>
        <!--[if mso]></td></tr></table><![endif]-->
        <p style="margin:14px 0 0;font:12px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#8a8194;">You asked for this reading to be emailed to you from the Marketing Tarot on ${esc(siteUrl || "our website")}. Card images: ${esc(deckLabel)}.</p>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = [
    `Your Marketing Tarot reading`,
    `Question: ${s.question}`,
    ``,
    ...picked.flatMap(({ card, position, n }) => [
      `${n}. ${position}`,
      `${card.name}`,
      `Classic meaning: ${card.classic_meaning}`,
      `${card.marketing_meaning}`,
      ``
    ]),
    footer,
    servicesUrl ? `Services: ${servicesUrl}` : "",
    viewUrl ? `View this reading online: ${viewUrl}` : ""
  ].filter((line) => line !== undefined).join("\n");

  return { subject, html, text };
}
