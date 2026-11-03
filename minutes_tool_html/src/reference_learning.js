/* التعلم المحلي من اختيارات الموضوع المرجعي اليدوية — منقول من core/reference_learning.py.
 * يُحفظ في متصفح المستخدم بدل مجلد المستخدم (~/.college_minutes_tool).
 */
"use strict";

const Learning = (() => {
  const { strip, SequenceMatcher } = PY;
  const { normalize_ar } = Similarity;

  const KEYS = {
    college: "college_minutes_tool:reference_learning",
    department: "college_minutes_tool:department_reference_learning",
  };
  const memory = new Map();

  function load_learning(kind = "college") {
    const key = KEYS[kind] || kind;
    try {
      const raw = window.localStorage.getItem(key);
      if (raw) {
        const data = JSON.parse(raw);
        if (Array.isArray(data)) return data.filter((x) => x && typeof x === "object" && !Array.isArray(x));
      }
    } catch (e) {
      // التخزين غير متاح (وضع خاص أو حظر): نستخدم الذاكرة المؤقتة فقط.
    }
    return (memory.get(key) || []).slice();
  }

  function save_learning(records, kind = "college") {
    const key = KEYS[kind] || kind;
    memory.set(key, records.slice());
    try {
      window.localStorage.setItem(key, JSON.stringify(records));
    } catch (e) {
      // يبقى في الذاكرة لهذه الجلسة.
    }
  }

  function _tokens(text) {
    return new Set(PY.split(normalize_ar(text)).filter((t) => PY.len(t) >= 3));
  }

  function title_similarity(a, b) {
    const na = normalize_ar(a), nb = normalize_ar(b);
    if (!na || !nb) return 0.0;
    if (na === nb) return 1.0;
    const ta = _tokens(na), tb = _tokens(nb);
    const seq = new SequenceMatcher(null, na, nb).ratio();
    let jacc = 0.0, containment = 0.0;
    if (ta.size && tb.size) {
      let inter = 0;
      for (const t of ta) if (tb.has(t)) inter++;
      const union = new Set([...ta, ...tb]).size;
      jacc = union ? inter / union : 0.0;
      containment = inter / Math.min(ta.size, tb.size);
    }
    let score = 0.50 * seq + 0.30 * jacc + 0.20 * containment;
    if (nb.includes(na) || na.includes(nb)) score = Math.max(score, 0.82);
    return Math.min(1.0, score);
  }

  function remember_reference_choice(source_title, source_rationale, reference, kind = "college") {
    source_title = strip(source_title || "");
    if (!source_title || !reference) return;
    const source_key = normalize_ar(source_title);
    const records = load_learning(kind);
    const record = {
      source_title,
      source_title_norm: source_key,
      source_rationale_hint: normalize_ar(source_rationale || "").slice(0, 500),
      reference_source_file: reference.source_file ?? "",
      reference_title: reference.title ?? "",
      reference_session: reference.session_number ?? "",
      updated_at: new Date().toISOString(),
    };
    const out = records.filter((r) => r.source_title_norm !== source_key);
    out.push(record);
    save_learning(out.slice(-500), kind);
  }

  function _resolve_reference(record, archive_topics) {
    const source_file = record.reference_source_file ?? "";
    const title = record.reference_title ?? "";
    for (const p of archive_topics) {
      if ((p.source_file ?? "") === source_file && (p.title ?? "") === title) return p;
    }
    const nt = normalize_ar(title);
    const matches = archive_topics.filter((p) => normalize_ar(p.title ?? "") === nt);
    return matches.length ? matches[0] : null;
  }

  function find_learned_reference(source_title, source_rationale, archive_topics, min_similarity = 0.74, kind = "college") {
    if (!archive_topics || !archive_topics.length) return null;
    const records = load_learning(kind);
    if (!records.length) return null;
    let best = null;
    let best_score = 0.0;
    const current_norm = normalize_ar(source_title);
    for (const record of records) {
      const learned_title = record.source_title || record.source_title_norm || "";
      let score = title_similarity(source_title, learned_title);
      if (current_norm && current_norm === (record.source_title_norm ?? "")) score = 1.0;
      if (score > best_score) {
        const ref = _resolve_reference(record, archive_topics);
        if (ref !== null) {
          best = [ref, score, record];
          best_score = score;
        }
      }
    }
    if (best && best_score >= min_similarity) return best;
    return null;
  }

  function learning_count(kind = "college") {
    return load_learning(kind).length;
  }

  function exportAll() {
    return { reference_learning: load_learning("college"), department_reference_learning: load_learning("department") };
  }

  // يقبل ملف النسخة الاحتياطية من هذه الأداة أو ملفات JSON الخاصة بالنسخة الأصلية.
  function importData(data, kindHint = "college") {
    let n = 0;
    const merge = (kind, list) => {
      if (!Array.isArray(list)) return;
      const cur = load_learning(kind);
      const byKey = new Map(cur.map((r) => [r.source_title_norm, r]));
      for (const r of list) {
        if (!r || typeof r !== "object" || !r.source_title_norm) continue;
        byKey.delete(r.source_title_norm);
        byKey.set(r.source_title_norm, r);
        n++;
      }
      save_learning(Array.from(byKey.values()).slice(-500), kind);
    };
    if (Array.isArray(data)) merge(kindHint, data);
    else if (data && typeof data === "object") {
      merge("college", data.reference_learning);
      merge("department", data.department_reference_learning);
    }
    return n;
  }

  function move_item(items, index, delta) {
    if (!items.length) return -1;
    if (!(index >= 0 && index < items.length)) return index;
    const target = index + delta;
    if (target < 0 || target >= items.length) return index;
    const [item] = items.splice(index, 1);
    items.splice(target, 0, item);
    return target;
  }

  return {
    load_learning, save_learning, title_similarity, remember_reference_choice, find_learned_reference,
    learning_count, exportAll, importData, move_item,
  };
})();
