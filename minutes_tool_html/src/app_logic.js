/* منطق شاشتي مجلس الكلية ومجلس القسم دون الواجهة — منقول من app.py و department_panel.py. */
"use strict";

const AppLogic = (() => {
  const { re, strip } = PY;
  const { normalize_ar, TopicMatcher } = Similarity;
  const P = Precedent;

  let uidCounter = 0;
  function uid() {
    uidCounter++;
    return Date.now().toString(36) + "-" + uidCounter.toString(36) + "-" + Math.random().toString(36).slice(2, 8);
  }
  function cloneTopic(t) {
    return PY.clone(t);
  }
  function pct(score) {
    return PY.fmt0(score * 100);
  }
  function shortTitle(text, n = 72) {
    const t = PY.split(text || "").join(" ");
    return PY.len(t) <= n ? t : Array.from(t).slice(0, n - 1).join("") + "…";
  }

  // ================================================================= shared helpers (تعديلات 11/2026)
  const _DIGITS = { "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4", "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
    "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4", "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9" };
  const _ascii_digits = (s) => String(s || "").replace(/[٠-٩۰-۹]/g, (d) => _DIGITS[d]);

  // مفتاح ترتيب زمني تقريبي للمحضر: التاريخ (هجري أو ميلادي) ثم رقم الجلسة.
  function topic_time_key(p) {
    const text = _ascii_digits(p.session_date || "");
    let y = 0, m = 0, d = 0;
    const nums = (text.match(/\d+/g) || []).map(Number);
    const yi = nums.findIndex((n) => n >= 1000);
    if (yi >= 0) {
      y = nums[yi];
      const rest = nums.filter((_, i) => i !== yi);
      if (yi === 0) { m = rest[0] || 0; d = rest[1] || 0; } else { d = rest[0] || 0; m = rest[1] || 0; }
      if (y < 1700) y = y * 0.970224 + 621.5774; // هجري → ميلادي تقريبًا
    }
    const sess = Number((_ascii_digits(p.session_number || "").match(/\d+/) || [0])[0]);
    return y * 10000 + m * 100 + d + sess / 1000;
  }

  // من المرشحين [[topic, score], ...] من نفس النوع: يقدّم الأحدث تاريخًا (لاتباع صيغة آخر المحاضر).
  function prefer_newest(matches, same_kind, min_score = 0.30) {
    if (!matches.length) return matches;
    const pool = matches.filter(([p, s]) => s >= min_score && same_kind(p));
    if (pool.length < 2) return matches;
    let best = pool[0];
    for (const cand of pool) if (topic_time_key(cand[0]) > topic_time_key(best[0])) best = cand;
    if (best === matches[0]) return matches;
    return [[best[0], Math.max(best[1], matches[0][1])]].concat(matches.filter((x) => x !== best));
  }

  // بحث حر في الأرشيف كله: تطابق نصي في العنوان ثم في النص، ثم الأقرب تشابهًا. بلا بحث: الأحدث أولًا.
  function archive_search(pool, query, limit = 150) {
    const q = normalize_ar(query || "");
    const key = (p) => JSON.stringify([p.source_file, p.title]);
    if (!q) return pool.slice().sort((a, b) => topic_time_key(b) - topic_time_key(a)).slice(0, limit);
    const inTitle = [], inBody = [];
    for (const p of pool) {
      if (normalize_ar(p.title ?? "").includes(q)) inTitle.push(p);
      else if (normalize_ar(`${p.rationale ?? ""} ${p.decision ?? ""} ${p.attachments ?? ""}`).includes(q)) inBody.push(p);
    }
    const byDate = (a, b) => topic_time_key(b) - topic_time_key(a);
    inTitle.sort(byDate); inBody.sort(byDate);
    const similar = pool.length ? new TopicMatcher(pool).find_similar(query, "", Math.min(limit, pool.length), 0.25).map(([p]) => p) : [];
    const seen = new Set();
    const out = [];
    for (const p of inTitle.concat(inBody, similar)) {
      const k = key(p);
      if (!seen.has(k)) { seen.add(k); out.push(p); }
    }
    return out.slice(0, limit);
  }

  // ================================================================= college council
  class College {
    constructor() {
      this.archive_topics = [];
      this.items = [];
      this.current_index = null;
    }

    new_item(topic, session, source_kind, source_label, source_path = "", included = false, family_override = "") {
      return {
        uid: uid(), topic, session, source_kind, source_label, source_path, included, family_override,
        extra_details: "", precedent_override: null, new_topic_mode: false, generated: null,
        _learned_reference_used: false,
      };
    }

    static is_previous_minutes_note(topic) {
      const t = normalize_ar(topic.title || "").split(" ").join("");
      return t.includes(normalize_ar("ملاحظات على المحضر السابق").split(" ").join(""));
    }

    index_for_uid(id) {
      const i = this.items.findIndex((x) => x.uid === id);
      return i < 0 ? null : i;
    }

    new_topic_from_details(topic) {
      const raw = strip(topic.rationale || "");
      const labels = {
        "الحيثيات": "rationale", "حيثيات الموضوع": "rationale",
        "التوصية": "decision", "القرار": "decision", "التوصية / القرار": "decision",
        "المستند": "document_ref", "المستندات": "document_ref",
        "المرفقات": "attachments", "المرفق": "attachments",
        "الإجراء المطلوب": "action_required", "الاجراء المطلوب": "action_required",
      };
      const out = {
        title: strip(topic.title || ""), rationale: "", decision: "", document_ref: "",
        attachments: strip(topic.attachments || ""), action_required: "",
      };
      let current_key = "rationale";
      const buffers = { rationale: [], decision: [], document_ref: [], attachments: [], action_required: [] };
      let found = false;
      for (const line of PY.splitlines(raw)) {
        const stripped = strip(line);
        const m = re.match("^([^:：]{2,30})[:：]\\s*(.*)$", stripped);
        if (m) {
          const lab = strip(m.group(1));
          const key = Object.prototype.hasOwnProperty.call(labels, lab) ? labels[lab] : null;
          if (key) {
            found = true;
            current_key = key;
            if (strip(m.group(2))) buffers[key].push(strip(m.group(2)));
            continue;
          }
        }
        buffers[current_key].push(line);
      }
      if (found) {
        for (const [key, lines] of Object.entries(buffers)) {
          const value = strip(lines.filter((x) => strip(x)).join("\n"));
          if (value) {
            if (key === "attachments" && out.attachments) out.attachments += "\n" + value;
            else out[key] = value;
          }
        }
      } else out.rationale = raw;
      Object.assign(out, {
        _generation_method: "موضوع جديد من التفاصيل المدخلة — يحتاج مراجعة",
        _precedent_source: "", _reference_title: "", _reference_session: "",
      });
      return out;
    }

    static merge_extra_value(existing, addition) {
      existing = strip(existing || "");
      addition = strip(addition || "");
      if (!addition) return existing;
      if (!existing) return addition;
      if (existing.includes(addition)) return existing;
      return PY.rstrip(existing) + "\n" + addition;
    }

    apply_extra_details(data, extra) {
      extra = strip(extra || "");
      if (!extra) return data;
      const out = Object.assign({}, data || {});
      const aliases = {
        "عنوان الموضوع": "title", "العنوان": "title",
        "الحيثيات": "rationale", "حيثيات الموضوع": "rationale",
        "التوصية": "decision", "القرار": "decision", "التوصية / القرار": "decision",
        "المستند": "document_ref", "المستندات": "document_ref",
        "المرفق": "attachments", "المرفقات": "attachments",
        "الإجراء": "action_required", "الاجراء": "action_required",
        "الإجراء المطلوب": "action_required", "الاجراء المطلوب": "action_required",
      };
      const normalise = (label) => strip(re.sub("^(?:أضف|اضف|إضافة|اضافة)\\s+(?:إلى|الى)\\s+", "", strip(label)));
      const chunks = [];
      let current_key = null, current_lines = [];
      const unlabelled = [];
      const flush = () => {
        if (current_key !== null) {
          const value = strip(current_lines.join("\n"));
          if (value) chunks.push([current_key, value]);
        }
        current_key = null;
        current_lines = [];
      };
      for (const raw_line of PY.splitlines(extra)) {
        const line = PY.rstrip(raw_line);
        const m = re.match("^([^:：]{2,40})[:：]\\s*(.*)$", strip(line));
        if (m) {
          const label = normalise(m.group(1));
          const key = Object.prototype.hasOwnProperty.call(aliases, label) ? aliases[label] : null;
          if (key) {
            flush();
            current_key = key;
            if (strip(m.group(2))) current_lines.push(strip(m.group(2)));
            continue;
          }
        }
        if (current_key !== null) current_lines.push(line);
        else unlabelled.push(line);
      }
      flush();
      const plain = strip(unlabelled.join("\n"));
      if (plain) out.rationale = College.merge_extra_value(out.rationale ?? "", plain);
      for (const [key, value] of chunks) {
        if (key === "title") out[key] = strip(value);
        else out[key] = College.merge_extra_value(out[key] ?? "", value);
      }
      out._extra_details_applied = extra;
      return out;
    }

    find_precedents(item, topic) {
      if (!this.archive_topics.length) return [];
      item._learned_reference_used = false;
      const [current_family, reference_pool] = P.reference_topics_for_current(this.archive_topics, topic.title, topic.rationale);
      const override = item.precedent_override;
      if (P.STRICT_REFERENCE_FAMILIES.has(current_family) && !reference_pool.length && !override) return [];
      if (override) {
        const [source_file, title] = override;
        for (const p of this.archive_topics) if (p.source_file === source_file && p.title === title) return [[p, 1.0]];
        if (P.STRICT_REFERENCE_FAMILIES.has(current_family)) return [];
      }
      const learned = Learning.find_learned_reference(topic.title, topic.rationale, reference_pool, 0.74, "college");
      if (learned) {
        const [learned_ref, learned_score] = learned;
        item._learned_reference_used = true;
        const single_family = P.SINGLE_REFERENCE_FAMILIES.has(current_family);
        const normal = new TopicMatcher(reference_pool).find_similar(topic.title, topic.rationale, single_family ? Math.max(8, reference_pool.length) : 8, 0.0);
        const out = [[learned_ref, Math.max(0.95, learned_score)]];
        const seen = new Set([JSON.stringify([learned_ref.source_file, learned_ref.title])]);
        for (const [p, score] of normal) {
          const key = JSON.stringify([p.source_file, p.title]);
          if (!seen.has(key)) { out.push([p, score]); seen.add(key); }
        }
        if (P.SINGLE_REFERENCE_FAMILIES.has(current_family)) return this._newest_of_family(out, current_family).slice(0, 1);
        return out.slice(0, 8);
      }
      const single = P.SINGLE_REFERENCE_FAMILIES.has(current_family);
      const matches = new TopicMatcher(reference_pool).find_similar(topic.title, topic.rationale, single ? Math.max(8, reference_pool.length) : 8, 0.0);
      return single ? this._newest_of_family(matches, current_family).slice(0, 1) : matches;
    }

    // بدل التميز والتعيين والترقية: صيغة آخر محضر من نفس النوع (مثل عدد المستندات والمرفقات).
    _newest_of_family(matches, family) {
      return prefer_newest(matches, (p) => P.topic_family(p.title ?? "", p.rationale ?? "") === family, 0.0);
    }

    generate_item(idx) {
      const item = this.items[idx];
      const topic = cloneTopic(item.topic);
      const extra = strip(item.extra_details || "");
      const search_topic = cloneTopic(topic);
      if (extra) search_topic.rationale = strip(PY.rstrip(search_topic.rationale) + "\n" + extra);
      if (item.new_topic_mode) return this.apply_extra_details(this.new_topic_from_details(topic), extra);

      const reference_topics = this.find_precedents(item, search_topic);
      if (!reference_topics.length) {
        throw new Error("لم أجد موضوعًا مرجعيًا في محاضر مجلس الكلية. تأكدي من مجلد المحاضر المرجعية في الإعدادات.");
      }
      const [top_reference, top_score] = reference_topics[0];
      if (!item.precedent_override && top_score < 0.30) {
        const candidates = reference_topics.slice(0, 3).map(([p, s]) => `• ${Array.from(p.title ?? "").slice(0, 95).join("")} (${pct(s)}%)`).join("\n");
        throw new Error(
          "لم أجد موضوعًا مرجعيًا بدرجة تشابه كافية. اختاري «تغيير الموضوع المرجعي» لتحديد الأقرب، " +
          "أو اختاري «موضوع جديد — استخدم التفاصيل المدخلة».\n\nأقرب الموضوعات:\n" + candidates,
        );
      }
      const session = item.session;
      const department_name = item.source_kind === "department" ? session.council_name : "";
      P.set_title_corpus(this.archive_topics);
      let data;
      if (item.precedent_override) {
        data = P.build_from_selected_reference(topic, department_name, session.session_number, session.date, top_reference);
      } else {
        let internal_family = P.topic_family(top_reference.title ?? "", top_reference.rationale ?? "");
        if (item.source_kind === "committee") internal_family = "scholarship_notice";
        data = P.build_from_precedent(topic, department_name, session.session_number, session.date, reference_topics, internal_family);
      }
      if (data === null || data === undefined) {
        const suggestion = reference_topics.slice(0, 3).map(([p, s]) => `• ${Array.from(p.title ?? "").slice(0, 95).join("")} (${pct(s)}%)`).join("\n");
        throw new Error(
          "وجدت موضوعات قريبة في مجلس الكلية، لكن التطابق غير كافٍ لتطبيق أحدها تلقائيًا. " +
          "استخدمي «تغيير الموضوع المرجعي» لاختيار الأنسب يدويًا.\n\nأقرب الموضوعات:\n" + suggestion,
        );
      }
      if (P.topic_family(topic.title ?? "", topic.rationale ?? "") !== "promotion" && !/ترقي/.test(data.title || "")) {
        data.decision = P.sync_rank_with_title(data.title, data.decision);
      }
      data._reference_title = top_reference.title ?? "";
      data._reference_session = top_reference.session_number ?? "";
      data._learned_reference_used = !!item._learned_reference_used;
      return this.apply_extra_details(data, extra);
    }

    // Returns [reference, score, mode]
    resolve_reference(idx) {
      if (idx === null || idx === undefined || !(idx >= 0 && idx < this.items.length)) return [null, null, ""];
      const item = this.items[idx];
      const override = item.precedent_override;
      if (override) {
        const [source_file, title] = override;
        for (const p of this.archive_topics) if (p.source_file === source_file && p.title === title) return [p, 1.0, "مختار يدويًا"];
      }
      const data = item.generated || {};
      const source_file = data._precedent_source || "";
      const title = data._reference_title || "";
      if (source_file || title) {
        for (const p of this.archive_topics) {
          if ((!source_file || p.source_file === source_file) && (!title || p.title === title)) {
            const score = data._precedent_score;
            return [p, typeof score === "number" ? score : null, "المستخدم في التوليد"];
          }
        }
      }
      const refs = this.find_precedents(item, cloneTopic(item.topic));
      if (refs.length) return [refs[0][0], refs[0][1], "مقترح تلقائيًا"];
      return [null, null, ""];
    }

    archive_search(query) {
      return archive_search(this.archive_topics, query);
    }

    chooser_pool(idx) {
      const item = this.items[idx];
      return P.reference_topics_for_current(this.archive_topics, item.topic.title, item.topic.rationale);
    }

    chooser_search(pool, query) {
      const q = normalize_ar(query);
      let data;
      if (q) {
        const scored = new TopicMatcher(pool).find_similar(query, "", Math.min(80, this.archive_topics.length), 0.0);
        const ordered = scored.map(([p]) => p);
        const contains = pool.filter((p) => normalize_ar(p.title ?? "").includes(q));
        const seen = new Set();
        data = [];
        for (const p of contains.concat(ordered)) {
          const key = JSON.stringify([p.source_file, p.title]);
          if (!seen.has(key)) { seen.add(key); data.push(p); }
        }
      } else data = pool;
      return data.slice(0, 100);
    }
  }

  // ================================================================= department council
  const DEPARTMENTS = ["علوم الحاسب", "تقنية المعلومات"];
  const SCOPE_LABELS = ["نفس القسم فقط", "قسم علوم الحاسب فقط", "قسم تقنية المعلومات فقط", "جميع الأقسام"];

  function dept_key(name) {
    const n = normalize_ar(name || "");
    if (n.includes(normalize_ar("علوم الحاسب"))) return "cs";
    if (n.includes(normalize_ar("تقنية المعلومات"))) return "it";
    return "";
  }

  class Department {
    constructor() {
      this.archive_topics = [];
      this.items = [];
      this.current_index = null;
      this.target_department = DEPARTMENTS[0];
      this.scope = SCOPE_LABELS[0];
    }

    new_item(topic, source_path, source_label, included = false) {
      return {
        uid: uid(), topic, source_path, source_label, included, reference_override: null, generated: null,
        new_topic_mode: false, _learned_reference_used: false, raw_source_topic: null,
      };
    }

    scope_topics() {
      const target = strip(this.target_department);
      const scope = strip(this.scope);
      if (scope === "جميع الأقسام") return Array.from(this.archive_topics);
      let allowed;
      if (scope === "قسم علوم الحاسب فقط") allowed = "cs";
      else if (scope === "قسم تقنية المعلومات فقط") allowed = "it";
      else allowed = dept_key(target);
      return this.archive_topics.filter((p) => dept_key(p.council_name ?? "") === allowed);
    }

    learning_source_title(topic) {
      return `${strip(this.target_department)} | ${topic.title || ""}`;
    }

    static append_unique(base, extra) {
      base = strip(base || "");
      extra = strip(extra || "");
      if (!extra) return base;
      if (!base) return extra;
      if (normalize_ar(base).includes(normalize_ar(extra))) return base;
      return base + "\n\n" + extra;
    }

    static merge_topic_source(current, incoming) {
      const merged = cloneTopic(current);
      merged.rationale = Department.append_unique(merged.rationale, incoming.rationale);
      merged.decision = Department.append_unique(merged.decision, incoming.decision);
      merged.document_ref = Department.append_unique(merged.document_ref, incoming.document_ref);
      merged.attachments = Department.append_unique(merged.attachments, incoming.attachments);
      merged.action_required = Department.append_unique(merged.action_required, incoming.action_required);
      const existing = Array.from(merged.data_tables || []);
      for (const table of Array.from(incoming.data_tables || [])) {
        if (!existing.some((t) => PY.deepEqual(t, table))) existing.push(PY.clone(table));
      }
      merged.data_tables = existing;
      return merged;
    }

    reference_context_changed() {
      for (const item of this.items) if (!item.reference_override) item.generated = null;
    }

    find_references(item) {
      const pool = this.scope_topics();
      if (!pool.length) return [];
      const override = item.reference_override;
      if (override) {
        for (const p of this.archive_topics) if (p.source_file === override[0] && p.title === override[1]) return [[p, 1.0]];
      }
      const topic = item.topic;
      const learned = Learning.find_learned_reference(this.learning_source_title(topic), topic.rationale, pool, 0.74, "department");
      item._learned_reference_used = false;
      if (learned) {
        const [p, score] = learned;
        item._learned_reference_used = true;
        const normal = new TopicMatcher(pool).find_similar(topic.title, topic.rationale, 8, 0.0);
        const out = [[p, Math.max(0.95, score)]];
        const seen = new Set([JSON.stringify([p.source_file, p.title])]);
        for (const [x, s] of normal) {
          const k = JSON.stringify([x.source_file, x.title]);
          if (!seen.has(k)) { out.push([x, s]); seen.add(k); }
        }
        return this._newest_of_profile(out.slice(0, 8), topic);
      }
      return this._newest_of_profile(new TopicMatcher(pool).find_similar(topic.title, topic.rationale, 8, 0.0), topic);
    }

    // نماذج الطلبات (بدل التميز، المؤتمر، التعيين، الترقية): صيغة آخر محضر من نفس النوع.
    _newest_of_profile(matches, topic) {
      if (!matches.length) return matches;
      const profile = FormFields._profile_from_title(topic.title || "") || FormFields._profile_from_title(matches[0][0].title || "");
      if (!profile) return matches;
      return prefer_newest(matches, (p) => FormFields._profile_from_title(p.title || "") === profile, 0.30);
    }

    generate_item(idx) {
      const item = this.items[idx];
      const topic = cloneTopic(item.topic);
      topic._structured_fields = PY.clone(item.structured_fields || {});
      topic._structured_records = PY.clone(item.structured_records || []);
      if (item.new_topic_mode) {
        return {
          title: topic.title, rationale: topic.rationale, decision: topic.decision,
          document_ref: topic.document_ref, attachments: topic.attachments,
          action_required: topic.action_required, _data_tables: Array.from(topic.data_tables || []),
          _generation_method: "موضوع جديد من بيانات المصدر الحالي",
        };
      }
      const refs = this.find_references(item);
      if (!refs.length) throw new Error("لم يتم العثور على موضوع مرجعي ضمن نطاق البحث المحدد.");
      const [ref, score] = refs[0];
      if (!item.reference_override && score < 0.30) {
        throw new Error("درجة التشابه منخفضة. استخدمي «تغيير الموضوع المرجعي» لتحديد المرجع المناسب أو اعتبريه موضوعًا جديدًا.");
      }
      const data = DeptTransfer.build_department_from_reference(topic, ref, score, strip(this.target_department));
      if (data._source_profile !== "promotion" && !/ترقي/.test(data.title || "")) {
        data.decision = P.sync_rank_with_title(data.title, data.decision);
      }
      data._learned_reference_used = !!item._learned_reference_used;
      return data;
    }

    resolve_reference(idx) {
      if (idx === null || idx === undefined) return [null, null, ""];
      const item = this.items[idx];
      const pool = this.scope_topics();
      const override = item.reference_override;
      if (override) {
        for (const p of this.archive_topics) if (p.source_file === override[0] && p.title === override[1]) return [p, 1.0, "مختار يدويًا"];
      }
      const data = item.generated || {};
      if (data._reference_title) {
        for (const p of pool) {
          if (p.title === data._reference_title && p.source_file === data._precedent_source) return [p, data._precedent_score, "المستخدم في التوليد"];
        }
      }
      const refs = this.find_references(item);
      if (refs.length) return [refs[0][0], refs[0][1], "مقترح تلقائيًا"];
      return [null, null, ""];
    }

    suggestions(query) {
      const q = strip(query);
      const pool = this.scope_topics();
      let refs;
      if (q) refs = new TopicMatcher(pool).find_similar(q, "", Math.min(12, Math.max(1, pool.length)), 0.0).map(([p]) => p);
      else refs = pool.slice(0, 12);
      return refs;
    }

    archive_search(query) {
      return archive_search(this.archive_topics, query);
    }

    chooser_search(query) {
      const pool = this.scope_topics();
      const q = strip(query);
      let data;
      if (q) data = new TopicMatcher(pool).find_similar(q, "", Math.min(100, pool.length), 0.0).map(([p]) => p);
      else data = pool;
      return data.slice(0, 100);
    }
  }

  return { College, Department, DEPARTMENTS, SCOPE_LABELS, dept_key, shortTitle, pct, cloneTopic, topic_time_key, prefer_newest, archive_search };
})();
