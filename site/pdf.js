/* Marketing Tarot: builds a PDF of a reading in the browser with no libraries.
   Exposes window.MarketingTarotPdf.build(reading) -> Promise<Blob>.

   reading = {
     title, question, hint, deckLabel, footer, servicesUrl,
     cards: [{ position, name, classic, marketing, imageUrl }]
   }

   Text is set in the PDF standard fonts Helvetica / Helvetica-Bold (WinAnsi encoding, no
   font embedding needed). Line wrapping is measured with a canvas using Arial, which is
   metric-compatible with Helvetica. Card images are the site's JPEGs embedded as-is. */
(function () {
  "use strict";

  var PAGE_W = 612, PAGE_H = 792, MARGIN = 54;           // US Letter, 3/4 inch margins
  var CONTENT_W = PAGE_W - MARGIN * 2;
  var INK = "0.17 0.13 0.2", SOFT = "0.36 0.32 0.4", ACCENT = "0.42 0.31 0.56", LINE = "0.89 0.85 0.78";

  /* ---------- text encoding ---------- */

  var WINANSI = {
    "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "–": 0x96, "—": 0x97,
    "…": 0x85, "•": 0x95, "€": 0x80, "™": 0x99, " ": 0x20
  };

  function toWinAnsi(str) {
    var out = [];
    for (var i = 0; i < str.length; i++) {
      var ch = str[i], code = str.charCodeAt(i);
      if (WINANSI[ch] !== undefined) out.push(WINANSI[ch]);
      else if (code === 0x0A || code === 0x0D || code === 0x09) out.push(0x20);
      else if ((code >= 0x20 && code < 0x7F) || (code >= 0xA0 && code <= 0xFF)) out.push(code);
      else if (code >= 0xD800 && code <= 0xDBFF) { out.push(0x3F); i++; } // surrogate pair (emoji) -> ?
      else out.push(0x3F);
    }
    return out;
  }

  // PDF literal string: (escaped bytes)
  function pdfString(str) {
    var out = [0x28];
    toWinAnsi(str).forEach(function (b) {
      if (b === 0x28 || b === 0x29 || b === 0x5C) out.push(0x5C);
      out.push(b);
    });
    out.push(0x29);
    return out;
  }

  function ascii(str) {
    var out = [];
    for (var i = 0; i < str.length; i++) out.push(str.charCodeAt(i) & 0xFF);
    return out;
  }

  /* ---------- measuring and wrapping ---------- */

  var canvas = document.createElement("canvas");
  var ctx = canvas.getContext("2d");

  function textWidth(text, size, bold) {
    ctx.font = (bold ? "bold " : "") + size + "px Arial, Helvetica, 'Liberation Sans', sans-serif";
    return ctx.measureText(text).width * 1.03; // small safety margin for metric differences
  }

  function wrap(text, size, bold, maxWidth) {
    var words = String(text).split(/\s+/).filter(Boolean), lines = [], line = "";
    words.forEach(function (word) {
      var candidate = line ? line + " " + word : word;
      if (!line || textWidth(candidate, size, bold) <= maxWidth) line = candidate;
      else { lines.push(line); line = word; }
    });
    if (line) lines.push(line);
    return lines;
  }

  /* ---------- JPEG header ---------- */

  function jpegInfo(bytes) {
    if (bytes.length < 4 || bytes[0] !== 0xFF || bytes[1] !== 0xD8) return null;
    var i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xFF) { i++; continue; }
      var marker = bytes[i + 1];
      if (marker === 0xFF) { i++; continue; }                       // fill byte
      if (marker === 0xD8 || (marker >= 0xD0 && marker <= 0xD7) || marker === 0x01) { i += 2; continue; }
      var len = (bytes[i + 2] << 8) | bytes[i + 3];
      var isSof = marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC;
      if (isSof) {
        return {
          height: (bytes[i + 5] << 8) | bytes[i + 6],
          width: (bytes[i + 7] << 8) | bytes[i + 8],
          components: bytes[i + 9]
        };
      }
      i += 2 + len;
    }
    return null;
  }

  /* ---------- minimal PDF writer ---------- */

  function PdfWriter() {
    this.objects = []; // index = object number - 1; each is an array of byte arrays
  }

  PdfWriter.prototype.reserve = function () {
    this.objects.push(null);
    return this.objects.length;
  };

  PdfWriter.prototype.set = function (num, parts) {
    this.objects[num - 1] = parts;
  };

  PdfWriter.prototype.add = function (parts) {
    var num = this.reserve();
    this.set(num, parts);
    return num;
  };

  PdfWriter.prototype.stream = function (dict, bytes) {
    return [ascii("<< " + dict + " /Length " + bytes.length + " >>\nstream\n"), bytes, ascii("\nendstream")];
  };

  PdfWriter.prototype.toBytes = function (rootNum, infoNum) {
    var chunks = [], offsets = [], length = 0;
    function push(part) {
      var arr = part instanceof Uint8Array ? part : Uint8Array.from(part);
      chunks.push(arr);
      length += arr.length;
    }
    push(ascii("%PDF-1.4\n%âãÏÓ\n"));
    this.objects.forEach(function (parts, idx) {
      offsets.push(length);
      push(ascii((idx + 1) + " 0 obj\n"));
      (parts || [ascii("null")]).forEach(push);
      push(ascii("\nendobj\n"));
    });
    var xrefOffset = length;
    var xref = "xref\n0 " + (this.objects.length + 1) + "\n0000000000 65535 f \n";
    offsets.forEach(function (o) { xref += ("0000000000" + o).slice(-10) + " 00000 n \n"; });
    xref += "trailer\n<< /Size " + (this.objects.length + 1) + " /Root " + rootNum + " 0 R" +
      (infoNum ? " /Info " + infoNum + " 0 R" : "") + " >>\nstartxref\n" + xrefOffset + "\n%%EOF\n";
    push(ascii(xref));

    var out = new Uint8Array(length), pos = 0;
    chunks.forEach(function (c) { out.set(c, pos); pos += c.length; });
    return out;
  };

  /* ---------- page content helpers ---------- */

  function Page() {
    this.ops = [];       // byte arrays
    this.images = {};    // name -> object number
    this.links = [];     // { rect: [x1,y1,x2,y2], url }
  }

  Page.prototype.text = function (str, x, y, size, bold, color) {
    this.ops.push(ascii("BT " + color + " rg /" + (bold ? "F2" : "F1") + " " + size + " Tf " +
      fmt(x) + " " + fmt(y) + " Td "));
    this.ops.push(pdfString(str));
    this.ops.push(ascii(" Tj ET\n"));
  };

  Page.prototype.lines = function (lines, x, y, size, lineHeight, bold, color) {
    for (var i = 0; i < lines.length; i++) this.text(lines[i], x, y - size - i * lineHeight, size, bold, color);
    return lines.length * lineHeight;
  };

  Page.prototype.rule = function (x1, y, x2) {
    this.ops.push(ascii(LINE + " RG 0.75 w " + fmt(x1) + " " + fmt(y) + " m " + fmt(x2) + " " + fmt(y) + " l S\n"));
  };

  Page.prototype.image = function (name, x, y, w, h) {
    this.ops.push(ascii("q " + fmt(w) + " 0 0 " + fmt(h) + " " + fmt(x) + " " + fmt(y) + " cm /" + name + " Do Q\n"));
  };

  function fmt(n) { return (Math.round(n * 100) / 100).toString(); }

  /* ---------- fetching images ---------- */

  function loadImage(url) {
    if (!url) return Promise.resolve(null);
    return fetch(url, { mode: "cors" }).then(function (res) {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.arrayBuffer();
    }).then(function (buf) {
      var bytes = new Uint8Array(buf);
      var info = jpegInfo(bytes);
      if (!info || !info.width || !info.height) throw new Error("not a JPEG");
      return { bytes: bytes, width: info.width, height: info.height, components: info.components };
    }).catch(function () {
      return null; // the PDF still works without the picture
    });
  }

  /* ---------- layout ---------- */

  function build(reading) {
    var cards = reading.cards || [];
    return Promise.all(cards.map(function (c) { return loadImage(c.imageUrl); })).then(function (images) {
      var pdf = new PdfWriter();
      var catalogNum = pdf.reserve();
      var pagesNum = pdf.reserve();
      var fontRegular = pdf.add([ascii("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>")]);
      var fontBold = pdf.add([ascii("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>")]);
      var infoNum = pdf.add([
        ascii("<< /Title "), pdfString((reading.title || "Marketing Tarot") + ": " + (reading.question || "")),
        ascii(" /Producer (Marketing Tarot widget) /CreationDate (D:" + dateStamp() + ") >>")
      ]);

      var imageNums = images.map(function (img, i) {
        if (!img) return null;
        var cs = img.components === 1 ? "/DeviceGray" : img.components === 4 ? "/DeviceCMYK" : "/DeviceRGB";
        var dict = "/Type /XObject /Subtype /Image /Width " + img.width + " /Height " + img.height +
          " /ColorSpace " + cs + " /BitsPerComponent 8 /Filter /DCTDecode";
        return pdf.add(pdf.stream(dict, img.bytes));
      });

      var pages = [];
      var page = null, y = 0;
      var top = PAGE_H - MARGIN, bottom = MARGIN;

      function newPage() {
        page = new Page();
        pages.push(page);
        y = top;
      }
      newPage();

      // Header
      page.text(reading.title || "Marketing Tarot", MARGIN, y - 22, 22, true, INK);
      y -= 34;
      var qLines = wrap(reading.question || "", 15, false, CONTENT_W);
      y -= page.lines(qLines, MARGIN, y, 15, 19, false, INK) + 2;
      if (reading.hint) {
        y -= page.lines(wrap(reading.hint, 10, false, CONTENT_W), MARGIN, y, 10, 13, false, SOFT);
      }
      y -= 12;

      // Cards
      var IMG_W = 96, GAP = 16;
      cards.forEach(function (card, i) {
        var img = images[i];
        var imgH = img ? IMG_W * img.height / img.width : 0;
        var textX = img ? MARGIN + IMG_W + GAP : MARGIN;
        var textW = CONTENT_W - (textX - MARGIN);

        var posLines = wrap((i + 1) + ". " + card.position, 10, true, textW);
        var nameLines = wrap(card.name, 14, true, textW);
        var classicLines = wrap("Classic meaning: " + card.classic, 10, false, textW);
        var meaningLines = wrap(card.marketing, 11, false, textW);
        var textH = posLines.length * 13 + 4 + nameLines.length * 18 + 2 + classicLines.length * 13 + 6 + meaningLines.length * 15;
        var blockH = Math.max(imgH, textH);

        if (y - blockH < bottom + 40 && y !== top) newPage();
        if (i > 0 && y !== top) { page.rule(MARGIN, y + 2, MARGIN + CONTENT_W); }
        var blockTop = y - 10;

        if (img) {
          var name = "Im" + i;
          page.images[name] = imageNums[i];
          page.image(name, MARGIN, blockTop - imgH, IMG_W, imgH);
        }
        var ty = blockTop;
        ty -= page.lines(posLines, textX, ty, 10, 13, true, ACCENT) + 4;
        ty -= page.lines(nameLines, textX, ty, 14, 18, true, INK) + 2;
        ty -= page.lines(classicLines, textX, ty, 10, 13, false, SOFT) + 6;
        ty -= page.lines(meaningLines, textX, ty, 11, 15, false, INK);

        y = blockTop - blockH - 14;
      });

      // Footer: Kelly's line, with the Services link, then an image credit.
      var footerLines = wrap(reading.footer || "", 10, false, CONTENT_W);
      var creditLines = wrap("Card images: " + (reading.deckLabel || "the classic 1909 tarot") + ".", 9, false, CONTENT_W);
      var footerH = footerLines.length * 13 + (reading.servicesUrl ? 14 : 0) + creditLines.length * 12 + 10;
      if (y - footerH < bottom) newPage();
      var fy = y; // directly under the last card
      page.rule(MARGIN, fy, MARGIN + CONTENT_W);
      fy -= 8;
      fy -= page.lines(footerLines, MARGIN, fy, 10, 13, false, SOFT);
      if (reading.servicesUrl) {
        var linkText = reading.servicesUrl.replace(/^https?:\/\//, "");
        var lw = textWidth(linkText, 10, false);
        page.text(linkText, MARGIN, fy - 10, 10, false, ACCENT);
        page.links.push({ rect: [MARGIN, fy - 13, MARGIN + lw, fy], url: reading.servicesUrl });
        fy -= 14;
      }
      fy -= 4;
      page.lines(creditLines, MARGIN, fy, 9, 12, false, SOFT);

      // Emit pages
      var pageNums = pages.map(function (p) {
        var content = [];
        p.ops.forEach(function (op) { content = content.concat(Array.from(op)); });
        var contentNum = pdf.add(pdf.stream("", Uint8Array.from(content)));
        var xobjects = Object.keys(p.images).map(function (n) { return "/" + n + " " + p.images[n] + " 0 R"; }).join(" ");
        var annots = p.links.map(function (l) {
          return pdf.add([ascii("<< /Type /Annot /Subtype /Link /Border [0 0 0] /Rect [" + l.rect.map(fmt).join(" ") +
            "] /A << /S /URI /URI "), pdfString(l.url), ascii(" >> >>")]);
        });
        return pdf.add([ascii("<< /Type /Page /Parent " + pagesNum + " 0 R /MediaBox [0 0 " + PAGE_W + " " + PAGE_H + "]" +
          " /Resources << /Font << /F1 " + fontRegular + " 0 R /F2 " + fontBold + " 0 R >>" +
          (xobjects ? " /XObject << " + xobjects + " >>" : "") + " >>" +
          " /Contents " + contentNum + " 0 R" +
          (annots.length ? " /Annots [" + annots.map(function (n) { return n + " 0 R"; }).join(" ") + "]" : "") + " >>")]);
      });

      pdf.set(pagesNum, [ascii("<< /Type /Pages /Count " + pageNums.length + " /Kids [" +
        pageNums.map(function (n) { return n + " 0 R"; }).join(" ") + "] >>")]);
      pdf.set(catalogNum, [ascii("<< /Type /Catalog /Pages " + pagesNum + " 0 R >>")]);

      return new Blob([pdf.toBytes(catalogNum, infoNum)], { type: "application/pdf" });
    });
  }

  function dateStamp() {
    var d = new Date(), p = function (n) { return (n < 10 ? "0" : "") + n; };
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
  }

  window.MarketingTarotPdf = { build: build, _wrap: wrap, _jpegInfo: jpegInfo };
})();
