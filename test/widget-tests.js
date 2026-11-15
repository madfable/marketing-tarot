/* Browser test suite for site/app.js. Loaded by test/index.html via the dev server.
   Each test gets a fresh widget instance: we set window.MARKETING_TAROT_CONFIG, point
   rootSelector at a new container, and re-run the app.js source. Results go to the page
   and to window.__results so a script can read them.

   Note: Chrome throttles history.replaceState to roughly 100 calls per 10 seconds and then
   silently drops calls, so instances run with updateHash:false unless a test is about the
   hash, and tests read the drawn cards from data-card-id instead of the URL. */
(async function () {
  "use strict";

  const deck = window.MARKETING_TAROT_DECK;
  const stage = document.getElementById("stage");
  const resultsEl = document.getElementById("results");
  const summaryEl = document.getElementById("summary");
  const appSource = await (await fetch("/app.js", { cache: "no-store" })).text();

  const results = { passed: 0, failed: 0, failures: [] };
  let instanceCount = 0;

  /* ---------- tiny runner ---------- */

  function assert(cond, msg) { if (!cond) throw new Error(msg || "assertion failed"); }
  function eq(a, b, msg) { if (a !== b) throw new Error(`${msg || "not equal"}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function waitFor(fn, ms = 3000, label = "condition") {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (fn()) return; await sleep(20); }
    throw new Error(`timed out waiting for ${label}`);
  }

  async function test(name, fn) {
    const li = document.createElement("li");
    li.textContent = name;
    resultsEl.appendChild(li);
    try {
      await fn();
      li.className = "pass";
      results.passed++;
    } catch (err) {
      li.className = "fail";
      const pre = document.createElement("pre");
      pre.textContent = err && err.stack ? err.stack : String(err);
      li.appendChild(pre);
      results.failed++;
      results.failures.push({ name, error: String(err && err.message || err) });
      console.error("FAIL", name, err);
    }
  }

  /* ---------- widget factory ---------- */

  function setHash(hash) {
    window.history.replaceState(null, "", hash ? "#" + hash : window.location.pathname);
  }

  // Boots a fresh widget in its own container. `hash` is applied to the page before boot
  // so the restore-from-hash path runs; cfg overrides MARKETING_TAROT_CONFIG.
  function boot(cfg = {}, hash = "") {
    const id = "w" + (++instanceCount);
    const host = document.createElement("div");
    host.id = id;
    stage.appendChild(host);
    setHash(hash);
    window.MARKETING_TAROT_CONFIG = Object.assign({
      rootSelector: "#" + id,
      servicesUrl: "https://example.test/services",
      privacyUrl: "https://example.test/privacy",
      emailEndpoint: "",
      cardsBaseUrl: "/cards/",
      shuffleMs: 0, revealStaggerMs: 0, flipMs: 0, scrollOnPull: false, updateHash: false
    }, cfg);
    new Function(appSource)(); // same as a <script> tag, scoped to this instance's root
    const q = (sel) => host.querySelector(sel);
    const qa = (sel) => Array.from(host.querySelectorAll(sel));
    return {
      host, q, qa,
      select: () => q("#mt-question"),
      pullBtn: () => q(".mt-controls__pull"),
      reading: () => q(".mt-reading"),
      cards: () => qa(".mt-card"),
      ids: () => qa(".mt-card").map((c) => Number(c.dataset.cardId)),
      async pull() {
        q(".mt-controls").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
        await waitFor(() => !q(".mt-controls__pull").disabled, 3000, "pull to finish");
      }
    };
  }

  const parseHash = (h) => {
    const m = /^#q=(\d+)&c=([\d,]+)$/.exec(h);
    return m ? { q: Number(m[1]), c: m[2].split(",").map(Number) } : null;
  };
  const slug = (n) => n.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

  /* ---------- tests ---------- */

  await test("deck data has the expected shape", () => {
    eq(deck.cards.length, 78, "card count");
    eq(deck.spreads.length, 7, "spread count");
    deck.cards.forEach((c, i) => { eq(c.id, i, `card ${i} id`); assert(c.name && c.classic_meaning && c.marketing_meaning, `card ${i} fields`); });
    deck.spreads.forEach((s, i) => { assert(s.question, `spread ${i} question`); eq(s.positions.length, 4, `spread ${i} positions`); });
    assert(deck.footer && deck.email_box && deck.email_box.heading, "footer and email_box copy");
    const slugs = new Set(deck.cards.map((c) => slug(c.name)));
    eq(slugs.size, 78, "card slugs are unique");
  });

  await test("renders the 7 questions, first selected, reading hidden, no email box", () => {
    const w = boot();
    const opts = w.qa("#mt-question option");
    eq(opts.length, 7, "option count");
    opts.forEach((o, i) => eq(o.textContent, deck.spreads[i].question, `option ${i}`));
    eq(w.select().value, "0", "default selection");
    assert(w.reading().hidden, "reading hidden before a pull");
    eq(w.q(".mt-email"), null, "email box absent when endpoint is empty");
    eq(w.pullBtn().textContent, "Shuffle & pull 4 cards", "initial button label");
  });

  await test("a pull renders 4 distinct cards for the chosen question, with exact copy", async () => {
    const w = boot({ updateHash: true });
    w.select().value = "3";
    await w.pull();
    assert(!w.reading().hidden, "reading shown");
    const ids = w.ids();
    eq(ids.length, 4, "4 cards rendered");
    eq(new Set(ids).size, 4, "4 distinct cards");
    const h = parseHash(window.location.hash);
    assert(h && h.q === 3 && h.c.join() === ids.join(), "hash records question and cards");
    const spread = deck.spreads[3];
    eq(w.q(".mt-reading__question").textContent, spread.question, "heading");
    w.cards().forEach((card, i) => {
      const c = deck.cards[ids[i]];
      assert(card.querySelector(".mt-card__position").textContent.includes(spread.positions[i]), `card ${i} position label`);
      eq(card.querySelector(".mt-card__name h3").textContent, c.name, `card ${i} name`);
      eq(card.querySelector(".mt-card__classic").textContent, "Classic meaning: " + c.classic_meaning, `card ${i} classic`);
      eq(card.querySelector(".mt-card__marketing").textContent, c.marketing_meaning, `card ${i} marketing`);
      const img = card.querySelector("img");
      assert(img.getAttribute("src").endsWith("/cards/" + slug(c.name) + ".jpg"), `card ${i} image path`);
      assert(img.alt.includes(c.name) && !/rider/i.test(img.alt), `card ${i} alt text (no trademark)`);
      assert(!card.classList.contains("is-facedown"), `card ${i} flipped face up`);
    });
    eq(w.pullBtn().textContent, "Shuffle & pull again", "button label after a pull");
    assert(!/rider/i.test(w.host.textContent), "no Rider-Waite wording anywhere");
    assert(w.q(".mt-announce").textContent.includes(spread.question), "screen-reader announcement names the question");
  });

  await test("300 pulls never repeat a card within a reading and cover the whole deck", async () => {
    const w = boot();
    const seen = new Set();
    for (let i = 0; i < 300; i++) {
      await w.pull();
      const ids = w.ids();
      eq(ids.length, 4, `pull ${i} has 4 cards`);
      eq(new Set(ids).size, 4, `pull ${i} has 4 distinct cards`);
      ids.forEach((id) => { assert(id >= 0 && id < 78, `pull ${i} id in range`); seen.add(id); });
    }
    eq(seen.size, 78, "every card appeared at least once in 300 pulls");
  });

  await test("every one of the 78 cards renders from a hash, and its image file exists", async () => {
    for (let start = 0; start < 78; start += 4) {
      const ids = [0, 1, 2, 3].map((k) => (start + k) % 78);
      const w = boot({}, `q=${start % 7}&c=${ids.join(",")}`);
      await waitFor(() => !w.pullBtn().disabled, 3000, "restore to finish");
      eq(w.ids().join(), ids.join(), `restore ${start} renders the right cards`);
      w.cards().forEach((card, i) => eq(card.querySelector(".mt-card__name h3").textContent, deck.cards[ids[i]].name, `restore ${start} card ${i}`));
    }
    const missing = [];
    await Promise.all(deck.cards.map(async (c) => {
      const res = await fetch("/cards/" + slug(c.name) + ".jpg", { method: "HEAD" });
      if (!res.ok) missing.push(slug(c.name));
    }));
    eq(missing.length, 0, "missing image files: " + missing.join(", "));
  });

  await test("invalid hashes are ignored", () => {
    const bad = ["q=9&c=1,2,3,4", "q=0&c=1,1,2,3", "q=0&c=1,2,3", "q=0&c=1,2,3,78", "q=0&c=a,b,c,d", "q=&c=", "garbage", "q=-1&c=1,2,3,4", "q=0&c=1,2,3,4,5", "q=1&c=%E0%A4"];
    for (const h of bad) {
      const w = boot({}, h);
      assert(w.reading().hidden, `reading stays hidden for #${h}`);
      eq(w.cards().length, 0, `no cards for #${h}`);
    }
  });

  await test("valid hash restores the reading and syncs the dropdown", async () => {
    const w = boot({}, "q=5&c=77,0,40,13");
    await waitFor(() => !w.pullBtn().disabled, 3000, "restore");
    eq(w.select().value, "5", "dropdown synced");
    eq(w.q(".mt-reading__question").textContent, deck.spreads[5].question, "heading");
    eq(w.ids().join(","), "77,0,40,13", "card order preserved");
  });

  await test("footer keeps Kelly's copy exactly and links the last sentence to Services, leaving the iframe", async () => {
    const w = boot({ servicesUrl: "https://example.test/services" });
    await w.pull();
    const footer = w.q(".mt-reading__footer");
    eq(footer.textContent, deck.footer, "footer text identical to deck.json (including spacing)");
    const a = footer.querySelector("a");
    eq(a.getAttribute("href"), "https://example.test/services", "services link");
    eq(a.getAttribute("target"), "_top", "services link escapes the iframe");
    eq(a.textContent, "If you want help turning your reading into a plan, that's what I do!", "linked sentence");
  });

  await test("pull is ignored while a reveal is in progress, then works again", async () => {
    const w = boot({ shuffleMs: 150, flipMs: 150 });
    w.q(".mt-controls").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    assert(w.pullBtn().disabled, "button disabled while busy");
    eq(w.pullBtn().textContent, "Shuffling…", "busy label");
    const first = w.ids().join();
    w.q(".mt-controls").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    w.q(".mt-reading__again").click();
    eq(w.ids().join(), first, "second pull ignored while busy");
    await waitFor(() => !w.pullBtn().disabled, 3000, "busy to clear");
    let changed = false;
    for (let i = 0; i < 6 && !changed; i++) { await w.pull(); changed = w.ids().join() !== first; }
    assert(changed, "a later pull produces a different reading");
  });

  await test("'Shuffle & pull again' button pulls too", async () => {
    const w = boot();
    await w.pull();
    const before = w.ids().join();
    let changed = false;
    for (let i = 0; i < 6 && !changed; i++) {
      w.q(".mt-reading__again").click();
      await waitFor(() => !w.pullBtn().disabled, 3000, "pull again");
      changed = w.ids().join() !== before;
    }
    assert(changed, "pull again changed the reading");
  });

  await test("card copy is HTML-escaped (no injection from deck data)", async () => {
    const original = window.MARKETING_TAROT_DECK;
    const clone = JSON.parse(JSON.stringify(original));
    clone.cards[0].name = '<img src=x onerror="window.__xss=1">Evil';
    clone.cards[0].marketing_meaning = '<script>window.__xss=2</script>"quoted" & <b>bold</b>';
    clone.spreads[0].positions[0] = '<i onclick="x">pos</i>';
    clone.footer = '<a href="x">bad</a> link. Sentence two!';
    window.MARKETING_TAROT_DECK = clone;
    try {
      const w = boot({}, "q=0&c=0,1,2,3");
      await waitFor(() => !w.pullBtn().disabled, 3000, "restore");
      await sleep(50);
      eq(window.__xss, undefined, "no script executed");
      eq(w.q(".mt-card__name h3").textContent, clone.cards[0].name, "name rendered as text");
      eq(w.q(".mt-card__name img"), null, "no injected img in name");
      eq(w.q(".mt-card__marketing").textContent, clone.cards[0].marketing_meaning, "meaning rendered as text");
      eq(w.q(".mt-reading__footer a").textContent, "Sentence two!", "only the services link is a link");
      eq(w.qa(".mt-reading__footer a").length, 1, "injected footer anchor neutralised");
    } finally {
      window.MARKETING_TAROT_DECK = original;
      delete window.__xss;
    }
  });

  await test("email box: shown with an endpoint, validates, posts the reading, handles failure and success", async () => {
    const calls = [];
    let respond = () => new Response(JSON.stringify({ ok: true }), { status: 200 });
    const realFetch = window.fetch;
    window.fetch = async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return respond(); };
    try {
      const w = boot({ emailEndpoint: "/api/send-reading" });
      assert(w.q(".mt-email").hidden, "email box hidden before a reading");
      await w.pull();
      const box = w.q(".mt-email");
      assert(!box.hidden, "email box visible after a reading");
      eq(box.querySelector("h3").textContent, deck.email_box.heading, "heading copy");
      eq(box.querySelector(".mt-email__text").textContent, deck.email_box.text, "body copy");
      eq(box.querySelector('input[name="newsletter"]').checked, false, "newsletter starts unchecked");
      eq(box.querySelector(".mt-email__privacy a").getAttribute("href"), "https://example.test/privacy", "privacy link");
      const form = box.querySelector("form");
      const input = box.querySelector("#mt-email-input");
      const status = box.querySelector(".mt-email__status");
      const submit = () => form.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));

      input.value = "not-an-email";
      submit();
      eq(calls.length, 0, "no request for an invalid email");
      eq(input.getAttribute("aria-invalid"), "true", "field flagged invalid");
      assert(status.classList.contains("is-error") && status.textContent.length > 0, "validation message shown");

      input.value = "reader@example.test";
      box.querySelector('input[name="newsletter"]').checked = true;
      respond = () => new Response("oops", { status: 500 });
      submit();
      await waitFor(() => status.classList.contains("is-error"), 3000, "error status");
      eq(calls.length, 1, "one request");
      const body = calls[0].body;
      eq(body.email, "reader@example.test", "payload email");
      eq(body.newsletter, true, "payload newsletter");
      eq(body.spread, 0, "payload spread");
      eq(body.cards.join(","), w.ids().join(","), "payload cards match the reading");
      eq(body.website, "", "honeypot empty");
      assert(!box.querySelector('button[type="submit"]').disabled, "button re-enabled after failure");

      respond = () => new Response(JSON.stringify({ ok: true }), { status: 200 });
      submit();
      await waitFor(() => status.classList.contains("is-success"), 3000, "success status");
      eq(status.textContent, deck.email_box.confirmation, "confirmation copy");
      assert(input.disabled && box.querySelector('button[type="submit"]').disabled, "form locked after sending");

      await w.pull();
      assert(!input.disabled, "form reset for the next reading");
      eq(status.textContent, "", "status cleared for the next reading");

      // A reply that arrives after the user has already pulled again must not touch the new form.
      let release;
      respond = () => new Promise((r) => { release = () => r(new Response(JSON.stringify({ ok: true }), { status: 200 })); });
      input.value = "late@example.test";
      submit();
      await waitFor(() => !!release, 1000, "request in flight");
      await w.pull();
      release();
      await sleep(50);
      eq(status.textContent, "", "stale reply ignored");
      assert(!input.disabled, "new form still usable");
    } finally {
      window.fetch = realFetch;
    }
  });

  await test("standalone page in an iframe reports its height and reading, and can shrink", async () => {
    const frame = document.createElement("iframe");
    frame.style.cssText = "width:900px;height:3000px;border:0";
    const messages = [];
    const onMsg = (e) => { if (e.data && /^marketing-tarot:/.test(e.data.type)) messages.push(e.data); };
    window.addEventListener("message", onMsg);
    try {
      frame.src = "/index.html#q=0&c=1,2,3,4";
      stage.appendChild(frame);
      await waitFor(() => messages.some((m) => m.type === "marketing-tarot:height"), 5000, "height message");
      await sleep(300);
      const heights = messages.filter((m) => m.type === "marketing-tarot:height").map((m) => m.height);
      const last = heights[heights.length - 1];
      assert(last > 800 && last < 3000, `reported height ${last} is the widget's own height, not the 3000px frame`);
      const reading = messages.find((m) => m.type === "marketing-tarot:reading");
      assert(reading && reading.hash === "#q=0&c=1,2,3,4", "reading message carries the hash");
    } finally {
      window.removeEventListener("message", onMsg);
      frame.remove();
    }
  });

  await test("accessibility basics: labelled controls, status region, focus moves to the reading", async () => {
    const w = boot();
    const select = w.select();
    eq(w.q(`label[for="${select.id}"]`) !== null, true, "dropdown has a label");
    eq(w.reading().getAttribute("aria-live"), null, "whole reading is not a live region (would read all 4 cards at once)");
    eq(w.q(".mt-announce").getAttribute("role"), "status", "a short status region exists instead");
    await w.pull();
    eq(document.activeElement, w.q(".mt-reading__question"), "focus moved to the reading heading");
    w.cards().forEach((c, i) => assert(c.querySelector("img").alt.length > 0, `card ${i} image has alt`));
    const ids = w.qa("[id]").map((el) => el.id);
    eq(new Set(ids).size, ids.length, "no duplicate ids inside the widget");
  });

  /* ---------- summary ---------- */

  setHash("");
  window.__results = results;
  const total = results.passed + results.failed;
  summaryEl.className = results.failed ? "fail" : "pass";
  summaryEl.textContent = results.failed ? `${results.failed} of ${total} tests failed` : `All ${total} tests passed`;
  document.title = (results.failed ? "FAIL " : "PASS ") + document.title;
  console.log("widget tests:", results);
})();
