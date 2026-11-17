/* Browser test suite for site/app.js and site/pdf.js. Loaded by test/index.html via the
   dev server. Each test gets a fresh widget instance: we set window.MARKETING_TAROT_CONFIG,
   point rootSelector at a new container, and re-run the app.js source. Results go to the
   page and to window.__results so a script can read them.

   Note: Chrome throttles history.replaceState to roughly 100 calls per 10 seconds and then
   silently drops calls, so instances run with updateHash:false unless a test is about the
   hash, and tests read the drawn cards from data-card-id instead of the URL.

   Run the suite in a visible, foreground tab. In a hidden or occluded tab Chrome throttles
   timers, and the time-based waits here ("pull to finish", the image retry) then fail
   even though the widget is fine. The "pull is ignored while a reveal is in progress"
   test also assumes the OS does not have "reduce motion" switched on. */
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
      cardsBaseUrl: "/cards/",
      shuffleMs: 0, scrollOnPull: false, updateHash: false
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
      faceDown: () => qa(".mt-card.is-facedown"),
      turns: () => qa(".mt-card__turn"),
      flipAll: () => host.marketingTarot.flipAll(),
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

  // Decodes PDF bytes as latin1 so literal strings and dictionary keys can be searched.
  const latin1 = (bytes) => { let s = ""; for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]); return s; };
  const count = (s, needle) => s.split(needle).length - 1;

  // Real Helvetica / Helvetica-Bold glyph widths (per 1000 em) by WinAnsi byte, exported
  // from pypdf's copy of Adobe's core-font AFM metrics. This is the ruler a PDF viewer
  // actually uses, independent of the canvas measurement pdf.js wraps with.
  const HELVETICA = {"Helvetica":{"32":278,"33":278,"34":355,"35":556,"36":556,"37":889,"38":667,"39":191,"40":333,"41":333,"42":389,"43":584,"44":278,"45":333,"46":278,"47":278,"48":556,"49":556,"50":556,"51":556,"52":556,"53":556,"54":556,"55":556,"56":556,"57":556,"58":278,"59":278,"60":584,"61":584,"62":584,"63":556,"64":1015,"65":667,"66":667,"67":722,"68":722,"69":667,"70":611,"71":778,"72":722,"73":278,"74":500,"75":667,"76":556,"77":833,"78":722,"79":778,"80":667,"81":778,"82":722,"83":667,"84":611,"85":722,"86":667,"87":944,"88":667,"89":667,"90":611,"91":278,"92":278,"93":278,"94":469,"95":556,"96":333,"97":556,"98":556,"99":500,"100":556,"101":556,"102":278,"103":556,"104":556,"105":222,"106":222,"107":500,"108":222,"109":833,"110":556,"111":556,"112":556,"113":556,"114":333,"115":500,"116":278,"117":556,"118":500,"119":722,"120":500,"121":500,"122":500,"123":334,"124":260,"125":334,"126":584,"128":556,"130":222,"131":556,"132":333,"133":1000,"134":556,"135":556,"136":333,"137":1000,"138":667,"139":333,"140":1000,"142":611,"145":222,"146":222,"147":333,"148":333,"149":350,"150":556,"151":1000,"152":333,"153":1000,"154":500,"155":333,"156":944,"158":500,"159":667,"161":333,"162":556,"163":556,"164":556,"165":556,"166":260,"167":556,"168":333,"169":737,"170":370,"171":556,"172":584,"174":737,"175":333,"176":400,"177":584,"178":333,"179":333,"180":333,"181":556,"182":537,"183":278,"184":333,"185":333,"186":365,"187":556,"188":834,"189":834,"190":834,"191":611,"192":667,"193":667,"194":667,"195":667,"196":667,"197":667,"198":1000,"199":722,"200":667,"201":667,"202":667,"203":667,"204":278,"205":278,"206":278,"207":278,"208":722,"209":722,"210":778,"211":778,"212":778,"213":778,"214":778,"215":584,"216":778,"217":722,"218":722,"219":722,"220":722,"221":667,"222":667,"223":611,"224":556,"225":556,"226":556,"227":556,"228":556,"229":556,"230":889,"231":500,"232":556,"233":556,"234":556,"235":556,"236":278,"237":278,"238":278,"239":278,"240":556,"241":556,"242":556,"243":556,"244":556,"245":556,"246":556,"247":584,"248":611,"249":556,"250":556,"251":556,"252":556,"253":500,"254":556,"255":500},"Helvetica-Bold":{"32":278,"33":333,"34":474,"35":556,"36":556,"37":889,"38":722,"39":238,"40":333,"41":333,"42":389,"43":584,"44":278,"45":333,"46":278,"47":278,"48":556,"49":556,"50":556,"51":556,"52":556,"53":556,"54":556,"55":556,"56":556,"57":556,"58":333,"59":333,"60":584,"61":584,"62":584,"63":611,"64":975,"65":722,"66":722,"67":722,"68":722,"69":667,"70":611,"71":778,"72":722,"73":278,"74":556,"75":722,"76":611,"77":833,"78":722,"79":778,"80":667,"81":778,"82":722,"83":667,"84":611,"85":722,"86":667,"87":944,"88":667,"89":667,"90":611,"91":333,"92":278,"93":333,"94":584,"95":556,"96":333,"97":556,"98":611,"99":556,"100":611,"101":556,"102":333,"103":611,"104":611,"105":278,"106":278,"107":556,"108":278,"109":889,"110":611,"111":611,"112":611,"113":611,"114":389,"115":556,"116":333,"117":611,"118":556,"119":778,"120":556,"121":556,"122":500,"123":389,"124":280,"125":389,"126":584,"128":556,"130":278,"131":556,"132":500,"133":1000,"134":556,"135":556,"136":333,"137":1000,"138":667,"139":333,"140":1000,"142":611,"145":278,"146":278,"147":500,"148":500,"149":350,"150":556,"151":1000,"152":333,"153":1000,"154":556,"155":333,"156":944,"158":500,"159":667,"161":333,"162":556,"163":556,"164":556,"165":556,"166":280,"167":556,"168":333,"169":737,"170":370,"171":556,"172":584,"174":737,"175":333,"176":400,"177":584,"178":333,"179":333,"180":333,"181":611,"182":556,"183":278,"184":333,"185":333,"186":365,"187":556,"188":834,"189":834,"190":834,"191":611,"192":722,"193":722,"194":722,"195":722,"196":722,"197":722,"198":1000,"199":722,"200":667,"201":667,"202":667,"203":667,"204":278,"205":278,"206":278,"207":278,"208":722,"209":722,"210":778,"211":778,"212":778,"213":778,"214":778,"215":584,"216":778,"217":722,"218":722,"219":722,"220":722,"221":667,"222":667,"223":611,"224":556,"225":556,"226":556,"227":556,"228":556,"229":556,"230":889,"231":556,"232":556,"233":556,"234":556,"235":556,"236":278,"237":278,"238":278,"239":278,"240":611,"241":611,"242":611,"243":611,"244":611,"245":611,"246":611,"247":584,"248":611,"249":611,"250":611,"251":611,"252":611,"253":556,"254":611,"255":556}};
  const helveticaWidth = (s, bold, size) => {
    const table = HELVETICA[bold ? "Helvetica-Bold" : "Helvetica"];
    let w = 0;
    for (const ch of s) {
      const cw = table[ch.charCodeAt(0)];
      if (cw === undefined) throw new Error(`no Helvetica width for byte ${ch.charCodeAt(0)} in "${s.slice(0, 40)}"`);
      w += cw;
    }
    return w * size / 1000;
  };
  // Every text operation pdf.js writes: BT <rgb> rg /F1|F2 <size> Tf <x> <y> Td (<text>) Tj ET
  const pdfTextOps = (text) => {
    const re = /BT [\d. ]+ rg \/(F[12]) ([\d.]+) Tf ([\d.-]+) ([\d.-]+) Td \(([\s\S]*?)(?<!\\)\) Tj ET/g;
    const ops = [];
    let m;
    while ((m = re.exec(text))) ops.push({ bold: m[1] === "F2", size: +m[2], x: +m[3], y: +m[4], text: m[5].replace(/\\([()\\])/g, "$1") });
    return ops;
  };

  // Walks the xref table and checks every offset lands on "N 0 obj".
  function checkXref(bytes, text) {
    const m = /startxref\s+(\d+)\s+%%EOF\s*$/.exec(text);
    assert(m, "startxref present");
    const xrefAt = Number(m[1]);
    assert(text.slice(xrefAt, xrefAt + 4) === "xref", "startxref points at the xref table");
    const header = /^xref\s+0 (\d+)\s/.exec(text.slice(xrefAt));
    const n = Number(header[1]);
    const entriesStart = xrefAt + header[0].length;
    for (let i = 1; i < n; i++) {
      const entry = text.slice(entriesStart + i * 20, entriesStart + i * 20 + 20);
      const off = Number(entry.slice(0, 10));
      assert(text.slice(off).startsWith(`${i} 0 obj`), `xref entry ${i} points at object ${i}`);
    }
    return n - 1;
  }

  /* ---------- tests ---------- */

  await test("deck data has the expected shape", () => {
    eq(deck.cards.length, 78, "card count");
    eq(deck.spreads.length, 7, "spread count");
    deck.cards.forEach((c, i) => { eq(c.id, i, `card ${i} id`); assert(c.name && c.classic_meaning && c.marketing_meaning, `card ${i} fields`); });
    deck.spreads.forEach((s, i) => { assert(s.question, `spread ${i} question`); eq(s.positions.length, 4, `spread ${i} positions`); });
    assert(deck.footer, "footer copy");
    const slugs = new Set(deck.cards.map((c) => slug(c.name)));
    eq(slugs.size, 78, "card slugs are unique");
  });

  await test("renders the 7 questions, first selected, reading hidden", () => {
    const w = boot();
    const opts = w.qa("#mt-question option");
    eq(opts.length, 7, "option count");
    opts.forEach((o, i) => eq(o.textContent, deck.spreads[i].question, `option ${i}`));
    eq(w.select().value, "0", "default selection");
    assert(w.reading().hidden, "reading hidden before a pull");
    eq(w.q(".mt-email"), null, "no email box anywhere");
    eq(w.pullBtn().textContent, "Shuffle & pull 4 cards", "initial button label");
    assert(w.q(".mt-header h1"), "title shown when the page stands on its own");
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
      assert(card.classList.contains("is-facedown"), `card ${i} dealt face down`);
    });
    eq(w.pullBtn().textContent, "Shuffle & pull again", "button label after a pull");
    assert(w.q(".mt-announce").textContent.includes(spread.question), "screen-reader announcement names the question");
    w.flipAll();
    eq(w.faceDown().length, 0, "flipAll turns every card");
    eq(w.ids().join(), ids.join(), "same four cards after turning them over");
    eq(w.q(".mt-reading__pdf").textContent, "Download as PDF", "PDF button present");
    eq(w.q(".mt-reading__pdf").hidden, false, "PDF button shown once every card is up");
    assert(!/rider/i.test(w.host.textContent), "no Rider-Waite wording anywhere");
  });

  await test("cards are dealt face down and turn over one at a time, in any order, without ever changing", async () => {
    const w = boot();
    await w.pull();
    const ids = w.ids();
    const spread = deck.spreads[0];
    eq(new Set(ids).size, 4, "4 distinct cards dealt");
    w.cards().forEach((card, i) => {
      assert(card.classList.contains("is-facedown"), `card ${i} starts face down`);
      const turn = card.querySelector(".mt-card__turn");
      eq(turn && turn.tagName, "BUTTON", `card ${i} has a Turn over button`);
      eq(turn.disabled, false, `card ${i} button enabled once dealt`);
      eq(turn.getAttribute("aria-label"), `Turn over card ${i + 1}: ${spread.positions[i]}`, `card ${i} button names its position`);
      eq(card.querySelector(".mt-card__face--front").getAttribute("aria-hidden"), "true", `card ${i} picture hidden from screen readers while face down`);
      card.querySelectorAll(".mt-card__text").forEach((t) => eq(t.getAttribute("aria-hidden"), "true", `card ${i} text hidden while face down`));
    });
    eq(w.q(".mt-reading__pdf").hidden, true, "PDF button waits until all cards are turned");
    eq(w.q(".mt-reading__flip-hint").hidden, false, "flip hint shown");
    assert(/face down/.test(w.q(".mt-announce").textContent), "announcement says the cards are face down");

    const order = [2, 0, 3, 1];
    order.forEach((idx, step) => {
      const card = w.cards()[idx];
      card.querySelector(".mt-card__turn").click();
      assert(!card.classList.contains("is-facedown"), `card ${idx} turned over`);
      eq(card.querySelector(".mt-card__face--front").getAttribute("aria-hidden"), null, `card ${idx} picture exposed`);
      card.querySelectorAll(".mt-card__text").forEach((t) => eq(t.getAttribute("aria-hidden"), null, `card ${idx} text exposed`));
      eq(card.querySelector(".mt-card__turn").hidden, true, `card ${idx} button gone`);
      eq(w.ids().join(), ids.join(), `cards unchanged after turn ${step + 1}`);
      eq(w.faceDown().length, 3 - step, `${3 - step} cards still face down after turn ${step + 1}`);
      const name = deck.cards[ids[idx]].name;
      assert(w.q(".mt-announce").textContent.includes(name), `announcement names ${name}`);
      eq(w.q(".mt-reading__pdf").hidden, step < 3, `PDF button ${step < 3 ? "hidden" : "shown"} after turn ${step + 1}`);
      card.querySelector(".mt-card__turn").click();
      eq(w.ids().join(), ids.join(), "clicking a turned card again changes nothing");
      eq(w.faceDown().length, 3 - step, "and turns nothing back over");
    });
    eq(w.q(".mt-reading__flip-hint").hidden, true, "flip hint gone once all four are up");
    assert(w.q(".mt-announce").textContent.includes(spread.question), "ready announcement after the last turn");

    await w.pull();
    eq(w.faceDown().length, 4, "pull again deals a fresh face-down set");
    eq(w.q(".mt-reading__pdf").hidden, true, "PDF button hidden again");
    eq(w.turns().filter((b) => !b.hidden).length, 4, "four fresh Turn over buttons");
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
      w.flipAll();
      eq(w.ids().join(), ids.join(), `pull ${i}: turning the cards over doesn't change them`);
      eq(w.faceDown().length, 0, `pull ${i}: all four turned`);
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

  await test("a card image that fails to load is retried once, then shows a named placeholder", async () => {
    const w = boot({ cardsBaseUrl: "/no-such-folder/" }, "q=0&c=5,6,7,8");
    await waitFor(() => !w.pullBtn().disabled, 3000, "restore");
    await sleep(300);
    eq(w.qa(".mt-card__face--front.is-missing").length, 0, "no placeholder yet: the retry is pending");
    await waitFor(() => w.qa(".mt-card__face--front.is-missing").length === 4, 6000, "all four placeholders after the retry");
    w.cards().forEach((card, i) => {
      const img = card.querySelector("img");
      assert(/\?retry=1$/.test(img.getAttribute("src")), `card ${i} was retried with a fresh request`);
      eq(img.getAttribute("src").split("?")[0], "/no-such-folder/" + slug(deck.cards[5 + i].name) + ".jpg", `card ${i} retried the same file`);
      eq(card.querySelector(".mt-card__placeholder").textContent, deck.cards[5 + i].name, `card ${i} placeholder names the card`);
      eq(getComputedStyle(card.querySelector(".mt-card__placeholder")).display, "flex", `card ${i} placeholder visible`);
      eq(getComputedStyle(img).display, "none", `card ${i} broken image hidden`);
    });
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
    eq(w.faceDown().length, 0, "a restored reading comes back face up");
    eq(w.turns().length, 0, "no Turn over buttons on a restored reading");
    eq(w.q(".mt-reading__pdf").hidden, false, "PDF button available straight away");
    eq(w.q(".mt-reading__flip-hint").hidden, true, "no flip hint");
    w.cards().forEach((c, i) => eq(c.querySelector(".mt-card__name").getAttribute("aria-hidden"), null, `restored card ${i} text exposed`));
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
    const w = boot({ shuffleMs: 150 });
    w.q(".mt-controls").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    assert(w.pullBtn().disabled, "button disabled while busy");
    eq(w.pullBtn().textContent, "Shuffling…", "busy label");
    const first = w.ids().join();
    w.q(".mt-controls").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    w.q(".mt-reading__again").click();
    eq(w.ids().join(), first, "second pull ignored while busy");
    assert(w.turns().every((b) => b.disabled), "cards can't be turned while shuffling");
    w.turns()[0].click();
    w.flipAll();
    eq(w.faceDown().length, 4, "turning is ignored while shuffling");
    await waitFor(() => !w.pullBtn().disabled, 3000, "busy to clear");
    assert(w.turns().every((b) => !b.disabled), "cards can be turned once dealt");
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
      await w.pull();
      eq(w.turns()[0].getAttribute("aria-label"), "Turn over card 1: " + clone.spreads[0].positions[0], "position label escaped in the Turn over button");
      eq(w.q(".mt-card__turn i"), null, "no injected element inside the button");
      eq(w.q(".mt-card__position i"), null, "no injected element in the position label");
      eq(window.__xss, undefined, "still no script executed after a pull");
    } finally {
      window.MARKETING_TAROT_DECK = original;
      delete window.__xss;
    }
  });

  await test("PDF: every line fits inside the margins by real Helvetica metrics, including a worst-case reading", async () => {
    const original = window.MARKETING_TAROT_DECK;
    const longest = (arr, key) => arr.reduce((a, b) => (b[key].length > a[key].length ? b : a));
    const worst = JSON.parse(JSON.stringify(original));
    const lm = longest(worst.cards, "marketing_meaning"), lc = longest(worst.cards, "classic_meaning"), ln = longest(worst.cards, "name");
    const lp = worst.spreads.flatMap((s) => s.positions).reduce((a, b) => (b.length > a.length ? b : a));
    [0, 1, 2, 3].forEach((i) => { worst.cards[i].marketing_meaning = lm.marketing_meaning; worst.cards[i].classic_meaning = lc.classic_meaning; worst.cards[i].name = ln.name; });
    worst.spreads[0].question = longest(worst.spreads, "question").question;
    worst.spreads[0].positions = [lp, lp, lp, lp];
    let checked = 0;
    for (const [deckToUse, hash] of [[original, "q=2&c=0,22,36,77"], [worst, "q=0&c=0,1,2,3"]]) {
      window.MARKETING_TAROT_DECK = deckToUse;
      try {
        const w = boot({ servicesUrl: "https://example.test/services" }, hash);
        await waitFor(() => !w.pullBtn().disabled, 3000, "restore");
        const text = latin1(new Uint8Array(await (await w.host.marketingTarot.buildPdf()).arrayBuffer()));
        const ops = pdfTextOps(text);
        assert(ops.length > 30, `found ${ops.length} text lines`);
        eq(ops.length, count(text, " Tj ET"), "every text operation in the PDF was parsed");
        for (const op of ops) {
          const right = op.x + helveticaWidth(op.text, op.bold, op.size);
          assert(right <= 612 - 54 + 0.01, `line ends at ${right.toFixed(1)}pt, past the 558pt right margin: "${op.text.slice(0, 50)}"`);
          assert(op.y >= 54 - 0.01, `line at y=${op.y} sits below the bottom margin: "${op.text.slice(0, 50)}"`);
          checked++;
        }
      } finally {
        window.MARKETING_TAROT_DECK = original;
      }
    }
    assert(checked > 60, `${checked} lines checked`);
  });

  await test("PDF: text wrapping never exceeds the column width (the widget's own ruler)", () => {
    const wrap = window.MarketingTarotPdf._wrap;
    const canvas = document.createElement("canvas").getContext("2d");
    const long = deck.cards.map((c) => c.marketing_meaning).join(" ");
    for (const [size, bold, width] of [[11, false, 392], [10, true, 392], [15, false, 504], [11, false, 120]]) {
      const lines = wrap(long, size, bold, width);
      canvas.font = (bold ? "bold " : "") + size + "px Arial, Helvetica, sans-serif";
      lines.forEach((line, i) => assert(canvas.measureText(line).width <= width, `line ${i} at ${size}px fits ${width}pt: "${line.slice(0, 40)}"`));
      eq(lines.join(" "), long.split(/\s+/).join(" "), "no words lost or duplicated");
    }
    eq(window.MarketingTarotPdf._jpegInfo(new Uint8Array([0, 1, 2])), null, "non-JPEG rejected");
  });

  await test("PDF: builds a valid file with the question, four cards, their images and the Services link", async () => {
    const w = boot({ servicesUrl: "https://example.test/services" }, "q=2&c=0,22,36,77");
    await waitFor(() => !w.pullBtn().disabled, 3000, "restore");
    const blob = await w.host.marketingTarot.buildPdf();
    eq(blob.type, "application/pdf", "blob type");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const text = latin1(bytes);
    assert(text.startsWith("%PDF-1.4\n"), "PDF header");
    const objects = checkXref(bytes, text);
    assert(objects >= 10, `object count ${objects}`);
    eq(count(text, "/Subtype /Image"), 4, "four embedded images");
    eq(count(text, "/Filter /DCTDecode"), 4, "images are JPEG streams");
    assert(/\/Type \/Pages \/Count ([12]) /.test(text), "one or two pages");
    for (const id of [0, 22, 36, 77]) assert(text.includes("(" + deck.cards[id].name + ") Tj"), `card name in PDF: ${deck.cards[id].name}`);
    assert(text.includes("(I'm about to launch something new) Tj"), "question in PDF");
    assert(text.includes("(1. The heart of the offer) Tj"), "position label in PDF");
    assert(text.includes("/Subtype /Link") && text.includes("/URI (https://example.test/services)"), "services link annotation");
    assert(text.includes("/BaseFont /Helvetica ") && text.includes("/BaseFont /Helvetica-Bold "), "standard fonts");
    assert(bytes.length > 200000 && bytes.length < 2000000, `size ${bytes.length} looks like text plus 4 images`);

    // Keep it around: a link to view it, and a copy on disk for pypdf (dev server only).
    const url = URL.createObjectURL(blob);
    window.__lastPdfUrl = url;
    document.getElementById("pdf-link").innerHTML = `<a href="${url}" target="_blank" rel="noopener">Open the last generated PDF</a> (${(bytes.length / 1024).toFixed(0)} KB)`;
    await fetch("/test/save-pdf", { method: "POST", body: blob }).catch(() => {});
  });

  await test("PDF: still builds when card images are missing, and escapes special characters", async () => {
    const w = boot({ cardsBaseUrl: "/nope/" }, "q=0&c=1,2,3,4");
    await waitFor(() => !w.pullBtn().disabled, 3000, "restore");
    const blob = await w.host.marketingTarot.buildPdf();
    const text = latin1(new Uint8Array(await blob.arrayBuffer()));
    checkXref(null, text);
    eq(count(text, "/Subtype /Image"), 0, "no images embedded");
    assert(text.includes("(" + deck.cards[1].name + ") Tj"), "text still present");

    const original = window.MARKETING_TAROT_DECK;
    const clone = JSON.parse(JSON.stringify(original));
    clone.cards[5].name = "Paren(the)sis \\ back ’curly’ — dash é";
    window.MARKETING_TAROT_DECK = clone;
    try {
      const w2 = boot({ cardsBaseUrl: "/nope/" }, "q=0&c=5,6,7,8");
      await waitFor(() => !w2.pullBtn().disabled, 3000, "restore");
      const t2 = latin1(new Uint8Array(await (await w2.host.marketingTarot.buildPdf()).arrayBuffer()));
      assert(t2.includes("(Paren\\(the\\)sis \\\\ back \x92curly\x92 \x97 dash \xe9) Tj"), "parentheses and backslash escaped, curly quotes and dash mapped to WinAnsi");
    } finally {
      window.MARKETING_TAROT_DECK = original;
    }
  });

  await test("PDF: the Download button builds the file and triggers a download", async () => {
    const w = boot({}, "q=1&c=10,11,12,13");
    await waitFor(() => !w.pullBtn().disabled, 3000, "restore");
    const realCreate = URL.createObjectURL, realClick = HTMLAnchorElement.prototype.click;
    let created = null, clicked = null;
    URL.createObjectURL = (b) => { created = b; return "blob:fake"; };
    HTMLAnchorElement.prototype.click = function () { clicked = { href: this.getAttribute("href"), download: this.download }; };
    try {
      const btn = w.q(".mt-reading__pdf");
      btn.click();
      eq(btn.disabled, true, "button disabled while preparing");
      eq(btn.textContent, "Preparing PDF…", "preparing label");
      await waitFor(() => !btn.disabled, 5000, "PDF to finish");
      assert(created && created.type === "application/pdf", "a PDF blob was created");
      eq(clicked && clicked.download, "marketing-tarot-reading.pdf", "download filename");
      eq(clicked && clicked.href, "blob:fake", "anchor points at the blob");
      eq(w.q(".mt-reading__pdf-status").textContent, "", "no error shown");
      eq(btn.textContent, "Download as PDF", "label restored");
    } finally {
      URL.createObjectURL = realCreate;
      HTMLAnchorElement.prototype.click = realClick;
    }
  });

  await test("PDF: a build failure shows the fallback message and re-enables the button", async () => {
    const w = boot({}, "q=1&c=10,11,12,13");
    await waitFor(() => !w.pullBtn().disabled, 3000, "restore");
    const realBuild = window.MarketingTarotPdf.build;
    window.MarketingTarotPdf.build = () => Promise.reject(new Error("boom"));
    try {
      const btn = w.q(".mt-reading__pdf");
      btn.click();
      await waitFor(() => !btn.disabled, 3000, "button re-enabled");
      const status = w.q(".mt-reading__pdf-status");
      assert(status.classList.contains("is-error") && /print/i.test(status.textContent), "fallback message mentions printing");
      await w.pull();
      eq(status.textContent, "", "status cleared on the next reading");
    } finally {
      window.MarketingTarotPdf.build = realBuild;
    }
  });

  await test("PDF: a download still building when the visitor pulls again is dropped, never delivered late", async () => {
    const w = boot({}, "q=1&c=10,11,12,13");
    await waitFor(() => !w.pullBtn().disabled, 3000, "restore");
    const realBuild = window.MarketingTarotPdf.build, realCreate = URL.createObjectURL, realClick = HTMLAnchorElement.prototype.click;
    let clicks = 0, finishBuild = null;
    window.MarketingTarotPdf.build = () => new Promise((resolve) => { finishBuild = resolve; });
    URL.createObjectURL = () => "blob:fake";
    HTMLAnchorElement.prototype.click = function () { clicks++; };
    try {
      w.q(".mt-reading__pdf").click();
      eq(w.q(".mt-reading__pdf").textContent, "Preparing PDF…", "build started");
      await w.pull();
      eq(w.q(".mt-reading__pdf").hidden, true, "new face-down reading hides the PDF button");
      finishBuild(new Blob(["%PDF-1.4 stale"], { type: "application/pdf" }));
      await sleep(80);
      eq(clicks, 0, "the stale PDF was not downloaded");
      eq(w.q(".mt-reading__pdf").hidden, true, "button stays hidden");
      eq(w.q(".mt-reading__pdf-status").textContent, "", "no stray status");
      window.MarketingTarotPdf.build = realBuild;
      w.flipAll();
      w.q(".mt-reading__pdf").click();
      await waitFor(() => clicks === 1, 5000, "a fresh download for the new reading");
      eq(w.q(".mt-reading__pdf").textContent, "Download as PDF", "label restored");
    } finally {
      window.MarketingTarotPdf.build = realBuild;
      URL.createObjectURL = realCreate;
      HTMLAnchorElement.prototype.click = realClick;
    }
  });

  await test("changing the page hash shows that reading (a shared link to the same page)", async () => {
    const w = boot({ updateHash: true }, "q=1&c=20,21,22,23");
    await waitFor(() => !w.pullBtn().disabled, 3000, "restore");
    eq(w.ids().join(), "20,21,22,23", "initial reading");
    window.location.hash = "#q=4&c=30,31,32,33";
    await waitFor(() => w.ids().join() === "30,31,32,33", 3000, "reading follows the hash");
    eq(w.select().value, "4", "dropdown follows");
    eq(w.faceDown().length, 0, "shown face up");
    window.location.hash = "#garbage";
    await sleep(100);
    eq(w.ids().join(), "30,31,32,33", "an invalid hash leaves the reading alone");
  });

  await test("standalone page in an iframe reports its height and reading, can shrink, and hides its scrollbar only once acked", async () => {
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
      const html = frame.contentDocument.documentElement;
      eq(html.classList.contains("mt-embedded"), false, "scrollbar kept until the host acknowledges");
      eq(getComputedStyle(html).overflow, "visible", "frame document can scroll on its own");
      frame.contentWindow.postMessage({ type: "marketing-tarot:ack" }, "*");
      await waitFor(() => html.classList.contains("mt-embedded"), 2000, "ack received");
      eq(getComputedStyle(html).overflow, "hidden", "scrollbar dropped once the host resizes the frame");
    } finally {
      window.removeEventListener("message", onMsg);
      frame.remove();
    }
  });

  await test("Squarespace snippet: seeds from the page hash, resizes the frame, mirrors the reading, follows hash changes, ignores strangers", async () => {
    const host = document.createElement("iframe");
    host.style.cssText = "width:900px;height:900px;border:0";
    host.src = "/test/embed.html#q=2&c=1,2,3,4";
    stage.appendChild(host);
    const inner = () => host.contentDocument && host.contentDocument.getElementById("marketing-tarot-frame");
    const widget = () => inner() && inner().contentDocument;
    const ids = () => Array.from(widget().querySelectorAll(".mt-card")).map((c) => Number(c.dataset.cardId)).join();
    try {
      await waitFor(() => { try { return !!(widget() && widget().querySelector(".mt-card")); } catch (e) { return false; } }, 8000, "embedded widget to render");
      assert(inner().getAttribute("src").endsWith("#q=2&c=1,2,3,4"), "page hash handed to the iframe");
      eq(inner().getAttribute("scrolling"), null, "no scrolling=no, so the frame can still scroll if the script is missing");
      await waitFor(() => !widget().querySelector(".mt-controls__pull").disabled, 3000, "restore");
      eq(ids(), "1,2,3,4", "seeded reading shown");
      eq(widget().querySelector("#mt-question").value, "2", "seeded question");
      eq(widget().querySelector(".mt-header"), null, "no second title inside the frame: the host page has its own heading");
      await waitFor(() => parseInt(inner().style.height, 10) > 800, 3000, "frame sized to the reading");
      const tall = parseInt(inner().style.height, 10);
      await waitFor(() => widget().documentElement.classList.contains("mt-embedded"), 3000, "widget acknowledged by the snippet");
      eq(getComputedStyle(widget().documentElement).overflow, "hidden", "frame document hides its scrollbar");

      widget().querySelector(".mt-controls__pull").click();
      await waitFor(() => !widget().querySelector(".mt-controls__pull").disabled, 3000, "pull inside the frame");
      await waitFor(() => host.contentWindow.location.hash === "#q=2&c=" + ids(), 3000, "host page URL mirrors the new reading");
      await waitFor(() => parseInt(inner().style.height, 10) < tall, 3000, `frame shrank below ${tall}px for the face-down reading`);

      host.contentWindow.location.hash = "#q=5&c=10,11,12,13";
      await waitFor(() => { try { return ids() === "10,11,12,13"; } catch (e) { return false; } }, 6000, "widget re-seeded from the host's new hash");
      eq(widget().querySelector("#mt-question").value, "5", "question followed the host hash");

      const before = inner().style.height;
      host.contentWindow.postMessage({ type: "marketing-tarot:height", height: 7 }, "*");
      await sleep(150);
      eq(inner().style.height, before, "a height message from anything but the widget frame is ignored");
    } finally {
      host.remove();
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
    const first = w.cards()[0];
    const turn = first.querySelector(".mt-card__turn");
    eq(turn.tagName, "BUTTON", "Turn over control is a real button (keyboard operable)");
    assert(/^Turn over card 1: /.test(turn.getAttribute("aria-label")), "button labelled with the card position");
    turn.click();
    eq(document.activeElement, first.querySelector(".mt-card__name h3"), "focus moves to the turned card's name");
    eq(first.querySelector(".mt-card__name").getAttribute("aria-hidden"), null, "card text exposed once turned");
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
