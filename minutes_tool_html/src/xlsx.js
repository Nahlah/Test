/* قراءة ملفات Excel (.xlsx) بنفس طريقة openpyxl في الوضع load_workbook(data_only=True, read_only=True). */
"use strict";

const XLSX = (() => {
  const S_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
  const R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const PKG_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
  const RT_WORKSHEET = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet";
  const dec = new TextDecoder("utf-8");

  const BUILTIN_FORMATS = {
    0: "General", 1: "0", 2: "0.00", 3: "#,##0", 4: "#,##0.00", 5: '"$"#,##0_);("$"#,##0)',
    6: '"$"#,##0_);[Red]("$"#,##0)', 7: '"$"#,##0.00_);("$"#,##0.00)', 8: '"$"#,##0.00_);[Red]("$"#,##0.00)',
    9: "0%", 10: "0.00%", 11: "0.00E+00", 12: "# ?/?", 13: "# ??/??", 14: "mm-dd-yy", 15: "d-mmm-yy", 16: "d-mmm",
    17: "mmm-yy", 18: "h:mm AM/PM", 19: "h:mm:ss AM/PM", 20: "h:mm", 21: "h:mm:ss", 22: "m/d/yy h:mm",
    37: "#,##0_);(#,##0)", 38: "#,##0_);[Red](#,##0)", 39: "#,##0.00_);(#,##0.00)", 40: "#,##0.00_);[Red](#,##0.00)",
    41: '_(* #,##0_);_(* \\(#,##0\\);_(* "-"_);_(@_)', 42: '_("$"* #,##0_);_("$"* \\(#,##0\\);_("$"* "-"_);_(@_)',
    43: '_(* #,##0.00_);_(* \\(#,##0.00\\);_(* "-"??_);_(@_)', 44: '_("$"* #,##0.00_)_("$"* \\(#,##0.00\\)_("$"* "-"??_)_(@_)',
    45: "mm:ss", 46: "[h]:mm:ss", 47: "mmss.0", 48: "##0.0E+0", 49: "@",
  };

  const STRIP_RE = PY.re.compile('".*?"|\\[(?!hh?\\]|mm?\\]|ss?\\])[^\\]]*\\]');
  const TIMEDELTA_RE = PY.re.compile("\\[hh?\\](:mm(:ss(\\.0*)?)?)?|\\[mm?\\](:ss(\\.0*)?)?|\\[ss?\\](\\.0*)?", PY.re.I);
  function is_date_format(fmt) {
    if (fmt === null || fmt === undefined) return false;
    fmt = fmt.split(";")[0];
    fmt = STRIP_RE.sub("", fmt);
    return PY.re.search("(?<![_\\\\])[dmhysDMHYS]", fmt) !== null;
  }
  function is_timedelta_format(fmt) {
    if (fmt === null || fmt === undefined) return false;
    fmt = fmt.split(";")[0];
    return TIMEDELTA_RE.search(fmt) !== null;
  }

  function el(doc, local) {
    return Array.from(doc.getElementsByTagNameNS(S_NS, local));
  }
  function kids(node, local) {
    const out = [];
    for (let c = node.firstElementChild; c; c = c.nextElementSibling) if (c.namespaceURI === S_NS && c.localName === local) out.push(c);
    return out;
  }
  function textContent(node) {
    // openpyxl Text.content: plain <t> plus <r><t>, ignoring phonetic runs (<rPh>).
    let s = "";
    for (const c of kids(node, "t")) s += c.textContent;
    for (const r of kids(node, "r")) for (const t of kids(r, "t")) s += t.textContent;
    return s;
  }
  function parse(bytes) {
    const d = new DOMParser().parseFromString(dec.decode(bytes), "application/xml");
    if (!d.documentElement || d.getElementsByTagName("parsererror").length) throw new Error("ملف Excel غير صالح.");
    return d;
  }
  function join(base, rel) {
    if (rel.startsWith("/")) return rel.slice(1);
    const parts = base.split("/").filter(Boolean);
    for (const seg of rel.split("/")) {
      if (seg === "..") parts.pop();
      else if (seg && seg !== ".") parts.push(seg);
    }
    return parts.join("/");
  }
  function colToNum(letters) {
    let n = 0;
    for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n;
  }
  function rangeBoundaries(ref) {
    const parts = String(ref || "").replace(/\$/g, "").split(":");
    const parse1 = (p) => {
      const m = /^([A-Za-z]*)(\d*)$/.exec(p);
      if (!m) return [null, null];
      return [m[1] ? colToNum(m[1]) : null, m[2] ? parseInt(m[2], 10) : null];
    };
    const [c1, r1] = parse1(parts[0]);
    const [c2, r2] = parts.length > 1 ? parse1(parts[1]) : [c1, r1];
    return { min_col: c1, min_row: r1, max_col: c2, max_row: r2 };
  }

  // ---------------------------------------------------------------- python value formatting
  const pad = (n, w = 2) => String(n).padStart(w, "0");
  function roundHalfEven(x) {
    const f = Math.floor(x);
    const d = x - f;
    if (d > 0.5) return f + 1;
    if (d < 0.5) return f;
    return f % 2 === 0 ? f : f + 1;
  }
  function fmtMicro(us) {
    return us ? "." + pad(us, 6) : "";
  }
  function fromExcel(value, date1904, timedelta) {
    if (timedelta) {
      // datetime.timedelta(days=value), rounded to microseconds, then milliseconds
      let us = roundHalfEven(value * 86400 * 1e6);
      let micro = ((us % 1e6) + 1e6) % 1e6;
      if (micro) {
        const secs = Math.floor(us / 1e6);
        micro = Math.round(micro / 1000) * 1000;
        us = secs * 1e6 + micro;
      }
      return { kind: "timedelta", us };
    }
    const day = Math.floor(value);
    const fraction = value - day;
    const ms = roundHalfEven(fraction * 86400 * 1000);
    if (value >= 0 && value < 1 && ms < 86400000) return { kind: "time", ms };
    let d = day;
    if (value > 0 && value < 60 && !date1904) d += 1;
    const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
    return { kind: "datetime", t: epoch + d * 86400000 + ms };
  }
  function pyStrValue(v) {
    if (v === null || v === undefined) return "None";
    if (typeof v === "boolean") return v ? "True" : "False";
    if (typeof v === "number") return PY.strNumber(v);
    if (typeof v === "string") return v;
    if (v.kind === "datetime") {
      const dt = new Date(v.t);
      const msPart = ((v.t % 1000) + 1000) % 1000;
      return `${pad(dt.getUTCFullYear(), 4)}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())} ` +
        `${pad(dt.getUTCHours())}:${pad(dt.getUTCMinutes())}:${pad(dt.getUTCSeconds())}${fmtMicro(msPart * 1000)}`;
    }
    if (v.kind === "time") {
      const total = v.ms;
      const s = Math.floor(total / 1000);
      return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}${fmtMicro((total % 1000) * 1000)}`;
    }
    if (v.kind === "timedelta") {
      const us = v.us;
      const days = Math.floor(us / 86400e6);
      let rem = us - days * 86400e6;
      const micro = rem % 1e6;
      rem = Math.floor(rem / 1e6);
      const hh = Math.floor(rem / 3600), mm = Math.floor(rem / 60) % 60, ss = rem % 60;
      let s = `${hh}:${pad(mm)}:${pad(ss)}${fmtMicro(micro)}`;
      if (days) s = `${days} day${Math.abs(days) !== 1 ? "s" : ""}, ` + s;
      return s;
    }
    return String(v);
  }
  function castNumber(text) {
    if (text.includes(".") || text.includes("E") || text.includes("e")) return parseFloat(text);
    return PY.int(text);
  }

  // ---------------------------------------------------------------- workbook
  class Worksheet {
    constructor(title, cells, dims) {
      this.title = title;
      this._cells = cells;
      this.max_row = dims ? dims.max_row : null;
      this.max_column = dims ? dims.max_col : null;
    }
    value(r, c) {
      const v = this._cells.get(r * 20000 + c);
      return v === undefined ? null : v;
    }
  }

  function load(bytes) {
    let files;
    try {
      files = fflate.unzipSync(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
    } catch (e) {
      throw new Error("File is not a zip file");
    }
    const lower = new Map(Object.keys(files).map((k) => [k.toLowerCase(), k]));
    const get = (p) => {
      const k = lower.get(p.toLowerCase());
      return k ? files[k] : null;
    };
    const rels = (part) => {
      const d = part.lastIndexOf("/");
      const relsPath = (d >= 0 ? part.slice(0, d + 1) : "") + "_rels/" + part.slice(d + 1) + ".rels";
      const b = get(relsPath);
      const out = new Map();
      if (!b) return out;
      const doc = parse(b);
      const base = d >= 0 ? part.slice(0, d) : "";
      for (const r of Array.from(doc.getElementsByTagNameNS(PKG_REL_NS, "Relationship"))) {
        out.set(r.getAttribute("Id"), { type: r.getAttribute("Type"), target: join(base, r.getAttribute("Target") || "") });
      }
      return out;
    };
    let wbPath = null;
    for (const [, r] of rels("")) if (/officeDocument$/.test(r.type || "")) { wbPath = r.target; break; }
    if (!wbPath) wbPath = "xl/workbook.xml";
    const wbBytes = get(wbPath);
    if (!wbBytes) throw new Error("لم يتم العثور على محتوى ملف Excel.");
    const wb = parse(wbBytes);
    const wbRels = rels(wbPath);
    const pr = el(wb, "workbookPr")[0];
    const d1904 = pr ? ["1", "true"].includes(String(pr.getAttribute("date1904") || "").toLowerCase()) : false;

    // shared strings
    let shared = [];
    for (const [, r] of wbRels) {
      if (/sharedStrings$/.test(r.type || "")) {
        const b = get(r.target);
        if (b) shared = el(parse(b), "si").map((si) => textContent(si).split("x005F_").join(""));
      }
    }
    // styles -> date / timedelta formats by xf index
    const dateXf = new Set(), tdXf = new Set();
    for (const [, r] of wbRels) {
      if (/\/styles$/.test(r.type || "")) {
        const b = get(r.target);
        if (!b) continue;
        const st = parse(b);
        const custom = new Map();
        for (const nf of el(st, "numFmt")) custom.set(parseInt(nf.getAttribute("numFmtId"), 10), nf.getAttribute("formatCode"));
        const cellXfs = el(st, "cellXfs")[0];
        if (cellXfs) {
          kids(cellXfs, "xf").forEach((xf, idx) => {
            const id = parseInt(xf.getAttribute("numFmtId") || "0", 10);
            const fmt = custom.has(id) ? custom.get(id) : (BUILTIN_FORMATS[id] ?? null);
            if (is_date_format(fmt)) dateXf.add(idx);
            if (is_timedelta_format(fmt)) tdXf.add(idx);
          });
        }
      }
    }

    const sheets = [];
    const sheetsEl = el(wb, "sheets")[0];
    for (const sh of sheetsEl ? kids(sheetsEl, "sheet") : []) {
      const rid = sh.getAttributeNS(R_NS, "id");
      const rel = wbRels.get(rid);
      if (!rel || rel.type !== RT_WORKSHEET) continue;
      const b = get(rel.target);
      if (!b) continue;
      const doc = parse(b);
      const dimEl = el(doc, "dimension")[0];
      const dims = dimEl ? rangeBoundaries(dimEl.getAttribute("ref")) : null;
      const cells = new Map();
      let rowCounter = 0;
      for (const row of el(doc, "row")) {
        const rAttr = row.getAttribute("r");
        rowCounter = rAttr ? parseInt(rAttr, 10) : rowCounter + 1;
        let colCounter = 0;
        for (const c of kids(row, "c")) {
          const ref = c.getAttribute("r");
          let rr = rowCounter, cc;
          if (ref) {
            const m = /^([A-Za-z]+)(\d+)$/.exec(ref);
            cc = colToNum(m[1]);
            rr = parseInt(m[2], 10);
            colCounter = cc;
          } else cc = ++colCounter;
          const t = c.getAttribute("t") || "n";
          const sid = parseInt(c.getAttribute("s") || "0", 10) || 0;
          let value = null;
          if (t === "inlineStr") {
            const is = kids(c, "is")[0];
            if (is) value = textContent(is);
          } else {
            const vEl = kids(c, "v")[0];
            const vText = vEl ? vEl.textContent : null;
            if (vText) {
              if (t === "n") {
                value = castNumber(vText);
                if (dateXf.has(sid)) {
                  try { value = fromExcel(value, d1904, tdXf.has(sid)); } catch (e) { value = "#VALUE!"; }
                }
              } else if (t === "s") value = shared[PY.int(vText)];
              else if (t === "b") value = !!PY.int(vText);
              else if (t === "str" || t === "e") value = vText;
              else if (t === "d") value = vText.replace("T", " ");
              else value = vText;
            }
          }
          cells.set(rr * 20000 + cc, value);
        }
        rowCounter = rowCounter;
      }
      sheets.push(new Worksheet(sh.getAttribute("name") || "", cells, dims));
    }
    return { worksheets: sheets };
  }

  return { load, pyStrValue, is_date_format, is_timedelta_format, fromExcel };
})();
