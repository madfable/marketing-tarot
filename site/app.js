/* Marketing Tarot widget
   Reads window.MARKETING_TAROT_DECK (from deck.js) and window.MARKETING_TAROT_CONFIG,
   renders into #marketing-tarot, and handles shuffle, turning the cards over, and the
   PDF download (window.MarketingTarotPdf from pdf.js). */
(function () {
  "use strict";

  var DEFAULTS = {
    rootSelector: "#marketing-tarot",
    servicesUrl: "#",
    cardsBaseUrl: "cards/",
    imageExt: ".jpg",
    deckLabel: "the classic 1909 tarot",
    title: "Marketing Tarot",
    subtitle: "Pick what's on your mind, pull four cards, and see what they have to say about your marketing.",
    questionLabel: "What's on your mind?",
    pullButton: "Shuffle & pull 4 cards",
    pullAgainButton: "Shuffle & pull again",
    shufflingButton: "Shuffling…",
    readingHint: "Each spot asks its own question. The card that landed there is the answer.",
    flipHint: "Your cards are face down. Tap or click each one to turn it over.",
    flipButton: "tap to flip",
    flipLabel: "Turn over card {n}: {position}",
    dealtAnnouncement: "Four cards are face down for “{question}”. Turn each one over to read it.",
    flippedAnnouncement: "Card {n}, {position}: {name}.",
    readyAnnouncement: "Your reading is ready: four cards for “{question}”.",
    pdfButton: "Download as PDF",
    pdfPreparing: "Preparing PDF…",
    pdfError: "Couldn't build the PDF. Try printing this page instead.",
    pdfFilename: "marketing-tarot-reading.pdf",
    shuffleMs: 900,
    scrollOnPull: true,
    updateHash: true,
    // The landing page has its own heading right above the widget, so an embedded copy
    // skips the title. "auto" shows it only when the page is not inside an iframe.
    showHeader: "auto"
  };

  var config = assign({}, DEFAULTS, window.MARKETING_TAROT_CONFIG || {});
  var deck = window.MARKETING_TAROT_DECK;
  var root = document.querySelector(config.rootSelector);

  if (!root) return;
  if (!deck || !deck.cards || !deck.spreads) {
    root.textContent = "The tarot deck didn't load. Please refresh the page.";
    return;
  }

  var CARDS_PER_READING = deck.cards_per_reading || 4;
  var reducedMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  // pdfTicket changes whenever a new reading is rendered, so a PDF that was still being
  // built for the previous reading is dropped instead of downloaded.
  var state = { spread: 0, cards: [], busy: false, pdfBusy: false, pdfTicket: 0 };

  /* ---------- helpers ---------- */

  function assign(target) {
    for (var i = 1; i < arguments.length; i++) {
      var src = arguments[i];
      if (!src) continue;
      for (var k in src) if (Object.prototype.hasOwnProperty.call(src, k)) target[k] = src[k];
    }
    return target;
  }

  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function fill(template, values) {
    return String(template).replace(/\{(\w+)\}/g, function (m, key) {
      return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : m;
    });
  }

  function slug(name) {
    return String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  }

  function imageUrl(card) {
    return config.cardsBaseUrl + slug(card.name) + config.imageExt;
  }

  // Unbiased random integer in [0, maxExclusive) from the browser's cryptographic
  // generator. Rejection sampling avoids the slight skew a plain modulo would add.
  function randomInt(maxExclusive) {
    if (window.crypto && window.crypto.getRandomValues) {
      var a = new Uint32Array(1);
      var limit = 0x100000000 - (0x100000000 % maxExclusive);
      do { window.crypto.getRandomValues(a); } while (a[0] >= limit);
      return a[0] % maxExclusive;
    }
    return Math.floor(Math.random() * maxExclusive);
  }

  // Fisher-Yates over all 78 ids, take the first N. The four cards are decided here,
  // before anything is shown, so turning them over one by one can never repeat a card.
  function drawCards(n) {
    var ids = [];
    for (var i = 0; i < deck.cards.length; i++) ids.push(i);
    for (var j = ids.length - 1; j > 0; j--) {
      var k = randomInt(j + 1);
      var tmp = ids[j]; ids[j] = ids[k]; ids[k] = tmp;
    }
    return ids.slice(0, n);
  }

  function validCards(ids) {
    if (!Array.isArray(ids) || ids.length !== CARDS_PER_READING) return false;
    var seen = {};
    for (var i = 0; i < ids.length; i++) {
      var id = ids[i];
      if (typeof id !== "number" || id !== Math.floor(id) || id < 0 || id >= deck.cards.length) return false;
      if (seen[id]) return false;
      seen[id] = true;
    }
    return true;
  }

  // Reading state lives in the URL hash (#q=2&c=5,17,40,61) so a refresh, or a shared
  // link, brings the same reading back.
  function readHash() {
    var h = window.location.hash.replace(/^#/, "");
    if (!h) return null;
    var params = {};
    try {
      h.split("&").forEach(function (pair) {
        var kv = pair.split("=");
        params[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1] || "");
      });
    } catch (e) {
      return null; // mangled percent-encoding in a shared link
    }
    var q = parseInt(params.q, 10);
    var c = (params.c || "").split(",").map(function (x) { return parseInt(x, 10); });
    if (isNaN(q) || q < 0 || q >= deck.spreads.length) return null;
    if (!validCards(c)) return null;
    return { spread: q, cards: c };
  }

  function currentHash() {
    return "#q=" + state.spread + "&c=" + state.cards.join(",");
  }

  function writeHash() {
    var hash = currentHash();
    if (config.updateHash) {
      if (window.history && window.history.replaceState) {
        try { window.history.replaceState(null, "", hash); } catch (e) { /* browser throttled it; harmless */ }
      } else {
        window.location.hash = hash;
      }
    }
    // Let a host page (the Squarespace iframe snippet) mirror the reading into its own URL.
    postToParent({ type: "marketing-tarot:reading", hash: hash });
  }

  /* ---------- render ---------- */

  function renderShell() {
    var options = deck.spreads.map(function (s, i) {
      return '<option value="' + i + '">' + esc(s.question) + "</option>";
    }).join("");

    var showHeader = config.showHeader === "auto" ? window.parent === window : !!config.showHeader;
    var header = showHeader
      ? '<header class="mt-header">' +
          "<h1>" + esc(config.title) + "</h1>" +
          '<p class="mt-header__sub">' + esc(config.subtitle) + "</p>" +
        "</header>"
      : "";

    root.innerHTML =
      '<div class="mt-widget">' +
        header +
        '<form class="mt-controls">' +
          '<div class="mt-controls__field">' +
            '<label for="mt-question">' + esc(config.questionLabel) + "</label>" +
            '<select class="mt-select" id="mt-question" name="question">' + options + "</select>" +
          "</div>" +
          '<button type="submit" class="mt-button mt-controls__pull">' + esc(config.pullButton) + "</button>" +
        "</form>" +
        '<p class="mt-visually-hidden mt-announce" role="status" aria-live="polite"></p>' +
        '<section class="mt-reading" hidden>' +
          '<h2 class="mt-reading__question" tabindex="-1"></h2>' +
          '<p class="mt-reading__hint">' + esc(config.readingHint) + "</p>" +
          '<p class="mt-reading__flip-hint" hidden>' + esc(config.flipHint) + "</p>" +
          '<ol class="mt-cards"></ol>' +
          '<p class="mt-reading__footer">' + footerHtml() + "</p>" +
          '<div class="mt-reading__actions">' +
            '<button type="button" class="mt-button mt-reading__pdf" hidden>' + esc(config.pdfButton) + "</button>" +
            '<button type="button" class="mt-button mt-button--ghost mt-reading__again">' + esc(config.pullAgainButton) + "</button>" +
          "</div>" +
          '<p class="mt-reading__pdf-status" role="status" aria-live="polite"></p>' +
        "</section>" +
      "</div>";
  }

  // Footer copy comes from deck.json. The last sentence becomes the Services link.
  // Opens in a new tab (and so outside the iframe when embedded), leaving the reading in place.
  function footerHtml() {
    var text = deck.footer || "";
    var m = text.match(/^(.*?)([^.!?]*[.!?]?)$/);
    if (!m || !m[2].trim()) return esc(text);
    var lead = m[2].match(/^\s*/)[0];
    return esc(m[1] + lead) + '<a href="' + esc(config.servicesUrl) + '" target="_blank" rel="noopener">' + esc(m[2].trim()) + "</a>";
  }

  // A face-down card hides its picture and text from assistive tech until it is turned
  // over, and carries a "Turn over" button that covers the whole picture. Cards restored
  // from a link render face up with no button.
  function cardHtml(card, position, index, facedown) {
    var n = index + 1;
    var alt = card.name + " card from " + config.deckLabel;
    var covered = facedown ? ' aria-hidden="true"' : "";
    var turnLabel = fill(config.flipLabel, { n: n, position: position });
    return (
      '<li class="mt-card' + (facedown ? " is-facedown" : "") + '" data-card-id="' + card.id + '">' +
        '<p class="mt-card__position"><span class="mt-card__position-num" aria-hidden="true">' + n + "</span>" +
          '<span class="mt-visually-hidden">Card ' + n + ": </span>" + esc(position) + "</p>" +
        '<figure class="mt-card__figure">' +
          '<div class="mt-card__flip">' +
            '<div class="mt-card__face mt-card__face--front"' + covered + ">" +
              '<img src="' + esc(imageUrl(card)) + '" alt="' + esc(alt) + '" loading="eager" decoding="async">' +
              '<div class="mt-card__placeholder" aria-hidden="true">' + esc(card.name) + "</div>" +
            "</div>" +
            '<div class="mt-card__face mt-card__face--back" aria-hidden="true"></div>' +
          "</div>" +
          (facedown
            ? '<button type="button" class="mt-card__turn" aria-label="' + esc(turnLabel) + '" disabled>' +
                '<span aria-hidden="true">' + esc(config.flipButton) + "</span>" +
              "</button>"
            : "") +
        "</figure>" +
        '<div class="mt-card__text mt-card__name"' + covered + '><h3 tabindex="-1">' + esc(card.name) + "</h3></div>" +
        '<p class="mt-card__text mt-card__classic"' + covered + "><strong>Classic meaning:</strong> " + esc(card.classic_meaning) + "</p>" +
        '<p class="mt-card__text mt-card__marketing"' + covered + ">" + esc(card.marketing_meaning) + "</p>" +
      "</li>"
    );
  }

  function faceDownCount() {
    return root.querySelectorAll(".mt-card.is-facedown").length;
  }

  // The flip hint shows while any card is still face down; the PDF button appears once
  // every card has been turned over (a PDF of face-down cards would give the ending away).
  function updateProgress() {
    var left = faceDownCount();
    root.querySelector(".mt-reading__flip-hint").hidden = left === 0;
    root.querySelector(".mt-reading__pdf").hidden = left > 0;
  }

  // animate=true is a fresh pull: shuffle, then deal the four cards face down for the
  // visitor to turn over. animate=false restores a reading from a link, already face up.
  function renderReading(animate) {
    var spread = deck.spreads[state.spread];
    var section = root.querySelector(".mt-reading");
    var list = root.querySelector(".mt-cards");
    var heading = root.querySelector(".mt-reading__question");
    var announce = root.querySelector(".mt-announce");
    var facedown = !!animate;

    heading.textContent = spread.question;
    announce.textContent = "";
    resetPdfStatus();
    list.innerHTML = state.cards.map(function (id, i) {
      return cardHtml(deck.cards[id], spread.positions[i], i, facedown);
    }).join("");

    // If an image fails to load (a flaky connection, say), try once more after a moment;
    // if it fails again, show a named placeholder instead of a broken icon.
    Array.prototype.forEach.call(list.querySelectorAll(".mt-card__face--front img"), function (img) {
      img.addEventListener("error", function () {
        if (!img.getAttribute("data-retried")) {
          img.setAttribute("data-retried", "1");
          window.setTimeout(function () {
            img.src = img.getAttribute("src").split("?")[0] + "?retry=1";
          }, 1500);
          return;
        }
        img.parentNode.classList.add("is-missing");
      });
    });

    section.hidden = false;
    updateProgress();

    var dealt = function () {
      section.classList.remove("is-shuffling");
      Array.prototype.forEach.call(list.querySelectorAll(".mt-card__turn"), function (btn) { btn.disabled = false; });
      setBusy(false);
      announce.textContent = fill(facedown ? config.dealtAnnouncement : config.readyAnnouncement, { question: spread.question });
      postHeight();
    };

    if (animate && !reducedMotion) {
      section.classList.add("is-shuffling");
      window.setTimeout(dealt, config.shuffleMs);
    } else {
      dealt();
    }

    writeHash();
    postHeight();
    if (animate) {
      if (config.scrollOnPull) section.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
      heading.focus({ preventScroll: true });
    }
  }

  // Turns one card over. The card itself was decided at pull time, so this only reveals it.
  function flipCard(card) {
    if (state.busy || !card || !card.classList.contains("is-facedown")) return;
    var spread = deck.spreads[state.spread];
    var index = Array.prototype.indexOf.call(card.parentNode.children, card);
    var turn = card.querySelector(".mt-card__turn");
    var name = card.querySelector(".mt-card__name h3");

    card.classList.remove("is-facedown");
    Array.prototype.forEach.call(card.querySelectorAll(".mt-card__face--front, .mt-card__text"), function (el) {
      el.removeAttribute("aria-hidden");
    });
    if (turn) turn.hidden = true;
    name.focus({ preventScroll: true });

    updateProgress();
    var message = fill(config.flippedAnnouncement, { n: index + 1, position: spread.positions[index], name: name.textContent });
    if (faceDownCount() === 0) message += " " + fill(config.readyAnnouncement, { question: spread.question });
    root.querySelector(".mt-announce").textContent = message;
    postHeight();
  }

  function flipAll() {
    Array.prototype.forEach.call(root.querySelectorAll(".mt-card.is-facedown"), flipCard);
  }

  function setBusy(busy) {
    state.busy = busy;
    var pull = root.querySelector(".mt-controls__pull");
    var again = root.querySelector(".mt-reading__again");
    pull.disabled = busy;
    if (again) again.disabled = busy;
    pull.textContent = busy ? config.shufflingButton : (state.cards.length ? config.pullAgainButton : config.pullButton);
  }

  function pull() {
    if (state.busy) return;
    var select = root.querySelector("#mt-question");
    state.spread = parseInt(select.value, 10) || 0;
    state.cards = drawCards(CARDS_PER_READING);
    setBusy(true);
    renderReading(true);
  }

  /* ---------- PDF download ---------- */

  // The current reading in the shape pdf.js expects.
  function currentReading() {
    var spread = deck.spreads[state.spread];
    return {
      title: config.title,
      question: spread.question,
      hint: config.readingHint,
      deckLabel: config.deckLabel,
      footer: deck.footer || "",
      servicesUrl: config.servicesUrl && config.servicesUrl !== "#" ? config.servicesUrl : "",
      cards: state.cards.map(function (id, i) {
        var card = deck.cards[id];
        return {
          position: spread.positions[i],
          name: card.name,
          classic: card.classic_meaning,
          marketing: card.marketing_meaning,
          imageUrl: imageUrl(card)
        };
      })
    };
  }

  function buildPdf() {
    if (!state.cards.length) return Promise.reject(new Error("No reading yet"));
    if (!window.MarketingTarotPdf) return Promise.reject(new Error("pdf.js did not load"));
    return window.MarketingTarotPdf.build(currentReading());
  }

  function resetPdfStatus() {
    var btn = root.querySelector(".mt-reading__pdf");
    var status = root.querySelector(".mt-reading__pdf-status");
    if (!btn) return;
    state.pdfTicket++;
    state.pdfBusy = false;
    btn.disabled = false;
    btn.textContent = config.pdfButton;
    status.textContent = "";
    status.className = "mt-reading__pdf-status";
  }

  function downloadPdf() {
    if (state.pdfBusy || !state.cards.length) return;
    var btn = root.querySelector(".mt-reading__pdf");
    var status = root.querySelector(".mt-reading__pdf-status");
    var ticket = state.pdfTicket;
    var hashAtClick = currentHash();
    // False once the visitor has pulled a new reading while this PDF was still building.
    var stillCurrent = function () { return ticket === state.pdfTicket && currentHash() === hashAtClick; };
    state.pdfBusy = true;
    btn.disabled = true;
    btn.textContent = config.pdfPreparing;
    status.textContent = "";
    status.className = "mt-reading__pdf-status";

    buildPdf().then(function (blob) {
      if (!stillCurrent()) return;
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = config.pdfFilename;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
    }).catch(function () {
      if (!stillCurrent()) return;
      status.textContent = config.pdfError;
      status.classList.add("is-error");
    }).then(function () {
      if (!stillCurrent()) return;
      state.pdfBusy = false;
      btn.disabled = false;
      btn.textContent = config.pdfButton;
      postHeight();
    });
  }

  /* ---------- iframe messaging ---------- */

  function postToParent(message) {
    if (window.parent === window) return;
    window.parent.postMessage(message, "*");
  }

  // When embedded in an iframe (Squarespace), tell the parent page how tall the widget is.
  // Measure the widget itself, not the document: the document is never shorter than the
  // iframe's viewport, which would stop the frame from ever shrinking.
  function postHeight() {
    if (window.parent === window) return;
    var rect = root.getBoundingClientRect();
    var h = Math.ceil(rect.height + rect.top + (window.pageYOffset || 0));
    postToParent({ type: "marketing-tarot:height", height: h });
  }

  /* ---------- wire up ---------- */

  renderShell();

  root.querySelector(".mt-controls").addEventListener("submit", function (e) {
    e.preventDefault();
    pull();
  });
  root.querySelector(".mt-reading__again").addEventListener("click", pull);
  root.querySelector(".mt-reading__pdf").addEventListener("click", downloadPdf);
  root.querySelector(".mt-cards").addEventListener("click", function (e) {
    var btn = e.target.closest ? e.target.closest(".mt-card__turn") : null;
    if (btn && !btn.disabled) flipCard(btn.closest(".mt-card"));
  });

  if (window.ResizeObserver && window.parent !== window) {
    new ResizeObserver(postHeight).observe(root);
  }
  window.addEventListener("load", postHeight);

  // The embed snippet answers the first height message with an "ack". Only then does the
  // frame document hide its own scrollbar (html.mt-embedded in styles.css): if the
  // snippet's script isn't running (someone pasted just the iframe, or a Squarespace 7.0
  // Ajax page load skipped it), the frame keeps a scrollbar so the whole reading stays
  // reachable instead of being cut off at the iframe's starting height.
  window.addEventListener("message", function (e) {
    if (window.parent === window || e.source !== window.parent) return;
    if (e.data && e.data.type === "marketing-tarot:ack") document.documentElement.classList.add("mt-embedded");
  });

  // Small API for tests and for anyone embedding the widget programmatically.
  root.marketingTarot = { buildPdf: buildPdf, reading: currentReading, flipAll: flipAll };

  // Shows the reading named in the URL hash, face up. Runs at load and again when the
  // hash changes (a shared link to this same page, or the host page re-seeding the iframe).
  function restoreFromHash() {
    var fromHash = readHash();
    if (!fromHash) return;
    if (fromHash.spread === state.spread && fromHash.cards.join() === state.cards.join()) return;
    state.spread = fromHash.spread;
    state.cards = fromHash.cards;
    root.querySelector("#mt-question").value = String(state.spread);
    setBusy(true);
    renderReading(false);
  }

  restoreFromHash();
  window.addEventListener("hashchange", function () { if (!state.busy) restoreFromHash(); });
})();
