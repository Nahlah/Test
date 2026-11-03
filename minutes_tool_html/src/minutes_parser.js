/* تحليل محاضر المجالس (مجلس القسم أو مجلس الكلية) — منقول من core/minutes_parser.py
 * و core/extract.py و core/archive.py في الأداة الأصلية.
 */
"use strict";

const Minutes = (() => {
  const { re, strip } = PY;
  const X = OOXML;

  // ---------------------------------------------------------------- data classes
  function Topic(o = {}) {
    return Object.assign({
      number: "", title: "", rationale: "", decision: "", document_ref: "",
      attachments: "", action_required: "", votes: [], guests: [], data_tables: [],
    }, o);
  }
  function SessionInfo(o = {}) {
    return Object.assign({ council_name: "", session_number: "", day: "", date: "", place: "", time: "" }, o);
  }
  function MinutesDoc(o = {}) {
    return Object.assign({ session: SessionInfo(), members: [], topics: [], source_path: "" }, o);
  }

  const LABEL_TOPIC = "الموضوع";
  const LABEL_RATIONALE = X.norm("حيثيات الموضوع");
  const LABEL_DECISION = X.norm("التوصية / القرار");
  const LABEL_DOCUMENT = X.norm("المستند");
  const LABEL_ATTACH = X.norm("المرفقات");
  const LABEL_ACTION = X.norm("الإجراء المطلوب");
  const LABEL_VOTE = X.norm("تصويت الأعضاء");
  const LABEL_GUEST = X.norm("استضافة");
  const LABEL_SESSION_NO = X.norm("رقم الجلسة");

  function docTables(pkg) {
    return X.wChildren(pkg.body, "tbl");
  }

  // ---------------------------------------------------------------- file helpers
  function lowerName(file) {
    return String(file.name || file.path || "").toLowerCase();
  }
  function extOf(file) {
    const n = lowerName(file);
    const base = n.slice(n.lastIndexOf("/") + 1);
    const i = base.lastIndexOf(".");
    return i <= 0 ? "" : base.slice(i);
  }
  function openDocx(file) {
    if (file._pkg) return file._pkg;
    const pkg = X.DocxPackage.open(file.bytes, file.name);
    return pkg;
  }

  // ---------------------------------------------------------------- extract.read_text
  function readDocxText(file) {
    const pkg = openDocx(file);
    const parts = [];
    for (let c = pkg.body.firstElementChild; c; c = c.nextElementSibling) {
      if (X.isW(c, "p")) {
        const t = strip(X.paragraphText(c));
        if (t) parts.push(t);
      } else if (X.isW(c, "tbl")) {
        const t = strip(X.tablePlainText(c));
        if (t) parts.push(t);
      }
    }
    return parts.join("\n");
  }
  function readPlainText(file) {
    const s = new TextDecoder("utf-8", { ignoreBOM: true }).decode(file.bytes);
    return s.replace(/�/g, "").replace(/\r\n?/g, "\n");
  }
  async function readText(file) {
    const ext = extOf(file);
    if (ext === ".docx") return readDocxText(file);
    if (ext === ".pdf") return PDFText.readPlumberText(file);
    return readPlainText(file);
  }

  // ---------------------------------------------------------------- minutes_parser
  function cleanCouncilName(text) {
    text = strip(text);
    for (const prefix of ["اسم اللجنة", "اللجنة"]) {
      if (text.startsWith(prefix)) text = strip(text.slice(prefix.length));
    }
    text = strip(PY.lstrip(text, "/ "));
    for (const prefix of ["مجلس قسم", "مجلس كلية", "مجلس"]) {
      if (text.startsWith(prefix)) {
        text = strip(text.slice(prefix.length));
        break;
      }
    }
    text = strip(re.sub("\\([^)]*[A-Za-z][^)]*\\)\\s*$", "", text));
    const m = re.search("[A-Za-z]", text);
    if (m) text = strip(text.slice(0, m.start()));
    return strip(text, " ()");
  }

  function parseSessionHeader(pkg) {
    const info = SessionInfo();
    const tables = docTables(pkg);
    for (const table of tables) {
      const rows = X.tableRows(table);
      for (let i = 0; i < rows.length; i++) {
        const texts = X.rowTexts(rows[i]);
        if (!texts.length) continue;
        if (X.norm(texts[0]) === LABEL_SESSION_NO && texts.length >= 5) {
          if (i + 1 < rows.length) {
            const values = X.rowTexts(rows[i + 1]);
            if (values.length >= 5 && values.some((v) => strip(v))) {
              info.session_number = strip(values[0]);
              info.day = strip(values[1]);
              info.date = strip(values[2]);
              info.place = strip(values[3]);
              info.time = strip(values[4]);
            }
          }
        }
      }
    }
    if (tables.length) {
      const rows = X.tableRows(tables[0]);
      let first = "";
      if (rows.length) {
        const cells = X.rowCells(rows[0]);
        if (!cells.length) throw new Error("tuple index out of range");
        first = X.cellText(cells[0]);
      }
      info.council_name = cleanCouncilName(first);
    }
    return info;
  }

  function iterAllTables(tables, out = []) {
    for (const table of tables) {
      out.push(table);
      for (const tr of X.tableRows(table)) {
        for (const tc of X.rowCells(tr)) {
          const nested = X.cellTables(tc);
          if (nested.length) iterAllTables(nested, out);
        }
      }
    }
    return out;
  }

  function looksLikeRosterHeader(texts) {
    const joined = texts.map((t) => X.norm(t)).join("");
    return joined.includes(X.norm("الاسم")) && joined.includes(X.norm("الحضور"));
  }

  function parseMembers(pkg) {
    const members = [];
    const seen = new Set();
    for (const table of iterAllTables(docTables(pkg))) {
      let inRoster = false;
      for (const tr of X.tableRows(table)) {
        const vals = X.rowTexts(tr);
        if (!vals.length) continue;
        if (looksLikeRosterHeader(vals)) { inRoster = true; continue; }
        if (!inRoster) continue;
        if (vals.length < 2 || !strip(vals[1])) { inRoster = false; continue; }
        if (X.norm(vals[0]).startsWith(LABEL_TOPIC) || X.norm(vals[0]) === LABEL_VOTE || X.norm(vals[0]) === LABEL_GUEST) {
          inRoster = false;
          continue;
        }
        const name = strip(vals[1]);
        if (seen.has(name)) continue;
        seen.add(name);
        members.push({
          seq: vals.length > 0 ? strip(vals[0]) : "",
          name,
          rank: vals.length > 2 ? strip(vals[2]) : "",
          role: vals.length > 3 ? strip(vals[3]) : "",
          attendance: vals.length > 4 ? strip(vals[4]) : "",
        });
      }
    }
    return members;
  }

  function cellParagraphText(tc) {
    const parts = [];
    for (const p of X.cellParagraphs(tc)) {
      const t = X.paragraphText(p);
      if (strip(t)) parts.push(strip(t));
    }
    return strip(parts.join("\n"));
  }

  function tableMatrix(table) {
    const matrix = [];
    for (const tr of X.tableRows(table)) {
      const vals = [];
      const seen = new Set();
      for (const tc of X.rowCells(tr)) {
        if (seen.has(tc)) continue;
        seen.add(tc);
        vals.push(strip(X.cellText(tc)));
      }
      if (vals.some((v) => v)) matrix.push(vals);
    }
    return matrix;
  }

  function parseTopicTable(table) {
    const topic = Topic();
    const rows = X.tableRows(table);
    let idx = 0;
    const n = rows.length;
    while (idx < n) {
      const texts = X.rowTexts(rows[idx]);
      if (!texts.length) { idx++; continue; }
      const label = X.norm(texts[0]);
      if (label.startsWith(LABEL_TOPIC) && !topic.title) {
        const m = strip(texts[0]);
        topic.number = strip(m.split("الموضوع").join(""));
        topic.title = texts.length > 1 ? strip(texts[1]) : "";
      } else if (label === LABEL_RATIONALE) {
        const cells = X.rowCells(rows[idx]);
        if (cells.length > 1) {
          const valueCell = cells[1];
          topic.rationale = cellParagraphText(valueCell);
          for (const nested of X.cellTables(valueCell)) {
            const matrix = tableMatrix(nested);
            if (matrix.length) topic.data_tables.push(matrix);
          }
        } else topic.rationale = "";
      } else if (label === LABEL_DECISION) {
        topic.decision = texts.length > 1 ? strip(texts[1]) : "";
      } else if (label === LABEL_DOCUMENT) {
        topic.document_ref = texts.length > 1 ? strip(texts[1]) : "";
      } else if (label === LABEL_ATTACH) {
        topic.attachments = texts.length > 1 ? strip(texts[1]) : "";
      } else if (label === LABEL_ACTION) {
        topic.action_required = texts.length > 1 ? strip(texts[1]) : "";
      } else if (label === LABEL_VOTE) {
        idx++;
        while (idx < n) {
          const v = X.rowTexts(rows[idx]);
          if (!v.length || X.norm(v[0]) === LABEL_GUEST) break;
          if (v.length >= 2 && strip(v[1])) {
            topic.votes.push({
              name: strip(v[1]),
              agree: v.length > 2 ? strip(v[2]) : "",
              disagree: v.length > 3 ? strip(v[3]) : "",
              note: v.length > 4 ? strip(v[4]) : "",
            });
          }
          idx++;
        }
        continue;
      } else if (label === LABEL_GUEST) {
        idx++;
        while (idx < n) {
          const g = X.rowTexts(rows[idx]);
          if (!g.length) break;
          if (g.length >= 2 && strip(g[1]) && X.norm(g[1]) !== "لايوجد") {
            topic.guests.push({ name: strip(g[1]), role: g.length > 2 ? strip(g[2]) : "" });
          }
          idx++;
        }
        continue;
      }
      idx++;
    }
    return topic;
  }

  function isTopicTable(table) {
    const rows = X.tableRows(table);
    if (!rows.length) return false;
    for (const tr of rows.slice(0, 2)) {
      const texts = X.rowTexts(tr);
      if (texts.length && X.norm(texts[0]).startsWith(LABEL_TOPIC)) return true;
    }
    return false;
  }

  function isSessionOrAgendaTable(table) {
    for (const tr of X.tableRows(table).slice(0, 6)) {
      const vals = X.rowTexts(tr);
      const joined = vals.join(" ");
      if (vals.length && X.norm(vals[0]) === LABEL_SESSION_NO) return true;
      if (joined.includes("جدول الأعمال") || joined.includes("جدول الاعمال")) return true;
    }
    return false;
  }

  function isMembersOrSignatureTable(table) {
    for (const tr of X.tableRows(table).slice(0, 4)) {
      const vals = X.rowTexts(tr);
      const joinedN = vals.map((x) => X.norm(x)).join("");
      if (looksLikeRosterHeader(vals)) return true;
      if (joinedN.includes(X.norm("التوقيع")) && joinedN.includes(X.norm("الاسم"))) return true;
    }
    return false;
  }

  function appendSupplementalTable(topic, table) {
    const txt = strip(X.tablePlainText(table));
    if (!txt) return;
    if (isSessionOrAgendaTable(table) || isMembersOrSignatureTable(table)) return;
    const matrix = tableMatrix(table);
    if (matrix.length && !topic.data_tables.some((t) => PY.deepEqual(t, matrix))) topic.data_tables.push(matrix);
  }

  function parseMinutesDocx(file) {
    const pkg = openDocx(file);
    const minutes = MinutesDoc({ source_path: file.path || file.name || "" });
    minutes.session = parseSessionHeader(pkg);
    minutes.members = parseMembers(pkg);
    let current = null;
    for (let c = pkg.body.firstElementChild; c; c = c.nextElementSibling) {
      if (!X.isW(c, "tbl")) continue;
      if (isTopicTable(c)) {
        const topic = parseTopicTable(c);
        if (topic.title) {
          minutes.topics.push(topic);
          current = topic;
        } else current = null;
        continue;
      }
      if (current !== null) appendSupplementalTable(current, c);
    }
    return minutes;
  }

  const TOPIC_SPLIT_RE = re.compile(
    "(?:^|\\n)\\s*(?:الموضوع|البند)\\s*[:\\-]?\\s*" +
    "([0-9]{1,2}|الأول|الثاني|الثالث|الرابع|الخامس|السادس|السابع|الثامن|التاسع|العاشر)\\b"
  );

  async function parseMinutesPlain(file) {
    const text = await readText(file);
    const minutes = MinutesDoc({ source_path: file.path || file.name || "" });
    const matches = TOPIC_SPLIT_RE.finditer(text);
    for (let i = 0; i < matches.length; i++) {
      const m = matches[i];
      const start = m.end();
      const end = i + 1 < matches.length ? matches[i + 1].start() : text.length;
      const chunk = strip(text.slice(start, end));
      const lines = PY.splitlines(chunk).map((ln) => strip(ln)).filter((ln) => ln);
      const title = lines.length ? lines[0] : "";
      const rationale = lines.slice(1).join("\n");
      minutes.topics.push(Topic({ number: m.group(1), title, rationale }));
    }
    return minutes;
  }

  async function parseMinutesFile(file) {
    if (lowerName(file).endsWith(".docx")) return parseMinutesDocx(file);
    return parseMinutesPlain(file);
  }

  // ---------------------------------------------------------------- archive
  const SUPPORTED_EXTS = [".docx", ".pdf", ".txt"];

  function archNorm(text) {
    text = (text || "").toLowerCase();
    text = re.sub("[إأآ]", "ا", text);
    text = text.split("ة").join("ه").split("ى").join("ي");
    text = re.sub("\\s+", " ", text);
    return strip(text);
  }

  function basename(p) {
    const s = String(p || "");
    return s.slice(s.lastIndexOf("/") + 1);
  }

  async function detectLevel(file) {
    const name = archNorm(basename(file.path || file.name));
    if (name.includes("مجلس الكليه") || name.includes("مجلس كليه")) return "college";
    if (name.includes("مجلس قسم")) return "department";
    let text;
    try {
      text = archNorm((await readText(file)).slice(0, 16000));
    } catch (e) {
      return "unknown";
    }
    if (text.includes("مجلس كليه") || text.includes("اللجنه / مجلس كليه") || text.includes("اسم اللجنه / مجلس كليه")) return "college";
    if (text.includes("مجلس قسم") || text.includes("اللجنه / مجلس قسم") || text.includes("اسم اللجنه / مجلس قسم")) return "department";
    return "unknown";
  }

  // files: [{name, path (relative to the chosen folder), bytes}]
  // os.walk order: files of a folder (sorted), then sub-folders (sorted here).
  function walkOrder(files) {
    const tree = { files: [], dirs: new Map() };
    for (const f of files) {
      const parts = String(f.path || f.name).split("/");
      let node = tree;
      for (const d of parts.slice(0, -1)) {
        if (!node.dirs.has(d)) node.dirs.set(d, { files: [], dirs: new Map() });
        node = node.dirs.get(d);
      }
      node.files.push(f);
    }
    const out = [];
    const visit = (node) => {
      node.files.sort((a, b) => PY.cmpStr(basename(a.path || a.name), basename(b.path || b.name)));
      out.push(...node.files);
      const names = Array.from(node.dirs.keys()).sort(PY.cmpStr);
      for (const n of names) visit(node.dirs.get(n));
    };
    visit(tree);
    return out;
  }

  async function buildArchive(files, councilLevel = null, onProgress = null) {
    const topics = [];
    if (!files || !files.length) return topics;
    const ordered = walkOrder(files);
    let done = 0;
    for (const file of ordered) {
      done++;
      if (onProgress) onProgress(done, ordered.length, file);
      const nm = basename(file.path || file.name).toLowerCase();
      if (!SUPPORTED_EXTS.some((e) => nm.endsWith(e))) continue;
      let level = null;
      if (councilLevel) {
        const detected = await detectLevel(file);
        if (detected !== councilLevel) continue;
        level = councilLevel;
      }
      let minutes;
      try {
        minutes = await parseMinutesFile(file);
      } catch (e) {
        continue;
      }
      const rel = file.path || file.name;
      for (const t of minutes.topics) {
        topics.push({
          title: t.title,
          rationale: t.rationale,
          decision: t.decision,
          document_ref: t.document_ref,
          attachments: t.attachments,
          action_required: t.action_required,
          source_file: rel,
          source_path: rel,
          session_number: minutes.session.session_number,
          session_date: minutes.session.date,
          council_name: minutes.session.council_name,
          council_level: level || (await detectLevel(file)),
        });
      }
    }
    return topics;
  }

  return {
    Topic, SessionInfo, MinutesDoc, readText, readDocxText, readPlainText, parseMinutesDocx, parseMinutesPlain,
    parseMinutesFile, cleanCouncilName, tableMatrix, buildArchive, detectLevel, extOf, basename, openDocx,
    LABEL_RATIONALE, LABEL_DECISION, LABEL_DOCUMENT, LABEL_ATTACH, LABEL_ACTION, LABEL_SESSION_NO,
  };
})();
