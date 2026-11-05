/* الواجهة الرئيسية: الإعدادات، مجلس الكلية، مجلس القسم — تعيد سلوك app.py و department_panel.py. */
"use strict";

const App = (() => {
  const { h } = UI;
  const { strip } = PY;
  const { normalize_ar } = Similarity;
  const L = AppLogic;
  const P = Precedent;

  const FIELDS = [
    ["title", "عنوان الموضوع", 2], ["rationale", "حيثيات الموضوع", 10], ["decision", "التوصية / القرار", 2],
    ["document_ref", "المستند", 4], ["attachments", "المرفقات", 4], ["action_required", "الإجراء المطلوب", 2],
  ];
  const META = [["session_number", "رقم الجلسة"], ["day", "اليوم"], ["date", "التاريخ"], ["place", "المكان"], ["time", "الوقت"]];

  const college = new L.College();
  const dept = new L.Department();
  const templates = { college: null, cs: null, it: null };
  const archiveInfo = { college: null, department: null };
  const handles = { college: null, department: null };

  const $ = (sel, root = document) => root.querySelector(sel);
  const errText = (e) => String((e && e.message) || e);

  // ================================================================= settings
  function archiveStatusText(kind) {
    const info = archiveInfo[kind];
    const topics = kind === "college" ? college.archive_topics : dept.archive_topics;
    if (!info) return "لم يتم اختيار المجلد بعد.";
    const files = new Set(topics.map((x) => x.source_file || "")).size;
    const when = info.loadedAt ? new Date(info.loadedAt).toLocaleString("ar-SA-u-nu-latn") : "";
    if (!topics.length) {
      return kind === "college"
        ? `المجلد «${info.folderName}»: لم يتم العثور على محاضر مجلس كلية في المجلد المحدد.`
        : `المجلد «${info.folderName}»: لم يتم العثور على محاضر أقسام مرجعية في المجلد المحدد.`;
    }
    const what = kind === "college" ? "محضر مجلس كلية" : "محضر مجلس قسم";
    return `المجلد «${info.folderName}»: تم تحميل ${topics.length} موضوعًا من ${files} ${what} (يشمل المجلدات الفرعية). آخر تحديث: ${when}`;
  }

  function renderSettings() {
    for (const kind of ["college", "department"]) {
      const el = $(`#st-archive-${kind}`);
      const topics = kind === "college" ? college.archive_topics : dept.archive_topics;
      el.textContent = archiveStatusText(kind);
      el.className = "status " + (archiveInfo[kind] ? (topics.length ? "ok" : "warn") : "muted");
      $(`#btn-refresh-${kind}`).disabled = !archiveInfo[kind];
    }
    for (const key of ["college", "cs", "it"]) {
      const t = templates[key];
      const el = $(`#st-template-${key}`);
      el.textContent = t ? `القالب المحدد: ${t.name}` : "لم يتم اختيار القالب بعد.";
      el.className = "status " + (t ? "ok" : "muted");
    }
    $("#st-learning").textContent =
      `اختيارات متعلّمة محفوظة: مجلس الكلية ${Learning.learning_count("college")} — مجلس القسم ${Learning.learning_count("department")}`;
    $("#st-storage").textContent = Store.isPersistent()
      ? "تُحفظ المجلدات والقوالب داخل هذا المتصفح على جهازك، ولا تُرسل إلى أي جهة."
      : "تنبيه: المتصفح لا يسمح بحفظ الإعدادات، لذلك ستحتاجين إلى اختيار المجلدات والقوالب في كل مرة.";
  }

  async function loadArchiveFromFolder(kind, folder) {
    const level = kind === "college" ? "college" : "department";
    UI.busy("جارٍ تحليل المحاضر المرجعية...");
    let topics;
    try {
      topics = await Minutes.buildArchive(folder.files, level, (i, n) => {
        if (i % 3 === 0 || i === n) UI.busy(`جارٍ تحليل المحاضر المرجعية... (${i} من ${n})`);
      });
    } finally {
      UI.idle();
    }
    const info = { folderName: folder.name || "", loadedAt: new Date().toISOString(), fileCount: folder.files.length };
    archiveInfo[kind] = info;
    handles[kind] = folder.handle || handles[kind];
    if (kind === "college") college.archive_topics = topics;
    else dept.archive_topics = topics;
    await Store.set("archive:" + kind, Object.assign({ topics }, info));
    if (folder.handle) await Store.set("handle:" + kind, folder.handle);
    renderSettings();
    if (kind === "department") {
      dept.reference_context_changed();
      renderDept();
    }
    if (!topics.length) {
      await UI.warn("تنبيه", kind === "college"
        ? "لم يتم العثور على محاضر مجلس كلية في المجلد المحدد."
        : "لم يتم العثور على محاضر أقسام مرجعية في المجلد المحدد.");
    }
  }

  async function chooseArchive(kind) {
    const folder = await UI.pickFolder();
    if (!folder) return;
    await loadArchiveFromFolder(kind, folder);
  }

  async function refreshArchive(kind) {
    let folder = null;
    const handle = handles[kind];
    if (handle) {
      try {
        folder = await UI.rereadHandle(handle);
      } catch (e) {
        folder = null;
      }
    }
    if (!folder) {
      await UI.info("تحديث المحاضر المرجعية", "اختاري المجلد نفسه مرة أخرى لإعادة قراءة المحاضر (بما فيها المحاضر الجديدة).");
      folder = await UI.pickFolder();
    }
    if (folder) await loadArchiveFromFolder(kind, folder);
  }

  async function chooseTemplate(key, label) {
    const f = await UI.pickFile(".docx");
    if (!f) return;
    try {
      OOXML.DocxPackage.open(f.bytes, f.name);
    } catch (e) {
      await UI.error("قالب غير صالح", `تعذر فتح ${label}:\n${errText(e)}`);
      return;
    }
    templates[key] = { name: f.name, bytes: f.bytes };
    await Store.set("template:" + key, templates[key]);
    renderSettings();
  }

  async function exportLearning() {
    UI.downloadText(JSON.stringify(Learning.exportAll(), null, 2), "اختيارات_المراجع_المتعلمة.json");
  }
  async function importLearning() {
    const f = await UI.pickFile(".json,application/json");
    if (!f) return;
    try {
      const data = JSON.parse(new TextDecoder().decode(f.bytes));
      const kind = /department/i.test(f.name) ? "department" : "college";
      const n = Learning.importData(data, kind);
      renderSettings();
      await UI.info("تم", `تم استيراد ${n} اختيارًا متعلّمًا.`);
    } catch (e) {
      await UI.error("تعذر الاستيراد", "الملف ليس نسخة احتياطية صالحة للاختيارات المتعلمة.");
    }
  }

  // ================================================================= shared form helpers
  function buildFields(container, prefix) {
    const out = {};
    for (const [key, label, rows] of FIELDS) {
      const id = `${prefix}-f-${key}`;
      container.appendChild(h("label", { for: id, class: "field-label", text: label + ":" }));
      const ta = h("textarea", { id, dir: "rtl", rows: String(rows), class: "field" });
      container.appendChild(ta);
      out[key] = ta;
    }
    return out;
  }
  function setFields(fields, data) {
    for (const [key] of FIELDS) fields[key].value = (data && data[key]) || "";
  }
  function readFields(fields) {
    const v = {};
    for (const [key] of FIELDS) v[key] = strip(fields[key].value);
    return v;
  }
  function metaValues(prefix) {
    const m = {};
    for (const [key] of META) m[key] = strip($(`#${prefix}-meta-${key}`).value);
    return m;
  }
  function renderRows(listEl, items, currentIndex, onToggle, onSelect) {
    listEl.innerHTML = "";
    items.forEach((item, i) => {
      const cb = h("input", { type: "checkbox", "aria-label": "تضمين في المحضر" });
      cb.checked = !!item.included;
      cb.addEventListener("change", () => onToggle(item.uid, cb.checked));
      const marker = item.generated ? " ✓" : "";
      const cur = i === currentIndex ? "● " : "";
      const btn = h("button", { type: "button", class: "topic-btn" + (i === currentIndex ? " current" : ""), text: cur + (item.topic.title || "بدون عنوان") + marker });
      btn.addEventListener("click", () => onSelect(item.uid));
      listEl.appendChild(h("div", { class: "topic-row" }, cb, h("span", { class: "topic-num", text: String(i + 1) }), btn));
    });
    if (!items.length) listEl.appendChild(h("div", { class: "empty-list", text: "لا توجد موضوعات بعد." }));
  }
  function tablesText(tables, prefix) {
    return (tables || []).map((m, n) => `${prefix} ${n + 1}:\n` + m.map((row) => row.map((c) => strip(String(c ?? ""))).join(" | ")).join("\n")).join("\n\n");
  }

  // ================================================================= college council
  const C = { fields: null };

  function cStatus(text) { $("#c-status").textContent = text; }

  function cSaveCurrent() {
    const idx = college.current_index;
    if (idx === null || !(idx >= 0 && idx < college.items.length)) return;
    const item = college.items[idx];
    const existing = item.generated;
    const values = readFields(C.fields);
    const anyVal = Object.values(values).some((v) => v);
    if (existing && !anyVal) return;
    if (existing || anyVal) {
      const meta = {};
      for (const [k, v] of Object.entries(existing || {})) if (k.startsWith("_")) meta[k] = v;
      item.generated = Object.assign(values, meta);
    }
  }

  function cClearForm() {
    $("#c-source-info").textContent = "المصدر الحالي: لم يتم اختيار موضوع.";
    setFields(C.fields, null);
    $("#c-gen-info").textContent = "الموضوع المرجعي: لم يتم التوليد بعد.";
  }

  function cLoadItem(idx) {
    if (!(idx >= 0 && idx < college.items.length)) return;
    college.current_index = idx;
    const item = college.items[idx];
    $("#c-source-info").textContent = `المصدر الحالي: ${item.source_label || ""}`;
    const data = item.generated || {};
    setFields(C.fields, data);
    if (item.generated) {
      const source = data._precedent_source || "إدخال يدوي";
      const score = data._precedent_score;
      const st = typeof score === "number" ? ` (${L.pct(score)}%)` : "";
      const data_source = data._data_source || item.source_label || "";
      const ref_title = data._reference_title || "";
      const ref_session = data._reference_session || "";
      const ref_desc = ref_title ? `جلسة ${ref_session} — ${ref_title}` : source;
      const learned = data._learned_reference_used ? " | تم اختياره تلقائيًا بناءً على اختيار سابق" : "";
      $("#c-gen-info").textContent = `مصدر البيانات: ${data_source} | الموضوع المرجعي: ${ref_desc}${st}${learned}`;
    } else {
      const chosen = item.precedent_override;
      const chosen_txt = chosen ? ` | الموضوع المرجعي المختار: ${chosen[0]}` : "";
      if (item.new_topic_mode) $("#c-gen-info").textContent = "الموضوع جديد — سيتم استخدام التفاصيل المدخلة دون موضوع مرجعي.";
      else $("#c-gen-info").textContent = `المصدر الحالي: ${item.source_label} | الموضوع المرجعي: لم يتم التوليد بعد.${chosen_txt}`;
    }
  }

  function cRenderRows() {
    renderRows($("#c-list"), college.items, college.current_index,
      (id, checked) => {
        cSaveCurrent();
        const i = college.index_for_uid(id);
        if (i !== null) {
          college.items[i].included = checked;
          cLoadItem(i);
          cRenderRows();
          cStatus("تم تحديث قائمة مواضيع مجلس الكلية وتحديد الموضوع الحالي.");
        }
      },
      (id) => {
        const i = college.index_for_uid(id);
        if (i !== null) cSelect(i);
      });
  }

  function cSelect(idx) {
    if (!(idx >= 0 && idx < college.items.length)) return;
    if (college.current_index !== null && college.current_index !== idx) cSaveCurrent();
    cLoadItem(idx);
    cRenderRows();
  }

  function cRefresh(selectIndex = null) {
    cRenderRows();
    if (selectIndex !== null && selectIndex >= 0 && selectIndex < college.items.length) cSelect(selectIndex);
  }

  function requireCollegeArchive() {
    return college.archive_topics.length > 0;
  }

  async function cAddDepartmentMinutes() {
    const f = await UI.pickFile(".docx,.pdf,.txt");
    if (!f) return;
    let minutes;
    UI.busy("جارٍ تحليل محضر القسم...");
    try {
      minutes = await Minutes.parseMinutesFile(f);
    } catch (e) {
      UI.idle();
      await UI.error("خطأ في التحليل", `تعذر تحليل محضر القسم:\n${errText(e)}`);
      return;
    }
    UI.idle();
    const source_topics = minutes.topics.filter((t) => !L.College.is_previous_minutes_note(t));
    if (!source_topics.length) {
      await UI.warn("تنبيه", "لم يتم العثور على مواضيع قابلة للإضافة إلى مجلس الكلية.");
      return;
    }
    const start = college.items.length;
    for (const topic of source_topics) {
      college.items.push(college.new_item(topic, minutes.session, "department",
        `محضر قسم ${minutes.session.council_name} — الجلسة ${minutes.session.session_number} — ${minutes.session.date}`, f.name, false));
    }
    cRefresh(start);
    const skipped = minutes.topics.length - source_topics.length;
    const suffix = skipped ? " وتم إبقاء «ملاحظات على المحضر السابق» كبند ثابت في القالب." : "";
    cStatus(`تمت إضافة ${source_topics.length} موضوعًا من محضر القسم.${suffix}`);
  }

  async function cAddCommitteeMinutes() {
    const f = await UI.pickFile(".docx,.pdf");
    if (!f) return;
    let src;
    UI.busy("جارٍ قراءة محضر اللجنة الثلاثية...");
    try {
      src = await SourceImport.parse_committee_file(f);
    } catch (e) {
      UI.idle();
      await UI.error("تعذر قراءة محضر اللجنة الثلاثية", errText(e));
      return;
    }
    UI.idle();
    college.items.push(college.new_item(src.topic, src.session, "committee",
      `محضر اللجنة الثلاثية — الجلسة ${src.session.session_number} (${src.session.date})`, f.name, true, "scholarship_notice"));
    cRefresh(college.items.length - 1);
    cStatus("تمت إضافة موضوع اللجنة الثلاثية وتحديده تلقائيًا لإحاطة الابتعاث.");
  }

  function cAddManualTopic() {
    const titleIn = h("input", { type: "text", dir: "rtl", class: "wide" });
    const details = h("textarea", { dir: "rtl", rows: "7" });
    const attach = h("textarea", { dir: "rtl", rows: "5" });
    const body = h("div", { class: "form" },
      h("label", { text: "عنوان الموضوع أو كلمة البحث عن الموضوع المرجعي:" }), titleIn,
      h("label", { text: "التفاصيل الحالية (اختياري — ستستخدم للبحث وتحديث بيانات الموضوع المرجعي):" }), details,
      h("label", { text: "المرفق / المرفقات الحالية (اختياري):" }), attach,
      h("div", { class: "hint", text: "مثال: مرفق تغيير التخصص.  إذا كتبتي مرفقًا هنا سيُستخدم بدل مرفقات الموضوع المرجعي." }));
    UI.modal({
      title: "إضافة موضوع خاص بمجلس الكلية", body,
      buttons: [{
        label: "إضافة الموضوع", primary: true,
        onClick: async () => {
          const title = strip(titleIn.value);
          if (!title) { await UI.warn("تنبيه", "اكتبي عنوان الموضوع أولًا."); return false; }
          const topic = Minutes.Topic({ number: "", title, rationale: strip(details.value), attachments: strip(attach.value) });
          college.items.push(college.new_item(topic, Minutes.SessionInfo(), "manual", "موضوع مضاف مباشرة لمجلس الكلية", "", true, ""));
          cRefresh(college.items.length - 1);
          return true;
        },
      }, { label: "إلغاء" }],
    });
  }

  async function cRemoveCurrent() {
    const idx = college.current_index;
    if (idx === null || !(idx >= 0 && idx < college.items.length)) {
      await UI.info("تنبيه", "اختاري الموضوع المراد حذفه أولًا من القائمة.");
      return;
    }
    const current = college.items[idx];
    const id = current.uid;
    const title = strip(current.topic.title || "") || "الموضوع المحدد";
    if (!(await UI.confirm("تأكيد حذف الموضوع", `هل تريدين حذف الموضوع التالي؟\n\n${title}`))) return;
    const i = college.index_for_uid(id);
    if (i === null) {
      await UI.warn("تنبيه", "تعذر تحديد الموضوع المراد حذفه. أعيدي اختياره من القائمة.");
      return;
    }
    college.items.splice(i, 1);
    college.current_index = null;
    cClearForm();
    const next = college.items.length ? Math.min(i, college.items.length - 1) : null;
    cRefresh(next);
    cStatus(`تم حذف الموضوع: ${title}`);
  }

  function cIncludeAll(v) {
    cSaveCurrent();
    for (const item of college.items) item.included = v;
    cRefresh(college.current_index);
  }

  async function cMove(delta) {
    const idx = college.current_index;
    if (idx === null || !(idx >= 0 && idx < college.items.length)) {
      await UI.info("ترتيب المواضيع", "اختاري موضوعًا من القائمة أولًا.");
      return;
    }
    cSaveCurrent();
    const nw = Learning.move_item(college.items, idx, delta);
    if (nw === idx) {
      cStatus(delta < 0 ? "الموضوع موجود بالفعل في أعلى القائمة." : "الموضوع موجود بالفعل في أسفل القائمة.");
      return;
    }
    college.current_index = nw;
    cRefresh(nw);
    cStatus(`تم نقل الموضوع ${delta < 0 ? "للأعلى" : "للأسفل"}. سيُستخدم هذا الترتيب في جدول الأعمال وفي ملف Word.`);
  }

  async function cShowSource() {
    const idx = college.current_index;
    if (idx === null || !(idx >= 0 && idx < college.items.length)) { await UI.info("تنبيه", "اختاري موضوعًا أولًا."); return; }
    const item = college.items[idx];
    const t = item.topic, ses = item.session;
    const header = `المصدر: ${item.source_label || ""}\nالقسم/المجلس المستخرج: ${ses.council_name || "-"} | الجلسة: ${ses.session_number || "-"} | التاريخ: ${ses.date || "-"}`;
    const tables = tablesText(t.data_tables, "جدول بيانات") || "-";
    const raw = `عنوان الموضوع من المصدر:\n${t.title}\n\nحيثيات الموضوع من المصدر:\n${t.rationale || "-"}\n\n` +
      `بيانات الجداول من المصدر:\n${tables}\n\nالمستند من المصدر:\n${t.document_ref || "-"}\n\nالمرفقات من المصدر:\n${t.attachments || "-"}`;
    UI.textPopup("نص الموضوع من المصدر الحالي", header, raw);
  }

  async function cShowReference() {
    const idx = college.current_index;
    if (idx === null || !(idx >= 0 && idx < college.items.length)) { await UI.info("تنبيه", "لم يتم تحديد موضوع لعرض موضوعه المرجعي."); return; }
    let ref, score, mode;
    try {
      [ref, score, mode] = college.resolve_reference(idx);
    } catch (e) {
      await UI.error("تعذر البحث", errText(e));
      return;
    }
    if (!ref) { await UI.info("الموضوع المرجعي", "لا يوجد موضوع مرجعي متاح لهذا الموضوع حاليًا."); return; }
    const score_text = typeof score === "number" ? ` | درجة التشابه: ${L.pct(score)}%` : "";
    const header = `الحالة: ${mode}${score_text}\nالمحضر المرجعي: ${ref.source_file || "-"} | الجلسة: ${ref.session_number || "-"} | التاريخ: ${ref.session_date || "-"}`;
    const raw = `عنوان الموضوع المرجعي:\n${ref.title || "-"}\n\nحيثيات الموضوع المرجعي:\n${ref.rationale || "-"}\n\n` +
      `التوصية / القرار في الموضوع المرجعي:\n${ref.decision || "-"}\n\nالمستند في الموضوع المرجعي:\n${ref.document_ref || "-"}\n\n` +
      `المرفقات في الموضوع المرجعي:\n${ref.attachments || "-"}\n\nالإجراء المطلوب في الموضوع المرجعي:\n${ref.action_required || "-"}`;
    UI.textPopup("الموضوع المرجعي من محاضر مجلس الكلية", header, raw);
  }

  async function cApplyReference(p) {
      const cur = college.current_index;
      if (cur === null || !(cur >= 0 && cur < college.items.length)) {
        await UI.error("تعذر التوليد", "لم يعد الموضوع الحالي متاحًا. أعيدي اختياره من القائمة.");
        return;
      }
      const target = college.items[cur];
      target.precedent_override = [p.source_file ?? "", p.title ?? ""];
      target.new_topic_mode = false;
      target._learned_reference_used = false;
      $("#c-gen-info").textContent = `تم اختيار الموضوع المرجعي: ${p.source_file || ""} — جلسة ${p.session_number || ""} | جارٍ التوليد...`;
      let data;
      try {
        data = college.generate_item(cur);
      } catch (e) {
        await UI.error("تعذر توليد الموضوع", errText(e));
        cStatus(errText(e));
        $("#c-gen-info").textContent = `تعذر التوليد بعد اختيار الموضوع المرجعي: ${errText(e)}`;
        return;
      }
      target.generated = data;
      cLoadItem(cur);
      cRenderRows();
      cStatus("تم توليد الموضوع باستخدام الموضوع المرجعي الذي تم اختياره يدويًا.");
      try {
        Learning.remember_reference_choice(target.topic.title, target.topic.rationale, p, "college");
        cStatus(`تم توليد الموضوع وحفظ اختيار الموضوع المرجعي للتعرّف على الموضوعات المشابهة لاحقًا. (اختيارات متعلّمة: ${Learning.learning_count("college")})`);
      } catch (e) { /* التوليد أهم من حفظ التعلم */ }
  }


  // ---------------------------------------------------------------- بحث حر في الأرشيف (مجلس الكلية / مجلس القسم)
  function referenceText(ref) {
    return `عنوان الموضوع:\n${ref.title || "-"}\n\nالحيثيات:\n${ref.rationale || "-"}\n\n` +
      `التوصية / القرار:\n${ref.decision || "-"}\n\nالمستند:\n${ref.document_ref || "-"}\n\n` +
      `المرفقات:\n${ref.attachments || "-"}\n\nالإجراء المطلوب:\n${ref.action_required || "-"}`;
  }

  async function searchArchive(kind) {
    const isCollege = kind === "college";
    const logic = isCollege ? college : dept;
    if (!logic.archive_topics.length) {
      await UI.warn("تنبيه", isCollege
        ? "لا توجد محاضر مجلس كلية مرجعية محملة. اختاري مجلد المحاضر المرجعية من الإعدادات."
        : "لا توجد محاضر أقسام مرجعية محملة. اختاري مجلد المحاضر المرجعية من الإعدادات.");
      return;
    }
    const q = h("input", { type: "text", dir: "rtl", class: "wide", placeholder: "اكتبي أي كلمة: اسم، نوع الطلب، برنامج، جلسة..." });
    const count = h("div", { class: "hint" });
    const preview = h("textarea", { class: "readonly", readonly: true, dir: "rtl", rows: 12 });
    preview.value = "اختاري موضوعًا من القائمة لعرض نصه كاملًا.";
    let visible = [];
    const current = () => {
      const s = lb.selected();
      return s >= 0 && s < visible.length ? visible[s] : null;
    };
    const lb = UI.listbox({
      height: 11,
      onSelect: () => {
        const p = current();
        if (!p) return;
        preview.value = `المحضر: ${p.source_file || "-"} | ${p.council_name || ""} | الجلسة: ${p.session_number || "-"} | التاريخ: ${p.session_date || "-"}\n\n` + referenceText(p);
        preview.scrollTop = 0;
      },
    });
    const refresh = () => {
      try {
        visible = logic.archive_search(q.value);
      } catch (e) {
        visible = [];
      }
      lb.set(visible.map((p) => ({
        label: (isCollege ? "" : `${p.council_name || ""} | `) + `جلسة ${p.session_number || ""} | ${p.session_date || ""} | ${L.shortTitle(p.title || "", 90)}`,
      })));
      count.textContent = strip(q.value)
        ? `النتائج: ${visible.length} (من ${logic.archive_topics.length} موضوعًا في الأرشيف)`
        : `كل موضوعات الأرشيف (${logic.archive_topics.length})، الأحدث أولًا — اكتبي للبحث.`;
    };
    let timer = null;
    q.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(refresh, 200); });
    const body = h("div", { class: "form" },
      h("label", { text: isCollege ? "البحث في كل محاضر مجلس الكلية (بدون تحديد موضوع):" : "البحث في كل محاضر مجالس الأقسام (بدون تحديد موضوع):" }),
      q, count, lb.el, h("label", { text: "نص الموضوع المختار:" }), preview);
    const ctl = UI.modal({
      title: isCollege ? "بحث في أرشيف مجلس الكلية" : "بحث في أرشيف مجالس الأقسام",
      body, wide: true,
      buttons: [
        {
          label: "نسخ النص", close: false,
          onClick: async () => {
            const p = current();
            if (!p) { await UI.info("تنبيه", "اختاري موضوعًا من القائمة أولًا."); return false; }
            const text = referenceText(p);
            try { await navigator.clipboard.writeText(text); }
            catch (e) { preview.focus(); preview.select(); document.execCommand("copy"); }
            (isCollege ? cStatus : dStatus)("تم نسخ نص الموضوع من الأرشيف.");
            return false;
          },
        },
        {
          label: "استخدامه مرجعًا للموضوع المعروض", primary: true, close: false,
          onClick: async () => {
            const p = current();
            if (!p) { await UI.info("تنبيه", "اختاري موضوعًا من القائمة أولًا."); return false; }
            const idx = logic.current_index;
            if (idx === null || !(idx >= 0 && idx < logic.items.length)) {
              await UI.info("تنبيه", "لا يوجد موضوع معروض لربطه. يمكنك نسخ النص فقط، أو إضافة موضوع ثم اختياره.");
              return false;
            }
            ctl.close();
            if (isCollege) await cApplyReference(p); else await dApplyReference(p);
            return false;
          },
        },
        { label: "إغلاق" },
      ],
    });
    refresh();
  }

  async function cChoosePrecedent() {
    const idx = college.current_index;
    if (idx === null || !(idx >= 0 && idx < college.items.length)) { await UI.info("تنبيه", "اختاري موضوعًا أولًا."); return; }
    if (!requireCollegeArchive()) {
      await UI.warn("تنبيه", "لا توجد محاضر مجلس كلية مرجعية محملة. اختاري مجلد المحاضر المرجعية من الإعدادات.");
      return;
    }
    const item = college.items[idx];
    const [family, pool] = college.chooser_pool(idx);
    if (P.STRICT_REFERENCE_FAMILIES.has(family) && !pool.length) {
      await UI.warn("لا يوجد موضوع مرجعي مطابق",
        "لم أجد في أرشيف مجلس الكلية موضوعًا من نفس النوع لهذا الطلب. لن يتم ربطه بموضوع من نوع مختلف.");
      return;
    }
    const names = { appointment: "التعيين", promotion: "الترقية", research_bonus: "بدل التميز", conference: "حضور مؤتمر" };
    const hint = P.STRICT_REFERENCE_FAMILIES.has(family)
      ? `موضوعات مجلس الكلية المطابقة لنوع: ${names[family] || family}`
      : "ابحثي في موضوعات مجلس الكلية المرجعية (مثال: تغيير التخصص، الجداول، ابتعاث...)";
    const q = h("input", { type: "text", dir: "rtl", class: "wide", value: item.topic.title });
    let visible = [];
    let ctl;
    const choose = async () => {
      const s = lb.selected();
      if (s < 0) { await UI.info("تنبيه", "اختاري موضوعًا مرجعيًا من القائمة."); return false; }
      const p = visible[s];
      ctl.close();
      await cApplyReference(p);
      return false;
    };
    const lb = UI.listbox({ onActivate: () => choose(), height: 16 });
    const refresh = () => {
      try {
        visible = college.chooser_search(pool, q.value);
      } catch (e) {
        visible = [];
      }
      lb.set(visible.map((p) => ({ label: `جلسة ${p.session_number || ""} | ${L.shortTitle(p.title || "", 95)} | ${p.source_file || ""}` })));
    };
    let timer = null;
    q.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(refresh, 180); });
    const body = h("div", { class: "form" }, h("label", { text: hint }), q, lb.el);
    ctl = UI.modal({
      title: "تغيير الموضوع المرجعي", body, wide: true,
      buttons: [
        { label: "استخدام هذا الموضوع المرجعي", primary: true, close: false, onClick: choose },
        {
          label: "موضوع جديد — استخدم التفاصيل المدخلة",
          onClick: () => {
            item.precedent_override = null;
            item.new_topic_mode = true;
            $("#c-gen-info").textContent = "الموضوع جديد — سيتم استخدام التفاصيل التي أدخلتها دون موضوع مرجعي.";
          },
        },
        { label: "إلغاء الاختيار والعودة للبحث التلقائي", onClick: () => { item.precedent_override = null; item.new_topic_mode = false; } },
      ],
    });
    refresh();
  }

  async function cGenerateIncluded() {
    cSaveCurrent();
    const indices = college.items.map((x, i) => (x.included ? i : -1)).filter((i) => i >= 0);
    if (!indices.length) { await UI.info("تنبيه", "لم يتم اختيار أي موضوع لمجلس الكلية."); return; }
    const errors = [];
    const done = [];
    UI.busy("جارٍ توليد الموضوعات...");
    await UI.nextFrame();
    try {
      for (const i of indices) {
        try {
          college.items[i].generated = college.generate_item(i);
          done.push(i);
        } catch (e) {
          errors.push(`• ${Array.from(college.items[i].topic.title || "").slice(0, 65).join("")}: ${errText(e)}`);
        }
      }
    } finally {
      UI.idle();
    }
    if (done.length) {
      const show = done.includes(college.current_index) ? college.current_index : done[0];
      cLoadItem(show);
      cRenderRows();
    }
    if (errors.length) {
      cStatus(`تم توليد ${done.length} من ${indices.length} موضوعًا، ويوجد ${errors.length} يحتاج مراجعة.`);
      await UI.warn("بعض المواضيع تحتاج موضوعًا مرجعيًا محددًا", errors.slice(0, 8).join("\n\n"));
    } else cStatus(`تم توليد جميع الموضوعات المحددة (${indices.length}) وعرض أول نتيجة مولدة.`);
  }

  async function cExport() {
    cSaveCurrent();
    const included = college.items.filter((x) => x.included);
    if (!included.length) { await UI.info("تنبيه", "لم يتم اختيار أي موضوع لمجلس الكلية."); return; }
    const missing = included.filter((x) => !x.generated).map((x) => x.topic.title);
    if (missing.length) {
      await UI.warn("مواضيع لم تُولّد بعد", "ولّدي الموضوعات المحددة أولًا:\n\n" + missing.slice(0, 10).map((x) => "• " + x).join("\n"));
      return;
    }
    if (!templates.college) { await UI.warn("تنبيه", "اختاري قالب Word لمحضر مجلس الكلية من تبويب الإعدادات."); return; }
    let bytes;
    try {
      bytes = DocxBuilder.build_minutes_document(templates.college.bytes, metaValues("c"), included.map((x) => x.generated), templates.college.name);
    } catch (e) {
      await UI.error("خطأ في التصدير", errText(e));
      return;
    }
    const sn = metaValues("c").session_number;
    const name = await UI.saveBytes(bytes, `محضر مجلس الكلية${sn ? " - الجلسة " + sn : ""}.docx`);
    if (!name) return;
    cStatus(`تم إنشاء المحضر: ${name}`);
    await UI.info("تم", "تم إنشاء محضر مجلس الكلية بنجاح.");
  }

  // ================================================================= department council
  const D = { fields: null };
  function dStatus(text) { $("#d-status").textContent = text; }

  function dSaveCurrent() {
    const idx = dept.current_index;
    if (idx === null || !(idx >= 0 && idx < dept.items.length)) return;
    const item = dept.items[idx];
    const existing = item.generated;
    const values = readFields(D.fields);
    const anyVal = Object.values(values).some((v) => v);
    if (existing && !anyVal) return;
    if (existing || anyVal) {
      const meta = {};
      for (const [k, v] of Object.entries(existing || {})) if (k.startsWith("_")) meta[k] = v;
      item.generated = Object.assign(values, meta);
    }
  }

  function dClearForm() {
    $("#d-source-info").textContent = "المصدر الحالي: لم يتم اختيار موضوع.";
    $("#d-gen-info").textContent = "الموضوع المرجعي: لم يتم التوليد بعد.";
    setFields(D.fields, null);
  }

  function dLoadForm(idx) {
    if (!(idx >= 0 && idx < dept.items.length)) return;
    dept.current_index = idx;
    const item = dept.items[idx];
    $("#d-source-info").textContent = `المصدر الحالي: ${item.source_label || ""}`;
    const data = item.generated || {};
    setFields(D.fields, data);
    if (item.generated) {
      const pct = typeof data._precedent_score === "number" ? ` (${L.pct(data._precedent_score)}%)` : "";
      const learned = data._learned_reference_used ? " | تم ترجيحه بناءً على اختيار سابق" : "";
      $("#d-gen-info").textContent = `الموضوع المرجعي: مجلس قسم ${data._reference_department || ""} — جلسة ${data._reference_session || ""} — ${data._reference_title || ""}${pct}${learned}`;
    } else $("#d-gen-info").textContent = "الموضوع المرجعي: لم يتم التوليد بعد.";
  }

  function dRenderRows() {
    renderRows($("#d-list"), dept.items, dept.current_index,
      (id, checked) => {
        const i = dept.items.findIndex((x) => x.uid === id);
        if (i >= 0) { dept.items[i].included = checked; dSelect(i); }
      },
      (id) => {
        const i = dept.items.findIndex((x) => x.uid === id);
        if (i >= 0) dSelect(i);
      });
  }

  function dSelect(idx) {
    dSaveCurrent();
    if (idx >= 0 && idx < dept.items.length) {
      dept.current_index = idx;
      dLoadForm(idx);
      dRenderRows();
    }
  }

  function dRefresh(selectIndex = null) {
    if (selectIndex !== null && dept.items.length) {
      dRenderRows();
      dSelect(Math.min(Math.max(selectIndex, 0), dept.items.length - 1));
    } else {
      if (!dept.items.length) { dept.current_index = null; dClearForm(); }
      dRenderRows();
    }
  }

  function renderDept() {
    dRenderRows();
    if (dept.current_index !== null) dLoadForm(dept.current_index);
  }

  function dContextChanged() {
    dept.target_department = $("#d-target").value;
    dept.scope = $("#d-scope").value;
    dept.reference_context_changed();
    dRenderRows();
    if (dept.current_index !== null) dLoadForm(dept.current_index);
  }

  const SOURCE_ACCEPT = ".xlsx,.docx,.pdf,.txt";

  async function dAddSource() {
    const f = await UI.pickFile(SOURCE_ACCEPT);
    if (!f) return;
    let topics, kind;
    UI.busy("جارٍ قراءة المصدر...");
    try {
      [topics, , kind] = await SourceImport.import_current_source(f);
    } catch (e) {
      UI.idle();
      await UI.error("تعذر قراءة المصدر", errText(e));
      return;
    }
    UI.idle();
    const usable = topics.filter((t) => !normalize_ar(t.title).includes("ملاحظات على المحضر السابق"));
    if (!usable.length) { await UI.warn("تنبيه", "لم يتم استخراج موضوعات قابلة للإضافة من الملف."); return; }
    const start = dept.items.length;
    for (const t of usable) dept.items.push(dept.new_item(t, f.name, `${kind}: ${f.name}`, false));
    dRefresh(start);
    dStatus(`تم استيراد ${usable.length} موضوعًا جديدًا من ${f.name}.`);
  }

  function dChooseImportedTopic(topics, sourceName) {
    if (!topics.length) return Promise.resolve(null);
    if (topics.length === 1) return Promise.resolve(topics[0]);
    return new Promise((resolve) => {
      let result = null;
      const lb = UI.listbox({ height: 14, onActivate: (i) => { result = topics[i]; ctl.close(); } });
      lb.set(topics.map((t) => ({ label: L.shortTitle(t.title || "بدون عنوان", 150) })));
      lb.select(0);
      const body = h("div", { class: "form" },
        h("label", { text: `يحتوي الملف ${sourceName} على أكثر من موضوع. اختاري الجزء الذي يمثل بيانات الموضوع المعروض:` }), lb.el);
      const ctl = UI.modal({
        title: "اختيار البيانات من الملف", body, wide: true, onClose: () => resolve(result),
        buttons: [{
          label: "استخدام هذه البيانات", primary: true,
          onClick: async () => {
            const s = lb.selected();
            if (s < 0) { await UI.info("تنبيه", "اختاري بيانات من القائمة."); return false; }
            result = topics[s];
            return true;
          },
        }],
      });
    });
  }

  function dReviewExtracted(extracted, sourceName) {
    return new Promise((resolve) => {
      let result = [null, null];
      const entries = {};
      const context_keys = new Set(["member_name", "member_rank", "member_gender"]);
      let fields_to_show = extracted.display_fields;
      if (extracted.profile === "excellence" && extracted.records) fields_to_show = extracted.display_fields.filter(([k]) => context_keys.has(k));
      const grid = h("div", { class: "kv-grid" });
      for (const [key, label] of fields_to_show) {
        const inp = h("input", { type: "text", dir: "rtl", value: extracted.values[key] || "" });
        entries[key] = inp;
        grid.append(h("label", { text: label + ":" }), inp);
      }
      const extra = h("div");
      let promotionBox = null;
      const recordEntries = [];
      if (extracted.profile === "promotion") {
        const count = (extracted.records || []).length;
        promotionBox = h("textarea", { dir: "rtl", rows: "8" });
        promotionBox.value = (extracted.records || []).map((r) => strip(String((r || {}).research_title || ""))).filter((x) => x).join("\n");
        extra.append(
          h("div", { class: "subhead", text: `الاستشهادات العلمية المستخرجة من جدول نموذج الترقية: ${count}` }),
          h("div", { class: "hint", text: "استشهاد كامل لكل عمل في سطر مستقل، كما هو في خانة «عنوان العمل (بلغة النشر)». يمكن التصحيح قبل استخدام البيانات." }),
          promotionBox);
      } else if (extracted.profile === "excellence" && extracted.records) {
        extra.append(h("div", { class: "subhead", text: `الأبحاث المستخرجة من الجدول: ${extracted.records.length}` }));
        const labels = [["research_title", "عنوان البحث"], ["journal_name", "اسم المجلة"], ["journal_specialty", "تخصص المجلة"], ["impact_factor", "معامل التأثير"], ["publication_date", "تاريخ النشر"]];
        extracted.records.forEach((rec, i) => {
          const g = h("div", { class: "kv-grid" });
          const rowVars = {};
          for (const [key, label] of labels) {
            const inp = h("input", { type: "text", dir: "rtl", value: rec[key] || "" });
            rowVars[key] = inp;
            g.append(h("label", { text: label + ":" }), inp);
          }
          recordEntries.push(rowVars);
          extra.append(h("fieldset", { class: "record" }, h("legend", { text: `البحث ${i + 1}` }), g));
        });
      }
      const body = h("div", { class: "form" },
        h("div", { class: "subhead", text: `تمت قراءة البيانات الحالية المطلوبة من ${sourceName}. يمكن تعديل أي قيمة قبل استخدامها.` }),
        h("div", { class: "hint", text: "هذه البيانات مستقلة عن صيغة الموضوع المرجعي. الصيغة تحدد أسلوب المحضر فقط، ولا تغيّر نوع النموذج أو جنسه أو بياناته." }),
        grid, extra);
      UI.modal({
        title: "البيانات المستخرجة من النموذج", body, wide: true, onClose: () => resolve(result),
        buttons: [{
          label: "استخدام هذه البيانات", primary: true,
          onClick: () => {
            const vals = Object.assign({}, extracted.values);
            for (const [k, inp] of Object.entries(entries)) vals[k] = strip(inp.value);
            let recs = null;
            if (promotionBox) recs = PY.splitlines(strip(promotionBox.value)).filter((l) => strip(l)).map((l) => ({ research_title: strip(l) }));
            else if (recordEntries.length) {
              recs = [];
              for (const row of recordEntries) {
                const rec = {};
                for (const [k, inp] of Object.entries(row)) if (strip(inp.value)) rec[k] = strip(inp.value);
                if (Object.keys(rec).length) recs.push(rec);
              }
            }
            result = [vals, recs];
            return true;
          },
        }, { label: "إلغاء" }],
      });
    });
  }

  async function dAttachSource() {
    const idx0 = dept.current_index;
    if (idx0 === null || !(idx0 >= 0 && idx0 < dept.items.length)) {
      await UI.info("تنبيه", "اختاري الموضوع الذي ستُضاف إليه بيانات الملف أولًا.");
      return;
    }
    const f = await UI.pickFile(SOURCE_ACCEPT);
    if (!f) return;
    let topics, kind;
    UI.busy("جارٍ قراءة الملف...");
    try {
      [topics, , kind] = await SourceImport.import_current_source(f, true);
    } catch (e) {
      UI.idle();
      await UI.error("تعذر قراءة المصدر", errText(e));
      return;
    }
    UI.idle();
    const usable = topics.filter((t) => !normalize_ar(t.title).includes("ملاحظات على المحضر السابق"));
    if (!usable.length) { await UI.warn("تنبيه", "لم يتم استخراج بيانات قابلة للإضافة من الملف."); return; }
    const selected = await dChooseImportedTopic(usable, f.name);
    if (!selected) return;
    const idx = dept.current_index;
    dSaveCurrent();
    const item = dept.items[idx];
    let ref = null;
    try { [ref] = dept.resolve_reference(idx); } catch (e) { ref = null; }
    const ref_title = ref ? (ref.title || "") : "";
    const profile = FormFields.topic_profile(item.topic.title, ref_title);
    let source_desc;
    if (profile) {
      const extracted = FormFields.extract_form_fields(selected, profile);
      const [values, records] = await dReviewExtracted(extracted, f.name);
      if (values === null) return;
      let filtered_text;
      if (profile === "excellence" && records && records.length) {
        const labels = new Map(extracted.display_fields);
        const ctx = ["member_name", "member_rank", "member_gender"].filter((k) => values[k]).map((k) => `${labels.get(k) || k}: ${values[k]}`).join("\n");
        filtered_text = [ctx, FormFields.publication_records_to_text(records)].filter((x) => x).join("\n");
      } else if (profile === "promotion") {
        filtered_text = FormFields.fields_to_text(extracted, values);
        if (records && records.length) {
          const names = records.map((r) => strip(r.research_title || "")).filter((x) => x);
          if (names.length) filtered_text += "\n" + names.map((x) => `عنوان العمل (بلغة النشر): ${x}`).join("\n");
        }
      } else filtered_text = FormFields.fields_to_text(extracted, values);
      if (!filtered_text) {
        await UI.warn("لم يتم العثور على بيانات", "لم تُستخرج أي قيمة من الحقول المطلوبة. يمكن إعادة المحاولة أو إدخال البيانات يدويًا في الموضوع.");
        return;
      }
      const filtered = Minutes.Topic({ title: selected.title, rationale: filtered_text });
      item.topic = L.Department.merge_topic_source(item.topic, filtered);
      item.structured_fields = Object.assign({}, values);
      item.structured_records = PY.clone(records || []);
      item.raw_source_topic = PY.clone(selected);
      const profile_names = { conference: "حضور مؤتمر", appointment: "تعيين", excellence: "بدل التميز", promotion: "ترقية" };
      source_desc = `${kind} — استخراج حقول ${profile_names[profile] || profile}`;
    } else {
      item.topic = L.Department.merge_topic_source(item.topic, selected);
      item.raw_source_topic = PY.clone(selected);
      source_desc = kind;
    }
    item.source_path = f.name;
    item.source_label = strip(`${strip(item.source_label || "")} + بيانات من ${source_desc}: ${f.name}`, " +");
    item.generated = null;
    dLoadForm(idx);
    dRenderRows();
    dStatus(`تم إرفاق البيانات المطلوبة فقط من ${f.name} بالموضوع المعروض.`);
  }

  function dAddManual() {
    const titleIn = h("input", { type: "text", dir: "rtl", class: "wide" });
    const info = h("div", { class: "hint" });
    const data = h("textarea", { dir: "rtl", rows: "8" });
    let visible = [];
    let selectedRef = null;
    const useSuggestion = (i) => {
      const s = i === undefined ? lb.selected() : i;
      if (s < 0) return;
      const p = visible[s];
      selectedRef = p;
      titleIn.value = DeptTransfer.reference_title_template(p, strip(dept.target_department));
      info.textContent = `الصيغة المختارة من مجلس قسم ${p.council_name || ""} — الجلسة ${p.session_number || ""}. يمكن تعديل الاسم أو أي جزء قبل الإضافة.`;
    };
    const lb = UI.listbox({ height: 9, onActivate: useSuggestion });
    const refresh = () => {
      try {
        visible = dept.suggestions(titleIn.value);
      } catch (e) {
        visible = [];
      }
      const target = strip(dept.target_department);
      lb.set(visible.map((p) => ({ label: `${DeptTransfer.reference_title_template(p, target)}   —   مجلس قسم ${p.council_name || ""} | جلسة ${p.session_number || ""}` })));
      info.textContent = visible.length
        ? `عدد المقترحات المعروضة: ${visible.length}. اختيار صيغة يربط الموضوع تلقائيًا بمرجعها في الأرشيف.`
        : "لا توجد موضوعات مرجعية ضمن نطاق البحث الحالي.";
    };
    let timer = null;
    titleIn.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(refresh, 220); });
    const body = h("div", { class: "form" },
      h("div", { class: "subhead", text: "يمكن كتابة عبارة مختصرة مثل «بدل تميز» أو «حضور مؤتمر». تعرض الأداة صيغًا مستخدمة فعليًا في محاضر الأقسام السابقة ضمن نطاق البحث المحدد." }),
      h("label", { text: "عنوان الموضوع / عبارة البحث:" }), titleIn,
      h("label", { text: "صيغ مقترحة من محاضر الأقسام السابقة:" }), lb.el, info,
      h("div", {}, h("button", { type: "button", text: "استخدام الصيغة المحددة", onclick: () => useSuggestion() })),
      h("label", { text: "البيانات الحالية (اختياري — ويمكن إرفاق Word/PDF بعد إضافة الموضوع):" }), data);
    UI.modal({
      title: "إضافة موضوع لمجلس القسم", body, wide: true,
      buttons: [{
        label: "إضافة الموضوع", primary: true,
        onClick: async () => {
          const title = strip(titleIn.value);
          if (!title) { await UI.warn("تنبيه", "أدخلي عنوان الموضوع أو اختاري إحدى الصيغ المقترحة."); return false; }
          const item = dept.new_item(Minutes.Topic({ title, rationale: strip(data.value) }), "", "موضوع مضاف مباشرة لمجلس القسم", true);
          if (selectedRef) {
            item.reference_override = [selectedRef.source_file ?? "", selectedRef.title ?? ""];
            item.new_topic_mode = false;
          }
          dept.items.push(item);
          dRefresh(dept.items.length - 1);
          dStatus(selectedRef
            ? "تمت إضافة الموضوع وربطه بالصيغة المرجعية المختارة. بعد إرفاق بيانات النموذج سيُستخدم نفس أسلوب المحضر السابق مع البيانات الحالية."
            : "تمت إضافة الموضوع. يمكن اختيار الموضوع المرجعي لاحقًا من أرشيف مجلس القسم.");
          return true;
        },
      }, { label: "إلغاء" }],
    });
    refresh();
  }

  async function dRemoveCurrent() {
    const idx = dept.current_index;
    if (idx === null || !(idx >= 0 && idx < dept.items.length)) { await UI.info("تنبيه", "لم يتم تحديد موضوع للحذف."); return; }
    const title = dept.items[idx].topic.title;
    if (!(await UI.confirm("تأكيد الحذف", `حذف الموضوع المعروض؟\n\n${title}`))) return;
    dept.items.splice(idx, 1);
    dept.current_index = null;
    dRefresh(dept.items.length ? 0 : null);
  }

  function dIncludeAll(v) {
    dSaveCurrent();
    for (const x of dept.items) x.included = v;
    dRefresh(dept.current_index);
  }

  async function dMove(delta) {
    const idx = dept.current_index;
    if (idx === null || !(idx >= 0 && idx < dept.items.length)) { await UI.info("ترتيب المواضيع", "اختاري موضوعًا من القائمة أولًا."); return; }
    dSaveCurrent();
    const nw = Learning.move_item(dept.items, idx, delta);
    if (nw === idx) {
      dStatus(delta < 0 ? "الموضوع موجود بالفعل في أعلى القائمة." : "الموضوع موجود بالفعل في أسفل القائمة.");
      return;
    }
    dept.current_index = nw;
    dRefresh(nw);
    dStatus(`تم نقل الموضوع ${delta < 0 ? "للأعلى" : "للأسفل"}. سيُستخدم هذا الترتيب عند تصدير محضر مجلس القسم.`);
  }

  async function dShowSource() {
    const idx = dept.current_index;
    if (idx === null) { await UI.info("تنبيه", "لم يتم تحديد موضوع."); return; }
    const t = dept.items[idx].topic;
    let tables = "";
    (t.data_tables || []).forEach((m, n) => {
      tables += `\n\nجدول ${n + 1}:\n` + m.map((row) => row.map((c) => Precedent.pyStr(c)).join(" | ")).join("\n");
    });
    let raw = `عنوان المصدر:\n${t.title || "-"}\n\nالبيانات المستخدمة في الموضوع:\n${t.rationale || "-"}\n\n` +
      `التوصية/القرار في المصدر:\n${t.decision || "-"}\n\nالمستند في المصدر:\n${t.document_ref || "-"}\n\n` +
      `المرفقات في المصدر:\n${t.attachments || "-"}\n\nالإجراء المطلوب في المصدر:\n${t.action_required || "-"}${tables}`;
    const original = dept.items[idx].raw_source_topic;
    if (original) {
      let raw_tables = "";
      (original.data_tables || []).forEach((m, n) => {
        raw_tables += `\n\nجدول أصلي ${n + 1}:\n` + m.map((row) => row.map((c) => Precedent.pyStr(c)).join(" | ")).join("\n");
      });
      raw += "\n\n----------------------------------------\n" +
        "الملف المرفق الأصلي — للمعاينة فقط، ولا تُستخدم كل تفاصيله في التوليد:\n" +
        `${original.rationale || "-"}${raw_tables}`;
    }
    UI.textPopup("المصدر الحالي", "", raw);
  }

  async function dShowReference() {
    let ref, score, mode;
    try {
      [ref, score, mode] = dept.resolve_reference(dept.current_index);
    } catch (e) {
      await UI.error("تعذر البحث", errText(e));
      return;
    }
    if (!ref) { await UI.info("الموضوع المرجعي", "لا يوجد موضوع مرجعي متاح حاليًا."); return; }
    const pct = typeof score === "number" ? ` | درجة التشابه: ${L.pct(score)}%` : "";
    const raw = `الحالة: ${mode}${pct}\nالمحضر: ${ref.source_file || "-"} | مجلس قسم ${ref.council_name || "-"} | الجلسة: ${ref.session_number || "-"} | التاريخ: ${ref.session_date || "-"}\n\n` +
      `العنوان:\n${ref.title || "-"}\n\nالحيثيات:\n${ref.rationale || "-"}\n\nالتوصية/القرار:\n${ref.decision || "-"}\n\n` +
      `المستند:\n${ref.document_ref || "-"}\n\nالمرفقات:\n${ref.attachments || "-"}\n\nالإجراء المطلوب:\n${ref.action_required || "-"}`;
    UI.textPopup("الموضوع المرجعي من محاضر الأقسام", "", raw);
  }

  async function dGenerateIncluded() {
    dSaveCurrent();
    const inds = dept.items.map((x, i) => (x.included ? i : -1)).filter((i) => i >= 0);
    if (!inds.length) { await UI.info("تنبيه", "لم يتم تحديد أي موضوع لمجلس القسم."); return; }
    const errs = [], done = [];
    UI.busy("جارٍ توليد الموضوعات...");
    await UI.nextFrame();
    try {
      for (const i of inds) {
        try {
          dept.items[i].generated = dept.generate_item(i);
          done.push(i);
        } catch (e) {
          errs.push(`• ${Array.from(dept.items[i].topic.title || "").slice(0, 65).join("")}: ${errText(e)}`);
        }
      }
    } finally {
      UI.idle();
    }
    if (done.length) { dLoadForm(done[0]); dRefresh(done[0]); }
    if (errs.length) {
      dStatus(`تم توليد ${done.length} من ${inds.length} موضوعًا.`);
      await UI.warn("بعض الموضوعات تحتاج مراجعة", errs.slice(0, 8).join("\n\n"));
    } else dStatus(`تم توليد جميع الموضوعات المحددة (${done.length}).`);
  }

  async function dApplyReference(p) {
      const idx = dept.current_index;
      dept.items[idx].reference_override = [p.source_file ?? "", p.title ?? ""];
      dept.items[idx].new_topic_mode = false;
      let data;
      try {
        data = dept.generate_item(idx);
      } catch (e) {
        await UI.error("تعذر التوليد", errText(e));
        return;
      }
      dept.items[idx].generated = data;
      dLoadForm(idx);
      dRefresh(idx);
      try {
        const t = dept.items[idx].topic;
        Learning.remember_reference_choice(dept.learning_source_title(t), t.rationale, p, "department");
        dStatus(`تم التوليد وحفظ اختيار الموضوع المرجعي للتعلّم المحلي. (اختيارات متعلّمة: ${Learning.learning_count("department")})`);
      } catch (e) {
        dStatus("تم التوليد باستخدام الموضوع المرجعي المختار.");
      }
  }

  async function dChooseReference() {
    const idx0 = dept.current_index;
    if (idx0 === null) { await UI.info("تنبيه", "اختاري موضوعًا أولًا."); return; }
    const pool = dept.scope_topics();
    if (!pool.length) { await UI.warn("تنبيه", "لا توجد محاضر أقسام مرجعية ضمن نطاق البحث المحدد."); return; }
    const item = dept.items[idx0];
    const q = h("input", { type: "text", dir: "rtl", class: "wide", value: item.topic.title });
    let visible = [];
    let ctl;
    const choose = async () => {
      const s = lb.selected();
      if (s < 0) { await UI.info("تنبيه", "اختاري موضوعًا مرجعيًا."); return false; }
      const p = visible[s];
      ctl.close();
      await dApplyReference(p);
      return false;
    };
    const lb = UI.listbox({ height: 16, onActivate: () => choose() });
    const refresh = () => {
      try {
        visible = dept.chooser_search(q.value);
      } catch (e) {
        visible = [];
      }
      lb.set(visible.map((p) => ({ label: `${p.council_name || ""} | جلسة ${p.session_number || ""} | ${L.shortTitle(p.title || "", 90)}` })));
    };
    let timer = null;
    q.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(refresh, 180); });
    const body = h("div", { class: "form" },
      h("label", { text: "البحث في موضوعات مجالس الأقسام المرجعية:" }),
      h("div", { class: "hint", text: `الموضوعات المتاحة ضمن نطاق البحث الحالي: ${pool.length}` }), q, lb.el);
    ctl = UI.modal({
      title: "تغيير الموضوع المرجعي", body, wide: true,
      buttons: [
        { label: "استخدام هذا الموضوع المرجعي", primary: true, close: false, onClick: choose },
        {
          label: "موضوع جديد — استخدم بيانات المصدر الحالي",
          onClick: () => {
            item.reference_override = null;
            item.new_topic_mode = true;
            $("#d-gen-info").textContent = "الموضوع جديد — سيستخدم المصدر الحالي دون موضوع مرجعي.";
          },
        },
      ],
    });
    refresh();
  }

  async function dExport() {
    dSaveCurrent();
    const included = dept.items.filter((x) => x.included);
    if (!included.length) { await UI.info("تنبيه", "لم يتم تحديد موضوعات للتصدير."); return; }
    const missing = included.filter((x) => !x.generated).map((x) => x.topic.title);
    if (missing.length) {
      await UI.warn("مواضيع لم تُولّد بعد", "ولّدي الموضوعات أولًا:\n\n" + missing.slice(0, 10).map((x) => "• " + x).join("\n"));
      return;
    }
    const d = strip(dept.target_department);
    const key = L.dept_key(d) === "cs" ? "cs" : "it";
    const tpl = templates[key];
    if (!tpl) { await UI.warn("تنبيه", `حددي قالب Word لمجلس قسم ${d} من الإعدادات.`); return; }
    let bytes;
    try {
      bytes = DocxBuilder.build_department_minutes_document(tpl.bytes, metaValues("d"), included.map((x) => x.generated), tpl.name);
    } catch (e) {
      await UI.error("خطأ في التصدير", errText(e));
      return;
    }
    const sn = metaValues("d").session_number;
    const name = await UI.saveBytes(bytes, `محضر مجلس قسم ${d}${sn ? " - الجلسة " + sn : ""}.docx`);
    if (!name) return;
    dStatus(`تم إنشاء المحضر: ${name}`);
    await UI.info("تم", `تم إنشاء محضر مجلس قسم ${d} بنجاح.`);
  }

  // ================================================================= wiring
  function bind(id, fn) {
    const el = document.getElementById(id);
    if (el) el.addEventListener("click", () => {
      Promise.resolve(fn()).catch((e) => { UI.idle(); UI.error("خطأ غير متوقع", errText(e)); });
    });
  }

  function setupTabs() {
    const tabs = Array.from(document.querySelectorAll(".tab"));
    for (const t of tabs) {
      t.addEventListener("click", () => {
        for (const x of tabs) {
          x.setAttribute("aria-selected", x === t ? "true" : "false");
          document.getElementById(x.dataset.panel).hidden = x !== t;
        }
        cSaveCurrent();
        dSaveCurrent();
        if (t.dataset.panel === "panel-settings" && C.fields) renderSettings();
        try { localStorage.setItem("college_minutes_tool:tab", t.dataset.panel); } catch (e) { /* ignore */ }
      });
    }
    let saved = null;
    try { saved = localStorage.getItem("college_minutes_tool:tab"); } catch (e) { saved = null; }
    const first = tabs.find((t) => t.dataset.panel === saved) || tabs[0];
    first.click();
  }

  async function restore() {
    for (const kind of ["college", "department"]) {
      const a = await Store.get("archive:" + kind);
      if (a && Array.isArray(a.topics)) {
        archiveInfo[kind] = { folderName: a.folderName, loadedAt: a.loadedAt, fileCount: a.fileCount };
        if (kind === "college") college.archive_topics = a.topics;
        else dept.archive_topics = a.topics;
      }
      const hd = await Store.get("handle:" + kind);
      if (hd) handles[kind] = hd;
    }
    for (const key of ["college", "cs", "it"]) {
      const t = await Store.get("template:" + key);
      if (t && t.bytes) templates[key] = { name: t.name, bytes: t.bytes instanceof Uint8Array ? t.bytes : new Uint8Array(t.bytes) };
    }
  }

  function capabilityCheck() {
    try {
      new RegExp("(?<=a)b", "u");
      new RegExp("\\p{L}", "u");
      new RegExp("a", "d");
    } catch (e) {
      return false;
    }
    return typeof TextDecoder !== "undefined" && typeof DOMParser !== "undefined";
  }

  async function init() {
    if (!capabilityCheck()) {
      document.getElementById("unsupported").hidden = false;
      return;
    }
    C.fields = buildFields(document.getElementById("c-fields"), "c");
    D.fields = buildFields(document.getElementById("d-fields"), "d");
    for (const d of L.DEPARTMENTS) $("#d-target").appendChild(h("option", { value: d, text: d }));
    for (const s of L.SCOPE_LABELS) $("#d-scope").appendChild(h("option", { value: s, text: s }));
    $("#d-target").addEventListener("change", dContextChanged);
    $("#d-scope").addEventListener("change", dContextChanged);

    bind("btn-archive-college", () => chooseArchive("college"));
    bind("btn-refresh-college", () => refreshArchive("college"));
    bind("btn-archive-department", () => chooseArchive("department"));
    bind("btn-refresh-department", () => refreshArchive("department"));
    bind("btn-template-college", () => chooseTemplate("college", "قالب محضر مجلس الكلية"));
    bind("btn-template-cs", () => chooseTemplate("cs", "قالب مجلس قسم علوم الحاسب"));
    bind("btn-template-it", () => chooseTemplate("it", "قالب مجلس قسم تقنية المعلومات"));
    bind("btn-learning-export", exportLearning);
    bind("btn-learning-import", importLearning);

    bind("c-add-dept", cAddDepartmentMinutes);
    bind("c-add-committee", cAddCommitteeMinutes);
    bind("c-add-manual", cAddManualTopic);
    bind("c-remove", cRemoveCurrent);
    bind("c-include-all", () => cIncludeAll(true));
    bind("c-exclude-all", () => cIncludeAll(false));
    bind("c-up", () => cMove(-1));
    bind("c-down", () => cMove(1));
    bind("c-generate", cGenerateIncluded);
    bind("c-show-source", cShowSource);
    bind("c-choose-ref", cChoosePrecedent);
    bind("c-search-archive", () => searchArchive("college"));
    bind("c-search-archive-top", () => searchArchive("college"));
    bind("c-show-ref", cShowReference);
    bind("c-export", cExport);

    bind("d-add-manual", dAddManual);
    bind("d-attach", dAttachSource);
    bind("d-import", dAddSource);
    bind("d-remove", dRemoveCurrent);
    bind("d-include-all", () => dIncludeAll(true));
    bind("d-exclude-all", () => dIncludeAll(false));
    bind("d-up", () => dMove(-1));
    bind("d-down", () => dMove(1));
    bind("d-generate", dGenerateIncluded);
    bind("d-show-source", dShowSource);
    bind("d-choose-ref", dChooseReference);
    bind("d-search-archive", () => searchArchive("department"));
    bind("d-search-archive-top", () => searchArchive("department"));
    bind("d-show-ref", dShowReference);
    bind("d-export", dExport);

    window.addEventListener("beforeunload", (e) => {
      if (college.items.length || dept.items.length) {
        e.preventDefault();
        e.returnValue = "";
      }
    });

    setupTabs();
    await restore();
    renderSettings();
    cRenderRows();
    dRenderRows();
  }

  return { init, college, dept, templates, _internals: { loadArchiveFromFolder, cSaveCurrent, dSaveCurrent } };
})();

document.addEventListener("DOMContentLoaded", () => {
  App.init().catch((e) => UI.error("تعذر تشغيل الأداة", String((e && e.message) || e)));
});
