/* توليد موضوع مجلس القسم من مصدر بيانات حالي + موضوع مرجعي — منقول من core/department_transfer.py */
"use strict";

const DeptTransfer = (() => {
  const { re, strip, rstrip, SequenceMatcher } = PY;
  const { normalize_ar } = Similarity;
  const { extract_applicant } = Precedent;
  const { topic_profile: _table_topic_profile, extract_form_fields, publication_records_to_text } = FormFields;

  function _norm(s) {
    return normalize_ar(s || "");
  }
  const nospace = (s) => s.split(" ").join("");

  function _parse_fields(text) {
    const out = [];
    for (const raw of PY.splitlines(text || "")) {
      const line = strip(raw);
      if (!line) continue;
      if (line.includes("|")) {
        const cells = line.split("|").map((x) => strip(x)).filter((x) => x);
        if (cells.length === 2 && PY.len(cells[0]) <= 60) {
          out.push([cells[0], cells[1]]);
          continue;
        }
      }
      const m = re.match("^([^:：]{2,60})[:：]\\s*(.+)$", line);
      if (m) out.push([strip(m.group(1)), strip(m.group(2))]);
    }
    return out;
  }

  function _field_map(text) {
    const out = new Map();
    for (const [k, v] of _parse_fields(text)) if (v) out.set(nospace(_norm(k)), v);
    return out;
  }

  function _replace_literal(text, old, nw) {
    if (!text || !old || !nw || old === nw) return text || "";
    return (text || "").split(old).join(nw);
  }

  function _current_facts_text(topic) {
    return strip(topic.rationale || "");
  }

  function _strip_name_prefix(value) {
    const raw = strip(value || "");
    if (!raw) return ["", ""];
    const patterns = [
      "^\\s*(الدكتورة|الدكتور|الأستاذة|الأستاذ|المحاضرة|المحاضر)\\s*/?\\s*",
      "^\\s*(د\\.?|Dr\\.?)\\s*/?\\s*",
    ];
    for (const patt of patterns) {
      const m = re.match(patt, raw, re.IGNORECASE);
      if (m) {
        let honor = strip(m.group(1));
        if (honor === "د" || honor === "د." || honor.toLowerCase().startsWith("dr")) honor = "";
        return [honor, strip(raw.slice(m.end()), " ،,")];
      }
    }
    return ["", strip(raw, " ،,")];
  }

  function _rank_honorific(rank, gender = "") {
    const r = nospace(_norm(rank));
    const g = nospace(_norm(gender));
    const female = ["انثى", "انثي", "female"].some((x) => g.includes(x));
    const male = ["ذكر", "male"].some((x) => g.includes(x));
    if (r.includes("محاضره") || (r.includes("محاضر") && female)) return "المحاضرة";
    if (r.includes("محاضر") && !female) return "المحاضر";
    if (r.includes("معيده") || (r.includes("معيد") && female)) return "المعيدة";
    if (r.includes("معيد") && !female) return "المعيد";
    if (["استاذ", "استاذمساعد", "استاذمشارك"].some((x) => r.includes(x))) {
      if (female) return "الدكتورة";
      if (male) return "الدكتور";
    }
    return "";
  }

  function _current_gender_kind(current_topic) {
    const raw_gender = nospace(_norm(_lookup_field(current_topic, "member_gender")));
    if (["ذكر", "male"].some((x) => raw_gender.includes(x))) return "male";
    if (["انثي", "female"].some((x) => raw_gender.includes(x))) return "female";
    const [honor] = _strip_name_prefix(_lookup_field(current_topic, "member_name"));
    if (["الدكتور", "الأستاذ", "المحاضر"].includes(honor)) return "male";
    if (["الدكتورة", "الأستاذة", "المحاضرة"].includes(honor)) return "female";
    const rank = nospace(_norm(_lookup_field(current_topic, "member_rank")));
    if (rank.includes("محاضره") || rank.includes("معيده")) return "female";
    if (rank.includes("محاضر") || rank.includes("معيد")) return "male";
    return "";
  }

  const _GENDERED_WORDS_FEMALE_TO_MALE = [
    ["لبحثها", "لبحثه"], ["بحثها", "بحثه"], ["ورقتها", "ورقته"], ["مشاركتها", "مشاركته"], ["طلبها", "طلبه"],
    ["تعيينها", "تعيينه"], ["ترقيتها", "ترقيته"], ["إنتاجها", "إنتاجه"], ["انتاجها", "انتاجه"], ["أبحاثها", "أبحاثه"],
    ["ابحاثها", "ابحاثه"], ["منشوراتها", "منشوراته"], ["دراستها", "دراسته"], ["بعثتها", "بعثته"], ["تمديدها", "تمديده"],
    ["مؤهلها", "مؤهله"], ["خبراتها", "خبراته"], ["خبرتها", "خبرته"], ["سيرتها", "سيرته"], ["موافقتها", "موافقته"],
    ["استيفائها", "استيفائه"], ["استيفاءها", "استيفائه"], ["تتقدم", "يتقدم"], ["متقدمة", "متقدم"],
  ];

  function _gender_correct_honorific(reference_honorific, current_topic) {
    const honor = strip(reference_honorific || "");
    const kind = _current_gender_kind(current_topic);
    if (!honor || !kind) return honor;
    const f2m = { "الدكتورة": "الدكتور", "الأستاذة": "الأستاذ", "المحاضرة": "المحاضر", "المعيدة": "المعيد" };
    if (kind === "male") return f2m[honor] ?? honor;
    const m2f = {};
    for (const [k, v] of Object.entries(f2m)) m2f[v] = k;
    return m2f[honor] ?? honor;
  }

  function _apply_current_gender_grammar(text, current_topic) {
    const out = text || "";
    const kind = _current_gender_kind(current_topic);
    if (!kind) return out;
    // dict semantics: later duplicate keys override earlier ones.
    const mapping = new Map();
    if (kind === "male") for (const [k, v] of _GENDERED_WORDS_FEMALE_TO_MALE) mapping.set(k, v);
    else for (const [k, v] of _GENDERED_WORDS_FEMALE_TO_MALE) mapping.set(v, k);
    const keys = Array.from(mapping.keys()).sort((a, b) => PY.len(b) - PY.len(a));
    if (!keys.length) return out;
    const pattern = re.compile(keys.map((k) => re.escape(k)).join("|"));
    return pattern.sub((m) => mapping.get(m.group(0)), out);
  }

  function _current_applicant(current_topic, target_department = "") {
    const current_title = current_topic.title || "";
    const app = extract_applicant(current_title, _current_facts_text(current_topic), target_department);
    let name = app.name, honorific = app.honorific, rank = app.rank;
    const has_placeholder = !!re.search("[ـ_]{3,}|-{4,}|—{3,}", current_title);
    if (has_placeholder) { name = ""; honorific = ""; rank = ""; }
    if (name && !re.sub("[\\sـ_\\-–—.،,]+", "", name)) name = "";
    const raw_name = _lookup_field(current_topic, "member_name");
    if (!name && raw_name) {
      const [h, n] = _strip_name_prefix(raw_name);
      name = n || name;
      honorific = h || honorific;
    }
    const current_rank = _lookup_field(current_topic, "member_rank");
    const current_gender = _lookup_field(current_topic, "member_gender");
    if (current_rank) rank = strip(current_rank);
    const rank_honor = _rank_honorific(rank, current_gender);
    if (rank_honor) honorific = rank_honor;
    const department = target_department || app.department;
    return [honorific, name, rank, department];
  }

  function reference_title_template(reference, target_department = "", placeholder = "ــــــــــــ") {
    let title = strip(reference.title || "");
    const old = extract_applicant(title, reference.rationale || "", reference.council_name || "");
    if (old.name) title = _replace_literal(title, old.name, placeholder);
    const ref_department = strip(reference.council_name || old.department || "");
    if (target_department && ref_department && _norm(ref_department) !== _norm(target_department)) {
      title = _replace_literal(title, `قسم ${ref_department}`, `قسم ${target_department}`);
      title = _replace_literal(title, ref_department, target_department);
    }
    return title;
  }

  function _build_title_from_reference(reference, current_topic, target_department = "") {
    const ref_title = strip(reference.title || "");
    if (!ref_title) return strip(current_topic.title || "");
    const old = extract_applicant(ref_title, reference.rationale || "", reference.council_name || "");
    const [cur_honor, cur_name, cur_rank, cur_dep] = _current_applicant(current_topic, target_department);
    let title = ref_title;
    if (old.name) title = _replace_literal(title, old.name, cur_name || "ــــــــــــ");
    if (old.honorific) {
      const effective_honor = cur_honor || _gender_correct_honorific(old.honorific, current_topic);
      if (effective_honor) title = _replace_literal(title, old.honorific, effective_honor);
    }
    if (old.rank && cur_rank) title = _replace_literal(title, old.rank, cur_rank);
    const ref_dep = strip(reference.council_name || old.department || "");
    const dep = target_department || cur_dep;
    if (dep && ref_dep && _norm(dep) !== _norm(ref_dep)) {
      title = _replace_literal(title, `قسم ${ref_dep}`, `قسم ${dep}`);
      title = _replace_literal(title, ref_dep, dep);
    }
    title = _apply_current_gender_grammar(title, current_topic);
    return strip(title);
  }

  function _safe_template_text(reference_text, current_topic, reference_title = "", target_department = "") {
    let text = reference_text || "";
    const cur_fields = _field_map(_current_facts_text(current_topic));
    const ref_fields = _field_map(reference_text);
    for (const [k, new_val] of cur_fields) {
      const old_val = ref_fields.get(k);
      if (old_val) text = _replace_literal(text, old_val, new_val);
    }
    const old_app = extract_applicant(reference_title || "", reference_text || "", "");
    const [cur_honor, cur_name, cur_rank, cur_dep] = _current_applicant(current_topic, target_department);
    const effective_honor = cur_honor || _gender_correct_honorific(old_app.honorific, current_topic);
    const replacements = [
      [old_app.name, cur_name || (old_app.name ? "ــــــــــــ" : "")],
      [old_app.honorific, effective_honor],
      [old_app.rank, cur_rank],
      [old_app.department, cur_dep],
    ];
    for (const [old, nw] of replacements) if (old && nw) text = _replace_literal(text, old, nw);
    text = _apply_current_gender_grammar(text, current_topic);
    return strip(text);
  }

  function _reference_intro(reference_rationale) {
    const ref = strip(reference_rationale || "");
    if (!ref) return "";
    const lines = PY.splitlines(ref).map((x) => strip(x)).filter((x) => x);
    if (!lines.length) return "";
    const kept = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (i > 0 && re.match("^.{2,80}[：:]\\s*", line)) break;
      if (i > 0 && Object.values(_FIELD_ALIASES).some((aliases) => _contains_alias(rstrip(line, "：: "), aliases))) break;
      kept.push(line);
      const n = _norm(line);
      if (["وفق التفاصيل التالية", "وفقا للتفاصيل التالية", "حسب التفاصيل التالية", "وفق البيانات التالية", "وفقا للبيانات التالية"].some((x) => n.includes(_norm(x)))) break;
    }
    return strip(kept.join("\n"));
  }

  function _opening_style(reference_rationale, current_title) {
    const ref = strip(reference_rationale || "");
    let verb = "استعرض المجلس";
    const n = _norm(ref);
    for (const cand of ["استعرض المجلس", "ناقش المجلس", "استعرض ومناقشة المجلس", "اطلع المجلس", "ناقش أعضاء المجلس"]) {
      if (n.includes(_norm(cand))) { verb = cand; break; }
    }
    const title = rstrip(strip(current_title || ""), ".");
    if (title) {
      const subject = strip(re.sub("^\\s*(?:دراسة|مناقشة)\\s+", "", title));
      return `${verb} ${subject} وفق البيانات التالية:`;
    }
    return `${verb} الموضوع وفق البيانات التالية:`;
  }

  // Python dict literal with a duplicated "member_name" key: the later value wins
  // but the key keeps its first position.
  const _FIELD_ALIASES = {
    member_name: ["اسم العضو", "اسم المرشح", "اسم المرشحة", "الاسم"],
    member_rank: ["الرتبة العلمية", "الرتبة الأكاديمية", "الرتبة الاكاديمية", "الرتبة", "المسمى الوظيفي", "المسمى الأكاديمي", "المسمى الاكاديمي", "الوظيفة"],
    member_gender: ["الجنس", "النوع"],
    conference_name: ["اسم المؤتمر", "عنوان المؤتمر", "المؤتمر"],
    paper_title: ["عنوان الورقة العلمية", "عنوان الورقة العلمية المنشورة", "عنوان البحث المقبول للنشر", "عنوان البحث", "اسم البحث", "الورقة العلمية المنشورة"],
    conference_place: ["مكان المؤتمر", "مكان انعقاد المؤتمر", "مقر المؤتمر", "المكان", "المدينة", "الدولة"],
    conference_date: ["تاريخ المؤتمر", "تاريخ عقد المؤتمر", "تاريخ انعقاد المؤتمر", "موعد المؤتمر", "التاريخ"],
    conference_time: ["وقت المؤتمر", "وقت انعقاد المؤتمر", "الوقت"],
    bachelor_university: ["جامعة البكالوريوس", "جهة البكالوريوس", "مؤسسة البكالوريوس", "بكالوريوس"],
    master_university: ["جامعة الماجستير", "جهة الماجستير", "مؤسسة الماجستير", "ماجستير"],
    phd_university: ["جامعة الدكتوراه", "جامعة الدكتوراة", "جهة الدكتوراه", "جهة الدكتوراة", "مؤسسة الدكتوراه", "دكتوراه", "دكتوراة"],
    research_title: ["عنوان البحث", "عنوان البحث المنشور", "عنوان الورقة العلمية", "الورقة العلمية المنشورة"],
    journal_name: ["اسم المجلة", "المجلة"],
    journal_specialty: ["تخصص المجلة", "تصنيف المجلة", "مجال المجلة"],
    impact_factor: ["معامل التأثير", "impact factor"],
    publication_date: ["تاريخ النشر", "publication date"],
    target_rank: ["الرتبة المطلوب الترقية إليها", "الرتبة المراد الترقية إليها", "الرتبة المطلوبة", "الترقية إلى رتبة"],
    current_rank_date: ["تاريخ الترقية للرتبة الحالية", "تاريخ آخر ترقية", "تاريخ اخر ترقية", "تاريخ الحصول على الرتبة الحالية", "تاريخ الترقية إلى الرتبة الحالية", "تاريخ الترقية الى الرتبة الحالية"],
  };

  const aliasNormCache = new Map();
  function _contains_alias(label, aliases) {
    const n = nospace(_norm(label));
    return aliases.some((a) => {
      if (!a) return false;
      let an = aliasNormCache.get(a);
      if (an === undefined) { an = nospace(_norm(a)); aliasNormCache.set(a, an); }
      return n.includes(an) || an.includes(n);
    });
  }

  function _all_current_fields(topic) {
    const pairs = _parse_fields(_current_facts_text(topic)).slice();
    const lines = PY.splitlines(_current_facts_text(topic) || "").map((x) => strip(x, " \t•·-–—"));
    lines.slice(0, -1).forEach((line, i) => {
      if (!line) return;
      if (line.endsWith(":") || line.endsWith("：")) {
        const label = rstrip(line, ":： ");
        const val = strip(lines[i + 1]);
        if (val && !val.endsWith(":") && PY.len(label) <= 80) pairs.push([label, val]);
      }
    });
    for (const matrix of Array.from(topic.data_tables || [])) {
      if (!matrix || !matrix.length) continue;
      for (const row of matrix) {
        const cells = row.map((c) => strip(c ? String(c) : ""));
        const nonempty = [];
        cells.forEach((c, i) => { if (c) nonempty.push([i, c]); });
        if (nonempty.length < 2) continue;
        for (const [i, cell] of nonempty) {
          if (PY.len(cell) > 100) continue;
          if (Object.values(_FIELD_ALIASES).some((aliases) => _contains_alias(cell, aliases))) {
            const candidates = nonempty.filter(([j]) => j !== i).map(([j, v]) => [Math.abs(j - i), j, v]);
            if (candidates.length) {
              candidates.sort((a, b) => a[0] - b[0] || a[1] - b[1] || PY.cmpStr(a[2], b[2]));
              const value = candidates[0][2];
              if (value && value !== cell) pairs.push([cell, value]);
            }
          }
        }
        if (nonempty.length === 2) {
          const [[, a], [, b]] = nonempty;
          if (PY.len(a) <= 80 && PY.len(b) > 0) pairs.push([a, b]);
          if (PY.len(b) <= 80 && PY.len(a) > 0) pairs.push([b, a]);
        }
      }
    }
    const out = [];
    const seen = new Set();
    for (const [k, v] of pairs) {
      const key = JSON.stringify([_norm(k), strip(String(v))]);
      if (!v || seen.has(key)) continue;
      seen.add(key);
      out.push([strip(String(k)), strip(String(v))]);
    }
    return out;
  }

  function _lookup_field(topic, canonical) {
    const structured = topic._structured_fields || {};
    if (canonical in structured && strip(String(structured[canonical] ?? ""))) return strip(String(structured[canonical]));
    const aliases = _FIELD_ALIASES[canonical] || [];
    for (const [label, value] of _all_current_fields(topic)) {
      if (_contains_alias(label, aliases)) return strip(value);
    }
    return "";
  }

  function _degree_university_from_tables(topic, degree_aliases) {
    for (const matrix of Array.from(topic.data_tables || [])) {
      if (!matrix || !matrix.length) continue;
      let header_idx = null, university_col = null, degree_col = null;
      const head = matrix.slice(0, 6);
      for (let r = 0; r < head.length; r++) {
        const cells = head[r].map((c) => strip(c ? String(c) : ""));
        cells.forEach((cell, c) => {
          const n = _norm(cell);
          if (n.includes("جامعه") || n.includes("المؤسسه التعليميه") || n.includes("جهه التخرج")) university_col = c;
          if (n.includes("المؤهل") || n.includes("الدرجه") || n.includes("المرحله")) degree_col = c;
        });
        if (university_col !== null && degree_col !== null) { header_idx = r; break; }
      }
      if (header_idx !== null) {
        for (const row of matrix.slice(header_idx + 1)) {
          const cells = row.map((c) => strip(c ? String(c) : ""));
          if (degree_col >= cells.length || university_col >= cells.length) continue;
          if (degree_aliases.some((a) => _norm(cells[degree_col]).includes(_norm(a)))) {
            if (cells[university_col]) return cells[university_col];
          }
        }
      }
      for (const row of matrix) {
        const cells = row.map((c) => strip(c ? String(c) : "")).filter((c) => c);
        if (!cells.some((cell) => degree_aliases.some((a) => _norm(cell).includes(_norm(a))))) continue;
        for (const cell of cells) {
          const n = _norm(cell);
          if (["جامعه", "university", "college", "معهد"].some((w) => n.includes(w)) && !degree_aliases.some((a) => n.includes(_norm(a)))) return cell;
        }
      }
    }
    return "";
  }

  function _topic_profile(current_title, reference_title = "") {
    return _table_topic_profile(current_title, reference_title);
  }

  function _profile_facts(topic, profile) {
    if (!profile) return ["", false];
    const extracted = extract_form_fields(topic, profile);
    const structured = topic._structured_fields || {};
    if (Object.keys(structured).length) {
      for (const [k, v] of Object.entries(structured)) if (strip(String(v))) extracted.values[k] = String(v);
    }
    let excluded;
    if (profile === "conference" || profile === "excellence") excluded = new Set(["member_name", "member_rank", "member_gender"]);
    else if (profile === "appointment") excluded = new Set(["member_name", "member_rank", "member_gender"]);
    else if (profile === "promotion") excluded = new Set(["member_name", "member_rank", "member_gender", "target_rank", "current_rank_date"]);
    else excluded = new Set(["member_gender"]);
    if (profile === "conference") {
      const vals = extracted.values;
      const lines = [];
      const has_city_country = !!(strip(String(vals.conference_city ?? "")) || strip(String(vals.conference_country ?? "")));
      for (const [key, label] of extracted.display_fields) {
        if (excluded.has(key)) continue;
        if (key === "conference_place" && has_city_country) continue;
        const value = strip(String(vals[key] || ""));
        if (value) lines.push(`${label}: ${value}`);
      }
      return [lines.join("\n"), true];
    }
    if (profile === "excellence") {
      const sr = topic._structured_records;
      const records = (sr && sr.length ? sr : null) || extracted.records || [];
      const details = publication_records_to_text(records);
      if (details) return [details, true];
    }
    return [extracted.as_text(excluded), true];
  }

  function _promotion_gender_forms(current_topic) {
    const kind = _current_gender_kind(current_topic);
    if (kind === "female") {
      return { honor: "الدكتورة", fulfilled: "استيفائها", promoted: "ترقيتها", production_owner: "للدكتورة", applies: "تتقدم" };
    }
    return { honor: "الدكتور", fulfilled: "استيفائه", promoted: "ترقيته", production_owner: "للدكتور", applies: "يتقدم" };
  }

  function _structured(topic) {
    return topic._structured_fields || {};
  }
  const sval = (v) => (v ? String(v) : "");

  function _promotion_payload(current_topic, target_department = "") {
    const structured = _structured(current_topic);
    let name = strip(sval(structured.member_name) || _lookup_field(current_topic, "member_name"));
    let current_rank = strip(sval(structured.member_rank) || _lookup_field(current_topic, "member_rank"));
    let target_rank = strip(sval(structured.target_rank) || _lookup_field(current_topic, "target_rank"));
    let rank_date = strip(sval(structured.current_rank_date) || _lookup_field(current_topic, "current_rank_date"));
    const forms = _promotion_gender_forms(current_topic);
    if (!name) name = "ــــــــــــ";
    if (!current_rank) current_rank = "ــــــــــــ";
    if (!target_rank) {
      const m = re.search("(?:إلى|الى)\\s+رتبة\\s+([^،,.\\n]+)", current_topic.title || "");
      target_rank = m ? strip(m.group(1)) : "ــــــــــــ";
    }
    if (!rank_date) rank_date = "ــــــــــــ";
    const rationale =
      `استعرض المجلس الطلب المقدم من ${forms.honor}/ ${name} ` +
      `للترقية من رتبة ${current_rank} إلى رتبة ${target_rank}، حيث تم التحقق من ` +
      `${forms.fulfilled} للمدة النظامية المطلوبة للترقية، إذ تمت ${forms.promoted} ` +
      `إلى رتبة ${current_rank} بتاريخ ${rank_date}.\n\n` +
      `كما استعرض المجلس الإنتاج العلمي ${forms.production_owner}، وتم التأكد من ` +
      `${forms.fulfilled} الحد الأدنى من الوحدات البحثية المطلوبة للترقية، وذلك وفقًا ` +
      `لضوابط المجلس العلمي، كما هو موضح في الجدول أدناه، مع الإشارة إلى أن هذه هي ` +
      `المرة الأولى التي ${forms.applies} فيها بطلب الترقية إلى رتبة ${target_rank}.`;
    const records = current_topic._structured_records || [];
    const titles = [];
    const seen = new Set();
    for (const rec of records) {
      const value = strip(sval((rec || {}).research_title));
      if (value && !seen.has(_norm(value))) { seen.add(_norm(value)); titles.push(value); }
    }
    const table = [["عنوان العمل (بلغة النشر)"]].concat(titles.map((t) => [t]));
    return [rationale, titles.length ? [table] : []];
  }

  function _promotion_title(current_topic) {
    const structured = _structured(current_topic);
    const name = strip(sval(structured.member_name) || _lookup_field(current_topic, "member_name")) || "ــــــــــــ";
    const current_rank = strip(sval(structured.member_rank) || _lookup_field(current_topic, "member_rank")) || "ــــــــــــ";
    let target_rank = strip(sval(structured.target_rank) || _lookup_field(current_topic, "target_rank"));
    if (!target_rank) {
      const m = re.search("(?:إلى|الى)\\s+رتبة\\s+([^،,.\\n]+)", current_topic.title || "");
      target_rank = m ? strip(m.group(1)) : "ــــــــــــ";
    }
    const honor = _promotion_gender_forms(current_topic).honor;
    return `دراسة طلب ترقية ${honor}/ ${name} من رتبة ${current_rank} إلى رتبة ${target_rank}.`;
  }

  function _reference_field_names(reference_text) {
    const labels = _parse_fields(reference_text).map(([k]) => k);
    const lines = PY.splitlines(reference_text || "").map((x) => strip(x, " \t•·-–—"));
    for (const line of lines) {
      if ((line.endsWith(":") || line.endsWith("：")) && PY.len(line) <= 90) labels.push(rstrip(line, ":： "));
    }
    const out = [];
    for (const x of labels) {
      if (x && !out.map(_norm).includes(_norm(x))) out.push(x);
    }
    return out;
  }

  function _is_promotion_topic(current_title, reference_title = "") {
    return _norm(`${current_title} ${reference_title}`).includes("ترقي");
  }

  function _drop_member_name_field_lines(text) {
    const lines = PY.splitlines(text || "");
    const kept = [];
    const aliases = _FIELD_ALIASES.member_name || [];
    let skip_next_value = false;
    for (const raw of lines) {
      const line = strip(raw);
      if (skip_next_value) { skip_next_value = false; continue; }
      const m = re.match("^([^:：]{1,80})[:：]\\s*(.*)$", line);
      if (m && _contains_alias(m.group(1), aliases)) continue;
      if (line.includes("|")) {
        const first = strip(PY.split(line, "|", 1)[0]);
        if (first && _contains_alias(first, aliases)) continue;
      }
      if (line && _contains_alias(rstrip(line, ":： "), aliases) && PY.len(line) <= 80) {
        skip_next_value = true;
        continue;
      }
      kept.push(raw);
    }
    return strip(kept.join("\n"));
  }

  function _generic_reference_filtered_facts(topic, reference_rationale) {
    const wanted = _reference_field_names(reference_rationale);
    if (!wanted.length) return _current_facts_text(topic);
    const selected = [];
    for (const [label, value] of _all_current_fields(topic)) {
      if (wanted.some((w) => new SequenceMatcher(null, _norm(label), _norm(w)).ratio() >= 0.72 || _contains_alias(label, [w]))) {
        selected.push([label, value]);
      }
    }
    if (!selected.length) return _current_facts_text(topic);
    return selected.map(([k, v]) => `${k}: ${v}`).join("\n");
  }


  // ---------------------------------------------------------------- اسم مقدم الطلب في كل النصوص (تعديل 11/2026)
  // الاسم بعد «اللقب/» ينتهي عند الفاصلة أو الرتبة أو كلمات مثل بقسم/بصرف/لحضور، حتى لو لم توجد فاصلة.
  const _SLOT_HON = "((?:ال|لل)(?:أستاذة\\s+الدكتورة|أستاذ\\s+الدكتور|دكتورة|دكتور|محاضرة|محاضر|أستاذة|أستاذ|معيدة|معيد)|د\\.)";
  // يحافظ على «لل» إذا كانت في النص الأصلي (للمحاضرة/ ...)
  const _keep_prefix = (orig, nw) => (orig && orig.startsWith("لل") && nw && nw.startsWith("ال") ? "ل" + nw.slice(1) : nw);
  const _NAME_STOP = new Set(["استاذ", "استاذه", "محاضر", "محاضره", "معيد", "معيده", "بقسم", "في", "قسم", "بكليه", "كليه",
    "بصرف", "صرف", "لحضور", "حضور", "علي", "عن", "من", "الي", "الى", "للعام", "والذي", "والتي", "التي", "الذي", "لصرف",
    "للنشر", "بدل", "مكافاه", "لبحثه", "لبحثها", "عضو", "عضوه", "المحاضر", "المحاضره", "الدكتور", "الدكتوره", "و"]);
  function _slot_names(text) {
    const out = [];
    const rx = new RegExp(_SLOT_HON + "\\s*/\\s*([^\\n/،,.:؛()]+)", "gu");
    for (const m of String(text || "").matchAll(rx)) {
      const words = m[2].trim().split(/\s+/);
      const name = [];
      for (const w of words) {
        if (_NAME_STOP.has(_norm(w)) || name.length >= 5) break;
        name.push(w);
      }
      if (name.length >= 2) out.push({ honor: m[1], name: name.join(" "), index: m.index, length: m[0].length - m[2].length + name.join(" ").length + (m[2].length - m[2].trimStart().length) });
    }
    return out;
  }
  function _replace_person_slots(text, old_names, honor, name) {
    if (!text || !name) return text;
    const cur = _norm(name);
    const olds = old_names.map(_norm).filter((n) => n && n !== cur);
    if (!olds.length) return text;
    let out = "", last = 0;
    for (const slot of _slot_names(text)) {
      const n = _norm(slot.name);
      if (n === cur || !olds.some((o) => n === o || n.startsWith(o) || o.startsWith(n))) continue;
      out += text.slice(last, slot.index) + `${_keep_prefix(slot.honor, honor || slot.honor)}/ ${name}`;
      last = slot.index + slot.length;
    }
    return out + text.slice(last);
  }

  function _build_title_dep(title, reference, target_department) {
    const ref_dep = strip(reference.council_name || "");
    if (!ref_dep || _norm(ref_dep) === _norm(target_department)) return title;
    return title.split(`قسم ${ref_dep}`).join(`قسم ${target_department}`).split(ref_dep).join(target_department);
  }

  function build_department_from_reference(current_topic, reference, score = null, target_department = "") {
    const ref_title = reference.title ?? "";
    const ref_rationale = reference.rationale ?? "";
    const profile = _topic_profile(current_topic.title ?? "", ref_title);
    let [current_facts, suppress_raw_tables] = _profile_facts(current_topic, profile);
    if (!current_facts && !profile) current_facts = _generic_reference_filtered_facts(current_topic, ref_rationale);
    if (_is_promotion_topic(current_topic.title ?? "", ref_title)) current_facts = _drop_member_name_field_lines(current_facts);

    let title = _build_title_from_reference(reference, current_topic, target_department);
    if (profile === "promotion") title = _promotion_title(current_topic);
    if (!title) title = strip(current_topic.title || "");

    let intro = _reference_intro(ref_rationale);
    if (intro) {
      intro = _safe_template_text(intro, current_topic, ref_title, target_department);
      const [, cur_name] = _current_applicant(current_topic, target_department);
      if (cur_name && !intro.includes(cur_name) && title.includes(cur_name)) intro = _opening_style(ref_rationale, title);
    } else intro = _opening_style(ref_rationale, title);

    if (profile === "conference") {
      const current_blob = _norm(_current_facts_text(current_topic));
      for (const phrase of ["بنظام التعاقد على الايراد البديل", "بنظام التعاقد على الإيراد البديل"]) {
        if (!current_blob.includes(_norm(phrase))) intro = re.sub("\\s*" + re.escape(phrase) + "\\s*", " ", intro, 0, re.I);
      }
      intro = strip(re.sub("\\s+", " ", intro).split(" ،").join("،"));
    }

    let promotion_tables = null;
    let rationale;
    if (profile === "promotion") [rationale, promotion_tables] = _promotion_payload(current_topic, target_department);
    else if (current_facts) rationale = strip(intro + "\n" + current_facts);
    else if (profile) rationale = intro || _opening_style(ref_rationale, title);
    else rationale = _safe_template_text(ref_rationale, current_topic, ref_title, target_department);

    let decision = _safe_template_text(reference.decision ?? "", current_topic, ref_title, target_department);
    let document_ref = reference.document_ref || current_topic.document_ref || "";
    let attachments = current_topic.attachments || reference.attachments || "";
    let action_required = reference.action_required || current_topic.action_required || "";

    if (strip(current_topic.decision ?? "")) decision = strip(current_topic.decision);
    if (strip(current_topic.document_ref ?? "")) document_ref = strip(current_topic.document_ref);
    if (strip(current_topic.action_required ?? "")) action_required = strip(current_topic.action_required);

    // أي اسم قديم بقي في العنوان أو الحيثيات أو التوصية يُستبدل باسم مقدم الطلب الحالي
    {
      const old_names = _slot_names(`${ref_title}\n${ref_rationale}\n${reference.decision ?? ""}`).map((x) => x.name);
      const [cur_honor, cur_name] = _current_applicant(current_topic, target_department);
      if (profile !== "promotion" && old_names.length && cur_name && !re.search("[ـ_]{3,}", cur_name)) {
        const honor = (o) => cur_honor || _gender_correct_honorific(o, current_topic);
        const fix = (t) => _apply_current_gender_grammar(_replace_person_slots(t, old_names, "", cur_name).replace(
          new RegExp(_SLOT_HON + "\\s*/\\s*" + cur_name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gu"),
          (m, h) => `${_keep_prefix(h, honor(h.startsWith("لل") ? "ا" + h.slice(1) : h))}/ ${cur_name}`), current_topic);
        if (profile !== "promotion") {
          // العنوان من العنوان المرجعي كاملًا إذا قُصّ عند استخراج الاسم
          title = fix(title);
          // إذا قُصّ العنوان عند استخراج الاسم (العنوان الحالي بداية العنوان المرجعي فقط) نكمله من العنوان المرجعي
          let alt = strip(fix(ref_title));
          if (target_department) alt = _build_title_dep(alt, reference, target_department);
          const nt = _norm(strip(title, " .،")), na = _norm(alt);
          if (alt && alt.includes(cur_name) && (!title.includes(cur_name) || (na.startsWith(nt) && na.length > nt.length + 3))) title = alt;
        }
        rationale = fix(rationale);
        if (!strip(current_topic.decision ?? "")) decision = fix(decision);
      }
    }

    const ref_department = strip(reference.council_name || "");
    if (target_department && ref_department && normalize_ar(ref_department) !== normalize_ar(target_department)) {
      const pairs = [[`قسم ${ref_department}`, `قسم ${target_department}`], [ref_department, target_department]];
      let vals = [title, rationale, decision, document_ref, attachments, action_required];
      for (const [old, nw] of pairs) {
        if (old && nw) vals = vals.map((v) => (typeof v === "string" ? v.split(old).join(nw) : v));
      }
      [title, rationale, decision, document_ref, attachments, action_required] = vals;
    }

    return {
      title,
      rationale,
      decision,
      document_ref,
      attachments,
      action_required,
      _data_tables: promotion_tables !== null ? promotion_tables : (suppress_raw_tables ? [] : Array.from(current_topic.data_tables || [])),
      _source_profile: profile || "reference-fields",
      _precedent_source: reference.source_file ?? "",
      _precedent_score: score,
      _reference_title: reference.title ?? "",
      _reference_session: reference.session_number ?? "",
      _reference_department: reference.council_name ?? "",
      _generation_method: "موضوع مرجعي من مجلس القسم + بيانات المصدر الحالي",
    };
  }

  return {
    _parse_fields, _field_map, _replace_literal, _strip_name_prefix, _rank_honorific, _current_gender_kind,
    _gender_correct_honorific, _apply_current_gender_grammar, _current_applicant, reference_title_template,
    _build_title_from_reference, _safe_template_text, _reference_intro, _opening_style, _FIELD_ALIASES,
    _contains_alias, _all_current_fields, _lookup_field, _degree_university_from_tables, _profile_facts,
    _promotion_payload, _promotion_title, _reference_field_names, _drop_member_name_field_lines,
    _generic_reference_filtered_facts, build_department_from_reference,
  };
})();
