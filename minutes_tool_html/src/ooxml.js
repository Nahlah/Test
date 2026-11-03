/* قراءة ملفات Word وكتابتها بنفس سلوك مكتبة python-docx المستخدمة في الأداة الأصلية.
 *
 * يُفك ملف docx (ZIP) ثم يُعالج XML مباشرة عبر DOM. الدوال هنا تحاكي ما تفعله
 * python-docx 1.2: قراءة نص الفقرة (w:r و w:hyperlink المباشرة فقط)، خلايا الصف
 * (تكرار الخلية المدمجة أفقيًا، والرجوع للخلية الأعلى في الدمج الرأسي)، وترتيب
 * عناصر الخصائص عند الإضافة.
 */
"use strict";

const OOXML = (() => {
  const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const PKG_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
  const CT_NS = "http://schemas.openxmlformats.org/package/2006/content-types";
  const XML_NS = "http://www.w3.org/XML/1998/namespace";
  const RT_OFFICE_DOCUMENT = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument";
  const RT_STYLES = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles";
  const CT_WML_MAIN = "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml";

  const PPR_SEQ = ["pStyle", "keepNext", "keepLines", "pageBreakBefore", "framePr", "widowControl", "numPr",
    "suppressLineNumbers", "pBdr", "shd", "tabs", "suppressAutoHyphens", "kinsoku", "wordWrap", "overflowPunct",
    "topLinePunct", "autoSpaceDE", "autoSpaceDN", "bidi", "adjustRightInd", "snapToGrid", "spacing", "ind",
    "contextualSpacing", "mirrorIndents", "suppressOverlap", "jc", "textDirection", "textAlignment",
    "textboxTightWrap", "outlineLvl", "divId", "cnfStyle", "rPr", "sectPr", "pPrChange"];
  const RPR_SEQ = ["rStyle", "rFonts", "b", "bCs", "i", "iCs", "caps", "smallCaps", "strike", "dstrike", "outline",
    "shadow", "emboss", "imprint", "noProof", "snapToGrid", "vanish", "webHidden", "color", "spacing", "w", "kern",
    "position", "sz", "szCs", "highlight", "u", "effect", "bdr", "shd", "fitText", "vertAlign", "rtl", "cs", "em",
    "lang", "eastAsianLayout", "specVanish", "oMath"];
  const TBLPR_SEQ = ["tblStyle", "tblpPr", "tblOverlap", "bidiVisual", "tblStyleRowBandSize", "tblStyleColBandSize",
    "tblW", "jc", "tblCellSpacing", "tblInd", "tblBorders", "shd", "tblLayout", "tblCellMar", "tblLook",
    "tblCaption", "tblDescription", "tblPrChange"];

  const utf8dec = new TextDecoder("utf-8");
  const utf8enc = new TextEncoder();

  // ---------------------------------------------------------------- element helpers
  function isW(el, local) {
    return !!el && el.nodeType === 1 && el.namespaceURI === W_NS && (local === undefined || el.localName === local);
  }
  function wChildren(el, local) {
    const out = [];
    for (let c = el.firstElementChild; c; c = c.nextElementSibling) if (isW(c, local)) out.push(c);
    return out;
  }
  function wFirst(el, local) {
    for (let c = el.firstElementChild; c; c = c.nextElementSibling) if (isW(c, local)) return c;
    return null;
  }
  function wAttr(el, local) {
    return el.hasAttributeNS(W_NS, local) ? el.getAttributeNS(W_NS, local) : null;
  }
  function setWAttr(el, local, val) {
    el.setAttributeNS(W_NS, "w:" + local, String(val));
  }
  function newW(doc, local) {
    return doc.createElementNS(W_NS, "w:" + local);
  }
  function xsdInt(v) {
    return PY.int(v);
  }
  // python-docx: insert_element_before(elm, *successors) — first child found for each
  // successor tag *in sequence order*, not in document order.
  function insertElementBefore(parent, el, successors) {
    let succ = null;
    for (const t of successors) {
      succ = wFirst(parent, t);
      if (succ) break;
    }
    if (succ) parent.insertBefore(el, succ);
    else parent.appendChild(el);
    return el;
  }
  function insertAt0(parent, el) {
    parent.insertBefore(el, parent.firstElementChild);
    return el;
  }
  function getOrAdd(parent, local, seq) {
    let c = wFirst(parent, local);
    if (!c) {
      c = newW(parent.ownerDocument, local);
      const ix = seq.indexOf(local);
      insertElementBefore(parent, c, seq.slice(ix + 1));
    }
    return c;
  }
  function getOrAddPPr(p) {
    let pPr = wFirst(p, "pPr");
    if (!pPr) pPr = insertAt0(p, newW(p.ownerDocument, "pPr"));
    return pPr;
  }
  function getOrAddRPr(r) {
    let rPr = wFirst(r, "rPr");
    if (!rPr) rPr = insertAt0(r, newW(r.ownerDocument, "rPr"));
    return rPr;
  }

  // ---------------------------------------------------------------- text (read)
  function runText(r) {
    let s = "";
    for (let c = r.firstElementChild; c; c = c.nextElementSibling) {
      if (c.namespaceURI !== W_NS) continue;
      switch (c.localName) {
        case "t": s += c.textContent; break;
        case "tab": case "ptab": s += "\t"; break;
        case "cr": s += "\n"; break;
        case "noBreakHyphen": s += "-"; break;
        case "br": {
          const t = wAttr(c, "type");
          if (t === null || t === "textWrapping") s += "\n";
          break;
        }
        default: break;
      }
    }
    return s;
  }
  function paragraphText(p) {
    let s = "";
    for (let c = p.firstElementChild; c; c = c.nextElementSibling) {
      if (isW(c, "r")) s += runText(c);
      else if (isW(c, "hyperlink")) for (const r of wChildren(c, "r")) s += runText(r);
    }
    return s;
  }

  // ---------------------------------------------------------------- tables
  function gridSpan(tc) {
    const tcPr = wFirst(tc, "tcPr");
    if (!tcPr) return 1;
    const gs = wFirst(tcPr, "gridSpan");
    if (!gs) return 1;
    return xsdInt(wAttr(gs, "val"));
  }
  function vMerge(tc) {
    const tcPr = wFirst(tc, "tcPr");
    if (!tcPr) return null;
    const vm = wFirst(tcPr, "vMerge");
    if (!vm) return null;
    const v = wAttr(vm, "val");
    return v === null ? "continue" : v;
  }
  function gridBefore(tr) {
    const trPr = wFirst(tr, "trPr");
    if (!trPr) return 0;
    const gb = wFirst(trPr, "gridBefore");
    if (!gb) return 0;
    return xsdInt(wAttr(gb, "val"));
  }
  function gridOffset(tc) {
    let off = gridBefore(tc.parentNode);
    for (let s = tc.previousElementSibling; s; s = s.previousElementSibling) if (isW(s, "tc")) off += gridSpan(s);
    return off;
  }
  function trAbove(tc) {
    for (let s = tc.parentNode.previousElementSibling; s; s = s.previousElementSibling) if (isW(s, "tr")) return s;
    throw new Error("no tr above topmost tr in w:tbl");
  }
  function tcAtGridOffset(tr, off) {
    let remaining = off - gridBefore(tr);
    for (const tc of wChildren(tr, "tc")) {
      if (remaining < 0) break;
      if (remaining === 0) return tc;
      remaining -= gridSpan(tc);
    }
    throw new Error("no `tc` element at grid_offset=" + off);
  }
  // python-docx 1.2 _Row.cells — returns w:tc elements (repeated for spans).
  function rowCells(tr) {
    const out = [];
    const iter = (tc) => {
      if (vMerge(tc) === "continue") {
        iter(tcAtGridOffset(trAbove(tc), gridOffset(tc)));
        return;
      }
      const n = gridSpan(tc);
      for (let i = 0; i < n; i++) out.push(tc);
    };
    for (const tc of wChildren(tr, "tc")) iter(tc);
    return out;
  }
  function tableRows(tbl) {
    return wChildren(tbl, "tr");
  }
  function cellParagraphs(tc) {
    return wChildren(tc, "p");
  }
  function cellTables(tc) {
    return wChildren(tc, "tbl");
  }
  // docx_struct.cell_text
  function cellText(tc) {
    const parts = [];
    for (let c = tc.firstElementChild; c; c = c.nextElementSibling) {
      if (isW(c, "p")) {
        const t = PY.strip(paragraphText(c));
        if (t) parts.push(t);
      } else if (isW(c, "tbl")) {
        const t = PY.strip(tablePlainText(c));
        if (t) parts.push(t);
      }
    }
    return PY.strip(parts.join("\n")).normalize("NFKC");
  }
  // docx_struct._table_plain_text
  function tablePlainText(tbl) {
    const lines = [];
    for (const tr of tableRows(tbl)) {
      const vals = [];
      const seen = new Set();
      for (const tc of rowCells(tr)) {
        if (seen.has(tc)) continue;
        seen.add(tc);
        const v = PY.strip(cellText(tc));
        if (v) vals.push(v);
      }
      if (vals.length) lines.push(vals.join(" | "));
    }
    return lines.join("\n");
  }
  function rowTexts(tr) {
    return rowCells(tr).map(cellText);
  }
  // python-docx _Cell.text
  function cellPlainText(tc) {
    return cellParagraphs(tc).map(paragraphText).join("\n");
  }
  function norm(text) {
    if (text === null || text === undefined) return "";
    return PY.re.sub("\\s+", "", text);
  }

  // ---------------------------------------------------------------- package
  function parseXml(bytes, name) {
    const text = typeof bytes === "string" ? bytes : utf8dec.decode(bytes);
    const doc = new DOMParser().parseFromString(text, "application/xml");
    if (!doc.documentElement || doc.getElementsByTagName("parsererror").length) {
      throw new Error("ملف XML غير صالح داخل المستند: " + (name || ""));
    }
    return doc;
  }
  function serializeXml(doc) {
    let s = new XMLSerializer().serializeToString(doc);
    s = s.replace(/^\s*<\?xml[^?]*\?>\s*/, "");
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' + s;
  }
  function posixJoin(base, rel) {
    if (rel.startsWith("/")) return rel.slice(1);
    const parts = base.split("/").filter(Boolean);
    for (const seg of rel.split("/")) {
      if (seg === "..") parts.pop();
      else if (seg && seg !== ".") parts.push(seg);
    }
    return parts.join("/");
  }
  function dirOf(path) {
    const i = path.lastIndexOf("/");
    return i < 0 ? "" : path.slice(0, i);
  }
  function relsPathFor(partPath) {
    const d = dirOf(partPath);
    const f = partPath.slice(d ? d.length + 1 : 0);
    return (d ? d + "/" : "") + "_rels/" + f + ".rels";
  }

  class DocxPackage {
    constructor(files, name) {
      this.files = files; // object: path -> Uint8Array (insertion order = zip order)
      this.name = name || "";
      this._xml = new Map();
      this._dirty = new Set();
      this._lower = new Map(Object.keys(files).map((k) => [k.toLowerCase(), k]));
    }
    static open(bytes, name) {
      let files;
      try {
        files = fflate.unzipSync(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
      } catch (e) {
        throw new Error("File is not a zip file");
      }
      const pkg = new DocxPackage(files, name);
      pkg._init();
      return pkg;
    }
    has(path) {
      return this._lower.has(path.toLowerCase());
    }
    _real(path) {
      return this._lower.get(path.toLowerCase());
    }
    xml(path) {
      const real = this._real(path);
      if (!real) return null;
      let d = this._xml.get(real);
      if (!d) {
        d = parseXml(this.files[real], real);
        this._xml.set(real, d);
      }
      return d;
    }
    markDirty(path) {
      this._dirty.add(this._real(path) || path);
    }
    rels(partPath) {
      const rp = relsPathFor(partPath);
      const doc = this.xml(rp);
      const out = new Map();
      if (!doc) return out;
      const base = dirOf(partPath);
      for (const rel of Array.from(doc.getElementsByTagNameNS(PKG_REL_NS, "Relationship"))) {
        const mode = rel.getAttribute("TargetMode");
        const target = rel.getAttribute("Target") || "";
        out.set(rel.getAttribute("Id"), {
          type: rel.getAttribute("Type"),
          target: mode === "External" ? target : posixJoin(base, target),
          external: mode === "External",
        });
      }
      return out;
    }
    contentType(partPath) {
      const ct = this.xml("[Content_Types].xml");
      if (!ct) return null;
      for (const o of Array.from(ct.getElementsByTagNameNS(CT_NS, "Override"))) {
        const pn = (o.getAttribute("PartName") || "").replace(/^\//, "");
        if (pn.toLowerCase() === partPath.toLowerCase()) return o.getAttribute("ContentType");
      }
      const ext = partPath.split(".").pop().toLowerCase();
      for (const d of Array.from(ct.getElementsByTagNameNS(CT_NS, "Default"))) {
        if ((d.getAttribute("Extension") || "").toLowerCase() === ext) return d.getAttribute("ContentType");
      }
      return null;
    }
    _init() {
      if (!this.has("[Content_Types].xml")) throw new Error("Package not found: [Content_Types].xml missing");
      let main = null;
      for (const [, r] of this.rels("")) {
        if (r.type === RT_OFFICE_DOCUMENT && !r.external) { main = r.target; break; }
      }
      if (!main || !this.has(main)) throw new Error("لم يتم العثور على المستند الرئيسي داخل ملف Word.");
      const ct = this.contentType(main);
      if (ct !== CT_WML_MAIN) {
        throw new Error(`file '${this.name}' is not a Word file, content type is '${ct}'`);
      }
      this.mainPath = this._real(main);
      this.doc = this.xml(this.mainPath);
      this.body = wFirst(this.doc.documentElement, "body");
      if (!this.body) throw new Error("document has no w:body");
      this._styles = undefined;
    }
    // python-docx DocumentPart.styles (only reading what the tool needs)
    stylesDoc() {
      if (this._styles !== undefined) return this._styles;
      this._styles = null;
      for (const [, r] of this.rels(this.mainPath)) {
        if (r.type === RT_STYLES && !r.external && this.has(r.target)) { this._styles = this.xml(r.target); break; }
      }
      return this._styles;
    }
    save() {
      const out = {};
      for (const k of Object.keys(this.files)) {
        if (this._dirty.has(k)) out[k] = utf8enc.encode(serializeXml(this._xml.get(k)));
        else out[k] = this.files[k];
      }
      return fflate.zipSync(out, { level: 6 });
    }
  }

  // ---------------------------------------------------------------- styles (python-docx semantics)
  function styleElements(stylesDoc) {
    if (!stylesDoc) return [];
    return wChildren(stylesDoc.documentElement, "style");
  }
  function onOff(v) {
    return v !== null && ["1", "true", "on"].includes(String(v).toLowerCase());
  }
  function defaultStyle(stylesDoc, type) {
    const c = styleElements(stylesDoc).filter((s) => wAttr(s, "type") === type && onOff(wAttr(s, "default")));
    return c.length ? c[c.length - 1] : null;
  }
  function styleById(stylesDoc, id) {
    return styleElements(stylesDoc).find((s) => wAttr(s, "styleId") === id) || null;
  }
  function styleByName(stylesDoc, name) {
    return styleElements(stylesDoc).find((s) => {
      const n = wFirst(s, "name");
      return n && wAttr(n, "val") === name;
    }) || null;
  }
  // Paragraph.style (getter) -> style element or null
  function paragraphStyle(pkg, p) {
    const sd = pkg.stylesDoc();
    const pPr = wFirst(p, "pPr");
    const ps = pPr ? wFirst(pPr, "pStyle") : null;
    const id = ps ? wAttr(ps, "val") : null;
    if (id === null) return defaultStyle(sd, "paragraph");
    const el = styleById(sd, id);
    if (!el || wAttr(el, "type") !== "paragraph") return defaultStyle(sd, "paragraph");
    return el;
  }
  // Paragraph.style = style (setter)
  function setParagraphStyle(pkg, p, styleEl) {
    const sd = pkg.stylesDoc();
    let id = null;
    if (styleEl) {
      if (wAttr(styleEl, "type") !== "paragraph") throw new Error("assigned style is not a paragraph style");
      id = styleEl === defaultStyle(sd, "paragraph") ? null : wAttr(styleEl, "styleId");
    }
    const pPr = getOrAddPPr(p);
    if (id === null) {
      for (const s of wChildren(pPr, "pStyle")) pPr.removeChild(s);
      return;
    }
    const ps = getOrAdd(pPr, "pStyle", PPR_SEQ);
    setWAttr(ps, "val", id);
  }

  // ---------------------------------------------------------------- text (write)
  const INVALID_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
  function checkXmlText(text) {
    if (INVALID_XML.test(text)) throw new Error("All strings must be XML compatible: Unicode or ASCII, no NULL bytes or control characters");
  }
  function setRunText(r, text) {
    checkXmlText(text);
    for (const c of Array.from(r.children)) if (!isW(c, "rPr")) r.removeChild(c);
    const doc = r.ownerDocument;
    let buf = "";
    const flush = () => {
      if (buf) {
        const t = newW(doc, "t");
        t.textContent = buf;
        if (PY.strip(buf).length < buf.length) t.setAttributeNS(XML_NS, "xml:space", "preserve");
        r.appendChild(t);
      }
      buf = "";
    };
    for (const ch of text) {
      if (ch === "\t") { flush(); r.appendChild(newW(doc, "tab")); }
      else if (ch === "\r" || ch === "\n") { flush(); r.appendChild(newW(doc, "br")); }
      else buf += ch;
    }
    flush();
  }
  function addRun(p, text) {
    const r = newW(p.ownerDocument, "r");
    p.appendChild(r);
    if (text) setRunText(r, text);
    return r;
  }
  function addParagraph(container) {
    const p = newW(container.ownerDocument, "p");
    container.appendChild(p);
    return p;
  }
  // docx_struct.clear_cell
  function clearCell(tc) {
    const ps = cellParagraphs(tc);
    for (const p of ps.slice(1)) tc.removeChild(p);
    const p0 = cellParagraphs(tc)[0];
    if (!p0) throw new Error("list index out of range");
    for (const r of wChildren(p0, "r")) p0.removeChild(r);
  }
  // docx_struct._force_paragraph_rtl
  function forceParagraphRtl(p) {
    const pPr = getOrAddPPr(p);
    const jc = getOrAdd(pPr, "jc", PPR_SEQ);
    setWAttr(jc, "val", "right");
    let bidi = wFirst(pPr, "bidi");
    if (!bidi) { bidi = newW(p.ownerDocument, "bidi"); pPr.appendChild(bidi); }
    setWAttr(bidi, "val", "1");
    for (const r of wChildren(p, "r")) {
      const rPr = getOrAddRPr(r);
      let rtl = wFirst(rPr, "rtl");
      if (!rtl) { rtl = newW(p.ownerDocument, "rtl"); rPr.appendChild(rtl); }
      setWAttr(rtl, "val", "1");
    }
  }
  // docx_struct.set_cell_text
  function setCellText(pkg, tc, text) {
    const lines = (text || "").split("\n");
    clearCell(tc);
    const p0 = cellParagraphs(tc)[0];
    let baseStyle = null;
    try { baseStyle = paragraphStyle(pkg, p0); } catch (e) { baseStyle = null; }
    const p0pPr = wFirst(p0, "pPr");
    addRun(p0, lines[0]);
    forceParagraphRtl(p0);
    for (const extra of lines.slice(1)) {
      const p = addParagraph(tc);
      if (baseStyle !== null) setParagraphStyle(pkg, p, baseStyle);
      if (p0pPr !== null) {
        const ex = wFirst(p, "pPr");
        if (ex) p.removeChild(ex);
        insertAt0(p, p0pPr.cloneNode(true));
      }
      addRun(p, extra);
      forceParagraphRtl(p);
    }
  }

  // ---------------------------------------------------------------- tables (write)
  function cellWidthEmu(tc) {
    const tcPr = wFirst(tc, "tcPr");
    if (!tcPr) return null;
    const tcW = wFirst(tcPr, "tcW");
    if (!tcW) return null;
    const type = wAttr(tcW, "type");
    if (type === null) throw new Error("required ``w:type`` attribute not present in element tcW");
    if (type !== "dxa") return null;
    const w = wAttr(tcW, "w");
    if (w === null) throw new Error("required ``w:w`` attribute not present in element tcW");
    return xsdInt(w) * 635;
  }
  function newTable(doc, rows, cols, widthEmu) {
    const colWidthEmu = cols > 0 ? Math.floor(widthEmu / cols) : 0;
    const twips = Math.round(colWidthEmu / 635);
    const tbl = newW(doc, "tbl");
    const tblPr = newW(doc, "tblPr");
    const tblW = newW(doc, "tblW");
    setWAttr(tblW, "type", "auto");
    setWAttr(tblW, "w", "0");
    const look = newW(doc, "tblLook");
    for (const [k, v] of [["firstColumn", "1"], ["firstRow", "1"], ["lastColumn", "0"], ["lastRow", "0"], ["noHBand", "0"], ["noVBand", "1"], ["val", "04A0"]]) setWAttr(look, k, v);
    tblPr.appendChild(tblW);
    tblPr.appendChild(look);
    tbl.appendChild(tblPr);
    const grid = newW(doc, "tblGrid");
    for (let c = 0; c < cols; c++) {
      const g = newW(doc, "gridCol");
      setWAttr(g, "w", String(twips));
      grid.appendChild(g);
    }
    tbl.appendChild(grid);
    for (let r = 0; r < rows; r++) {
      const tr = newW(doc, "tr");
      for (let c = 0; c < cols; c++) {
        const tc = newW(doc, "tc");
        const tcPr = newW(doc, "tcPr");
        const tcW = newW(doc, "tcW");
        setWAttr(tcW, "type", "dxa");
        setWAttr(tcW, "w", String(twips));
        tcPr.appendChild(tcW);
        tc.appendChild(tcPr);
        tc.appendChild(newW(doc, "p"));
        tr.appendChild(tc);
      }
      tbl.appendChild(tr);
    }
    return tbl;
  }
  // _Cell.add_table(rows, cols)
  function cellAddTable(tc, rows, cols) {
    let width = cellWidthEmu(tc);
    if (width === null) width = 914400;
    const tbl = newTable(tc.ownerDocument, rows, cols, width);
    tc.appendChild(tbl);
    addParagraph(tc);
    return tbl;
  }
  function setTableStyleByName(pkg, tbl, name) {
    const sd = pkg.stylesDoc();
    let el = styleByName(sd, name);
    if (!el) el = styleById(sd, name);
    if (!el) throw new Error("no style with name '" + name + "'");
    if (wAttr(el, "type") !== "table") throw new Error("assigned style is not a table style");
    const id = el === defaultStyle(sd, "table") ? null : wAttr(el, "styleId");
    const tblPr = wFirst(tbl, "tblPr");
    for (const s of wChildren(tblPr, "tblStyle")) tblPr.removeChild(s);
    if (id === null) return;
    const ts = newW(tbl.ownerDocument, "tblStyle");
    insertElementBefore(tblPr, ts, TBLPR_SEQ.slice(1));
    setWAttr(ts, "val", id);
  }
  function setTableAlignment(tbl, value) {
    const tblPr = wFirst(tbl, "tblPr");
    for (const j of wChildren(tblPr, "jc")) tblPr.removeChild(j);
    if (value === null) return;
    const jc = getOrAdd(tblPr, "jc", TBLPR_SEQ);
    setWAttr(jc, "val", value);
  }

  // ---------------------------------------------------------------- formatting (docx_builder.apply_word_format)
  function formatRun(r, fontName, halfPoints, rgbHex) {
    const rPr = getOrAddRPr(r);
    // font.name -> rFonts ascii / hAnsi
    const rFonts = getOrAdd(rPr, "rFonts", RPR_SEQ);
    setWAttr(rFonts, "ascii", fontName);
    setWAttr(rFonts, "hAnsi", fontName);
    // font.size
    const sz = getOrAdd(rPr, "sz", RPR_SEQ);
    setWAttr(sz, "val", String(halfPoints));
    // font.color.rgb
    for (const c of wChildren(rPr, "color")) rPr.removeChild(c);
    const color = newW(r.ownerDocument, "color");
    insertElementBefore(rPr, color, RPR_SEQ.slice(RPR_SEQ.indexOf("color") + 1));
    setWAttr(color, "val", rgbHex);
    let rf = wFirst(rPr, "rFonts");
    if (!rf) { rf = newW(r.ownerDocument, "rFonts"); insertAt0(rPr, rf); }
    for (const a of ["ascii", "hAnsi", "eastAsia", "cs"]) setWAttr(rf, a, fontName);
  }
  function formatParagraph(p, f) {
    for (const r of wChildren(p, "r")) formatRun(r, f.font, f.halfPoints, f.color);
  }
  function formatTable(tbl, f) {
    for (const tr of tableRows(tbl)) {
      for (const tc of rowCells(tr)) {
        for (const p of cellParagraphs(tc)) formatParagraph(p, f);
        for (const nested of cellTables(tc)) formatTable(nested, f);
      }
    }
  }
  function sectPrList(pkg) {
    const out = [];
    for (let c = pkg.body.firstElementChild; c; c = c.nextElementSibling) {
      if (isW(c, "p")) {
        const pPr = wFirst(c, "pPr");
        const s = pPr ? wFirst(pPr, "sectPr") : null;
        if (s) out.push(s);
      } else if (isW(c, "sectPr")) out.push(c);
    }
    return out;
  }
  // section.header / section.footer (default type), following inheritance from prior sections.
  function headerFooterParts(pkg) {
    const rels = pkg.rels(pkg.mainPath);
    const out = [];
    const sects = sectPrList(pkg);
    for (const kind of ["headerReference", "footerReference"]) {
      for (let i = 0; i < sects.length; i++) {
        let part = null;
        for (let k = i; k >= 0 && !part; k--) {
          const ref = wChildren(sects[k], kind).find((h) => wAttr(h, "type") === "default");
          if (ref) {
            const rid = ref.getAttributeNS(R_NS, "id");
            const rel = rels.get(rid);
            if (rel && pkg.has(rel.target)) part = rel.target;
          }
        }
        if (part) out.push(part);
      }
    }
    return out;
  }
  function applyWordFormat(pkg, f) {
    for (const p of wChildren(pkg.body, "p")) formatParagraph(p, f);
    for (const t of wChildren(pkg.body, "tbl")) formatTable(t, f);
    pkg.markDirty(pkg.mainPath);
    for (const part of headerFooterParts(pkg)) {
      const d = pkg.xml(part);
      const root = d.documentElement;
      for (const p of wChildren(root, "p")) formatParagraph(p, f);
      for (const t of wChildren(root, "tbl")) formatTable(t, f);
      pkg.markDirty(part);
    }
  }

  return {
    W_NS, R_NS, XML_NS, PPR_SEQ, RPR_SEQ, TBLPR_SEQ,
    isW, wChildren, wFirst, wAttr, setWAttr, newW, insertElementBefore, getOrAdd, getOrAddPPr, getOrAddRPr,
    runText, paragraphText, rowCells, tableRows, cellParagraphs, cellTables, cellText, tablePlainText, rowTexts,
    cellPlainText, norm, gridSpan, vMerge,
    DocxPackage, parseXml, serializeXml,
    setRunText, addRun, addParagraph, clearCell, forceParagraphRtl, setCellText,
    cellAddTable, setTableStyleByName, setTableAlignment, applyWordFormat, paragraphStyle,
  };
})();
