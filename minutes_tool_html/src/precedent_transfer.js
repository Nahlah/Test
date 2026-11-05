/* تحويل حتمي من مجلس القسم إلى مجلس الكلية بالاستناد إلى موضوع مرجعي من مجلس الكلية.
 * منقول سطرًا بسطر من core/precedent_transfer.py و core/draft_helpers.py.
 */
"use strict";

const Precedent = (() => {
  const { re, strip, rstrip, lstrip, SequenceMatcher } = PY;

  // ---------------------------------------------------------------- draft_helpers
  function _arabic_ordinal_feminine(n) {
    const words = {
      1: "الأولى", 2: "الثانية", 3: "الثالثة", 4: "الرابعة", 5: "الخامسة",
      6: "السادسة", 7: "السابعة", 8: "الثامنة", 9: "التاسعة", 10: "العاشرة",
      11: "الحادية عشرة", 12: "الثانية عشرة", 13: "الثالثة عشرة", 14: "الرابعة عشرة",
      15: "الخامسة عشرة", 16: "السادسة عشرة", 17: "السابعة عشرة", 18: "الثامنة عشرة",
      19: "التاسعة عشرة", 20: "العشرون",
    };
    const s = pyStr(n);
    let num;
    try {
      num = PY.int(re.sub("\\D", "", s));
    } catch (e) {
      return s;
    }
    return Object.prototype.hasOwnProperty.call(words, num) ? words[num] : `رقم ${num}`;
  }
  function pyStr(v) {
    if (v === null || v === undefined) return "None";
    if (typeof v === "number") return PY.strNumber(v);
    if (typeof v === "boolean") return v ? "True" : "False";
    return String(v);
  }
  function session_ordinal_text(session_number) {
    if (typeof session_number === "string" && PY.anyAlpha(session_number)) return session_number;
    return _arabic_ordinal_feminine(session_number);
  }

  // ---------------------------------------------------------------- classification
  function _norm(text) {
    text = (text || "").toLowerCase();
    text = re.sub("[إأآ]", "ا", text);
    text = text.split("ة").join("ه").split("ى").join("ي");
    text = re.sub("\\s+", " ", text);
    return strip(text);
  }
  const has = (t, k) => t.includes(k);
  const anyIn = (t, ks) => ks.some((k) => t.includes(k));

  function topic_family(title, rationale = "") {
    const t = _norm(`${title ?? ""} ${rationale ?? ""}`);
    if ((has(t, "بدل التميز") || has(t, "بدل تميز") || has(t, "مكافاه تميز") || has(t, "مكافاه التميز")) && has(t, "نشر")) return "research_bonus";
    if (has(t, "مؤتمر") && (has(t, "حضور") || has(t, "مشاركه"))) return "conference";
    if (has(t, "تعيين") && anyIn(t, ["عضو هيئه تدريس", "استاذ", "محاضر", "معيد", "طلب تعيين", "التعيين"])) return "appointment";
    if (anyIn(t, ["ترقيه", "الترقيه", "للترقيه", "طلب الترقيه"]) && anyIn(t, ["رتبه", "استاذ", "استاذ مساعد", "استاذ مشارك", "الترقيه"])) return "promotion";
    if (has(t, "اللجنه الثلاثيه") && anyIn(t, ["تشكيل", "اعاده تشكيل", "إعادة تشكيل", "اعادة تشكيل", "تسميه", "تسمية"])) return "";
    if ((has(t, "اللجنه الثلاثيه") || has(t, "شؤون الابتعاث") || has(t, "الابتعاث")) &&
      anyIn(t, ["تمديد", "بعثه", "دكتوراه", "دكتوراة", "ماجستير", "مبتعث", "ابتعاث المحاضر", "ابتعاث المعيد"])) return "scholarship_notice";
    if (has(t, "احاطه المجلس") && anyIn(t, ["تمديد", "بعثه", "ابتعاث"])) return "scholarship_notice";
    if (anyIn(t, ["تغيير تخصص", "تغيير التخصص", "تحويل تخصص", "التحويل من تخصص", "التحويل الى تخصص", "التحويل إلى تخصص"])) return "change_major";
    const title_n = strip(_norm(title ?? ""));
    const schedule_context = anyIn(t, [
      "برنامج", "برامج", "ماجستير", "بكالوريوس", "دكتوراه", "دكتوراة",
      "الفصل الدراسي", "العام الجامعي", "المقررات", "الوحدات التدريسيه",
      "العبء التدريسي",
    ]);
    if (anyIn(t, ["الجداول الدراسيه", "اعتماد الجداول", "اعتماد جداول", "اقرار الجداول", "اقرار جداول", "الجدول الدراسي",
      "جداول برنامج", "جداول برامج", "جدول برنامج", "جدول برامج"]) ||
      (has(t, "جداول") && schedule_context) || title_n === "الجداول" || title_n === "جداول") return "schedules";
    return "";
  }

  const STRICT_REFERENCE_FAMILIES = new Set(["appointment", "promotion", "research_bonus", "conference"]);
  const SINGLE_REFERENCE_FAMILIES = new Set(["appointment", "promotion", "research_bonus"]);

  function reference_topics_for_current(archive_topics, title, rationale = "") {
    const family = topic_family(title, rationale);
    let topics = Array.from(archive_topics || []);
    if (STRICT_REFERENCE_FAMILIES.has(family)) {
      topics = topics.filter((p) => topic_family(p.title ?? "", p.rationale ?? "") === family);
    }
    return [family, topics];
  }

  // ---------------------------------------------------------------- applicant extraction
  const _HONORIFIC = "(?:الأستاذة?\\s+الدكتور(?:ة)?|الدكتور(?:ة)?|المحاضر(?:ة)?|الأستاذ(?:ة)?)";
  const _RANK = "(?:أستاذ(?:ة)?(?:\\s+(?:مساعد|مشارك))?|محاضر(?:ة)?|معيد(?:ة)?)";

  class Applicant {
    constructor(honorific = "", name = "", rank = "", department = "") {
      this.honorific = honorific;
      this.name = name;
      this.rank = rank;
      this.department = department;
    }
    get short() {
      if (!this.honorific && !this.name) return "";
      return strip(`${this.honorific}/ ${this.name}`);
    }
    get with_rank_department() {
      return this.formatted("بقسم");
    }
    formatted(connector = "بقسم") {
      let s = this.short;
      const redundant = _norm(this.honorific).includes("محاضر") && this.rank && _norm(this.rank).includes("محاضر");
      if (this.rank && !redundant) s += `، ${this.rank}`;
      if (this.department) s += ` ${connector} ${this.department}`;
      return s;
    }
  }

  const APP_RE1 = "(?P<honorific>" + _HONORIFIC + ")\\s*/\\s*" +
    "(?P<name>.+?)" +
    "(?=(?:\\s*[,،]\\s*|\\s+)(?:" + _RANK + ")\\b|\\s+(?:في\\s+|ب)قسم\\b|\\s+(?:لحضور|بصرف|بطلب|لتعيين|للتعيين|لترقية|للترقية|لترقيه|للترقيه|بالترقية|بالترقيه)\\b|[.\\n])";
  const APP_RE2 = "(?P<honorific>" + _HONORIFIC + ")\\s*/\\s*(?P<name>.+?)(?=\\s+(?:لحضور|بصرف|لتعيين|للتعيين|لترقية|للترقية|في\\s+قسم|بقسم)|[,،.\\n])";
  const RANK_TAIL_RE = "[,،]?\\s*(?P<rank>" + _RANK + ")\\b";
  const DEPT_RE = "(?:في\\s+قسم|بقسم)\\s+([^،,.\\n]+?)(?=\\s+(?:لحضور|بصرف|بكلية|للترقية|لترقية|للترقيه|لترقيه|إلى\\s+رتبة|الى\\s+رتبه|للتعيين|لتعيين)|[,،.\\n]|$)";

  function extract_applicant(title, rationale = "", default_department = "") {
    const text = `${title ?? ""}\n${rationale ?? ""}`;
    let m = re.search(APP_RE1, text, re.IGNORECASE);
    if (!m) m = re.search(APP_RE2, text, re.IGNORECASE);
    const honorific = m ? strip(m.group("honorific")) : "";
    const name = m ? strip(m.group("name"), " ،,") : "";
    let rank = "";
    if (m) {
      const tail = text.slice(m.end(), m.end() + 180);
      const rm = re.search(RANK_TAIL_RE, tail, re.IGNORECASE);
      if (rm) rank = strip(rm.group("rank"));
    }
    let department = "";
    for (const source of [title ?? "", rationale ?? ""]) {
      const dm = re.search(DEPT_RE, source, re.IGNORECASE);
      if (dm) {
        department = strip(dm.group(1));
        break;
      }
    }
    department = department || default_department;
    return new Applicant(honorific, name, rank, department);
  }

  // ---------------------------------------------------------------- text helpers
  function _details_from_label(text, labels) {
    if (!text) return "";
    for (const label of labels) {
      const m = re.search(re.escape(label) + "\\s*:?[ \\t]*", text, re.IGNORECASE);
      if (m) return strip(text.slice(m.start()));
    }
    return strip(text);
  }

  function _is_unanimous(topic) {
    const raw = topic.decision ?? "";
    const decision = _norm(raw);
    if (decision.includes("بالاجماع") || raw.includes("بالإجماع")) return true;
    const votes = topic.votes || [];
    if (votes.length) {
      for (const v of votes) {
        const d = strip(v.disagree || "");
        if (d !== "" && d !== "-") return false;
      }
      return true;
    }
    return false;
  }

  function _vote_phrase(topic) {
    return _is_unanimous(topic) ? "بالإجماع " : "";
  }

  function _append_college_if_precedent(precedent_title, phrase) {
    if ((precedent_title || "").includes("بكلية الحوسبة والمعلوماتية") && !phrase.includes("بكلية الحوسبة والمعلوماتية")) {
      phrase += " بكلية الحوسبة والمعلوماتية";
    }
    return phrase;
  }

  function _split_lines(text) {
    if (!text) return [];
    const raw = [];
    for (let line of re.split("[\\r\\n]+", text)) {
      line = strip(re.sub("^\\s*(?:[•·\\-–—]|\\d+[.)])\\s*", "", line), " \t•·-–—");
      if (!line) continue;
      raw.push(rstrip(line, ". "));
    }
    return raw;
  }

  function _line_similarity(a, b) {
    return new SequenceMatcher(null, _norm(a), _norm(b)).ratio();
  }

  function _dedupe_lines(lines, threshold = 0.78) {
    const out = [];
    for (const line of lines) {
      if (!line) continue;
      if (out.some((existing) => _line_similarity(line, existing) >= threshold)) continue;
      out.push(line);
    }
    return out;
  }

  function _bullet_join(lines) {
    return lines.join("\n");
  }

  function _style_date_like_precedent(session_date, precedent) {
    const d = strip(session_date || "");
    const sample = `${precedent.rationale ?? ""}\n${precedent.attachments ?? ""}`;
    if (re.search("\\d{1,2}/\\d{1,2}/\\d{4}", sample)) return d.split(".").join("/").split("-").join("/");
    if (re.search("\\d{1,2}\\.\\d{1,2}\\.\\d{4}", sample)) return d.split("/").join(".").split("-").join(".");
    return d;
  }

  function _department_minutes_line(department_name, session_ordinal, session_date, precedent) {
    const patt = _split_lines(precedent.attachments ?? "").join("\n");
    const uses_held = patt.includes("المنعقدة");
    const date_suffix = re.search("بتاريخ\\s+[^\\n]*م", patt) ? "م" : "";
    if (uses_held) return `محضر قسم ${department_name} في جلسته ${session_ordinal} المنعقدة بتاريخ ${session_date}${date_suffix}`;
    return `محضر قسم ${department_name} في جلسته ${session_ordinal} بتاريخ ${session_date}${date_suffix}`;
  }

  function _merge_documents(precedent_doc, current_doc) {
    const base = _split_lines(precedent_doc);
    const current = _split_lines(current_doc);
    const merged = base.slice();
    for (const line of current) {
      if (line.includes("الرفع لمجلس الكلية")) continue;
      if (!merged.some((b) => _line_similarity(line, b) >= 0.64)) merged.push(line);
    }
    return _bullet_join(_dedupe_lines(merged, 0.80));
  }

  function _attachments_from_precedent(precedent, current_topic, department_name, session_ordinal, session_date) {
    const prev_lines = _split_lines(precedent.attachments ?? "").filter((x) => !x.includes("محضر قسم"));
    const cur_lines = _split_lines(current_topic.attachments ?? "").filter((x) => !x.includes("محضر قسم"));
    const lines = prev_lines.slice();
    for (const line of cur_lines) {
      if (!lines.some((p) => _line_similarity(line, p) >= 0.60)) lines.push(line);
    }
    lines.push(_department_minutes_line(department_name, session_ordinal, session_date, precedent));
    return _bullet_join(_dedupe_lines(lines, 0.80));
  }

  function _precedent_of_same_family(precedents, family) {
    for (const [p, score] of precedents || []) {
      if (topic_family(p.title ?? "", p.rationale ?? "") === family) return [p, score];
    }
    return precedents && precedents.length ? precedents[0] : [null, 0.0];
  }

  // ---------------------------------------------------------------- labelled sections
  const _KNOWN_LABELS = [
    "عنوان البحث", "عنوان الأبحاث", "اسم المجلة", "المجلة", "تاريخ النشر", "معامل التأثير", "تخصص المجلة",
    "عنوان المؤتمر", "نبذة موجزة عن المؤتمر", "تاريخ عقد المؤتمر", "الجهة المنظمة", "عمر المؤتمر", "المدينة",
    "الدولة", "نوع المشاركة", "عنوان البحث المقبول للنشر", "تخصص العضو",
    "الاسم", "اسم العضو", "اسم عضو هيئة التدريس", "اسم المرشح", "اسم المرشحة", "الرقم الوظيفي",
    "رقم الهوية", "رقم الهوية الوطنية", "رقم السجل المدني", "السجل المدني", "الجنسية",
    "الرتبة العلمية", "الرتبة الحالية", "الرتبة المطلوبة", "المسمى الوظيفي", "جهة العمل",
    "التخصص العام", "التخصص الدقيق", "المؤهل", "الدرجة العلمية", "الجامعة", "جامعة التخرج",
    "جهة التخرج", "تاريخ التخرج", "سنة التخرج", "القسم", "الكلية",
    "اسم الطالب", "اسم الطالبة", "الطالب", "الطالبة", "الرقم الجامعي", "الرقم الأكاديمي",
    "رقم الطالب", "رقم الطالبة", "البرنامج", "اسم البرنامج", "البرنامج الحالي", "البرنامج المطلوب",
    "التخصص", "التخصص الحالي", "التخصص المطلوب", "التخصص المراد التحويل إليه", "التخصص المراد التحويل اليه",
    "المسار", "الفرع", "المستوى", "الحالة الأكاديمية", "الحالة الاكاديمية", "المعدل التراكمي", "المعدل",
    "عدد الساعات المجتازة", "الساعات المجتازة", "الساعات المكتسبة", "عدد الساعات",
    "نوع الطلب", "سبب الطلب", "مبررات الطلب", "سبب التأجيل", "مبررات التأجيل", "مدة التأجيل",
    "الفصل الدراسي", "العام الجامعي", "تاريخ بداية التأجيل", "تاريخ نهاية التأجيل", "عدد فصول التأجيل",
    "عدد الفصول المؤجلة", "تاريخ الانقطاع", "مدة الانقطاع", "آخر فصل دراسي", "اخر فصل دراسي",
    "الفصل المراد إعادة القيد فيه", "الفصل المراد اعادة القيد فيه", "تاريخ إعادة القيد", "تاريخ اعادة القيد",
    "اسم المقرر", "رمز المقرر", "الرقم المرجعي", "تاريخ الطلب", "الجهة",
  ];

  function _label_key(label) {
    return _norm(label).split(" ").join("");
  }
  let KNOWN = null;
  const LABEL_HINTS = ["اسم", "رقم", "تخصص", "برنامج", "معدل", "ساعات", "فصل", "تاريخ",
    "مده", "مدة", "سبب", "مبرر", "رتبه", "رتبة", "جامعه", "جامعة",
    "كليه", "كلية", "قسم", "حاله", "حالة", "جنس", "مؤهل", "درجه", "درجة"];

  function _parse_labeled_sections(text) {
    const lines = PY.splitlines(text || "");
    if (!KNOWN) KNOWN = new Set(_KNOWN_LABELS.map(_label_key));
    const known = KNOWN;
    const prefix_lines = [];
    const sections = [];
    let current_label = null;
    let current_values = [];
    let seen_section = false;

    const is_label = (candidate) => {
      const c = rstrip(strip(candidate || ""), ":：");
      if (!c || PY.len(c) > 55) return false;
      const key = _label_key(c);
      if (known.has(key)) return true;
      return !!re.fullmatch("[\\u0600-\\u06FF\\s()/_-]{2,40}", c) && LABEL_HINTS.some((k) => key.includes(k));
    };
    const flush_current = () => {
      if (current_label !== null) {
        const value = strip(current_values.filter((v) => v !== null).join("\n"));
        sections.push([current_label, value]);
        seen_section = true;
      }
      current_label = null;
      current_values = [];
    };

    for (const raw of lines) {
      const stripped = strip(raw);
      if (!stripped) {
        if (current_label !== null) current_values.push("");
        else if (!seen_section) prefix_lines.push(raw);
        continue;
      }
      if (stripped.includes("|")) {
        let cells = stripped.split("|").map((c) => strip(c));
        cells = cells.filter((c) => c !== "");
        if (cells.length >= 2) {
          let paired = [];
          let i = 0;
          while (i + 1 < cells.length) {
            if (is_label(cells[i])) {
              paired.push([strip(rstrip(cells[i], ":：")), strip(cells[i + 1])]);
              i += 2;
            } else {
              paired = [];
              break;
            }
          }
          if (paired.length) {
            flush_current();
            sections.push(...paired);
            seen_section = true;
            continue;
          }
          if (is_label(cells[0])) {
            flush_current();
            sections.push([strip(rstrip(cells[0], ":：")), strip(cells.slice(1).join(" | "))]);
            seen_section = true;
            continue;
          }
        }
      }
      const match = re.match("^([^:：]{2,55})[:：]\\s*(.*)$", stripped);
      if (match && is_label(match.group(1))) {
        flush_current();
        current_label = strip(match.group(1));
        if (strip(match.group(2))) current_values.push(strip(match.group(2)));
        continue;
      }
      if (is_label(stripped) && known.has(_label_key(stripped))) {
        flush_current();
        current_label = strip(rstrip(stripped, ":："));
        continue;
      }
      if (current_label !== null) current_values.push(rstrip(raw));
      else if (!seen_section) prefix_lines.push(rstrip(raw));
      else if (sections.length) {
        const [label, value] = sections[sections.length - 1];
        sections[sections.length - 1] = [label, strip(rstrip(value) + "\n" + rstrip(raw))];
      }
    }
    flush_current();
    const prefix = strip(prefix_lines.join("\n"));
    return [prefix, sections];
  }

  function _replace_referral_session(text, department_name, session_ordinal, styled_date) {
    if (!text) return text;
    const repl = (m) => {
      const held = " المنعقدة";
      const suffix = rstrip(m.group(0)).endsWith("م") ? "م" : "";
      return `مجلس قسم ${department_name} في جلسته ${session_ordinal}${held} بتاريخ ${styled_date}${suffix}`;
    };
    return re.sub(
      "مجلس\\s+قسم\\s+[^،,.\\n]+?\\s+في\\s+جلسته\\s+.+?(?:\\s+المنعقدة)?\\s+بتاريخ\\s+[0-9./-]+\\s*م?",
      repl, text, 1,
    );
  }

  function _replace_applicant_in_template(text, old, nw) {
    if (!text || !old.short || !nw.short) return text;
    const variants = [];
    for (const connector of ["في قسم", "بقسم"]) {
      const old_full = old.formatted(connector);
      const new_full = nw.formatted(connector);
      if (old_full && old_full !== old.short) variants.push([old_full, new_full]);
    }
    variants.push([old.short, nw.short]);
    let out = text;
    const sorted = variants.slice().sort((a, b) => PY.len(b[0]) - PY.len(a[0]));
    for (const [a, b] of sorted) out = out.split(a).join(b);
    return out;
  }

  function _gender_neutralize_if_needed(text, old, nw) {
    const isFemale = (h) => h.includes("ة") || (h.endsWith("ه") && _norm(h).includes("دكتور"));
    const old_female = isFemale(old.honorific);
    const new_female = isFemale(nw.honorific);
    if (old_female === new_female) return text;
    let swaps = [
      ["لبحثها المنشور", "لبحثه المنشور"],
      ["لأبحاثها المنشورة", "لأبحاثه المنشورة"],
      ["بحثها", "بحثه"],
      ["أبحاثها", "أبحاثه"],
    ];
    if (new_female) swaps = swaps.map(([k, v]) => [v, k]);
    for (const [a, b] of swaps) text = text.split(a).join(b);
    return text;
  }

  function _generic_staff_transfer(current_topic, department_name, session_number, session_date, precedent, score) {
    if (score < 0.55) return null;
    const old_app = extract_applicant(precedent.title ?? "", precedent.rationale ?? "", department_name);
    const new_app = extract_applicant(current_topic.title, current_topic.rationale, department_name);
    if (!old_app.short || !new_app.short) return null;

    const [prev_prefix, prev_sections] = _parse_labeled_sections(precedent.rationale ?? "");
    const [, cur_sections] = _parse_labeled_sections(current_topic.rationale);
    const cur_map = new Map(cur_sections.map(([label, value]) => [_label_key(label), [label, value]]));
    const shared = prev_sections.filter(([label]) => cur_map.has(_label_key(label)));
    if (!shared.length) return null;

    const ordinal = session_ordinal_text(session_number);
    const styled_date = _style_date_like_precedent(session_date, precedent);

    let prefix = _replace_referral_session(prev_prefix, department_name, ordinal, styled_date);
    prefix = _replace_applicant_in_template(prefix, old_app, new_app);
    prefix = _gender_neutralize_if_needed(prefix, old_app, new_app);

    const prev_label_map = new Map(prev_sections.map(([label]) => [_label_key(label), label]));
    const out_sections = cur_sections.map(([cur_label, cur_value]) => {
      const key = _label_key(cur_label);
      return [prev_label_map.has(key) ? prev_label_map.get(key) : cur_label, cur_value];
    });

    const rationale_parts = prefix ? [prefix] : [];
    for (const [label, value] of out_sections) rationale_parts.push(`${label}:` + (value ? `\n${value}` : ""));
    const rationale = strip(rationale_parts.filter((x) => x).join("\n"));

    const title = _replace_applicant_in_template(precedent.title ?? "", old_app, new_app);
    let decision = _replace_applicant_in_template(precedent.decision ?? "", old_app, new_app);
    decision = _gender_neutralize_if_needed(decision, old_app, new_app);
    if (_is_unanimous(current_topic)) {
      if (!decision.includes("بالإجماع")) decision = PY.replace(decision, "التوصية بالموافقة", "التوصية بالموافقة بالإجماع", 1);
    }

    const combined = `${title}\n${rationale}\n${decision}`;
    if (old_app.name && combined.includes(old_app.name)) return null;

    return {
      title: title || strip(re.sub("^\\s*دراسة\\s+", "", current_topic.title)),
      rationale,
      decision,
      document_ref: strip(precedent.document_ref ?? ""),
      attachments: _attachments_from_precedent(precedent, current_topic, department_name, ordinal, styled_date),
      action_required: strip(precedent.action_required ?? ""),
      _generation_method: "أتمتة عامة بالقالب السابق",
      _precedent_source: precedent.source_file ?? "",
      _precedent_score: score,
    };
  }

  // ---------------------------------------------------------------- department-source-first
  function _structured_staff_value(topic, key) {
    const data = topic._structured_fields || {};
    const value = data && typeof data === "object" && !Array.isArray(data) ? (data[key] ?? "") : "";
    return strip(pyStr(value || ""));
  }

  function _current_staff_applicant(current_topic, department_name, old = null) {
    const app = extract_applicant(current_topic.title || "", current_topic.rationale || "", department_name);
    const name = _structured_staff_value(current_topic, "member_name") || app.name;
    const rank = _structured_staff_value(current_topic, "member_rank") || app.rank;
    const gender = _norm(_structured_staff_value(current_topic, "member_gender"));
    let honor = app.honorific;
    if (!honor && old !== null) honor = old.honorific;
    if (gender) {
      const female = ["انثى", "انثي", "female"].some((x) => gender.includes(x));
      const male = ["ذكر", "male"].some((x) => gender.includes(x));
      const nrank = _norm(rank);
      if (female) honor = nrank.includes("محاضر") ? "المحاضرة" : "الدكتورة";
      else if (male) honor = nrank.includes("محاضر") ? "المحاضر" : "الدكتور";
    }
    return new Applicant(honor, name, rank, department_name || app.department);
  }

  function _promotion_rank_from_text(text, which) {
    text = text || "";
    const rank = "(?:أستاذ(?:ة)?(?:\\s+(?:مساعد|مشارك))?|محاضر(?:ة)?|معيد(?:ة)?)";
    const patterns = which === "target"
      ? [
        `(?:إلى|الى)\\s+رتبة\\s+(${rank})`,
        `الرتبة\\s+(?:المطلوب|المراد)\\s+الترقية\\s+(?:إليها|اليها)\\s*[:：]?\\s*(${rank})`,
        `الرتبة\\s+المطلوبة\\s*[:：]?\\s*(${rank})`,
      ]
      : [
        `من\\s+رتبة\\s+(${rank})`,
        `الرتبة\\s+الحالية\\s*[:：]?\\s*(${rank})`,
      ];
    for (const patt of patterns) {
      const m = re.search(patt, text, re.IGNORECASE);
      if (m) return strip(m.group(1));
    }
    return "";
  }

  function _replace_promotion_rank_slots(title, ref_title, current_topic) {
    const current_blob = `${current_topic.title ?? ""}\n${current_topic.rationale ?? ""}`;
    const current_rank = _structured_staff_value(current_topic, "member_rank") || _promotion_rank_from_text(current_blob, "current");
    const target_rank = _structured_staff_value(current_topic, "target_rank") || _promotion_rank_from_text(current_blob, "target");
    const old_current = _promotion_rank_from_text(ref_title, "current");
    const old_target = _promotion_rank_from_text(ref_title, "target");
    let out = title;
    if (old_target && target_rank && old_target !== target_rank) {
      out = re.sub("((?:إلى|الى)\\s+رتبة\\s+)" + re.escape(old_target), (m) => m.group(1) + target_rank, out, 1, re.IGNORECASE);
    }
    if (old_current && current_rank && old_current !== current_rank) {
      out = re.sub("(من\\s+رتبة\\s+)" + re.escape(old_current), (m) => m.group(1) + current_rank, out, 1, re.IGNORECASE);
    }
    return out;
  }

  function _staff_title_from_college_reference(current_topic, precedent, department_name) {
    const ref_title = strip(precedent.title || "");
    if (!ref_title) return "";
    const family = topic_family(current_topic.title ?? "", current_topic.rationale ?? "");
    const old = extract_applicant(ref_title, precedent.rationale || "", precedent.council_name || department_name);
    const nw = _current_staff_applicant(current_topic, department_name, old);
    if (!old.short || !nw.short) return "";
    let title = _replace_applicant_in_template(ref_title, old, nw);
    title = _gender_neutralize_if_needed(title, old, nw);
    if (old.department && department_name && _norm(old.department) !== _norm(department_name)) {
      title = title.split(`قسم ${old.department}`).join(`قسم ${department_name}`);
      title = title.split(old.department).join(department_name);
    }
    if (family === "promotion") title = _replace_promotion_rank_slots(title, ref_title, current_topic);
    if (old.name && title.includes(old.name)) return "";
    if (old.department && department_name && _norm(old.department) !== _norm(department_name) && title.includes(old.department)) return "";
    return strip(re.sub("\\s+", " ", title));
  }

  function _clean_current_title(title) {
    let t = strip(title || "");
    t = re.sub("^\\s*(?:دراسة|مناقشة|استعراض)\\s+(?=ال?طلب|طلب|موضوع)", "", t, 0, re.IGNORECASE);
    return strip(re.sub("\\s+", " ", t));
  }

  function _reference_referral_style(precedent, department_name, session_number, session_date) {
    if (!department_name) return "";
    const rationale = precedent.rationale || "";
    const ordinal = session_ordinal_text(session_number);
    const styled_date = _style_date_like_precedent(session_date, precedent);
    const uses_held = rationale.includes("المنعقدة");
    const suffix = "م";
    const held = uses_held ? " المنعقدة" : "";
    if (rationale.includes("بناء على توصية") || rationale.includes("بناءً على توصية")) {
      return `بناءً على توصية مجلس قسم ${department_name} في جلسته ${ordinal}${held} بتاريخ ${styled_date}${suffix}،`;
    }
    if (rationale.includes("بتوصية") || rationale.includes("توصية من مجلس قسم")) {
      return `بتوصية من مجلس قسم ${department_name} في جلسته ${ordinal}${held} بتاريخ ${styled_date}${suffix}،`;
    }
    return `بتوصية من مجلس قسم ${department_name} في جلسته ${ordinal}${held} بتاريخ ${styled_date}${suffix}،`;
  }

  function _safe_generic_attachments(precedent, current_topic, department_name, session_number, session_date) {
    const ordinal = session_ordinal_text(session_number);
    const styled_date = _style_date_like_precedent(session_date, precedent);
    const current = _split_lines(current_topic.attachments || "");
    let lines;
    if (current.length) lines = current.slice();
    else {
      lines = [];
      for (const line of _split_lines(precedent.attachments ?? "")) {
        const n = _norm(line);
        if (n.includes("محضر قسم") || n.includes("مجلس قسم")) continue;
        if (re.search("(?:الدكتور|الدكتوره|الدكتورة|المحاضر|المحاضره|المحاضرة|الطالب|الطالبه|الطالبة)\\s*/?\\s*[^،,]+", line)) continue;
        if (re.search("\\b(?:S?\\d{7,12}|\\d{10})\\b", line, re.IGNORECASE)) continue;
        lines.push(line);
      }
    }
    if (department_name) lines.push(_department_minutes_line(department_name, ordinal, styled_date, precedent));
    return _bullet_join(_dedupe_lines(lines, 0.82));
  }


  // ---------------------------------------------------------------- college wording for titles (تعديلات 11/2026)
  // الرتبة في التوصية تتبع الرتبة المستخرجة في عنوان الموضوع.
  const _AR_LETTER = "\\u0621-\\u064A\\u0671-\\u06D3";
  const _RANK_RX = new RegExp(
    `(?<![${_AR_LETTER}])(?:[أا]ستاذ(?:ة|ه)?(?:\\s+(?:مساعد(?:ة|ه)?|مشارك(?:ة|ه)?))?|محاضر(?:ة|ه)?|معيد(?:ة|ه)?)(?![${_AR_LETTER}])`, "gu");
  function sync_rank_with_title(title, decision) {
    if (!title || !decision) return decision;
    const found = String(title).match(_RANK_RX);
    if (!found) return decision;
    // نأخذ أطول رتبة في العنوان (مثلا «أستاذ مساعد» وليس «أستاذ»)
    const rank = found.sort((a, b) => b.length - a.length)[0];
    return String(decision).replace(_RANK_RX, (m) => (_norm(m) === _norm(rank) ? m : rank));
  }

  // كلمات صياغة مجلس الكلية: تتكرر في عناوين عدة محاضر، بخلاف الأسماء والبيانات المتغيرة.
  let _TITLE_DF = null, _TITLE_DF_SRC = null, _TITLE_DF_LEN = -1;
  const _PREFIXES = ["وبال", "فال", "كال", "بال", "وال", "لل", "ال", "و", "ب", "ل"];
  function _stem(tok) {
    for (const pre of _PREFIXES) if (tok.startsWith(pre) && tok.length - pre.length >= 2) return tok.slice(pre.length);
    return tok;
  }
  function _title_tokens(text) {
    return (_norm(text).match(/[ء-ي0-9A-Za-z٠-٩]+/g) || []).filter((t) => t.length >= 2);
  }
  function set_title_corpus(archive_topics) {
    if (_TITLE_DF_SRC === archive_topics && _TITLE_DF_LEN === (archive_topics || []).length) return;
    _TITLE_DF = new Map();
    for (const p of archive_topics || []) {
      for (const st of new Set(_title_tokens(p.title || "").map(_stem))) _TITLE_DF.set(st, (_TITLE_DF.get(st) || 0) + 1);
    }
    _TITLE_DF_SRC = archive_topics;
    _TITLE_DF_LEN = (archive_topics || []).length;
  }

  // عنوان بصياغة الموضوع المرجعي من مجلس الكلية، والبيانات المتغيرة من محضر القسم.
  // يرجع "" إذا بقي في العنوان أي بيان قديم لا يوجد في محضر القسم الحالي.
  function _college_title_from_reference(current_topic, precedent, department_name, score) {
    const ref_title = strip(precedent.title || "");
    const cur_title = _clean_current_title(current_topic.title ?? "");
    if (!ref_title || !cur_title || !_TITLE_DF || score < 0.45) return "";
    // الترقية فيها رتبتان (من/إلى) ولها مسارها الخاص
    if (topic_family(current_topic.title ?? "", current_topic.rationale ?? "") === "promotion" || /ترقي/.test(cur_title)) return "";
    let title = ref_title;

    const old = extract_applicant(ref_title, precedent.rationale || "", precedent.council_name || department_name);
    const nw = _current_staff_applicant(current_topic, department_name, old);
    if (old.short && nw.short) {
      title = _replace_applicant_in_template(title, old, nw);
      title = _gender_neutralize_if_needed(title, old, nw);
    }
    const [, prev_sections] = _parse_labeled_sections(precedent.rationale ?? "");
    const [, cur_sections] = _parse_labeled_sections(current_topic.rationale ?? "");
    const cur_map = new Map(cur_sections.map(([l, v]) => [_label_key(l), v]));
    const subs = [];
    for (const [label, value] of prev_sections) {
      const cv = cur_map.get(_label_key(label));
      if (strip(value || "") && strip(cv || "") && PY.len(strip(value)) <= 120) subs.push([strip(value), strip(cv)]);
    }
    title = _apply_value_substitutions(title, subs);
    if (department_name) {
      for (const dep of ["علوم الحاسب", "تقنية المعلومات", old.department || ""]) {
        if (dep && _norm(dep) !== _norm(department_name)) title = title.split(dep).join(department_name);
      }
    }
    title = strip(re.sub("\\s+", " ", title));

    const current_blob = `${current_topic.title ?? ""} ${current_topic.rationale ?? ""} ${current_topic.decision ?? ""} ${department_name || ""}`;
    const cur_stems = Array.from(new Set(_title_tokens(current_blob).map(_stem)));
    const cur_set = new Set(cur_stems);
    const matches_current = (st) => cur_set.has(st) || (st.length >= 3 && cur_stems.some((c) => c.length >= 3 && (c.startsWith(st) || st.startsWith(c))));
    // الأسماء بعد الشرطة المائلة (الطالب/ ...، الدكتورة/ ...) يجب أن تكون من محضر القسم الحالي
    for (const m of title.matchAll(/\/\s*([^\/،,.()\n]+)/g)) {
      for (const tok of _title_tokens(m[1]).slice(0, 4)) if (!cur_set.has(_stem(tok)) && !cur_set.has(tok)) return "";
    }
    for (const tok of _title_tokens(title)) {
      const st = _stem(tok);
      if (matches_current(st)) continue;
      if (/\d/.test(tok)) return "";                    // رقم أو تاريخ قديم
      if ((_TITLE_DF.get(st) || 0) < 3) return "";      // اسم أو بيان خاص بالسابقة
    }
    // يجب أن يبقى العنوان عن نفس نوع الطلب: كلمات عنوان القسم (غير الأسماء) موجودة في العنوان الجديد
    const STOP = new Set(["من", "الي", "في", "علي", "عن", "دراسه", "مناقشه", "استعراض", "عرض", "طلب", "مقدم", "المقدم"]);
    const name_toks = new Set();
    for (const m of cur_title.matchAll(/\/\s*([^\/،,.()\n]+)/g)) for (const tok of _title_tokens(m[1]).slice(0, 4)) name_toks.add(_stem(tok));
    const new_stems = Array.from(new Set(_title_tokens(title).map(_stem)));
    const fuzzy_in_new = (st) => new_stems.some((c) => c === st || (c.length >= 3 && st.length >= 3 && (c.startsWith(st) || st.startsWith(c))));
    const kind_words = Array.from(new Set(_title_tokens(cur_title).map(_stem)))
      .filter((st) => st.length >= 3 && !STOP.has(st) && !STOP.has(_norm(st)) && !name_toks.has(st) && !/\d/.test(st));
    if (kind_words.length) {
      const kept = kind_words.filter(fuzzy_in_new).length;
      if (kept / kind_words.length < 0.6) return "";
    }
    return title;
  }

  function _generic_department_source_first_transfer(current_topic, department_name, session_number, session_date, precedent, score) {
    if (score < 0.18 || !department_name) return null;
    const current_title = _clean_current_title(current_topic.title ?? "");
    const current_rationale = strip(current_topic.rationale || "");
    const current_family = topic_family(current_topic.title ?? "", current_rationale);
    const current_decision = strip(current_topic.decision || "");
    const current_tables = current_topic.data_tables || [];
    if (!current_title) return null;

    const referral = _reference_referral_style(precedent, department_name, session_number, session_date);
    let rationale;
    if (current_rationale) {
      if (re.search("مجلس\\s+قسم\\s+", current_rationale)) {
        rationale = _force_current_department_context(current_rationale, department_name, session_number, session_date, precedent);
      } else rationale = strip(`${referral} ${current_rationale}`);
    } else rationale = referral;

    let decision = current_decision;
    if (!decision) decision = `التوصية بالموافقة على ${current_title}.`;

    let title = "";
    if (["appointment", "promotion", "research_bonus", "conference"].includes(current_family)) {
      title = _staff_title_from_college_reference(current_topic, precedent, department_name);
    }
    if (!title) title = _college_title_from_reference(current_topic, precedent, department_name, score);
    if (!title) title = current_title;

    return {
      title,
      rationale,
      decision,
      document_ref: strip(precedent.document_ref ?? ""),
      attachments: _safe_generic_attachments(precedent, current_topic, department_name, session_number, session_date),
      action_required: strip(precedent.action_required ?? ""),
      _generation_method: "الموضوع المرجعي للصياغة فقط — البيانات من محضر القسم الحالي",
      _precedent_source: precedent.source_file ?? "",
      _precedent_score: score,
      _data_source: `محضر قسم ${department_name} — الجلسة ${pyStr(session_number)} — ${pyStr(session_date)}`,
      _data_tables: current_tables,
    };
  }

  // ---------------------------------------------------------------- college-only topics
  function _apply_value_substitutions(text, substitutions) {
    let out = text || "";
    const sorted = substitutions.slice().sort((a, b) => PY.len(b[0] || "") - PY.len(a[0] || ""));
    for (let [old, nw] of sorted) {
      old = strip(old || "");
      nw = strip(nw || "");
      if (!old || !nw || old === nw || PY.len(old) < 2) continue;
      out = out.split(old).join(nw);
    }
    return out;
  }

  function _generic_college_topic_transfer(current_topic, precedent, score) {
    if (score < 0.18) return null;
    const [prev_prefix, prev_sections] = _parse_labeled_sections(precedent.rationale ?? "");
    const [, cur_sections] = _parse_labeled_sections(current_topic.rationale ?? "");
    const prev_map = new Map(prev_sections.map(([l, v]) => [_label_key(l), [l, v]]));
    const cur_map = new Map(cur_sections.map(([l, v]) => [_label_key(l), [l, v]]));

    const substitutions = [];
    for (const [key, [, pvalue]] of prev_map) {
      if (cur_map.has(key)) {
        const [, cvalue] = cur_map.get(key);
        if (strip(pvalue) && strip(cvalue)) substitutions.push([strip(pvalue), strip(cvalue)]);
      }
    }

    const rationale_parts = [];
    const prefix = _apply_value_substitutions(prev_prefix, substitutions);
    if (prefix) rationale_parts.push(prefix);

    const used = new Set();
    for (const [plabel, pvalue] of prev_sections) {
      const key = _label_key(plabel);
      if (cur_map.has(key)) {
        const [, cvalue] = cur_map.get(key);
        rationale_parts.push(`${plabel}:` + (cvalue ? `\n${cvalue}` : ""));
        used.add(key);
      } else {
        const replaced = _apply_value_substitutions(pvalue, substitutions);
        if (replaced !== pvalue) rationale_parts.push(`${plabel}:` + (replaced ? `\n${replaced}` : ""));
      }
    }
    for (const [clabel, cvalue] of cur_sections) {
      const key = _label_key(clabel);
      if (!used.has(key)) rationale_parts.push(`${clabel}:` + (cvalue ? `\n${cvalue}` : ""));
    }

    const current_title = strip(current_topic.title || "");
    const current_attachments = strip(current_topic.attachments || "");

    if (!cur_sections.length) {
      const use_precedent_title = PY.split(current_title).length <= 4;
      return {
        title: use_precedent_title ? strip(precedent.title ?? "") : strip(re.sub("^\\s*دراسة\\s+", "", current_title)),
        rationale: strip(precedent.rationale ?? ""),
        decision: strip(precedent.decision ?? ""),
        document_ref: strip(precedent.document_ref ?? ""),
        attachments: current_attachments || strip(precedent.attachments ?? ""),
        action_required: strip(precedent.action_required ?? ""),
        _generation_method: "نسخ قالب موضوع متكرر من مجلس الكلية",
        _precedent_source: precedent.source_file ?? "",
        _precedent_score: score,
      };
    }

    const rationale = strip(rationale_parts.filter((x) => x).join("\n"));
    const title_from_precedent = strip(_apply_value_substitutions(precedent.title ?? "", substitutions));
    const decision = strip(_apply_value_substitutions(precedent.decision ?? "", substitutions));
    let title;
    if (PY.split(current_title).length >= 5) title = strip(re.sub("^\\s*دراسة\\s+", "", current_title));
    else title = title_from_precedent || current_title;

    if (!substitutions.length && cur_sections.length) return null;
    if (!rationale) return null;

    return {
      title,
      rationale,
      decision,
      document_ref: strip(precedent.document_ref ?? ""),
      attachments: current_attachments || strip(precedent.attachments ?? ""),
      action_required: strip(precedent.action_required ?? ""),
      _generation_method: "أتمتة عامة من سابقة مجلس الكلية",
      _precedent_source: precedent.source_file ?? "",
      _precedent_score: score,
    };
  }

  const DEPT_CTX_RE = re.compile(
    "(?P<kind>(?:مجلس|محضر)(?:\\s+مجلس)?\\s+قسم)\\s+" +
    ".+?\\s+" +
    "(?P<connector>في\\s+جلسته|بجلسته)\\s+" +
    ".+?" +
    "(?P<held>\\s+المنعقدة)?\\s+بتاريخ\\s+" +
    "[0-9٠-٩./-]+\\s*(?P<suffix>م)?",
    re.IGNORECASE,
  );

  function _force_current_department_context(text, department_name, session_number, session_date, precedent) {
    if (!text || !department_name) return text || "";
    const ordinal = session_ordinal_text(session_number);
    const styled_date = _style_date_like_precedent(session_date, precedent);
    const repl = (m) => {
      const kind = m.group("kind");
      const connector = m.group("connector") || "في جلسته";
      const held = m.group(0).includes("المنعقدة") ? " المنعقدة" : "";
      const suffix = strip(m.group("suffix") || "") ? "م" : "";
      return `${kind} ${department_name} ${connector} ${ordinal}${held} بتاريخ ${styled_date}${suffix}`;
    };
    let out = DEPT_CTX_RE.sub(repl, text);
    out = re.sub(
      "(مجلس\\s+قسم)\\s+[^،,\\n]+?\\s+(?:في\\s+جلسته|بجلسته)\\s+[^،,\\n]+?\\s+بتاريخ\\s+[0-9٠-٩./-]+\\s*م?",
      () => `مجلس قسم ${department_name} في جلسته ${ordinal} المنعقدة بتاريخ ${styled_date}م`,
      out, 0, re.IGNORECASE,
    );
    return out;
  }

  function _apply_department_context_to_result(data, department_name, session_number, session_date, precedent) {
    if (!data || !department_name) return data;
    for (const key of ["title", "rationale", "decision", "attachments"]) {
      data[key] = _force_current_department_context(data[key] ?? "", department_name, session_number, session_date, precedent);
    }
    data._data_source = `محضر قسم ${department_name} — الجلسة ${pyStr(session_number)} — ${pyStr(session_date)}`;
    return data;
  }

  // ---------------------------------------------------------------- schedules
  function _schedule_subject_core(text) {
    let t = rstrip(strip(text || ""), ".، ");
    t = re.sub("^\\s*(?:مناقشة\\s+واعتماد|دراسة|مناقشة|استعراض|عرض|اعتماد|إقرار|اقرار)\\s+", "", t);
    return strip(re.sub("\\s+", " ", t));
  }

  function _schedule_slots(text) {
    text = text || "";
    const slots = {};
    let m = re.search(
      "((?:برنامج\\s+)?(?:ماجستير|بكالوريوس|دكتوراه|دكتوراة)\\s+[^،,.\\n]+?)" +
      "(?=\\s+(?:للفصل|في\\s+الفصل|للعام|للعام\\s+الجامعي)|[،,.\\n]|$)",
      text, re.IGNORECASE,
    );
    if (m) slots.program = strip(re.sub("\\s+", " ", m.group(1)));
    m = re.search(
      "((?:للفصل|الفصل)\\s+الدراسي\\s+(?:الأول|الاول|الثاني|الثالث|الصيفي)(?:\\s+من)?(?:\\s+العام\\s+الجامعي\\s+[^،,.\\n]+)?)",
      text, re.IGNORECASE,
    );
    if (m) slots.semester = strip(re.sub("\\s+", " ", m.group(1)));
    if (!("semester" in slots)) {
      m = re.search("(العام\\s+الجامعي\\s+[0-9٠-٩/\\-هـه\\s]+)", text, re.IGNORECASE);
      if (m) slots.year = strip(re.sub("\\s+", " ", m.group(1)));
    }
    return slots;
  }

  const _KNOWN_CCI_DEPARTMENTS = ["علوم الحاسب", "تقنية المعلومات", "علوم البيانات"];

  function _schedule_conflicting_department(text, department_name) {
    if (!text || !department_name) return "";
    const nd = _norm(department_name);
    for (const dep of _KNOWN_CCI_DEPARTMENTS) {
      if (_norm(dep) === nd) continue;
      if (re.search("قسم\\s+" + re.escape(dep) + "\\b", text, re.IGNORECASE)) return dep;
    }
    return "";
  }

  function _safe_schedule_attachments(current_topic, precedent, department_name, session_number, session_date) {
    const current = strip(current_topic.attachments || "");
    const ordinal = session_ordinal_text(session_number);
    const current_ref = department_name ? `محضر قسم ${department_name} في جلسته ${ordinal} بتاريخ ${pyStr(session_date)}م` : "";
    if (current) return _force_current_department_context(current, department_name, session_number, session_date, precedent);
    const old = strip(precedent.attachments || "");
    const old_slots = _schedule_slots((precedent.title || "") + "\n" + (precedent.rationale || ""));
    let safe_lines = [];
    for (const line of PY.splitlines(old).map((x) => strip(x)).filter((x) => x)) {
      const nline = _norm(line);
      if (nline.includes("محضر قسم") || nline.includes("مجلس قسم")) continue;
      if (old_slots.program && nline.includes(_norm(old_slots.program))) continue;
      safe_lines.push(line);
    }
    if (!safe_lines.length) safe_lines = ["الجداول الدراسية"];
    if (current_ref) safe_lines.push(current_ref);
    return safe_lines.join("\n");
  }

  function _clean_schedule_current_details(text, current_core = "") {
    const t = strip(text || "");
    if (!t) return "";
    const markers = [
      "وفق التفاصيل التالية:", "وفقًا للتفاصيل التالية:", "وفقا للتفاصيل التالية:",
      "والذي يحتوي على التفاصيل التالية:", "والتي تحتوي على التفاصيل التالية:",
      "التفاصيل التالية:",
    ];
    const nt = _norm(t);
    for (const marker of markers) {
      const pos = nt.indexOf(_norm(marker));
      if (pos >= 0) {
        const colon = t.indexOf(":", Math.max(0, pos - 10));
        if (colon >= 0) {
          const rest = strip(t.slice(colon + 1));
          if (rest) return rest;
        }
      }
    }
    const lines = PY.splitlines(t).map((ln) => strip(ln)).filter((ln) => ln);
    if (lines.length > 1 && re.match("^(?:استعرض|ناقش|درس|استعرض ومناقشة|تم استعراض)\\s+المجلس", lines[0])) {
      return strip(lines.slice(1).join("\n"));
    }
    const t2 = strip(re.sub(
      "^\\s*(?:استعرض|ناقش|درس|تم\\s+استعراض)\\s+المجلس\\s+.*?(?:وفق(?:ًا|ا)?\\s+للتفاصيل\\s+التالية|والذي\\s+يحتوي\\s+على\\s+التفاصيل\\s+التالية)\\s*[:：]?\\s*",
      "", t, 0, re.IGNORECASE | re.DOTALL,
    ));
    return t2 || t;
  }

  function _schedule_college_opening(department_name, session_number, session_date, current_title, precedent) {
    const ordinal = session_ordinal_text(session_number);
    const styled_date = _style_date_like_precedent(session_date, precedent);
    const core = _schedule_subject_core(current_title);
    const subject = core.startsWith("جداول ") ? core : (core || strip(current_title));
    return `بتوصية من مجلس قسم ${department_name} في جلسته ${ordinal} بتاريخ ${styled_date}م، ` +
      `استعرض المجلس ${subject}، والذي يحتوي على التفاصيل التالية:`;
  }

  function _replace_schedule_subject_in_text(text, precedent, current_title, department_name, session_number, session_date) {
    let out = text || "";
    const prev_core = _schedule_subject_core(precedent.title ?? "");
    const cur_core = _schedule_subject_core(current_title);
    if (prev_core && cur_core) out = re.sub(re.escape(prev_core), cur_core, out, 0, re.IGNORECASE);
    const prev_slots = _schedule_slots((precedent.title || "") + "\n" + (precedent.rationale || ""));
    const cur_slots = _schedule_slots(current_title);
    const subs = ["program", "semester", "year"].filter((k) => prev_slots[k] && cur_slots[k]).map((k) => [prev_slots[k], cur_slots[k]]);
    out = _apply_value_substitutions(out, subs);
    // الفصل الدراسي يأتي من محضر القسم الحالي حتى لو كتبته السابقة بدون العام الجامعي
    const cur_sem = re.search("(?:ال|لل)فصل\\s+الدراسي\\s+(الأول|الاول|الثاني|الثالث|الصيفي)", `${current_title}`);
    if (cur_sem) {
      out = re.sub("((?:ال|لل)فصل\\s+الدراسي\\s+)(?:الأول|الاول|الثاني|الثالث|الصيفي)", (m) => m.group(1) + cur_sem.group(1), out);
    }
    out = _force_current_department_context(out, department_name, session_number, session_date, precedent);
    return out;
  }

  function _schedule_transfer(current_topic, department_name, session_number, session_date, precedent, score) {
    if (score < 0.18) return null;
    const current_title = strip(current_topic.title || "");
    const current_rationale = strip(current_topic.rationale || "");
    if (!current_title) return null;

    if (!department_name) {
      if (PY.split(current_title).length <= 4) {
        return {
          title: strip(precedent.title ?? "") || current_title,
          rationale: strip(precedent.rationale ?? ""),
          decision: strip(precedent.decision ?? ""),
          document_ref: strip(precedent.document_ref ?? ""),
          attachments: strip(current_topic.attachments || "") || strip(precedent.attachments ?? ""),
          action_required: strip(precedent.action_required ?? ""),
          _generation_method: "أتمتة من قالب مجلس الكلية — الجداول (موضوع مجلس كلية مباشر)",
          _precedent_source: precedent.source_file ?? "",
          _precedent_score: score,
          _data_source: "موضوع خاص بمجلس الكلية",
        };
      }
      return null;
    }

    const conflict = _schedule_conflicting_department(current_title + "\n" + current_rationale, department_name);
    if (conflict) {
      throw new Error(
        `موضوع الجداول المحدد لا يطابق مصدره: المحضر الحالي هو قسم ${department_name} ` +
        `لكن نص الموضوع يتضمن قسم ${conflict}. اختاري موضوع الجداول الصحيح من محضر القسم الحالي ` +
        "أو اضغطي «عرض نص المصدر» للتحقق منه. لم يتم استخدام بيانات السابقة.",
      );
    }

    const cur_core = _schedule_subject_core(current_title);
    const prev_title = strip(precedent.title || "");
    let prefix = "";
    const pm = re.match("^\\s*((?:مناقشة\\s+واعتماد|دراسة|مناقشة|استعراض|عرض|اعتماد|إقرار|اقرار)\\s+)", prev_title);
    if (pm) prefix = pm.group(1);
    let title = cur_core ? strip(prefix + cur_core) : current_title;
    if (re.match("^\\s*(?:مناقشة\\s+واعتماد|مناقشة|اعتماد|إقرار|اقرار)\\s+", current_title)) title = current_title;

    const opening = _schedule_college_opening(department_name, session_number, session_date, current_title, precedent);
    const details = _clean_schedule_current_details(current_rationale, cur_core);
    const rationale = opening + (details ? "\n" + details : "");

    let decision = _replace_schedule_subject_in_text(precedent.decision ?? "", precedent, current_title, department_name, session_number, session_date);
    const pslots = _schedule_slots((precedent.title || "") + "\n" + (precedent.rationale || ""));
    const ctext = current_title + "\n" + current_rationale;
    const cslots = _schedule_slots(ctext);
    const stale_terms = [];
    for (const key of ["program", "semester", "year"]) {
      if (pslots[key] && !_norm(ctext).includes(_norm(pslots[key]))) stale_terms.push(pslots[key]);
    }
    if (!decision || stale_terms.some((term) => _norm(decision).includes(_norm(term)))) {
      decision = cur_core ? `التوصية بالموافقة بالإجماع على ${cur_core}.` : "التوصية بالموافقة بالإجماع.";
    }

    const attachments = _safe_schedule_attachments(current_topic, precedent, department_name, session_number, session_date);

    const guarded = [title, rationale, decision, attachments].join("\n");
    const old_program = pslots.program || "";
    if (old_program && !_norm(ctext).includes(_norm(old_program)) && _norm(guarded).includes(_norm(old_program))) {
      throw new Error(
        `تم منع نقل بيانات قديمة من السابقة (${old_program}). موضوع الجداول الحالي لا يحتوي هذه البيانات. ` +
        "راجعي نص المصدر ثم أعيدي التوليد.",
      );
    }

    return {
      title,
      rationale,
      decision,
      document_ref: strip(precedent.document_ref ?? ""),
      attachments,
      action_required: strip(precedent.action_required ?? ""),
      _generation_method: "أتمتة صارمة للجداول — السابقة للصياغة فقط والبيانات من محضر القسم الحالي",
      _precedent_source: precedent.source_file ?? "",
      _precedent_score: score,
      _data_source: `محضر قسم ${department_name} — الجلسة ${pyStr(session_number)} — ${pyStr(session_date)}`,
      _schedule_current_title: current_title,
      _schedule_current_program: cslots.program || "",
      _schedule_current_semester: cslots.semester || cslots.year || "",
    };
  }

  // ---------------------------------------------------------------- family builders
  function _research_bonus(current_topic, department_name, session_number, session_date, precedent) {
    const applicant = extract_applicant(current_topic.title, current_topic.rationale, department_name);
    if (!applicant.short) return null;
    const ordinal = session_ordinal_text(session_number);
    const styled_date = _style_date_like_precedent(session_date, precedent);
    const details = _details_from_label(current_topic.rationale, ["عنوان البحث", "عنوان الأبحاث"]);
    if (!details) return null;
    let applicant_full = applicant.formatted("بقسم") || applicant.short;
    applicant_full = _append_college_if_precedent(precedent.title ?? "", applicant_full);
    const rationale =
      `بتوصية من مجلس قسم ${department_name} في جلسته ${ordinal} المنعقدة بتاريخ ${styled_date}م، ` +
      `ناقش المجلس الطلب المقدم من ${applicant.short} بصرف بدل التميز للنشر العلمي للبحث المنشور ` +
      `وفقا للتفاصيل التالية:\n${details}`;
    let title = _staff_title_from_college_reference(current_topic, precedent, department_name);
    if (!title) title = `طلب مكافأة بدل التميز المقدم من ${applicant_full}`;
    const decision = `التوصية بالموافقة ${_vote_phrase(current_topic)}على طلب مكافأة بدل التميز المقدم من ${applicant_full}.`;
    return {
      title,
      rationale,
      decision,
      document_ref: strip(precedent.document_ref ?? ""),
      attachments: _attachments_from_precedent(precedent, current_topic, department_name, ordinal, styled_date),
      action_required: strip(precedent.action_required ?? ""),
      _generation_method: "أتمتة بالقالب: بدل التميز للنشر العلمي",
      _precedent_source: precedent.source_file ?? "",
    };
  }

  function _conference(current_topic, department_name, session_number, session_date, precedent) {
    const applicant = extract_applicant(current_topic.title, current_topic.rationale, department_name);
    if (!applicant.short) return null;
    const ordinal = session_ordinal_text(session_number);
    const styled_date = _style_date_like_precedent(session_date, precedent);
    const details = _details_from_label(current_topic.rationale, ["عنوان المؤتمر"]);
    if (!details) return null;
    const applicant_full = applicant.formatted("في قسم") || applicant.short;
    const revenue_alt = _norm(`${current_topic.title} ${current_topic.rationale} ${precedent.title ?? ""}`).includes("ايراد البديل") ? " (الإيراد البديل)" : "";
    const title = `الطلب المقدم من ${applicant_full} لحضور مؤتمر علمي${revenue_alt}.`;
    const rationale =
      `بتوصية من مجلس قسم ${department_name} في جلسته ${ordinal} المنعقدة بتاريخ ${styled_date}م، ` +
      `استعرض المجلس الطلب المقدم من ${applicant_full} لحضور مؤتمر علمي${revenue_alt}. وفقا للبيانات التالية:\n${details}`;
    const decision = `التوصية بالموافقة ${_vote_phrase(current_topic)}على الطلب المقدم من ${applicant_full} لحضور مؤتمر علمي${revenue_alt}.`;
    return {
      title,
      rationale,
      decision,
      document_ref: strip(precedent.document_ref ?? ""),
      attachments: _attachments_from_precedent(precedent, current_topic, department_name, ordinal, styled_date),
      action_required: strip(precedent.action_required ?? ""),
      _generation_method: "أتمتة بالقالب: حضور مؤتمر علمي",
      _precedent_source: precedent.source_file ?? "",
    };
  }

  // ---------------------------------------------------------------- scholarship notice
  function _first_paragraph(text) {
    const parts = re.split("\\n\\s*\\n|\\n", text || "").map((p) => strip(p)).filter((p) => p);
    if (!parts.length) return "";
    for (const p of parts) if (p.includes("تفويض") && p.includes("اللجنة الثلاثية")) return p;
    return parts[0];
  }

  function _scholarship_result(current_topic) {
    const t = _norm(`${current_topic.decision ?? ""} ${current_topic.rationale ?? ""}`);
    const result = t.includes("عدم الموافقه") ? "عدم الموافقة" : "الموافقة";
    const unanimous = t.includes("بالاجماع") || _is_unanimous(current_topic) ? " بالإجماع" : "";
    return [result, unanimous];
  }

  function _scholarship_request_title(title) {
    let t = rstrip(strip(title || ""), ". ");
    t = re.sub("^\\s*دراسة\\s+", "", t);
    t = re.sub("^\\s*إحاطة\\s+المجلس\\s+ب", "", t);
    t = re.sub("،?\\s*محاضر(?:ة)?\\s+بقسم\\s+[^،,]+?\\s+في\\s+كلية\\s+الحوسبة\\s+والمعلوماتية\\s*،?", "، بكلية الحوسبة والمعلوماتية، ", t);
    t = re.sub("\\s*/\\s*", " / ", t);
    t = re.sub("\\s+،", "،", t);
    t = re.sub("،\\s*،", "،", t);
    t = strip(re.sub("\\s+", " ", t), " ،");
    return t;
  }

  function _normalize_case_date(value) {
    const v = strip(value || "").split(".").join("/").split("-").join("/");
    const m = re.fullmatch("(\\d{1,2})/(\\d{1,2})/(20\\d{2})", v);
    if (m) return `${m.group(3)}/${PY.pad2(PY.int(m.group(1)))}/${PY.pad2(PY.int(m.group(2)))}`;
    return v;
  }

  function _field_lines(rationale) {
    const labels = ["اسم الجامعة", "التخصص العام", "بلد الابتعاث", "بداية البعثة",
      "بداية التمديد الأول", "بداية التمديد الثاني", "بداية التمديد الثالث"];
    const out = [];
    for (const raw of PY.splitlines(rationale || "")) {
      const line = strip(raw);
      for (const label of labels) {
        if (line.startsWith(label)) {
          const value = lstrip(line.slice(label.length), " :");
          out.push(strip(`${label}: ${value}`));
          break;
        }
      }
    }
    return out;
  }

  function _committee_body(rationale, request = "") {
    const text = strip(rationale || "");
    let case_no = "";
    const m = re.search("إدارة الابتعاث والاستقطاب\\s+رقم\\s+(.+?)\\s+وتاريخ", text, re.S);
    if (m) {
      const raw_no = strip(re.sub("\\s+", " ", m.group(1)), " ()");
      const digits = re.search("\\d+", raw_no);
      if (digits && re.search("\\bus\\b", raw_no, re.I)) case_no = `us-${digits.group(0)}`;
      else case_no = raw_no;
    }
    let case_date = "";
    if (m) {
      const tail = text.slice(m.end(), m.end() + 80);
      const dm = re.search("(20\\d{2}/\\d{1,2}/\\d{1,2}|\\d{1,2}/\\d{1,2}/20\\d{2})", tail);
      if (dm) case_date = _normalize_case_date(dm.group(1));
    }
    let civil = "";
    const cm = re.search("رقم سجل مدني\\s*\\(?\\s*(\\d{8,12})", text);
    if (cm) civil = cm.group(1);
    let supervisor = "";
    const sm = re.search("(كما اطلعت اللجنة على مالحظات المشرف.*?)(?=وذلك\\s+وفق|وفقًا للبيانات|اسم الجامعة)", text, re.S);
    if (sm) {
      supervisor = strip(re.sub("\\s+", " ", sm.group(1)), " ،");
      supervisor = re.sub("في المملكة\\s+([^/،]+?)/المتحدة\\s+(.+)$", "في المملكة المتحدة/\\1 \\2", supervisor);
    }
    const fields = _field_lines(text);
    let just = "";
    const jm = re.search("مبررات الطلب:\\s*(.*)$", text, re.S);
    if (jm) just = strip(jm.group(1));

    const bits = ["الطلب المُحال من قِبل إدارة الابتعاث والاستقطاب"];
    if (case_no) bits[bits.length - 1] += ` رقم (${case_no})`;
    if (case_date) bits[bits.length - 1] += ` وتاريخ ${case_date}م`;
    if (request) bits[bits.length - 1] += `، والمتعلق ب${request}`;
    if (civil) bits[bits.length - 1] += `، رقم سجل مدني (${civil})`;
    if (supervisor) bits[bits.length - 1] += `، ${supervisor}`;
    if (fields.length) {
      bits[bits.length - 1] += "، وذلك وفقًا للبيانات التالية:";
      bits.push(...fields);
    }
    if (just) {
      bits.push("مبررات الطلب:");
      bits.push(just);
    }
    return strip(bits.join("\n"));
  }

  function _scholarship_attachments(precedent, session_number, session_date) {
    const lines = _split_lines(precedent.attachments ?? "");
    const ordinal = session_ordinal_text(session_number);
    const date = (session_date || "").split(".").join("/").split("-").join("/");
    const out = [];
    let replaced = false;
    for (const line of lines) {
      if (line.includes("محضر اللجنة الثلاثية")) {
        out.push(`محضر اللجنة الثلاثية في كلية الحوسبة والمعلوماتية ${ordinal} بتاريخ ${date}م`);
        replaced = true;
      } else out.push(line);
    }
    if (!replaced) out.push(`محضر اللجنة الثلاثية في كلية الحوسبة والمعلوماتية ${ordinal} بتاريخ ${date}م`);
    return _bullet_join(_dedupe_lines(out, 0.82));
  }

  function _scholarship_notice(current_topic, session_number, session_date, precedent) {
    const request = _scholarship_request_title(current_topic.title);
    if (!request) return null;
    const ordinal = session_ordinal_text(session_number);
    const styled_date = (session_date || "").split(".").join("/").split("-").join("/");
    const [result, unanimous] = _scholarship_result(current_topic);
    const title = rstrip(`إحاطة المجلس ب${request}`, ". ") + ".";
    const delegation = _first_paragraph(precedent.rationale ?? "");
    let body = _committee_body(current_topic.rationale, request);
    body = strip(re.split("\\bالتوصية\\s*/?\\s*(?:القرار)?\\b", body, 1)[0]);
    const second = strip(
      `عليه تم استعراض توصية اللجنة الثلاثية في كلية الحوسبة والمعلوماتية لشؤون الابتعاث ` +
      `في جلستها ${ordinal} بتاريخ ${styled_date} والمتضمنة ${result} على ${body}`,
    );
    const rationale = strip([delegation, second].filter((x) => x).join("\n"));
    const decision = rstrip(`إحاطة المجلس ب${result}${unanimous} على ${request}`, ". ") + ".";
    return {
      title,
      rationale,
      decision,
      document_ref: strip(precedent.document_ref ?? ""),
      attachments: _scholarship_attachments(precedent, session_number, session_date),
      action_required: strip(precedent.action_required ?? ""),
      _generation_method: "أتمتة إلزامية من قالب مجلس الكلية — إحاطة ابتعاث",
      _precedent_source: precedent.source_file ?? "",
    };
  }

  // ---------------------------------------------------------------- entry points
  function build_from_precedent(current_topic, department_name, session_number, session_date, precedents, family_override = "") {
    const family = family_override || topic_family(current_topic.title, current_topic.rationale);
    if (!precedents || !precedents.length) return null;
    let precedent, score;
    if (family) [precedent, score] = _precedent_of_same_family(precedents, family);
    else [precedent, score] = precedents[0];
    if (!precedent || (typeof precedent === "object" && !Object.keys(precedent).length)) return null;
    if (score < 0.18) return null;

    if (family === "scholarship_notice") {
      let data = _scholarship_notice(current_topic, session_number, session_date, precedent);
      if (data !== null) {
        data._precedent_score = score;
        return _apply_department_context_to_result(data, department_name, session_number, session_date, precedent);
      }
      if (department_name) {
        data = _generic_department_source_first_transfer(current_topic, department_name, session_number, session_date, precedent, score);
        if (data !== null) {
          data._generation_method = "الموضوع المرجعي المختار للصياغة — البيانات من محضر القسم الحالي";
          return data;
        }
      }
      return null;
    }

    if (family === "research_bonus" || family === "conference") {
      let data = _generic_staff_transfer(current_topic, department_name, session_number, session_date, precedent, Math.max(score, 0.55));
      if (data === null) {
        data = family === "research_bonus"
          ? _research_bonus(current_topic, department_name, session_number, session_date, precedent)
          : _conference(current_topic, department_name, session_number, session_date, precedent);
      }
      if (data !== null) {
        data._precedent_score = score;
        data._data_tables = current_topic.data_tables || [];
        data._generation_method = family === "research_bonus"
          ? "أتمتة إلزامية من قالب مجلس الكلية — بدل التميز"
          : "أتمتة إلزامية من قالب مجلس الكلية — مؤتمر علمي";
        return _apply_department_context_to_result(data, department_name, session_number, session_date, precedent);
      }
      return null;
    }

    if (family === "schedules") {
      const data = _schedule_transfer(current_topic, department_name, session_number, session_date, precedent, score);
      if (data !== null) {
        data._data_tables = current_topic.data_tables || [];
        return _apply_department_context_to_result(data, department_name, session_number, session_date, precedent);
      }
      return null;
    }

    if (department_name) {
      const data = _generic_department_source_first_transfer(current_topic, department_name, session_number, session_date, precedent, score);
      if (data !== null) return _apply_department_context_to_result(data, department_name, session_number, session_date, precedent);
    }

    let data = _generic_staff_transfer(current_topic, department_name, session_number, session_date, precedent, score);
    if (data !== null) return _apply_department_context_to_result(data, department_name, session_number, session_date, precedent);

    data = _generic_college_topic_transfer(current_topic, precedent, score);
    return _apply_department_context_to_result(data, department_name, session_number, session_date, precedent);
  }

  function build_from_selected_reference(current_topic, department_name, session_number, session_date, precedent) {
    if (!precedent) return null;
    const ref_family = topic_family(precedent.title ?? "", precedent.rationale ?? "");
    const cur_family = topic_family(current_topic.title ?? "", current_topic.rationale ?? "");
    if (ref_family && ref_family === cur_family) {
      try {
        const data = build_from_precedent(current_topic, department_name, session_number, session_date, [[precedent, 1.0]], ref_family);
        if (data !== null) {
          data._generation_method = data._generation_method || "الموضوع المرجعي المختار يدويًا";
          return _apply_department_context_to_result(data, department_name, session_number, session_date, precedent);
        }
      } catch (e) {
        // اختيار يدوي: نكمل بالمسار الآمن.
      }
    }
    if (department_name) {
      const data = _generic_department_source_first_transfer(current_topic, department_name, session_number, session_date, precedent, 1.0);
      if (data !== null) {
        data._generation_method = "الموضوع المرجعي المختار يدويًا — البيانات من محضر القسم الحالي";
        data._precedent_source = precedent.source_file ?? "";
        data._precedent_score = 1.0;
        return data;
      }
    }
    const data = _generic_college_topic_transfer(current_topic, precedent, 1.0);
    if (data !== null) {
      data._generation_method = "الموضوع المرجعي المختار يدويًا";
      data._precedent_source = precedent.source_file ?? "";
      data._precedent_score = 1.0;
      return data;
    }
    const current_title = _clean_current_title(current_topic.title ?? "");
    const current_rationale = strip(current_topic.rationale || "");
    const current_decision = strip(current_topic.decision || "");
    if (!current_title) return null;
    const referral = department_name ? _reference_referral_style(precedent, department_name, session_number, session_date) : "";
    const rationale = current_rationale ? strip(`${referral} ${current_rationale}`) : referral;
    return {
      title: current_title,
      rationale,
      decision: current_decision || `التوصية بالموافقة على ${current_title}.`,
      document_ref: strip(precedent.document_ref ?? ""),
      attachments: _safe_generic_attachments(precedent, current_topic, department_name, session_number, session_date),
      action_required: strip(precedent.action_required ?? ""),
      _generation_method: "الموضوع المرجعي المختار يدويًا — مسار احتياطي آمن",
      _precedent_source: precedent.source_file ?? "",
      _precedent_score: 1.0,
      _data_tables: current_topic.data_tables || [],
    };
  }

  return {
    session_ordinal_text, _arabic_ordinal_feminine, pyStr,
    _norm, topic_family, STRICT_REFERENCE_FAMILIES, SINGLE_REFERENCE_FAMILIES, reference_topics_for_current,
    Applicant, extract_applicant, _details_from_label, _is_unanimous, _split_lines, _line_similarity, _dedupe_lines,
    _style_date_like_precedent, _department_minutes_line, _merge_documents, _attachments_from_precedent,
    _parse_labeled_sections, _label_key, _replace_referral_session, _replace_applicant_in_template,
    _gender_neutralize_if_needed, _generic_staff_transfer, _structured_staff_value, _current_staff_applicant,
    _promotion_rank_from_text, _replace_promotion_rank_slots, _staff_title_from_college_reference,
    _clean_current_title, _reference_referral_style, _safe_generic_attachments,
    _generic_department_source_first_transfer, _apply_value_substitutions, _generic_college_topic_transfer,
    _force_current_department_context, _apply_department_context_to_result, _schedule_subject_core,
    _schedule_slots, _schedule_conflicting_department, _safe_schedule_attachments, _clean_schedule_current_details,
    _schedule_college_opening, _replace_schedule_subject_in_text, _schedule_transfer, _research_bonus, _conference,
    _first_paragraph, _scholarship_result, _scholarship_request_title, _normalize_case_date, _field_lines,
    _committee_body, _scholarship_attachments, _scholarship_notice, build_from_precedent,
    build_from_selected_reference, sync_rank_with_title, set_title_corpus, _college_title_from_reference,
  };
})();
