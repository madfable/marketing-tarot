/* Marketing Tarot widget
   Reads window.MARKETING_TAROT_DECK (from deck.js) and window.MARKETING_TAROT_CONFIG,
   renders into #marketing-tarot, and handles shuffle, reveal, and the PDF download
   (window.MarketingTarotPdf from pdf.js). */
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
    readyAnnouncement: "Your reading is ready: four cards for “{question}”.",
    pdfButton: "Download as PDF",
    pdfPreparing: "Preparing PDF…",
    pdfError: "Couldn't build the PDF. Try printing this page instead.",
    pdfFilename: "marketing-tarot-reading.pdf",
    shuffleMs: 900,
    revealStaggerMs: 320,
    flipMs: 700,
    scrollOnPull: true,
    updateHash: true
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
  var state = { spread: 0, cards: [], busy: false, pdfBusy: false };

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

  function slug(name) {
    return String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  }

  function imageUrl(card) {
    return config.cardsBaseUrl + slug(card.name) + config.imageExt;
  }

  function randomInt(maxExclusive) {
    if (window.crypto && window.crypto.getRandomValues) {
      var a = new Uint32Array(1);
      window.crypto.getRandomValues(a);
      return a[0] % maxExclusive;
    }
    return Math.floor(Math.random() * maxExclusive);
  }

  // Fisher-Yates over all 78 ids, take the first N. No repeats by construction.
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

    root.innerHTML =
      '<div class="mt-widget">' +
        '<header class="mt-header">' +
          "<h1>" + esc(config.title) + "</h1>" +
          '<p class="mt-header__sub">' + esc(config.subtitle) + "</p>" +
        "</header>" +
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
          '<ol class="mt-cards"></ol>' +
          '<p class="mt-reading__footer">' + footerHtml() + "</p>" +
          '<div class="mt-reading__actions">' +
            '<button type="button" class="mt-button mt-reading__pdf">' + esc(config.pdfButton) + "</button>" +
            '<button type="button" class="mt-button mt-button--ghost mt-reading__again">' + esc(config.pullAgainButton) + "</button>" +
          "</div>" +
          '<p class="mt-reading__pdf-status" role="status" aria-live="polite"></p>' +
        "</section>" +
      "</div>";
  }

  // Footer copy comes from deck.json. The last sentence becomes the Services link.
  // target="_top" so it leaves the iframe when embedded.
  function footerHtml() {
    var text = deck.footer || "";
    var m = text.match(/^(.*?)([^.!?]*[.!?]?)$/);
    if (!m || !m[2].trim()) return esc(text);
    var lead = m[2].match(/^\s*/)[0];
    return esc(m[1] + lead) + '<a href="' + esc(config.servicesUrl) + '" target="_top">' + esc(m[2].trim()) + "</a>";
  }

  function cardHtml(card, position, index) {
    var alt = card.name + " card from " + config.deckLabel;
    return (
      '<li class="mt-card is-facedown" data-card-id="' + card.id + '">' +
        '<p class="mt-card__position"><span class="mt-card__position-num" aria-hidden="true">' + (index + 1) + "</span>" +
          '<span class="mt-visually-hidden">Card ' + (index + 1) + ": </span>" + esc(position) + "</p>" +
        '<figure class="mt-card__figure">' +
          '<div class="mt-card__flip">' +
            '<div class="mt-card__face mt-card__face--front">' +
              '<img src="' + esc(imageUrl(card)) + '" alt="' + esc(alt) + '" loading="eager" decoding="async">' +
              '<div class="mt-card__placeholder" aria-hidden="true">' + esc(card.name) + "</div>" +
            "</div>" +
            '<div class="mt-card__face mt-card__face--back" aria-hidden="true"></div>' +
          "</div>" +
        "</figure>" +
        '<div class="mt-card__text mt-card__name"><h3>' + esc(card.name) + "</h3></div>" +
        '<p class="mt-card__text mt-card__classic"><strong>Classic meaning:</strong> ' + esc(card.classic_meaning) + "</p>" +
        '<p class="mt-card__text mt-card__marketing">' + esc(card.marketing_meaning) + "</p>" +
      "</li>"
    );
  }

  function renderReading(animate) {
    var spread = deck.spreads[state.spread];
    var section = root.querySelector(".mt-reading");
    var list = root.querySelector(".mt-cards");
    var heading = root.querySelector(".mt-reading__question");
    var announce = root.querySelector(".mt-announce");

    heading.textContent = spread.question;
    announce.textContent = "";
    resetPdfStatus();
    list.innerHTML = state.cards.map(function (id, i) {
      return cardHtml(deck.cards[id], spread.positions[i], i);
    }).join("");

    // Swap in a placeholder when an image is missing, instead of a broken icon.
    Array.prototype.forEach.call(list.querySelectorAll(".mt-card__face--front img"), function (img) {
      img.addEventListener("error", function () {
        img.parentNode.classList.add("is-missing");
      });
    });

    section.hidden = false;

    var cards = list.querySelectorAll(".mt-card");
    var reveal = function () {
      section.classList.remove("is-shuffling");
      Array.prototype.forEach.call(cards, function (card, i) {
        var delay = (animate && !reducedMotion) ? i * config.revealStaggerMs : 0;
        window.setTimeout(function () { card.classList.remove("is-facedown"); }, delay);
      });
      var done = (animate && !reducedMotion) ? cards.length * config.revealStaggerMs + config.flipMs : 0;
      window.setTimeout(function () {
        setBusy(false);
        announce.textContent = config.readyAnnouncement.replace("{question}", spread.question);
        postHeight();
      }, done);
    };

    if (animate && !reducedMotion) {
      section.classList.add("is-shuffling");
      window.setTimeout(reveal, config.shuffleMs);
    } else {
      reveal();
    }

    writeHash();
    postHeight();
    if (animate) {
      if (config.scrollOnPull) section.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
      heading.focus({ preventScroll: true });
    }
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
    state.pdfBusy = true;
    btn.disabled = true;
    btn.textContent = config.pdfPreparing;
    status.textContent = "";
    status.className = "mt-reading__pdf-status";

    buildPdf().then(function (blob) {
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
      status.textContent = config.pdfError;
      status.classList.add("is-error");
    }).then(function () {
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

  if (window.ResizeObserver && window.parent !== window) {
    new ResizeObserver(postHeight).observe(root);
  }
  window.addEventListener("load", postHeight);

  // Small API for tests and for anyone embedding the widget programmatically.
  root.marketingTarot = { buildPdf: buildPdf, reading: currentReading };

  var fromHash = readHash();
  if (fromHash) {
    state.spread = fromHash.spread;
    state.cards = fromHash.cards;
    root.querySelector("#mt-question").value = String(state.spread);
    setBusy(true);
    renderReading(false);
  }
})();
