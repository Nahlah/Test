/* استخراج انتقائي وواعٍ ببنية الجداول لنماذج مجلس القسم — منقول من core/department_form_fields.py */
"use strict";

const FormFields = (() => {
  const { re, strip, SequenceMatcher } = PY;
  const { normalize_ar } = Similarity;

  const nCache = new Map();
  function _n(value) {
    const s = value === null || value === undefined || value === "" ? "" : String(value);
    let r = nCache.get(s);
    if (r === undefined) {
      r = re.sub("\\s+", "", normalize_ar(s));
      if (nCache.size > 50000) nCache.clear();
      nCache.set(s, r);
    }
    return r;
  }
  function pyStrOr(value) {
    return value ? String(value) : "";
  }
  function _clean(value) {
    return strip(re.sub("[ \\t]+", " ", pyStrOr(value)), " \t\n:：|-–—");
  }

  const FIELD_ALIASES = {
    conference_name: ["اسم المؤتمر", "عنوان المؤتمر", "مسمى المؤتمر", "اسم الفعالية", "عنوان الفعالية", "المؤتمر / الندوة", "conference name", "conference title", "event name"],
    paper_title: ["عنوان الورقة العلمية", "عنوان الورقة", "عنوان المشاركة", "عنوان البحث المشارك", "عنوان البحث المقبول", "عنوان البحث المقبول للنشر", "اسم البحث", "paper title", "research title", "title of paper"],
    conference_place: ["مكان انعقاد المؤتمر", "مكان المؤتمر", "مقر المؤتمر", "مكان الانعقاد", "مكان الفعالية", "الدولة / المدينة", "المدينة / الدولة", "conference location", "conference venue", "venue"],
    conference_city: ["المدينة", "city"],
    conference_country: ["الدولة", "البلد", "country"],
    conference_date: ["تاريخ انعقاد المؤتمر", "تاريخ عقد المؤتمر", "تاريخ المؤتمر", "موعد المؤتمر", "مدة المؤتمر", "فترة المؤتمر", "conference date", "date of conference", "conference dates"],
    conference_start_date: ["تاريخ بداية المؤتمر", "بداية المؤتمر", "من تاريخ", "تاريخ البدء", "start date", "from date"],
    conference_end_date: ["تاريخ نهاية المؤتمر", "نهاية المؤتمر", "إلى تاريخ", "الى تاريخ", "تاريخ الانتهاء", "end date", "to date"],
    conference_time: ["وقت انعقاد المؤتمر", "وقت المؤتمر", "conference time"],
    conference_summary: ["نبذة موجزة عن المؤتمر", "نبذة عن المؤتمر", "conference summary", "conference description"],
    conference_organizer: ["الجهة المنظمة للمؤتمر", "الجهة المنظمة", "منظم المؤتمر", "organizer", "organizing body"],
    conference_age: ["عمر المؤتمر", "عدد سنوات المؤتمر", "conference age"],
    participation_type: ["نوع المشاركة", "طريقة المشاركة", "participation type"],
    member_specialty: ["التخصص الدقيق", "تخصص العضو", "تخصص المرشح", "specialty", "specialisation", "specialization"],
    member_name: ["اسم العضو", "اسم مقدم الطلب", "اسم مقدمة الطلب", "مقدم الطلب", "مقدمة الطلب", "اسم المرشح", "اسم المرشحة", "اسم المتقدم", "اسم المتقدمة", "الاسم (عربي)", "الاسم عربي", "الاسم", "name"],
    member_rank: ["الرتبة العلمية", "الرتبة الأكاديمية", "الرتبة الاكاديمية", "الرتبة الحالية", "الرتبة", "المسمى الوظيفي", "المسمى الأكاديمي", "المسمى الاكاديمي", "الوظيفة", "academic rank", "current rank", "job title"],
    member_gender: ["الجنس", "النوع", "gender"],
    bachelor_university: ["جامعة البكالوريوس", "جهة البكالوريوس", "مؤسسة البكالوريوس", "جهة الحصول على البكالوريوس", "جامعة الحصول على البكالوريوس", "bachelor university"],
    master_university: ["جامعة الماجستير", "جهة الماجستير", "مؤسسة الماجستير", "جهة الحصول على الماجستير", "جامعة الحصول على الماجستير", "master university"],
    phd_university: ["جامعة الدكتوراه", "جامعة الدكتوراة", "جهة الدكتوراه", "جهة الدكتوراة", "جهة الحصول على الدكتوراه", "جهة الحصول على الدكتوراة", "جامعة الحصول على الدكتوراه", "phd university", "doctoral university"],
    target_rank: ["الرتبة المطلوب الترقية إليها", "الرتبة المراد الترقية إليها", "الرتبة المطلوبة", "الترقية إلى رتبة", "target rank", "proposed rank"],
    current_rank_date: ["تاريخ الترقية للرتبة الحالية", "تاريخ آخر ترقية", "تاريخ اخر ترقية", "تاريخ الحصول على الرتبة الحالية", "تاريخ الترقية إلى الرتبة الحالية", "تاريخ الترقية الى الرتبة الحالية", "تاريخ التعيين/الترقية", "تاريخ التعيين / الترقية", "date of current rank", "last promotion date"],
    research_title: ["عنوان البحث", "عنوان البحث المنشور", "عنوان الورقة العلمية", "عنوان العمل (بلغة النشر)", "عنوان العمل بلغة النشر", "research title", "paper title"],
    journal_name: ["اسم المجلة", "مسمى المجلة", "journal name"],
    journal_specialty: ["تخصص المجلة", "مجال المجلة", "تخصص/مجال المجلة", "journal field", "journal specialty"],
    impact_factor: ["معامل التأثير", "معامل تاثير المجلة", "impact factor"],
    publication_date: ["تاريخ النشر", "publication date", "date published"],
  };
  const ALL_KEYS = Object.keys(FIELD_ALIASES);

  const PROFILE_FIELDS = {
    conference: [
      ["member_name", "اسم العضو / مقدم الطلب"],
      ["member_rank", "الرتبة / المسمى الوظيفي"],
      ["member_gender", "الجنس"],
      ["conference_name", "عنوان المؤتمر"],
      ["conference_summary", "نبذة موجزة عن المؤتمر"],
      ["conference_date", "تاريخ عقد المؤتمر"],
      ["conference_organizer", "الجهة المنظمة"],
      ["conference_age", "عمر المؤتمر"],
      ["conference_city", "المدينة"],
      ["conference_country", "الدولة"],
      ["conference_place", "مكان انعقاد المؤتمر"],
      ["participation_type", "نوع المشاركة"],
      ["paper_title", "عنوان البحث المقبول للنشر"],
      ["member_specialty", "تخصص العضو"],
    ],
    appointment: [
      ["member_name", "اسم العضو"],
      ["member_rank", "الرتبة / المسمى الوظيفي"],
      ["member_gender", "الجنس"],
      ["bachelor_university", "جامعة البكالوريوس"],
      ["master_university", "جامعة الماجستير"],
      ["phd_university", "جامعة الدكتوراه"],
    ],
    excellence: [
      ["member_name", "اسم العضو / مقدم الطلب"],
      ["member_rank", "الرتبة / المسمى الوظيفي"],
      ["member_gender", "الجنس"],
      ["research_title", "عنوان البحث"],
      ["journal_name", "اسم المجلة"],
      ["journal_specialty", "تخصص المجلة"],
      ["impact_factor", "معامل التأثير"],
      ["publication_date", "تاريخ النشر"],
    ],
    promotion: [
      ["member_name", "اسم العضو"],
      ["member_rank", "الرتبة الحالية"],
      ["target_rank", "الرتبة المطلوب الترقية إليها"],
      ["current_rank_date", "تاريخ الترقية للرتبة الحالية"],
      ["member_gender", "الجنس"],
    ],
  };

  function _profile_from_title(title) {
    const n = _n(title);
    if (!n) return "";
    if (n.includes(_n("ترقي"))) return "promotion";
    if (n.includes(_n("تعيين")) && !["لجنة", "مشرف", "منسق"].some((x) => n.includes(_n(x)))) return "appointment";
    if (n.includes(_n("مؤتمر"))) return "conference";
    if (n.includes(_n("بدل التميز")) || n.includes(_n("مكافأة التميز")) || (n.includes(_n("تميز")) && n.includes(_n("نشر")))) return "excellence";
    return "";
  }

  function topic_profile(current_title, reference_title = "") {
    return _profile_from_title(current_title) || _profile_from_title(reference_title);
  }

  const scoreCache = new Map();
  function _alias_score(text, alias) {
    const raw_text = strip(pyStrOr(text)), raw_alias = strip(pyStrOr(alias));
    const ck = raw_text + "\u0000" + raw_alias;
    const hit = scoreCache.get(ck);
    if (hit !== undefined) return hit;
    const a = _n(raw_text), b = _n(raw_alias);
    let res;
    if (!a || !b) res = 0.0;
    else if (a === b) res = 1.0;
    else {
      res = null;
      const latin_alias = !!re.search("[A-Za-z]", raw_alias);
      if (!latin_alias) {
        if (a.includes(b) && PY.len(b) >= 7 && PY.len(a) <= PY.len(b) + 14) res = 0.95;
        else if (b.includes(a) && PY.len(a) >= 7) res = 0.91;
      }
      if (res === null) {
        const ratio = new SequenceMatcher(null, a, b).ratio();
        res = ratio >= 0.94 ? ratio : 0.0;
      }
    }
    if (scoreCache.size > 200000) scoreCache.clear();
    scoreCache.set(ck, res);
    return res;
  }

  function field_for_label(label, allowed = null) {
    let best = ["", 0.0];
    const keys = allowed && allowed.length ? allowed : ALL_KEYS;
    for (const key of keys) {
      for (const alias of FIELD_ALIASES[key] || []) {
        const score = _alias_score(label, alias);
        if (score > best[1]) best = [key, score];
      }
    }
    return best[1] >= 0.90 ? best : ["", 0.0];
  }

  function _looks_like_label(cell, allowed = null) {
    return !!field_for_label(cell, allowed)[0];
  }

  function _cell_value_candidate(cell, allowed = null) {
    const s = _clean(cell);
    if (!s || PY.len(s) > 500) return false;
    return !_looks_like_label(s, allowed);
  }

  function _matrix_rect(matrix) {
    let rows = (matrix || []).map((row) => (row || []).map((c) => _clean(c)));
    rows = rows.filter((r) => r.some((x) => x));
    if (!rows.length) return [];
    const width = Math.max(...rows.map((r) => r.length));
    return rows.map((r) => r.concat(Array(width - r.length).fill("")));
  }

  function _nearest_value(matrix, r, c, allowed) {
    const rows = _matrix_rect(matrix);
    if (!rows.length) return "";
    const width = rows[0].length;
    const row = rows[r];
    const label_cols = [];
    row.forEach((cell, i) => { if (cell && _looks_like_label(cell, allowed)) label_cols.push(i); });
    if (label_cols.length) {
      const right_score = label_cols.filter((i) => i + 1 < width && _cell_value_candidate(row[i + 1], allowed)).length;
      const left_score = label_cols.filter((i) => i - 1 >= 0 && _cell_value_candidate(row[i - 1], allowed)).length;
      const directions = right_score >= left_score ? [1, -1] : [-1, 1];
      for (const direction of directions) {
        const cc = c + direction;
        if (cc >= 0 && cc < width && _cell_value_candidate(row[cc], allowed)) return row[cc];
      }
    }
    for (let dist = 2; dist <= width; dist++) {
      for (const cc of [c + dist, c - dist]) {
        if (cc >= 0 && cc < width) {
          const v = row[cc];
          if (_cell_value_candidate(v, allowed)) return v;
        }
      }
    }
    for (let rr = r + 1; rr < Math.min(rows.length, r + 4); rr++) {
      for (const cc of [c, c + 1, c - 1]) {
        if (cc >= 0 && cc < width) {
          const v = rows[rr][cc];
          if (_cell_value_candidate(v, allowed)) return v;
        }
      }
    }
    if (r > 0) {
      for (const cc of [c, c + 1, c - 1]) {
        if (cc >= 0 && cc < width) {
          const v = rows[r - 1][cc];
          if (_cell_value_candidate(v, allowed)) return v;
        }
      }
    }
    return "";
  }

  function _extract_embedded_cell_pairs(cell, allowed) {
    const text = strip(pyStrOr(cell));
    if (!text) return new Map();
    const lines = re.split("[\\r\\n]+", text).filter((x) => _clean(x)).map((x) => _clean(x));
    const out = new Map();
    lines.forEach((line, i) => {
      const m = re.match("^(.{2,100}?)[：:]\\s*(.+)$", line);
      if (m) {
        const [key] = field_for_label(m.group(1), allowed);
        if (key && strip(m.group(2))) {
          if (!out.has(key)) out.set(key, _clean(m.group(2)));
          return;
        }
      }
      const [key] = field_for_label(line, allowed);
      if (key && i + 1 < lines.length) {
        const nxt = lines[i + 1];
        if (nxt && !_looks_like_label(nxt, allowed)) { if (!out.has(key)) out.set(key, nxt); }
      }
    });
    return out;
  }

  function _extract_from_table_labels(matrix, allowed) {
    const rows = _matrix_rect(matrix);
    const found = new Map();
    rows.forEach((row, r) => {
      row.forEach((cell, c) => {
        if (!cell) return;
        for (const [ek, ev] of _extract_embedded_cell_pairs(cell, allowed)) {
          if (ev && 0.995 > (found.has(ek) ? found.get(ek)[0] : 0.0)) found.set(ek, [0.995, ev]);
        }
        const [key, score] = field_for_label(cell, allowed);
        if (!key) return;
        const value = _nearest_value(rows, r, c, allowed);
        if (value && score > (found.has(key) ? found.get(key)[0] : 0.0)) found.set(key, [score, value]);
      });
    });
    const out = {};
    for (const [k, [, v]] of found) out[k] = v;
    return out;
  }

  function _find_header_column(row, aliases) {
    let best = [null, 0.0];
    row.forEach((cell, i) => {
      for (const alias of aliases) {
        const score = _alias_score(cell, alias);
        if (score > best[1]) best = [i, score];
      }
    });
    return best[1] >= 0.72 ? best[0] : null;
  }

  function _education_matrix(matrix) {
    const rows = _matrix_rect(matrix);
    if (rows.length < 2) return {};
    const degree_aliases = ["المؤهل", "الدرجة العلمية", "الدرجة", "المرحلة", "qualification", "degree"];
    const uni_aliases = ["الجامعة", "اسم الجامعة", "جهة التخرج", "المؤسسة التعليمية", "university", "institution"];
    const head = rows.slice(0, 8);
    for (let h = 0; h < head.length; h++) {
      const row = head[h];
      const dcol = _find_header_column(row, degree_aliases);
      const ucol = _find_header_column(row, uni_aliases);
      if (dcol === null || ucol === null || dcol === ucol) continue;
      const out = {};
      for (const data_row of rows.slice(h + 1)) {
        if (dcol >= data_row.length || ucol >= data_row.length) continue;
        const degree = data_row[dcol], uni = data_row[ucol];
        const nd = _n(degree);
        if (!uni) continue;
        if (nd.includes(_n("بكالوريوس"))) { if (!("bachelor_university" in out)) out.bachelor_university = uni; }
        else if (nd.includes(_n("ماجستير"))) { if (!("master_university" in out)) out.master_university = uni; }
        else if (nd.includes(_n("دكتوراه")) || nd.includes(_n("دكتوراة"))) { if (!("phd_university" in out)) out.phd_university = uni; }
      }
      if (Object.keys(out).length) return out;
    }
    return {};
  }

  function _publication_matrix_records(matrix) {
    const rows = _matrix_rect(matrix);
    if (rows.length < 2) return [];
    const allowed = ["research_title", "journal_name", "journal_specialty", "impact_factor", "publication_date"];
    const head = rows.slice(0, 10);
    for (let h = 0; h < head.length; h++) {
      const row = head[h];
      const cols = new Map();
      row.forEach((cell, c) => {
        const [key, score] = field_for_label(cell, allowed);
        if (key && score >= 0.82 && !cols.has(key)) cols.set(key, c);
      });
      if (cols.size < 2) continue;
      const records = [];
      for (const data_row of rows.slice(h + 1)) {
        const meaningful = {};
        for (const [key, c] of cols) {
          const v = c < data_row.length ? _clean(data_row[c]) : "";
          if (v && !_looks_like_label(v, allowed)) meaningful[key] = v;
        }
        if (!Object.keys(meaningful).length) continue;
        if (!(meaningful.research_title || meaningful.journal_name) && Object.keys(meaningful).length < 3) continue;
        records.push(meaningful);
      }
      if (records.length) return records;
    }
    return [];
  }

  function _publication_matrix(matrix) {
    const records = _publication_matrix_records(matrix);
    return records.length ? records[0] : {};
  }

  function _education_any_layout(matrix) {
    const rows = _matrix_rect(matrix);
    const out = {};
    const degree_map = [
      ["bachelor_university", ["بكالوريوس", "البكالوريوس"]],
      ["master_university", ["ماجستير", "الماجستير"]],
      ["phd_university", ["دكتوراه", "دكتوراة", "الدكتوراه", "الدكتوراة"]],
    ];
    rows.forEach((row, r) => {
      row.forEach((cell, c) => {
        const nc = _n(cell);
        for (const [key, aliases] of degree_map) {
          if (key in out || !aliases.some((a) => nc.includes(_n(a)))) continue;
          const candidates = [];
          for (const dist of [1, 2, 3]) {
            for (const cc of [c + dist, c - dist]) if (cc >= 0 && cc < row.length) candidates.push(row[cc]);
          }
          for (const rr of [r + 1, r - 1]) {
            if (rr >= 0 && rr < rows.length) {
              for (const cc of [c, c + 1, c - 1]) if (cc >= 0 && cc < rows[rr].length) candidates.push(rows[rr][cc]);
            }
          }
          for (const v of candidates) {
            const nv = _n(v);
            if (!v || aliases.some((a) => nv.includes(_n(a)))) continue;
            if (PY.len(v) >= 3 && !_looks_like_label(v, ["bachelor_university", "master_university", "phd_university"])) {
              out[key] = _clean(v);
              break;
            }
          }
        }
      });
    });
    return out;
  }

  function _promotion_work_to_title(value) {
    let s = pyStrOr(value).split("\ufeff").join("").split("\xa0").join(" ");
    s = strip(re.sub("\\s+", " ", s));
    if (!s) return "";
    s = strip(re.split(
      "\\s+(?:https?://doi\\.org/|doi\\s*:|\\((?:Web of Science|Scopus)[^)]*\\)|\\(Web of Science\\)\\s*&?\\s*\\(Scopus\\))",
      s, 1, re.I)[0]);
    let m = re.search("\\(\\s*(?:19|20)\\d{2}(?:\\s*,\\s*[A-Za-z]+)?\\s*\\)\\s*[,.:]?\\s*[\"“](.+?)[\"”]\\s*[\\.,]", s, re.S);
    if (m) return PY.rstrip(_clean(m.group(1)), ".");
    m = re.search("\\(\\s*(?:19|20)\\d{2}(?:\\s*,\\s*[A-Za-z]+)?\\s*\\)\\s*[\\.,]?\\s*(.+)$", s, re.S);
    let rest = m ? strip(m.group(1)) : s;
    rest = strip(rest, "\"“” ");
    const m_in = re.search("\\.\\s+In\\s+[A-Z]", rest);
    if (m_in) rest = strip(rest.slice(0, m_in.start()));
    else {
      const m_period = re.search("\\.\\s+(?=[A-Z][A-Za-z])", rest);
      if (m_period) rest = strip(rest.slice(0, m_period.start()));
    }
    rest = re.sub("(?<=[A-Za-z])\\s*-\\s*(?=[A-Za-z])", "-", rest);
    return PY.rstrip(_clean(rest), ".");
  }

  function _promotion_work_citation(value) {
    const s = pyStrOr(value).split("\ufeff").join("").split("\xa0").join(" ");
    return strip(re.sub("\\s+", " ", s));
  }

  function _normalize_gender_value(value) {
    const s = strip(pyStrOr(value));
    if (re.search("[☑✓✔]\\s*[أإا]?نث[ىي]", s)) return "أنثى";
    if (re.search("[☑✓✔]\\s*ذكر", s)) return "ذكر";
    const ns = normalize_ar(s);
    if (["انثى", "انثي"].some((x) => ns.includes(x)) && !ns.includes("ذكر")) return "أنثى";
    if (ns.includes("ذكر") && !["انثى", "انثي"].some((x) => ns.includes(x))) return "ذكر";
    return _clean(value);
  }

  function _looks_like_academic_rank(value) {
    const n = normalize_ar(pyStrOr(value));
    return ["معيد", "محاضر", "استاذ مساعد", "استاذ مشارك", "استاذ",
      "lecturer", "assistant professor", "associate professor", "professor"].some((x) => n.includes(x));
  }

  function _promotion_research_records(matrix) {
    const rows = _matrix_rect(matrix);
    if (!rows.length) return [];
    const title_aliases = FIELD_ALIASES.research_title.concat([
      "اسم البحث", "عنوان البحث العلمي", "اسم البحث العلمي", "البحث العلمي",
      "عنوان الإنتاج العلمي", "عنوان الانتاج العلمي", "الإنتاج العلمي", "الانتاج العلمي",
      "عنوان العمل العلمي", "عنوان العمل (بلغة النشر)", "عنوان العمل بلغة النشر",
      "research paper title", "title of research", "publication title",
    ]);
    const boundaryN = ["المجموع", "الاجمالي", "الإجمالي", "ملاحظات", "التوقيع", "اعتماد", "النتيجة النهائية"].map(_n);
    const is_boundary = (v) => {
      const nv = _n(v);
      return boundaryN.some((x) => nv.includes(x));
    };
    const is_title_header = (v) => {
      if (!v) return false;
      if (_find_header_column([v], title_aliases) === 0) return true;
      const nav = normalize_ar(v);
      if (nav.includes("بحث") && ["عنوان", "اسم", "الإنتاج", "الانتاج"].some((tok) => nav.includes(tok))) {
        if (!nav.includes("عدد")) return true;
      }
      return false;
    };
    const skipWords = new Set(["نعم", "لا", "مقبول", "منشور", "مرفق", "نوع العمل (1-10)", "تاريخ النشر", "المؤلفون", "عددهم", "ترتيب المتقدم"].map(normalize_ar));
    const clean_candidate = (v) => {
      v = _clean(v);
      if (!v || is_boundary(v) || is_title_header(v)) return "";
      const nv = normalize_ar(v);
      if (re.fullmatch("[\\d\\s./-]+", v)) return "";
      if (skipWords.has(nv)) return "";
      if (PY.len(v) < 4) return "";
      return v;
    };
    const split_titles = (v) => {
      v = clean_candidate(v);
      if (!v) return [];
      const parts = re.split("(?:\\r?\\n)+(?=\\s*(?:\\d+\\s*[.)-]|[•▪◦-])\\s*)", v);
      const out = [];
      for (let part of parts) {
        part = strip(re.sub("^\\s*(?:\\d+\\s*[.)-]|[•▪◦-])\\s*", "", part));
        part = clean_candidate(part);
        if (part) out.push(part);
      }
      return out.length ? out : [v];
    };

    const collected = [];
    const header_positions = [];
    rows.forEach((row, h) => row.forEach((cell, c) => { if (is_title_header(cell)) header_positions.push([h, c]); }));

    for (const [h, col] of header_positions) {
      for (const data_row of rows.slice(h + 1)) {
        if (data_row.some((x) => x && is_boundary(x))) break;
        if (data_row.some((x) => x && is_title_header(x))) continue;
        let value = clean_candidate(col < data_row.length ? data_row[col] : "");
        if (value) value = _promotion_work_citation(value);
        if (!value) {
          const candidates = [];
          data_row.forEach((cell, c) => {
            const cand = clean_candidate(cell);
            if (!cand) return;
            let score = 0;
            if (c === col) score += 100;
            score += Math.min(PY.len(cand), 200);
            score += re.search("[A-Za-z\\u0600-\\u06FF]{4,}", cand) ? 30 : 0;
            if (["مجله", "journal", "doi", "معامل التأثير", "وحده"].some((tok) => normalize_ar(cand).includes(tok))) score -= 80;
            candidates.push([score, cand]);
          });
          if (candidates.length) {
            let best = candidates[0];
            for (const cnd of candidates.slice(1)) {
              if (cnd[0] > best[0] || (cnd[0] === best[0] && PY.cmpStr(cnd[1], best[1]) > 0)) best = cnd;
            }
            value = _promotion_work_citation(best[1]);
          }
        }
        if (value) collected.push(...split_titles(value));
      }
      if (collected.length) break;
    }

    if (!collected.length) {
      rows.forEach((row, r) => row.forEach((cell, c) => {
        if (!is_title_header(cell)) return;
        const value = _nearest_value(rows, r, c, ["research_title"]);
        collected.push(...split_titles(value));
      }));
    }

    const table_text = rows.flatMap((row) => row.filter((cell) => cell)).join(" ");
    const ntab = normalize_ar(table_text);
    if (!collected.length && ["الإنتاج العلمي", "الانتاج العلمي", "الأبحاث", "الابحاث", "البحوث"].some((k) => ntab.includes(k))) {
      for (const row of rows) {
        const candidates = row.map((c) => clean_candidate(c)).filter((c) => c);
        if (!candidates.length) continue;
        if (candidates.every((c) => _looks_like_label(c, null) || is_title_header(c))) continue;
        const textual = candidates.filter((c) => PY.len(c) >= 12 && re.search("[A-Za-z\\u0600-\\u06FF]", c));
        if (textual.length) {
          let longest = textual[0];
          for (const t of textual) if (PY.len(t) > PY.len(longest)) longest = t;
          collected.push(...split_titles(longest));
        }
      }
    }

    const seen = new Set();
    const dedup = [];
    for (const value of collected) {
      const key = _n(value);
      if (!value || seen.has(key)) continue;
      seen.add(key);
      dedup.push({ research_title: value });
    }
    return dedup;
  }

  function _topic_blob(topic) {
    const parts = [pyStrOr(topic.rationale)];
    for (const matrix of topic.data_tables || []) {
      for (const row of matrix || []) for (const c of row || []) parts.push(pyStrOr(c));
    }
    return parts.join("\n");
  }

  function _known_form_kind(topic) {
    const n = _n(_topic_blob(topic));
    if (n.includes(_n("الوظيفية المتقدم عليها")) || n.includes(_n("المتقدم للتعيين")) || n.includes(_n("طلب تعيين عضو هيئة تدريس"))) return "appointment";
    if (n.includes(_n("المرتبة العلمية المتقدم للترقية إليها")) || n.includes(_n("هل سبق التقديم لهذه الترقية")) || n.includes(_n("استمارة طلب ترقية علمية"))) return "promotion";
    if (n.includes(_n("معلومات عن المؤتمر/الندوة")) || n.includes(_n("طلب الحضور/المشاركة في المؤتمرات"))) return "conference";
    return "";
  }

  function _next_row_same_col(rows, r, c, max_down = 3) {
    for (let rr = r + 1; rr < Math.min(rows.length, r + 1 + max_down); rr++) {
      if (c < rows[rr].length) {
        const v = _clean(rows[rr][c]);
        if (v) return v;
      }
    }
    return "";
  }

  function _find_exactish_cell_value(matrix, aliases, below = false) {
    const rows = _matrix_rect(matrix);
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      for (let c = 0; c < row.length; c++) {
        const ncell = _n(row[c]);
        if (!ncell) continue;
        if (aliases.some((a) => _n(a) === ncell || (ncell.includes(_n(a)) && PY.len(_n(a)) >= 7))) {
          if (below) {
            const v = _next_row_same_col(rows, r, c);
            if (v) return v;
          }
          for (const cc of [c + 1, c - 1]) {
            if (cc >= 0 && cc < row.length) {
              const v = _clean(row[cc]);
              if (v && _n(v) !== ncell) return v;
            }
          }
          const v = _nearest_value(rows, r, c, ALL_KEYS);
          if (v) return v;
        }
      }
    }
    return "";
  }

  function _education_university_from_table(matrix) {
    const rows = _matrix_rect(matrix);
    if (!rows.length) return "";
    const ucols = [];
    let header_end = -1;
    rows.slice(0, 3).forEach((row, r) => row.forEach((cell, c) => {
      const nc = _n(cell);
      if (nc === _n("الجامعة") || nc === _n("اسم الجامعة")) { ucols.push(c); header_end = Math.max(header_end, r); }
    }));
    if (!ucols.length) return "";
    for (let rr = header_end + 1; rr < rows.length; rr++) {
      for (const c of ucols) {
        if (c >= rows[rr].length) continue;
        const v = _clean(rows[rr][c]);
        if (!v) continue;
        const nv = _n(v);
        if (nv === _n("الجامعة") || nv === _n("اسم الجامعة")) continue;
        return v;
      }
    }
    return "";
  }

  function _extract_known_appointment(topic) {
    const values = {};
    const text = pyStrOr(topic.rationale);
    const tables = Array.from(topic.data_tables || []);
    const m = re.search("المتقدم\\s+للتعيين\\s*[:：]?\\s*الاسم\\s*[:：]\\s*(.+?)(?=\\s+التوقيع\\s*[:：]|$)", text, re.S);
    if (m) values.member_name = _clean(m.group(1));
    for (const matrix of tables) {
      const rows = _matrix_rect(matrix);
      if (!rows.length) continue;
      if (rows[0].some((c) => _n("المسمى") === _n(c))) {
        const c = rows[0].findIndex((cell) => _n(cell) === _n("المسمى"));
        if (c >= 0) {
          const v = _next_row_same_col(rows, 0, c);
          if (v && _looks_like_academic_rank(v)) {
            values.member_rank = v;
            break;
          }
        }
      }
    }
    const edu_tables = [];
    for (const matrix of tables) {
      const flat = normalize_ar(_matrix_rect(matrix).flatMap((row) => row.filter((c) => c)).join(" "));
      if (flat.includes("الجامعه") && (flat.includes("سنه التخرج") || flat.includes("تاريخه")) && flat.includes("التخصص")) {
        const uni = _education_university_from_table(matrix);
        if (uni) edu_tables.push(uni);
      }
    }
    ["bachelor_university", "master_university", "phd_university"].forEach((key, i) => {
      if (i < Math.min(3, edu_tables.length)) values[key] = edu_tables[i];
    });
    if (tables.length) {
      const g = _extract_from_table_labels(tables[0], ["member_gender"]).member_gender || "";
      const ng = _normalize_gender_value(g);
      if (ng === "ذكر" || ng === "أنثى") values.member_gender = ng;
    }
    const gm = re.search("[☑✓✔■●]\\s*(ذكر|[أإا]?نث[ىي])", text);
    if (gm) values.member_gender = _normalize_gender_value(gm.group(0));
    return values;
  }

  function _extract_known_promotion(topic) {
    const values = {};
    const text = pyStrOr(topic.rationale);
    const tables = Array.from(topic.data_tables || []);
    if (tables.length) {
      const base = _extract_from_table_labels(tables[0], ["member_name", "member_gender"]);
      for (const [k, v] of Object.entries(base)) if (v) values[k] = v;
    }
    for (const matrix of tables) {
      const rows = _matrix_rect(matrix);
      if (!rows.length) continue;
      rows.forEach((row, r) => row.forEach((cell, c) => {
        if (_n(cell) === _n("الرتبة الحالية")) {
          const v = _next_row_same_col(rows, r, c);
          if (_looks_like_academic_rank(v)) values.member_rank = v;
        }
        if (_n(cell) === _n("تاريخ التعيين/الترقية")) {
          const v = _next_row_same_col(rows, r, c);
          if (v) values.current_rank_date = v;
        }
      }));
    }
    let m = re.search("المرتبة\\s+العلمية\\s+المتقدم\\s+للترقية\\s+إليها\\s*[:：]?\\s*[^\\n]*?[☑✓✔■●]\\s*(أستاذ\\s+مشارك|أستاذ)", text);
    if (m) values.target_rank = _clean(m.group(1));
    else {
      m = re.search("المرتبة\\s+العلمية\\s+المتقدم\\s+للترقية\\s+إليها\\s*[:：]?\\s*(أستاذ\\s+مشارك|أستاذ)", text);
      if (m) values.target_rank = _clean(m.group(1));
    }
    if (values.member_gender) values.member_gender = _normalize_gender_value(values.member_gender);
    return values;
  }

  function _restore_run_spacing(value) {
    let s = pyStrOr(value);
    s = re.sub("(?<=[a-z])(?=[A-Z])", " ", s);
    return _clean(s);
  }

  function _extract_known_conference(topic) {
    const values = {};
    const text = pyStrOr(topic.rationale);
    const tables = Array.from(topic.data_tables || []);
    if (tables.length) Object.assign(values, _extract_from_table_labels(tables[0], ["member_name", "member_gender"]));
    if (tables.length >= 2) {
      const rows = _matrix_rect(tables[1]);
      if (rows.length) {
        rows[0].forEach((cell, c) => {
          if (_n(cell) === _n("الرتبة العلمية الحالية")) {
            const v = _next_row_same_col(rows, 0, c);
            if (v) values.member_rank = v;
          } else if (_n(cell) === _n("التخصص الدقيق")) {
            const v = _next_row_same_col(rows, 0, c);
            if (v) values.member_specialty = v;
          }
        });
      }
    }
    let conf_table = null;
    for (const matrix of tables) {
      const rows = _matrix_rect(matrix);
      const cells_n = rows.flatMap((row) => row.filter((c) => c).map((c) => _n(c)));
      if (cells_n.some((c) => c.includes(_n("عنوان المؤتمر أو الندوة"))) ||
        (cells_n.some((c) => c.includes(_n("نبذة موجزة عن المؤتمر"))) && cells_n.some((c) => c.includes(_n("الجهة المنظمة للمؤتمر"))))) {
        conf_table = rows;
        break;
      }
    }
    if (conf_table && conf_table.length) {
      for (const row of conf_table) {
        if (!row.length) continue;
        const label = row.length ? _n(row[0]) : "";
        const value = row.length > 1 ? _clean(row[1]) : "";
        if (label.includes(_n("عنوان المؤتمر أو الندوة"))) values.conference_name = _restore_run_spacing(value);
        else if (label.includes(_n("نبذة موجزة عن المؤتمر"))) values.conference_summary = value;
        else if (label.includes(_n("عمر المؤتمر"))) values.conference_age = value;
        else if (label.includes(_n("الجهة المنظمة للمؤتمر"))) values.conference_organizer = value;
        else if (_n("عنوان البحث") === label) values.paper_title = value;
      }
      const composite = conf_table.filter((row) => row.length > 3 && _clean(row[3])).map((row) => _clean(row[3])).join("\n");
      let m = re.search("المدينة\\s*[:：]\\s*([^\\n|]+)", composite);
      if (m) values.conference_city = _clean(m.group(1));
      m = re.search("الدولة\\s*[:：]\\s*([^\\n|]+)", composite);
      if (m) values.conference_country = _clean(m.group(1));
      m = re.search("من\\s*[:：]\\s*([^\\n|]+?)\\s+إلى\\s*[:：]\\s*([^\\n|]+)", composite);
      if (m) {
        values.conference_start_date = _clean(m.group(1));
        values.conference_end_date = _clean(m.group(2));
        values.conference_date = `${values.conference_start_date} - ${values.conference_end_date}`;
      }
    }
    const m = re.search("نوع\\s+المشاركة\\s*[:：]?\\s*\\|?\\s*([^\\n|]+)", text);
    if (m) {
      const v = _clean(m.group(1));
      if (v && v !== "نوع المشاركة") values.participation_type = v;
    }
    if (values.member_gender) values.member_gender = _normalize_gender_value(values.member_gender);
    return values;
  }

  function _conference_matrix(matrix) {
    const allowed = ["member_name", "member_rank", "member_gender", "conference_name", "paper_title", "conference_place", "conference_city", "conference_country", "conference_date", "conference_start_date", "conference_end_date", "conference_time"];
    return _extract_from_table_labels(matrix, allowed);
  }

  function _parse_text_pairs(text, allowed) {
    const found = {};
    const lines = PY.splitlines(text || "").filter((x) => _clean(x)).map((x) => _clean(x));
    lines.forEach((line, i) => {
      const m = re.match("^(.{2,100}?)[：:]\\s*(.+)$", line);
      if (m) {
        const label = _clean(m.group(1)), value = _clean(m.group(2));
        const [key] = field_for_label(label, allowed);
        if (key && value && !_looks_like_label(value, allowed)) {
          if (!(key in found)) found[key] = value;
          return;
        }
      }
      const [key] = field_for_label(line, allowed);
      if (key && i + 1 < lines.length) {
        const value = lines[i + 1];
        if (value && !_looks_like_label(value, allowed)) { if (!(key in found)) found[key] = value; }
      }
    });
    return found;
  }

  class ExtractedFormFields {
    constructor(profile, values, display_fields, records = null) {
      this.profile = profile;
      this.values = values;
      this.display_fields = display_fields;
      this.records = records;
    }
    as_text(exclude_keys = null) {
      const excluded = exclude_keys || new Set();
      return this.display_fields
        .filter(([key]) => !excluded.has(key) && strip(this.values[key] ?? ""))
        .map(([key, label]) => `${label}: ${strip(this.values[key] ?? "")}`)
        .join("\n");
    }
  }

  function extract_form_fields(topic, profile) {
    const display_fields = PROFILE_FIELDS[profile] || [];
    const allowed = display_fields.map(([k]) => k);
    let values = {};
    let records = [];
    const setdefault = (obj, k, v) => { if (!(k in obj)) obj[k] = v; };

    for (const matrix of Array.from(topic.data_tables || [])) {
      const candidates = {};
      if (profile === "appointment") {
        Object.assign(candidates, _education_matrix(matrix));
        for (const [k, v] of Object.entries(_education_any_layout(matrix))) setdefault(candidates, k, v);
        for (const [k, v] of Object.entries(_extract_from_table_labels(matrix, allowed))) setdefault(candidates, k, v);
      } else if (profile === "excellence") {
        const publication_rows = _publication_matrix_records(matrix);
        if (publication_rows.length) {
          records.push(...publication_rows);
          Object.assign(candidates, publication_rows[0]);
        }
        for (const [k, v] of Object.entries(_extract_from_table_labels(matrix, allowed))) setdefault(candidates, k, v);
      } else if (profile === "conference") {
        Object.assign(candidates, _conference_matrix(matrix));
      } else if (profile === "promotion") {
        const promotion_rows = _promotion_research_records(matrix);
        if (promotion_rows.length) records.push(...promotion_rows);
        for (const [k, v] of Object.entries(_extract_from_table_labels(matrix, allowed))) setdefault(candidates, k, v);
      }
      for (const [key, value] of Object.entries(candidates)) {
        if (allowed.includes(key) && value && !values[key]) values[key] = _clean(value);
      }
    }

    for (const [key, value] of Object.entries(_parse_text_pairs(topic.rationale || "", allowed))) setdefault(values, key, value);

    const known_kind = _known_form_kind(topic);
    let known_values = {};
    if (profile === "appointment" && known_kind === "appointment") known_values = _extract_known_appointment(topic);
    else if (profile === "conference" && known_kind === "conference") known_values = _extract_known_conference(topic);
    else if (profile === "promotion" && known_kind === "promotion") known_values = _extract_known_promotion(topic);
    if (known_kind === profile) values = {};
    for (const [key, value] of Object.entries(known_values)) {
      if (allowed.includes(key) && _clean(value)) values[key] = _clean(value);
    }

    if (profile === "promotion") {
      if (values.member_gender) values.member_gender = _normalize_gender_value(values.member_gender);
      if (values.member_rank && !_looks_like_academic_rank(values.member_rank)) delete values.member_rank;
      if (values.target_rank && !_looks_like_academic_rank(values.target_rank)) delete values.target_rank;
      if (values.current_rank_date && !(
        re.search("\\d{1,4}\\s*[./-]\\s*\\d{1,2}\\s*[./-]\\s*\\d{1,4}", values.current_rank_date) ||
        re.findall("\\d+", values.current_rank_date).length >= 3
      )) delete values.current_rank_date;
    }

    if (profile === "conference" && !values.conference_date) {
      const date_parts = {};
      for (const matrix of Array.from(topic.data_tables || [])) Object.assign(date_parts, _extract_from_table_labels(matrix, ["conference_start_date", "conference_end_date"]));
      Object.assign(date_parts, _parse_text_pairs(topic.rationale || "", ["conference_start_date", "conference_end_date"]));
      const start = strip(values.conference_start_date || date_parts.conference_start_date || "");
      const end = strip(values.conference_end_date || date_parts.conference_end_date || "");
      if (start && end) values.conference_date = `${start} - ${end}`;
      else if (start || end) values.conference_date = start || end;
    }

    if (profile === "conference" && !values.conference_place) {
      const broader = ["conference_place", "conference_city", "conference_country"];
      const extras = {};
      for (const matrix of Array.from(topic.data_tables || [])) Object.assign(extras, _extract_from_table_labels(matrix, broader));
      Object.assign(extras, _parse_text_pairs(topic.rationale || "", broader));
      const city = extras.conference_city || "", country = extras.conference_country || "";
      const place = extras.conference_place || [city, country].filter((x) => x).join("، ");
      if (place) values.conference_place = place;
    }

    if (records.length) {
      const seen = new Set();
      const unique = [];
      for (const rec of records) {
        const sig = JSON.stringify(["research_title", "journal_name", "journal_specialty", "impact_factor", "publication_date"].map((k) => [k, _clean(rec[k] ?? "")]));
        if (seen.has(sig)) continue;
        seen.add(sig);
        unique.push(rec);
      }
      records = unique;
    }
    return new ExtractedFormFields(profile, values, display_fields, records.length ? records : null);
  }

  function fields_to_text(extracted, values = null) {
    const vals = values !== null && values !== undefined ? values : extracted.values;
    return extracted.display_fields
      .filter(([key]) => _clean(vals[key] ?? ""))
      .map(([key, label]) => `${label}: ${_clean(vals[key] ?? "")}`)
      .join("\n");
  }

  function publication_records_to_text(records) {
    records = records || [];
    if (!records.length) return "";
    const labels = {
      research_title: "عنوان البحث",
      journal_name: "اسم المجلة",
      journal_specialty: "تخصص المجلة",
      impact_factor: "معامل التأثير",
      publication_date: "تاريخ النشر",
    };
    const blocks = [];
    const ordinals = ["البحث الأول", "البحث الثاني", "البحث الثالث", "البحث الرابع", "البحث الخامس", "البحث السادس"];
    records.forEach((rec, i) => {
      const lines = [];
      if (records.length > 1) lines.push(i < ordinals.length ? ordinals[i] : `البحث رقم ${i + 1}`);
      for (const key of ["research_title", "journal_name", "journal_specialty", "impact_factor", "publication_date"]) {
        const value = _clean(rec[key] ?? "");
        if (value) lines.push(`${labels[key]}: ${value}`);
      }
      if (lines.length) blocks.push(lines.join("\n"));
    });
    return blocks.join("\n\n");
  }

  return {
    _n, _clean, FIELD_ALIASES, PROFILE_FIELDS, _profile_from_title, topic_profile, _alias_score, field_for_label,
    _looks_like_label, _cell_value_candidate, _matrix_rect, _nearest_value, _extract_embedded_cell_pairs,
    _extract_from_table_labels, _find_header_column, _education_matrix, _publication_matrix_records,
    _publication_matrix, _education_any_layout, _promotion_work_to_title, _promotion_work_citation,
    _normalize_gender_value, _looks_like_academic_rank, _promotion_research_records, _topic_blob, _known_form_kind,
    _next_row_same_col, _find_exactish_cell_value, _education_university_from_table, _extract_known_appointment,
    _extract_known_promotion, _restore_run_spacing, _extract_known_conference, _conference_matrix, _parse_text_pairs,
    ExtractedFormFields, extract_form_fields, fields_to_text, publication_records_to_text,
  };
})();
