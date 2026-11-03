/* استيراد مصادر الموضوعات الحالية لوحدة مجلس القسم — منقول من core/source_import.py،
 * ومحاضر اللجنة الثلاثية — منقول من core/scholarship.py.
 */
"use strict";

const SourceImport = (() => {
  const { re, strip } = PY;
  const { normalize_ar } = Similarity;
  const X = OOXML;
  const { Topic, SessionInfo } = Minutes;

  const TITLE_HEADERS = ["الموضوع", "عنوان الموضوع", "نوع الموضوع", "نوع الطلب", "الطلب", "نوع المعاملة", "المعاملة", "موضوع الطلب"];
  const ATTACHMENT_HEADERS = ["المرفق", "المرفقات", "اسم المرفق", "الملف", "المستند المرفق"];
  const NAME_HEADERS = ["الاسم", "اسم الطالب", "اسم الطالبة", "اسم العضو", "اسم المرشح", "اسم المرشحة"];

  function _norm(s) {
    return normalize_ar(s ? String(s) : "").split(" ").join("");
  }
  function _header_index(headers, aliases) {
    const alias_n = new Set(aliases.map(_norm));
    for (let i = 0; i < headers.length; i++) if (alias_n.has(_norm(headers[i]))) return i;
    return null;
  }
  function _clean_value(v) {
    if (v === null || v === undefined) return "";
    return strip(XLSX.pyStrValue(v));
  }
  const compactN = (s) => re.sub("\\s+", "", normalize_ar(s));

  function _infer_title_from_text(text, filename) {
    const n = normalize_ar(text);
    const compact = re.sub("\\s+", "", n);
    if (compact.includes(compactN("الوظيفية المتقدم عليها")) || compact.includes(compactN("المتقدم للتعيين"))) return "طلب تعيين";
    if (compact.includes(compactN("المرتبة العلمية المتقدم للترقية إليها")) || compact.includes(compactN("هل سبق التقديم لهذه الترقية"))) return "طلب ترقية";
    if (compact.includes(compactN("معلومات عن المؤتمر/الندوة")) || compact.includes(compactN("طلب الحضور/المشاركة في المؤتمرات"))) return "طلب حضور مؤتمر علمي";
    const explicit_forms = [
      [["طلب تعيين عضو هيئه تدريس", "طلب تعيين عضو هيئة تدريس"], "طلب تعيين"],
      [["طلب الحضور/المشاركه في المؤتمرات", "طلب الحضور/المشاركة في المؤتمرات"], "طلب حضور مؤتمر علمي"],
      [["استماره طلب ترقيه علميه", "استمارة طلب ترقية علمية"], "طلب ترقية"],
    ];
    for (const [keys, title] of explicit_forms) if (keys.some((k) => compact.includes(compactN(k)))) return title;
    const patterns = [
      [["اعاده القيد", "اعادة القيد"], "طلب إعادة القيد"],
      [["تاجيل", "تأجيل"], "طلب تأجيل الدراسة"],
      [["بدل التميز", "مكافاه التميز"], "طلب مكافأة بدل التميز"],
      [["تعيين"], "طلب تعيين"],
      [["حضور مؤتمر", "المؤتمر"], "طلب حضور مؤتمر علمي"],
      [["ترقيه", "ترقية"], "طلب ترقية"],
      [["ابتعاث", "بعثه", "بعثة"], "طلب ابتعاث"],
      [["تغيير تخصص", "تغيير التخصص"], "طلب تغيير تخصص"],
      [["معادله", "معادلة"], "طلب معادلة"],
    ];
    for (const [keys, title] of patterns) if (keys.some((k) => n.includes(normalize_ar(k)))) return title;
    for (const line of PY.splitlines(text || "")) {
      const s = strip(line, " -•\t");
      if (PY.len(s) >= 5 && PY.len(s) <= 180 && ["طلب", "تعيين", "تاجيل", "اعاده", "مؤتمر", "ترقيه"].some((k) => normalize_ar(s).includes(k))) return s;
    }
    let base = Minutes.basename(filename);
    const dot = base.lastIndexOf(".");
    if (dot > 0) base = base.slice(0, dot);
    base = strip(re.sub("(?i)نموذج|form|template", "", base), " _-–—");
    return base || "موضوع جديد لمجلس القسم";
  }

  // Word tables including nested ones and tables inside content controls.
  function _docx_tables(file) {
    if (!String(file.name || "").toLowerCase().endsWith(".docx")) return [];
    let pkg;
    try {
      pkg = Minutes.openDocx(file);
    } catch (e) {
      throw e;
    }
    const out = [];
    const W = X.W_NS;
    const cell_text = (tc) => {
      const paragraphs = [];
      for (const p of Array.from(tc.getElementsByTagNameNS(W, "p"))) {
        const tokens = [];
        const walk = (node) => {
          for (let c = node.firstElementChild; c; c = c.nextElementSibling) {
            if (c.namespaceURI === W && c.localName === "t") {
              if (c.textContent) tokens.push(c.textContent);
            } else if (c.namespaceURI === W && c.localName === "sym") {
              const ch = (c.getAttributeNS(W, "char") || "").toUpperCase();
              if (ch === "F06E") tokens.push("☑");
              else if (ch === "F071") tokens.push("☐");
            }
            walk(c);
          }
        };
        walk(p);
        const line = strip(tokens.join(""));
        if (line) paragraphs.push(line);
      }
      const xml_text = strip(paragraphs.join("\n"));
      if (xml_text) return xml_text;
      return strip(X.cellParagraphs(tc).map((p) => strip(X.paragraphText(p))).filter((t) => t).join("\n"));
    };
    for (const tbl of Array.from(pkg.body.getElementsByTagNameNS(W, "tbl"))) {
      try {
        const matrix = [];
        for (const tr of X.tableRows(tbl)) {
          const vals = [];
          const seen = new Set();
          for (const tc of X.rowCells(tr)) {
            if (seen.has(tc)) { vals.push(""); continue; }
            seen.add(tc);
            vals.push(cell_text(tc));
          }
          if (vals.some((v) => v)) matrix.push(vals);
        }
        if (matrix.length) out.push(matrix);
      } catch (e) {
        continue;
      }
    }
    return out;
  }

  function _append_text_once(base, extra) {
    base = strip(base || "");
    extra = strip(extra || "");
    if (!extra) return base;
    if (base.includes(extra)) return base;
    return base ? strip(base + "\n" + extra) : extra;
  }

  async function import_document_source(file, prefer_form = false) {
    const ext = Minutes.extOf(file);
    if (ext === ".pdf") {
      const pdf = await PDFText.readPdfSource(file);
      if (!pdf.searchable) {
        throw new Error(
          "ملف PDF لا يحتوي نصًا قابلاً للقراءة (قد يكون صورة ممسوحة ضوئيًا). " +
          "يفضل استخدام النسخة الأصلية Word/PDF النصية أو إدخال البيانات يدويًا.",
        );
      }
      const text = pdf.text;
      const title = _infer_title_from_text(text, file.name);
      const topic = Topic({ title, rationale: strip(text), data_tables: Array.from(pdf.tables || []) });
      const pairs = [];
      for (const matrix of pdf.tables || []) {
        for (const row of matrix) {
          const nonempty = row.map((v) => strip(v ? String(v) : "")).filter((v) => v);
          if (nonempty.length === 2) {
            const [a, b] = nonempty;
            if (PY.len(a) <= 80 || PY.len(b) <= 80) pairs.push(`${b}: ${a}`);
          }
        }
      }
      if (pairs.length) {
        const structured = Array.from(new Set(pairs)).join("\n");
        topic.rationale = _append_text_once(topic.rationale, "\n\nبيانات مستخرجة من الجداول:\n" + structured);
      }
      return [[topic], SessionInfo(), "ملف PDF (نص + جداول)"];
    }
    if (!prefer_form) {
      let minutes = null;
      try {
        minutes = await Minutes.parseMinutesFile(file);
      } catch (e) {
        minutes = null;
      }
      if (minutes && minutes.topics.length) {
        const usable = minutes.topics.filter((t) => !normalize_ar(t.title).includes("ملاحظات على المحضر السابق"));
        if (usable.length && (minutes.session.council_name || usable.length > 1)) return [usable, minutes.session, "محضر/مستند منظم"];
      }
    }
    const text = await Minutes.readText(file);
    const title = _infer_title_from_text(text, file.name);
    const topic = Topic({ title, rationale: strip(text) });
    for (const matrix of _docx_tables(file)) if (matrix.length) topic.data_tables.push(matrix);
    return [[topic], SessionInfo(), "نموذج/طلب"];
  }

  function _find_header_row(ws) {
    let best = null;
    let best_score = -1;
    const max_scan = Math.min(ws.max_row || 0, 25);
    const known = new Set(TITLE_HEADERS.concat(ATTACHMENT_HEADERS, NAME_HEADERS).map(_norm));
    for (let r = 1; r <= max_scan; r++) {
      const vals = [];
      for (let c = 1; c <= (ws.max_column || 0); c++) vals.push(_clean_value(ws.value(r, c)));
      const nonempty = vals.filter((v) => v);
      if (nonempty.length < 2) continue;
      const k = nonempty.filter((v) => known.has(_norm(v))).length;
      const score = nonempty.length + k * 3;
      if (score > best_score) {
        best = [r, vals];
        best_score = score;
      }
    }
    return best || [null, []];
  }

  function import_excel_source(file) {
    const wb = XLSX.load(file.bytes);
    const topics = [];
    for (const ws of wb.worksheets) {
      const [header_row, raw_headers] = _find_header_row(ws);
      if (!header_row) continue;
      let last = -1;
      raw_headers.forEach((h, i) => { if (h) last = i; });
      const headers = raw_headers.slice(0, last + 1);
      if (headers.length < 2) continue;
      const rows = [];
      for (let r = header_row + 1; r <= (ws.max_row || 0); r++) {
        const vals = [];
        for (let c = 1; c <= headers.length; c++) vals.push(_clean_value(ws.value(r, c)));
        if (vals.some((v) => v)) rows.push(vals);
      }
      if (!rows.length) continue;
      const title_idx = _header_index(headers, TITLE_HEADERS);
      const attach_idx = _header_index(headers, ATTACHMENT_HEADERS);
      if (headers.length === 2 && title_idx === null && rows.length >= 2) {
        const pairs = rows.filter((row) => row[0] && row[1]).map((row) => [row[0], row[1]]);
        if (pairs.length) {
          const full = pairs.map(([k, v]) => `${k}: ${v}`).join("\n");
          const tn = new Set(TITLE_HEADERS.map(_norm));
          const hit = pairs.find(([k]) => tn.has(_norm(k)));
          const title = hit ? hit[1] : ws.title;
          topics.push(Topic({ title: title || ws.title, rationale: full, data_tables: [pairs.map(([k, v]) => [k, v])] }));
          continue;
        }
      }
      const groups = new Map();
      if (title_idx !== null) {
        for (const row of rows) {
          const key = strip(row[title_idx]) || ws.title;
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key).push(row);
        }
      } else groups.set(ws.title, rows.slice());
      for (const [group_title, grows] of groups) {
        const title = strip(group_title) || ws.title;
        if (grows.length === 1) {
          const row = grows[0];
          const facts = [];
          headers.forEach((h, i) => {
            if (i === title_idx || !h || i >= row.length || !row[i]) return;
            if (i === attach_idx) return;
            facts.push(`${h}: ${row[i]}`);
          });
          const attachments = attach_idx !== null && attach_idx < row.length ? row[attach_idx] : "";
          topics.push(Topic({ title, rationale: facts.join("\n"), attachments }));
        } else {
          const keep_cols = [];
          headers.forEach((h, i) => { if (h && i !== title_idx) keep_cols.push(i); });
          const matrix = [keep_cols.map((i) => headers[i])];
          for (const row of grows) matrix.push(keep_cols.map((i) => (i < row.length ? row[i] : "")));
          topics.push(Topic({ title, rationale: "وفق البيانات الواردة في الجدول المرفق أدناه:", data_tables: [matrix] }));
        }
      }
    }
    if (!topics.length) throw new Error("لم أتمكن من استخراج موضوعات من ملف Excel. يمكن تعديل تنسيق الملف أو إضافة الموضوع يدويًا.");
    return [topics, SessionInfo(), "ملف Excel"];
  }

  async function import_current_source(file, prefer_form = false) {
    if (Minutes.extOf(file) === ".xlsx") return import_excel_source(file);
    return import_document_source(file, prefer_form);
  }

  // ---------------------------------------------------------------- scholarship (committee minutes)
  const AR = re.compile("[\\u0600-\\u06FF]");
  const LATIN_NUM = re.compile("[A-Za-z0-9]");
  const DAYS = ["الأحد", "الاحد", "الإثنين", "الاثنين", "الثلاثاء", "الأربعاء", "الاربعاء", "الخميس", "الجمعة", "السبت"];

  function _cleanup(text) {
    const repl = [
      ["االبتعاث", "الابتعاث"], ["االستقطاب", "الاستقطاب"], ["االربعاء", "الأربعاء"], ["االول", "الأول"],
      ["االولى", "الأولى"], ["األول", "الأول"], ["األولى", "الأولى"], ["االجراء", "الإجراء"], ["حالُالم", "المُحال"],
      ["بلِق", "قِبل"], ["اوفقً", "وفقًا"], ["اًثالث", "ثالثًا"], ["أوالا", "أولًا"], ["ثانياا", "ثانيًا"],
      ["الدراس في الملحقية", "الدراسي في الملحقية"], ["مبعد الموافقة", "بعدم الموافقة"], ["اإلجماع", "الإجماع"],
      ["التوصية/التوصية", "التوصية/"], ["طلبات.الابتعاث", "طلبات الابتعاث."], ["البيانات:التالية", "البيانات التالية:"],
      ["مبررات:الطلب", "مبررات الطلب:"], ["اًاستناد", "استنادًا"], ["سنة.فقط", "سنة فقط."],
    ];
    for (const [a, b] of repl) text = text.split(a).join(b);
    text = re.sub("(\\d+)\\(\\)", "(\\1)", text);
    text = text.split("،سنوات").join("سنوات،");
    text = text.split("إضافةًثمللبرنامج").join("للبرنامج، إضافةً");
    text = text.split("إضافةً،").join("، إضافةً");
    text = text.split("،،").join("،");
    text = text.split("سنوات، حصل").join("سنوات، ثم حصل");
    text = text.split(".فقط").join(" فقط.");
    text = re.sub("(\\d{2})وتاريخ\\s+(20\\d{2}/\\d{2})/م", "وتاريخ \\2/\\1م", text);
    text = re.sub("\\s+([،؛:.])", "\\1", text);
    text = re.sub("([(/])\\s+", "\\1", text);
    text = re.sub("\\s+([/)])", "\\1", text);
    text = re.sub("(20\\d{2})/\\s*(\\d{1,2})/\\s*(\\d{1,2})", "\\1/\\2/\\3", text);
    text = re.sub("(\\d{1,2})/\\s*(\\d{1,2})/\\s*(20\\d{2})", "\\1/\\2/\\3", text);
    text = strip(re.sub("\\s+", " ", text));
    return text;
  }

  function _cleanup_multiline(text) {
    const lines = [];
    for (const raw of PY.splitlines(text || "")) {
      let line = _cleanup(raw);
      if (!line) continue;
      if (["حيثيات", "الموضوع", "القرار"].includes(line)) continue;
      line = re.sub("^حيثيات\\s+(?=بلد الابتعاث)", "", line);
      line = re.sub("^الموضوع\\s+(?=بداية البعثة)", "", line);
      for (const label of ["اسم الجامعة", "التخصص العام", "بلد الابتعاث", "بداية البعثة",
        "بداية التمديد الأول", "بداية التمديد الثاني", "بداية التمديد الثالث"]) {
        if (line.startsWith(label + " ") && !line.startsWith(label + ":")) {
          line = label + ": " + strip(line.slice(label.length));
          break;
        }
      }
      lines.push(line);
    }
    return strip(lines.join("\n"));
  }

  function _fix_rtl_line(line) {
    const tokens = PY.split(line);
    if (!tokens.length) return "";
    const arabic_count = tokens.filter((tok) => AR.search(tok)).length;
    if (arabic_count < Math.max(1, Math.trunc(tokens.length * 0.30))) return _cleanup(line);
    const rev = tokens.slice().reverse();
    const out = [];
    let i = 0;
    while (i < rev.length) {
      if (!AR.search(rev[i]) && LATIN_NUM.search(rev[i])) {
        let j = i + 1;
        while (j < rev.length && !AR.search(rev[j]) && LATIN_NUM.search(rev[j])) j++;
        out.push(...rev.slice(i, j).reverse());
        i = j;
      } else {
        out.push(rev[i]);
        i++;
      }
    }
    return _cleanup(out.join(" "));
  }

  async function _read_pdf_rtl(file) {
    const pages = await PDFText.readSortedTextPages(file);
    return pages.map((raw) => PY.splitlines(raw).filter((l) => strip(l)).map(_fix_rtl_line).join("\n")).join("\n\n");
  }

  function _extract_session(text) {
    const s = SessionInfo({ council_name: "اللجنة الثلاثية لكلية الحوسبة والمعلوماتية لشؤون الابتعاث" });
    const head = text.slice(0, 5000);
    let m = re.search("رقم الجلسة[^\\n]*\\n\\s*(\\d{1,2})\\b", head);
    if (m) s.session_number = m.group(1);
    else {
      m = re.search("\\b(\\d{1,2})\\s+(?:الأحد|الاحد|الإثنين|الاثنين|الثلاثاء|الأربعاء|الاربعاء|الخميس|الجمعة|السبت)\\b", head);
      if (m) s.session_number = m.group(1);
    }
    for (const day of DAYS) if (head.includes(day)) { s.day = day; break; }
    const dm = re.search("\\b(20\\d{2}[/.\\-]\\d{1,2}[/.\\-]\\d{1,2})\\b", head);
    if (dm) s.date = dm.group(1).split(".").join("/").split("-").join("/");
    const tm = re.search("\\b(\\d{1,2}:\\d{2})\\s*([صم])?", head);
    if (tm) s.time = tm.group(1) + (tm.group(2) ? " " + tm.group(2) : "");
    if (head.includes("مايكروسوفت تيمز")) s.place = "مايكروسوفت تيمز";
    return s;
  }

  function _strip_noise_lines(lines) {
    const out = [];
    for (const line of lines) {
      const n = strip(line);
      if (!n) continue;
      if (re.search("\\b\\d+\\s+of\\s+\\d+\\b", n, re.I)) continue;
      if (n.includes("سكرتير") && n.includes("رئيس") && n.includes("رقم")) continue;
      if (n.startsWith("اللجنة الثالثية لكلية الحوسبة رقم")) continue;
      out.push(n);
    }
    return out;
  }

  function _extract_title(text) {
    const lines = _strip_noise_lines(PY.splitlines(text));
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.includes("دراسة طلب")) {
        let title = strip(re.sub("^\\s*\\d+\\s*[.]\\s*", "", line));
        if (i + 1 < lines.length) {
          const nxt = lines[i + 1];
          if (!["أعضاء", "التشكيل", "المناقشات", "رقم الجلسة"].some((k) => nxt.includes(k)) && PY.len(nxt) < 220) title += " " + nxt;
        }
        return PY.rstrip(_cleanup(title), " .") + ".";
      }
    }
    for (const line of lines) {
      if (["ابتعاث", "تمديد", "بعثة", "الدكتوراه", "الدكتوراة"].some((k) => line.includes(k)) && PY.len(line) > 25) {
        return PY.rstrip(_cleanup(line), " .") + ".";
      }
    }
    return "";
  }

  function _slice_between(text, start_terms, end_terms) {
    let start = -1, start_term = "";
    for (const term of start_terms) {
      const pos = text.indexOf(term);
      if (pos >= 0 && (start < 0 || pos < start)) { start = pos; start_term = term; }
    }
    if (start < 0) return "";
    let end = text.length;
    for (const term of end_terms) {
      const pos = text.indexOf(term, start + start_term.length);
      if (pos >= 0) end = Math.min(end, pos);
    }
    return strip(text.slice(start, end));
  }

  function _extract_topic_from_pdf_text(text) {
    const title = _extract_title(text);
    let rationale = _slice_between(text,
      ["بناء على توصية", "بناءً على توصية", "وبالإشارة إلى تفويض", "استعرضت اللجنة الطلب"],
      ["التوصية /", "التوصية/", "المستند", "المادة العاشرة"]);
    if (!rationale) rationale = text;
    let decision = _slice_between(text,
      ["التوصية /", "التوصية/", "التوصية بعدم", "التوصية بالموافقة"],
      ["المستند", "المادة العاشرة", "المرفقات"]);
    decision = strip(re.sub("^التوصية\\s*/\\s*(?:القرار\\s*)?", "التوصية ", decision));
    return Topic({ number: "01", title: _cleanup(title), rationale: _cleanup_multiline(rationale), decision: _cleanup_multiline(decision) });
  }

  async function parse_committee_file(file) {
    const ext = Minutes.extOf(file);
    if (ext === ".docx") {
      const minutes = await Minutes.parseMinutesFile(file);
      let candidates = minutes.topics.filter((t) => ["ابتعاث", "تمديد", "بعثة", "الدكتوراه", "الدكتوراة"].some((k) => `${t.title} ${t.rationale}`.includes(k)));
      if (!candidates.length && minutes.topics.length) candidates = minutes.topics;
      if (!candidates.length) throw new Error("لم يتم العثور على موضوع ابتعاث/تمديد داخل محضر اللجنة الثلاثية.");
      return { session: minutes.session, topic: candidates[0], raw_text: "" };
    }
    if (ext === ".pdf") {
      const text = await _read_pdf_rtl(file);
      const session = _extract_session(text);
      const topic = _extract_topic_from_pdf_text(text);
      if (!topic.title) throw new Error("تعذر استخراج عنوان موضوع الابتعاث من PDF. يمكن إضافة الموضوع يدويًا من زر «إضافة موضوع خاص بمجلس الكلية». ");
      return { session, topic, raw_text: text };
    }
    throw new Error("محضر اللجنة الثلاثية يجب أن يكون بصيغة DOCX أو PDF.");
  }

  return {
    _infer_title_from_text, _docx_tables, import_document_source, import_excel_source, import_current_source,
    _find_header_row, _append_text_once, parse_committee_file, _fix_rtl_line, _cleanup, _cleanup_multiline,
    _extract_session, _extract_title, _extract_topic_from_pdf_text, _slice_between,
  };
})();
