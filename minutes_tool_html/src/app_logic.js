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
      if (P.STRICT_REFERENCE_FAMILIES.has(current_family) && !reference_pool.length) return [];
      const override = item.precedent_override;
      if (override) {
        const [source_file, title] = override;
        for (const p of reference_pool) if (p.source_file === source_file && p.title === title) return [[p, 1.0]];
        if (P.STRICT_REFERENCE_FAMILIES.has(current_family)) return [];
      }
      const learned = Learning.find_learned_reference(topic.title, topic.rationale, reference_pool, 0.74, "college");
      if (learned) {
        const [learned_ref, learned_score] = learned;
        item._learned_reference_used = true;
        const normal = new TopicMatcher(reference_pool).find_similar(topic.title, topic.rationale, 8, 0.0);
        const out = [[learned_ref, Math.max(0.95, learned_score)]];
        const seen = new Set([JSON.stringify([learned_ref.source_file, learned_ref.title])]);
        for (const [p, score] of normal) {
          const key = JSON.stringify([p.source_file, p.title]);
          if (!seen.has(key)) { out.push([p, score]); seen.add(key); }
        }
        return P.SINGLE_REFERENCE_FAMILIES.has(current_family) ? out.slice(0, 1) : out.slice(0, 8);
      }
      const matches = new TopicMatcher(reference_pool).find_similar(topic.title, topic.rationale, 8, 0.0);
      return P.SINGLE_REFERENCE_FAMILIES.has(current_family) ? matches.slice(0, 1) : matches;
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
        for (const p of pool) if (p.source_file === override[0] && p.title === override[1]) return [[p, 1.0]];
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
        return out.slice(0, 8);
      }
      return new TopicMatcher(pool).find_similar(topic.title, topic.rationale, 8, 0.0);
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
      data._learned_reference_used = !!item._learned_reference_used;
      return data;
    }

    resolve_reference(idx) {
      if (idx === null || idx === undefined) return [null, null, ""];
      const item = this.items[idx];
      const pool = this.scope_topics();
      const override = item.reference_override;
      if (override) {
        for (const p of pool) if (p.source_file === override[0] && p.title === override[1]) return [p, 1.0, "مختار يدويًا"];
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

    chooser_search(query) {
      const pool = this.scope_topics();
      const q = strip(query);
      let data;
      if (q) data = new TopicMatcher(pool).find_similar(q, "", Math.min(100, pool.length), 0.0).map(([p]) => p);
      else data = pool;
      return data.slice(0, 100);
    }
  }

  return { College, Department, DEPARTMENTS, SCOPE_LABELS, dept_key, shortTitle, pct, cloneTopic };
})();
