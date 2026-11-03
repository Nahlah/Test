/* قراءة ملفات PDF داخل المتصفح عبر pdf.js بما يحاكي مكتبتي الأداة الأصلية:
 * - PyMuPDF "words": كلمات بحروفها المنطقية ومواضعها البصرية.
 * - pdfplumber find_tables (استراتيجية الخطوط) لاستخراج حدود الخلايا.
 * - pdfplumber extract_text (ترتيب بصري للحروف كما في الأصل).
 * ثم core/pdf_source_reader.py منقولًا كما هو.
 */
"use strict";

const PDFText = (() => {
  const { re, strip } = PY;
  const AR_CHAR = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;
  const LTR_CHAR = /[A-Za-z0-9\u00C0-\u024F\u0660-\u0669\u06F0-\u06F9]/;

  function lib() {
    if (typeof pdfjsLib === "undefined") throw new Error("مكتبة قراءة PDF غير متاحة في هذه النسخة.");
    return pdfjsLib;
  }

  // ---------------------------------------------------------------- bidi helpers
  function charClass(ch) {
    if (/[0-9\u0660-\u0669\u06F0-\u06F9]/.test(ch)) return "L";
    if (AR_CHAR.test(ch)) return "R";
    if (LTR_CHAR.test(ch) || /\p{L}/u.test(ch)) return "L";
    return "N";
  }
  // Split a logical-order RTL string into runs [{dir, start, end}] (char indexes).
  function rtlRuns(chars) {
    const cls = chars.map(charClass);
    // neutrals between two L take L, otherwise R
    for (let i = 0; i < cls.length; i++) {
      if (cls[i] !== "N") continue;
      let j = i;
      while (j < cls.length && cls[j] === "N") j++;
      let prev = i - 1;
      while (prev >= 0 && cls[prev] === "N") prev--;
      const left = prev >= 0 ? cls[prev] : "R";
      const right = j < cls.length ? cls[j] : "R";
      const d = left === "L" && right === "L" ? "L" : "R";
      for (let k = i; k < j; k++) cls[k] = d;
      i = j - 1;
    }
    const runs = [];
    for (let i = 0; i < cls.length; i++) {
      if (runs.length && runs[runs.length - 1].dir === cls[i]) runs[runs.length - 1].end = i + 1;
      else runs.push({ dir: cls[i], start: i, end: i + 1 });
    }
    return runs;
  }
  // visual (left-to-right) string for an item drawn right-to-left
  function visualString(str, dir) {
    const chars = Array.from(str);
    if (dir !== "rtl") return str;
    const runs = rtlRuns(chars);
    let out = "";
    for (let r = runs.length - 1; r >= 0; r--) {
      const seg = chars.slice(runs[r].start, runs[r].end);
      out += (runs[r].dir === "R" ? seg.reverse() : seg).join("");
    }
    return out;
  }
  // visual x-offset (from the item's left edge, in chars) of each logical char
  function visualOffsets(chars, dir) {
    const n = chars.length;
    const pos = new Array(n);
    if (dir !== "rtl") {
      for (let i = 0; i < n; i++) pos[i] = i;
      return pos;
    }
    const runs = rtlRuns(chars);
    for (const run of runs) {
      for (let i = run.start; i < run.end; i++) {
        if (run.dir === "R") pos[i] = n - 1 - i;
        else pos[i] = (n - run.end) + (i - run.start);
      }
    }
    return pos;
  }

  // ---------------------------------------------------------------- page extraction
  async function openDocument(file) {
    if (!file._pdfDoc) {
      const pdfjs = lib();
      const data = file.bytes instanceof Uint8Array ? file.bytes.slice() : new Uint8Array(file.bytes);
      file._pdfDoc = pdfjs.getDocument({ data, isEvalSupported: false, useSystemFonts: false }).promise;
    }
    return file._pdfDoc;
  }

  // ---------------------------------------------------------------- glyph-level extraction
  // Simulates the PDF text state over pdf.js' operator list to get every glyph with its
  // device position (like pdfminer / MuPDF do), and collects vector edges in the same pass.
  const LTR_GLYPH = /[A-Za-z0-9٠-٩۰-۹]/;
  function isNeutral(ch) {
    return !AR_CHAR.test(ch) && !LTR_GLYPH.test(ch) && !/\p{L}/u.test(ch);
  }
  function groupLines(glyphs, tol) {
    const lines = [];
    for (const g of glyphs.slice().sort((a, b) => a.base - b.base || a.x0 - b.x0)) {
      let line = null;
      for (const l of lines) if (Math.abs(l.base - g.base) <= tol(g)) { line = l; break; }
      if (!line) { line = { base: g.base, glyphs: [] }; lines.push(line); }
      line.glyphs.push(g);
    }
    return lines;
  }
  function glyphWords(glyphs) {
    // Like MuPDF: words are built in drawing order; a new word starts at a space, a jump in
    // position, or a change of baseline.  Overlapping texts therefore never get interleaved.
    const raw = [];
    let cur = [];
    let prev = null;
    const flush = () => {
      if (cur.length) raw.push(cur);
      cur = [];
    };
    for (const g of glyphs) {
      if (!strip(g.ch)) { flush(); prev = null; continue; }
      if (prev) {
        const tol = Math.max(prev.size, g.size) * 0.15; // MuPDF SPACE_DIST
        const sameLine = Math.abs(prev.base - g.base) <= Math.max(1.0, g.size * 0.2);
        const adjacent = Math.abs(g.x0 - prev.x1) <= tol || Math.abs(prev.x0 - g.x1) <= tol;
        if (!sameLine || !adjacent) flush();
      }
      cur.push(g);
      prev = g;
    }
    flush();
    // right-to-left context per visual line (needed for words made only of digits/punctuation)
    const lines = [];
    for (const w of raw) {
      const base = w[0].base, size = w[0].size;
      let line = null;
      for (const l of lines) if (Math.abs(l.base - base) <= Math.max(1.0, size * 0.2)) { line = l; break; }
      if (!line) { line = { base, words: [], ar: 0, all: 0 }; lines.push(line); }
      line.words.push(w);
      for (const g of w) { line.all++; if (AR_CHAR.test(g.ch)) line.ar++; }
    }
    const out = [];
    for (const line of lines) {
      const arabicLine = line.ar * 4 >= line.all;
      for (const w of line.words) out.push(makeWord(w.slice().sort((x, y) => x.x0 - y.x0), arabicLine));
    }
    return out;
  }
  function makeWord(gs, arabicLine) {
    // gs are in visual (left-to-right) order; produce the logical text.
    const hasAr = gs.some((g) => AR_CHAR.test(g.ch));
    let order;
    if (hasAr) {
      const cls = gs.map((g) => (AR_CHAR.test(g.ch) ? "R" : (LTR_GLYPH.test(g.ch) ? "L" : "N")));
      for (let i = 0; i < cls.length; i++) {
        if (cls[i] !== "N") continue;
        let l = "R", r = "R";
        for (let k = i - 1; k >= 0; k--) if (cls[k] !== "N") { l = cls[k]; break; }
        for (let k = i + 1; k < cls.length; k++) if (cls[k] !== "N") { r = cls[k]; break; }
        cls[i] = l === "L" && r === "L" ? "L" : "R";
      }
      const runs = [];
      cls.forEach((c, i) => {
        if (runs.length && runs[runs.length - 1].c === c) runs[runs.length - 1].items.push(gs[i]);
        else runs.push({ c, items: [gs[i]] });
      });
      order = [];
      for (let r = runs.length - 1; r >= 0; r--) order.push(...(runs[r].c === "R" ? runs[r].items.slice().reverse() : runs[r].items));
    } else if (arabicLine) {
      // e.g. "1." is drawn as "." then "1" inside right-to-left text
      let k = 0;
      while (k < gs.length && isNeutral(gs[k].ch)) k++;
      let e = gs.length;
      while (e > k && isNeutral(gs[e - 1].ch)) e--;
      order = gs.slice(k, e).concat(gs.slice(e).reverse(), gs.slice(0, k).reverse());
    } else order = gs;
    const text = order.map((g) => g.ch).join("").normalize("NFKC");
    let x0 = Infinity, x1 = -Infinity, size = 0;
    for (const g of gs) { x0 = Math.min(x0, g.x0); x1 = Math.max(x1, g.x1); size = Math.max(size, g.size); }
    const base = gs[0].base;
    return [x0, base - 0.9 * size, x1, base + 0.25 * size, text];
  }

  async function pageData(file) {
    if (file._pdfPages) return file._pdfPages;
    const doc = await openDocument(file);
    const pages = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const vp = page.getViewport({ scale: 1 });
      let scan = { glyphs: [], edges: [] };
      try {
        scan = await scanOperators(page, vp);
      } catch (e) {
        scan = { glyphs: [], edges: [] };
      }
      pages.push({ width: vp.width, height: vp.height, glyphs: scan.glyphs, words: glyphWords(scan.glyphs), edges: scan.edges });
      page.cleanup();
    }
    file._pdfPages = pages;
    return pages;
  }

  async function scanOperators(page, vp) {
    const pdfjs = lib();
    const OPS = pdfjs.OPS;
    const ol = await page.getOperatorList();
    const mul = (m, n) => [
      m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
      m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
      m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
    ];
    const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
    let ctm = vp.transform.slice();
    const stack = [];
    let tm = [1, 0, 0, 1, 0, 0], tlm = [1, 0, 0, 1, 0, 0];
    let font = null, fontSize = 0, charSpacing = 0, wordSpacing = 0, hScale = 1, leading = 0, rise = 0;
    const tstack = [];
    const glyphs = [];
    const fontCache = new Map();
    const getFont = (id) => {
      if (!fontCache.has(id)) {
        let f = null;
        try {
          if (page.commonObjs.has(id)) f = page.commonObjs.get(id);
          else if (page.objs.has(id)) f = page.objs.get(id);
        } catch (e) { f = null; }
        fontCache.set(id, f);
      }
      return fontCache.get(id);
    };
    let pending = [];
    const edges = [];
    const pt = (x, y) => apply(ctm, x, y);
    const addSeg = (a, b, type) => pending.push([a, b, type]);
    const commit = () => {
      for (const [a, b, type] of pending) {
        const x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]);
        const top = Math.min(a[1], b[1]), bottom = Math.max(a[1], b[1]);
        let orientation = null;
        if (Math.abs(a[0] - b[0]) < 1e-6) orientation = "v";
        else if (Math.abs(a[1] - b[1]) < 1e-6) orientation = "h";
        if (!orientation) continue;
        if (orientation === "v") edges.push({ x0, x1: x0, top, bottom, width: 0, height: bottom - top, orientation, object_type: type });
        else edges.push({ x0, x1, top, bottom: top, width: x1 - x0, height: 0, orientation, object_type: type });
      }
      pending = [];
    };
    const paintOps = new Set([OPS.stroke, OPS.closeStroke, OPS.fill, OPS.eoFill, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke]);
    const moveText = (tx, ty) => { tlm = mul(tlm, [1, 0, 0, 1, tx, ty]); tm = tlm.slice(); };
    for (let i = 0; i < ol.fnArray.length; i++) {
      const fn = ol.fnArray[i];
      const args = ol.argsArray[i];
      switch (fn) {
        case OPS.save: stack.push(ctm.slice()); tstack.push([font, fontSize, charSpacing, wordSpacing, hScale, leading, rise]); break;
        case OPS.restore:
          if (stack.length) ctm = stack.pop();
          if (tstack.length) [font, fontSize, charSpacing, wordSpacing, hScale, leading, rise] = tstack.pop();
          break;
        case OPS.transform: ctm = mul(ctm, args); break;
        case OPS.paintFormXObjectBegin:
          stack.push(ctm.slice());
          if (args && args[0] && args[0].length === 6) ctm = mul(ctm, args[0]);
          break;
        case OPS.paintFormXObjectEnd: if (stack.length) ctm = stack.pop(); break;
        case OPS.beginText: tm = [1, 0, 0, 1, 0, 0]; tlm = [1, 0, 0, 1, 0, 0]; break;
        case OPS.setFont: font = getFont(args[0]); fontSize = args[1]; break;
        case OPS.setTextMatrix: tlm = Array.from(args).slice(0, 6); tm = tlm.slice(); break;
        case OPS.moveText: moveText(args[0], args[1]); break;
        case OPS.setLeadingMoveText: leading = -args[1]; moveText(args[0], args[1]); break;
        case OPS.nextLine: moveText(0, -leading); break;
        case OPS.setLeading: leading = args[0]; break;
        case OPS.setCharSpacing: charSpacing = args[0]; break;
        case OPS.setWordSpacing: wordSpacing = args[0]; break;
        case OPS.setHScale: hScale = args[0] / 100; break;
        case OPS.setTextRise: rise = args[0]; break;
        case OPS.showText: {
          const fm = (font && font.fontMatrix) || [0.001, 0, 0, 0.001, 0, 0];
          const vertical = !!(font && font.vertical);
          for (const g of args[0] || []) {
            if (typeof g === "number") {
              tm = mul(tm, [1, 0, 0, 1, (-g / 1000) * fontSize * hScale, 0]);
              continue;
            }
            if (!g) continue;
            const w = (g.width || 0) * fm[0] * fontSize;
            const spacing = charSpacing + (g.isSpace ? wordSpacing : 0);
            if (!vertical) {
              const m = mul(ctm, tm);
              const a = apply(m, 0, rise), b = apply(m, w * hScale, rise);
              const scale = Math.hypot(m[2], m[3]) || 1;
              const ch = g.unicode || "";
              if (ch) glyphs.push({ ch, x0: Math.min(a[0], b[0]), x1: Math.max(a[0], b[0]), base: a[1], size: Math.abs(fontSize * scale) });
            }
            tm = mul(tm, [1, 0, 0, 1, (w + spacing) * hScale, 0]);
          }
          break;
        }
        case OPS.constructPath: {
          const ops = args[0], coords = args[1];
          let k = 0, start = null, cur = null;
          for (const op of ops) {
            if (op === OPS.moveTo) { cur = pt(coords[k], coords[k + 1]); start = cur; k += 2; }
            else if (op === OPS.lineTo) { const q = pt(coords[k], coords[k + 1]); if (cur) addSeg(cur, q, "line"); cur = q; k += 2; }
            else if (op === OPS.curveTo) { cur = pt(coords[k + 4], coords[k + 5]); k += 6; }
            else if (op === OPS.curveTo2 || op === OPS.curveTo3) { cur = pt(coords[k + 2], coords[k + 3]); k += 4; }
            else if (op === OPS.closePath) { if (cur && start) addSeg(cur, start, "line"); cur = start; }
            else if (op === OPS.rectangle) {
              const x = coords[k], y = coords[k + 1], w = coords[k + 2], h = coords[k + 3];
              const a = pt(x, y), b = pt(x + w, y), c = pt(x + w, y + h), d = pt(x, y + h);
              addSeg(a, b, "rect_edge"); addSeg(b, c, "rect_edge"); addSeg(c, d, "rect_edge"); addSeg(d, a, "rect_edge");
              start = a; cur = a;
              k += 4;
            }
          }
          break;
        }
        case OPS.endPath: pending = []; break;
        default:
          if (paintOps.has(fn)) commit();
      }
    }
    return { glyphs, edges };
  }

  // ---------------------------------------------------------------- pdfplumber TableFinder (lines strategy)
  function clusterList(xs, tol) {
    const s = xs.slice().sort((a, b) => a - b);
    if (tol === 0 || s.length < 2) return s.map((x) => [x]);
    const groups = [];
    let cur = [s[0]];
    let last = s[0];
    for (const x of s.slice(1)) {
      if (x <= last + tol) cur.push(x);
      else { groups.push(cur); cur = [x]; }
      last = x;
    }
    groups.push(cur);
    return groups;
  }
  function clusterObjects(objs, key, tol) {
    const vals = Array.from(new Set(objs.map(key)));
    const clusters = clusterList(vals, tol);
    const idx = new Map();
    clusters.forEach((c, i) => c.forEach((v) => idx.set(v, i)));
    const tagged = objs.map((o, n) => [o, idx.get(key(o)), n]).sort((a, b) => a[1] - b[1] || a[2] - b[2]);
    const out = [];
    for (const [o, ci] of tagged) {
      if (!out.length || out[out.length - 1].ci !== ci) out.push({ ci, list: [] });
      out[out.length - 1].list.push(o);
    }
    return out.map((g) => g.list);
  }
  function snapObjects(objs, attr, tol) {
    const clusters = clusterObjects(objs, (o) => o[attr], tol);
    const out = [];
    for (const cl of clusters) {
      const avg = cl.reduce((s, o) => s + o[attr], 0) / cl.length;
      for (const o of cl) {
        const d = avg - o[attr];
        const n = Object.assign({}, o);
        if (attr === "x0") { n.x0 += d; n.x1 += d; } else { n.top += d; n.bottom += d; }
        out.push(n);
      }
    }
    return out;
  }
  function mergeEdges(edges, snapTol, joinTol) {
    const v = snapObjects(edges.filter((e) => e.orientation === "v"), "x0", snapTol);
    const h = snapObjects(edges.filter((e) => e.orientation === "h"), "top", snapTol);
    const all = v.concat(h);
    const key = (e) => (e.orientation === "h" ? ["h", e.top] : ["v", e.x0]);
    all.sort((a, b) => {
      const ka = key(a), kb = key(b);
      return ka[0] < kb[0] ? -1 : ka[0] > kb[0] ? 1 : ka[1] - kb[1];
    });
    const out = [];
    let i = 0;
    while (i < all.length) {
      const k = key(all[i]);
      let j = i;
      while (j < all.length && key(all[j])[0] === k[0] && key(all[j])[1] === k[1]) j++;
      const group = all.slice(i, j);
      const [minP, maxP] = k[0] === "h" ? ["x0", "x1"] : ["top", "bottom"];
      const sorted = group.slice().sort((a, b) => a[minP] - b[minP]);
      const joined = [Object.assign({}, sorted[0])];
      for (const e of sorted.slice(1)) {
        const last = joined[joined.length - 1];
        if (e[minP] <= last[maxP] + joinTol) {
          if (e[maxP] > last[maxP]) {
            last[maxP] = e[maxP];
            if (k[0] === "h") last.width = last.x1 - last.x0;
            else last.height = last.bottom - last.top;
          }
        } else joined.push(Object.assign({}, e));
      }
      out.push(...joined);
      i = j;
    }
    return out;
  }
  function filterEdges(edges, orientation, minLength) {
    return edges.filter((e) => (orientation === null || e.orientation === orientation) &&
      (e.orientation === "v" ? e.height : e.width) >= minLength);
  }
  function findTables(page) {
    const base = filterEdges(page.edges, "v", 1).concat(filterEdges(page.edges, "h", 1));
    const edges = filterEdges(mergeEdges(base, 3, 3), null, 3);
    const v_edges = edges.filter((e) => e.orientation === "v").sort((a, b) => a.x0 - b.x0 || a.top - b.top);
    const h_edges = edges.filter((e) => e.orientation === "h").sort((a, b) => a.top - b.top || a.x0 - b.x0);
    const inter = new Map();
    const pkey = (x, y) => x + "," + y;
    for (const v of v_edges) {
      for (const h of h_edges) {
        if (v.top <= h.top + 3 && v.bottom >= h.top - 3 && v.x0 >= h.x0 - 3 && v.x0 <= h.x1 + 3) {
          const k = pkey(v.x0, h.top);
          if (!inter.has(k)) inter.set(k, { pt: [v.x0, h.top], v: [], h: [] });
          inter.get(k).v.push(v);
          inter.get(k).h.push(h);
        }
      }
    }
    const bboxKey = (e) => [e.x0, e.top, e.x1, e.bottom].join(",");
    const connects = (p1, p2) => {
      const a = inter.get(pkey(p1[0], p1[1])), b = inter.get(pkey(p2[0], p2[1]));
      if (p1[0] === p2[0]) {
        const s = new Set(a.v.map(bboxKey));
        if (b.v.some((e) => s.has(bboxKey(e)))) return true;
      }
      if (p1[1] === p2[1]) {
        const s = new Set(a.h.map(bboxKey));
        if (b.h.some((e) => s.has(bboxKey(e)))) return true;
      }
      return false;
    };
    const points = Array.from(inter.values()).map((o) => o.pt).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cells = [];
    for (let i = 0; i < points.length - 1; i++) {
      const pt0 = points[i];
      const rest = points.slice(i + 1);
      const below = rest.filter((x) => x[0] === pt0[0]);
      const right = rest.filter((x) => x[1] === pt0[1]);
      let found = null;
      outer: for (const bp of below) {
        if (!connects(pt0, bp)) continue;
        for (const rp of right) {
          if (!connects(pt0, rp)) continue;
          const br = [rp[0], bp[1]];
          if (inter.has(pkey(br[0], br[1])) && connects(br, rp) && connects(br, bp)) {
            found = [pt0[0], pt0[1], br[0], br[1]];
            break outer;
          }
        }
      }
      if (found) cells.push(found);
    }
    // cells_to_tables
    const corners = (c) => [[c[0], c[1]], [c[0], c[3]], [c[2], c[1]], [c[2], c[3]]].map((p) => p.join(","));
    let remaining = cells.slice();
    let curCorners = new Set();
    let curCells = [];
    const tables = [];
    while (remaining.length) {
      const initial = curCells.length;
      for (const cell of remaining.slice()) {
        const cc = corners(cell);
        if (!curCells.length || cc.some((c) => curCorners.has(c))) {
          cc.forEach((c) => curCorners.add(c));
          curCells.push(cell);
          remaining.splice(remaining.indexOf(cell), 1);
        }
      }
      if (curCells.length === initial) {
        tables.push(curCells.slice());
        curCorners = new Set();
        curCells = [];
      }
    }
    if (curCells.length) tables.push(curCells.slice());
    const minKey = (t) => t.reduce((m, c) => (c[1] < m[0] || (c[1] === m[0] && c[0] < m[1]) ? [c[1], c[0]] : m), [Infinity, Infinity]);
    const sorted = tables.slice().sort((a, b) => {
      const ka = minKey(a), kb = minKey(b);
      return ka[0] - kb[0] || ka[1] - kb[1];
    });
    return sorted.filter((t) => t.length > 1).map((t) => ({ cells: t, rows: tableRows(t) }));
  }
  function tableRows(cells) {
    const sorted = cells.slice().sort((a, b) => a[1] - b[1] || a[0] - b[0]);
    const xs = Array.from(new Set(cells.map((c) => c[0]))).sort((a, b) => a - b);
    const rows = [];
    let i = 0;
    while (i < sorted.length) {
      let j = i;
      while (j < sorted.length && sorted[j][1] === sorted[i][1]) j++;
      const xdict = new Map();
      for (const c of sorted.slice(i, j)) xdict.set(c[0], c);
      rows.push(xs.map((x) => (xdict.has(x) ? xdict.get(x) : null)));
      i = j;
    }
    return rows;
  }

  // ---------------------------------------------------------------- pdf_source_reader.py
  const AR = re.compile("[\\u0600-\\u06FF]");
  const LAT = re.compile("[A-Za-z]");

  function _cleanup(text) {
    let value = String(text || "");
    const repl = [
      ["االبتعاث", "الابتعاث"], ["االستقطاب", "الاستقطاب"], ["االربعاء", "الأربعاء"], ["االحد", "الأحد"],
      ["االثنين", "الإثنين"], ["االول", "الأول"], ["االولى", "الأولى"], ["االجراء", "الإجراء"], ["اإلجراء", "الإجراء"],
      ["االسم", "الاسم"], ["االعضاء", "الأعضاء"], ["االجتماع", "الاجتماع"], ["االكاديمي", "الأكاديمي"],
      ["حالُالم", "المُحال"], ["بلِق", "قِبل"], ["اوفقً", "وفقًا"], ["الدراس في الملحقية", "الدراسي في الملحقية"],
      ["اًثالث", "ثالثًا"], ["أوالا", "أولًا"], ["ثانياا", "ثانيًا"], ["رابعاا", "رابعًا"], ["خامساا", "خامسًا"],
      ["مبررات:الطلب", "مبررات الطلب:"], ["البيانات:التالية", "البيانات التالية:"], ["اًاستناد", "استنادًا"],
    ];
    for (const [a, b] of repl) value = value.split(a).join(b);
    value = re.sub("[ \\t]+", " ", value);
    value = re.sub("\\s+([،؛:.])", "\\1", value);
    value = re.sub("([(/])\\s+", "\\1", value);
    value = re.sub("\\s+([/)])", "\\1", value);
    value = re.sub("\\n{3,}", "\n\n", value);
    return strip(value);
  }

  function _group_words_by_y(words, tolerance = 3.2) {
    const groups = [];
    const sorted = words.slice().sort((a, b) => ((a[1] + a[3]) / 2 - (b[1] + b[3]) / 2) || a[0] - b[0]);
    for (const w of sorted) {
      const cy = (w[1] + w[3]) / 2;
      let best = null, bestDiff = null;
      for (const g of groups.slice(-6)) {
        const diff = Math.abs(g.y - cy);
        if (diff <= tolerance && (bestDiff === null || diff < bestDiff)) { best = g; bestDiff = diff; }
      }
      if (best === null) {
        best = { y: cy, words: [] };
        groups.push(best);
      } else {
        const n = best.words.length;
        best.y = (best.y * n + cy) / (n + 1);
      }
      best.words.push(w);
    }
    return groups.slice().sort((a, b) => a.y - b.y);
  }

  function _reconstruct_line(words) {
    if (!words.length) return "";
    const arabic_count = words.filter((w) => AR.search(String(w[4]))).length;
    const rtl = arabic_count >= Math.max(1, Math.trunc(words.length * 0.25));
    const ordered = words.slice().sort((a, b) => (rtl ? b[0] - a[0] : a[0] - b[0]));
    let tokens = ordered.map((w) => strip(String(w[4]))).filter((t) => t);
    if (rtl) {
      const out = [];
      let i = 0;
      while (i < tokens.length) {
        if (LAT.search(tokens[i])) {
          let j = i + 1;
          while (j < tokens.length && (LAT.search(tokens[j]) || ["-", ":", "(", ")"].includes(tokens[j]))) j++;
          out.push(...tokens.slice(i, j).reverse());
          i = j;
        } else {
          out.push(tokens[i]);
          i++;
        }
      }
      tokens = out;
    }
    return _cleanup(tokens.join(" "));
  }

  function _reconstruct_words(words) {
    const lines = [];
    for (const g of _group_words_by_y(words)) {
      const t = _reconstruct_line(g.words);
      if (t) lines.push(t);
    }
    return strip(lines.join("\n"));
  }

  function _words_in_bbox(words, bbox) {
    if (!bbox) return [];
    const [x0, top, x1, bottom] = bbox;
    return words.filter((w) => {
      const cx = (w[0] + w[2]) / 2, cy = (w[1] + w[3]) / 2;
      return x0 - 0.5 <= cx && cx <= x1 + 0.5 && top - 0.5 <= cy && cy <= bottom + 0.5;
    });
  }

  function _dedupe_table(matrix) {
    let rows = matrix.filter((r) => r.some((v) => strip(v ? String(v) : ""))).map((r) => Array.from(r));
    if (!rows.length) return [];
    const width = Math.max(...rows.map((r) => r.length));
    rows = rows.map((r) => r.concat(Array(width - r.length).fill("")));
    const keep = [];
    for (let c = 0; c < width; c++) if (rows.some((r) => strip(r[c] ? String(r[c]) : ""))) keep.push(c);
    if (!keep.length) return [];
    return rows.map((r) => keep.map((c) => strip(r[c] ? String(r[c]) : "")));
  }

  async function readPdfSource(file) {
    const pages = await pageData(file);
    const texts = [];
    let total = 0;
    for (const p of pages) {
      total += p.words.length;
      const t = _reconstruct_words(p.words);
      if (t) texts.push(t);
    }
    const text = _cleanup(texts.join("\n\n"));
    const tables = [];
    try {
      for (const p of pages) {
        for (const table of findTables(p)) {
          let matrix = table.rows.map((row) => row.map((cell) => (cell === null ? "" : _reconstruct_words(_words_in_bbox(p.words, cell)))));
          matrix = _dedupe_table(matrix);
          const filled = matrix.reduce((s, r) => s + r.filter((v) => v).length, 0);
          if (matrix.length && filled >= 2 && !tables.some((t) => PY.deepEqual(t, matrix))) tables.push(matrix);
        }
      }
    } catch (e) {
      // فشل استخراج الجداول لا يمنع قراءة النص.
    }
    const searchable = total >= Math.max(4, pages.length * 2) && PY.len(text) >= 20;
    return { text, tables, page_count: pages.length, searchable };
  }

  // PyMuPDF page.get_text("text", sort=True): lines top-to-bottom, words left-to-right.
  async function readSortedTextPages(file) {
    const pages = await pageData(file);
    return pages.map((p) => _group_words_by_y(p.words, 3.0)
      .map((g) => g.words.slice().sort((a, b) => a[0] - b[0]).map((w) => w[4]).join(" "))
      .join("\n"));
  }

  // pdfplumber page.extract_text(): characters in visual order (as the original tool received them).
  async function readPlumberText(file) {
    const pages = await pageData(file);
    const out = [];
    for (const p of pages) {
      const lines = groupLines(p.glyphs, () => 3).sort((a, b) => a.base - b.base);
      out.push(lines.map((l) => {
        let s = "";
        let prev = null;
        for (const g of l.glyphs.sort((a, b) => a.x0 - b.x0)) {
          if (prev && g.x0 - prev.x1 > 3 && !s.endsWith(" ")) s += " ";
          s += g.ch;
          prev = g;
        }
        return strip(PY.split(s).join(" "));
      }).filter((t) => t).join("\n"));
    }
    return out.join("\n");
  }

  return {
    readPdfSource, readSortedTextPages, readPlumberText, pageData, findTables,
    _cleanup, _group_words_by_y, _reconstruct_line, _reconstruct_words, _words_in_bbox, _dedupe_table,
    visualString, visualOffsets,
  };
})();
