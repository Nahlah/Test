#!/usr/bin/env python3
"""
أداة كتابة محاضر المجالس الجامعية (أوف لاين بالكامل)
======================================================
تعمل محليًا على جهازك دون اتصال بالإنترنت، وتستخدم نموذج ذكاء اصطناعي محلي عبر Ollama
لصياغة نصوص المحاضر، مع الرجوع لأرشيف محاضر سابقة لإيجاد مواضيع مشابهة يُستأنس بصياغتها.

وضعان للاستخدام (تبويبان منفصلان):
1) تحويل محضر قسم إلى محضر كلية: تُحمَّل محاضر مجالس أقسام وتُحوَّل مواضيعها تلقائيًا إلى
   صياغة محضر مجلس الكلية المكافئة، بالرجوع لأرشيف محاضر الكلية السابقة.
2) إنشاء موضوع جديد لمحضر القسم: يكتب منسّق محضر القسم وصفًا مختصرًا لموضوع جديد، وتصوغه
   الأداة رسميًا بالاعتماد على أرشيف محاضر القسم نفسه (لاستخدام الأقسام العلمية مباشرة).
"""
import os
import queue
import threading
import tkinter as tk
from tkinter import ttk, filedialog, messagebox

from core.config import load_config, save_config
from core.minutes_parser import parse_minutes_file, Topic
from core.archive import build_archive
from core.similarity import TopicMatcher
from core.llm import list_models, LLMError as OllamaError
from core.draft import draft_topic, draft_new_topic, Engine
from core.docx_builder import build_minutes_document

FONT = ("Tahoma", 11)
FONT_BOLD = ("Tahoma", 11, "bold")


class MinutesApp:
    def __init__(self, root):
        self.root = root
        root.title("أداة كتابة محاضر المجالس الجامعية")
        root.geometry("1100x720")

        self.cfg = load_config()
        self.loaded_depts = []  # [{"path": str, "minutes": Minutes}, ...]
        self.topics_flat = []   # [(dept_index, Topic), ...] بترتيب العرض/التصدير
        self.archive_topics = []
        self.matcher = None
        self.generated = {}  # index في topics_flat -> dict بالحقول المولّدة

        # حالة تبويب "إنشاء موضوع جديد لمحضر القسم"
        self.dept_mode_topics = []      # [Topic, ...] مواضيع كتبها المستخدم يدويًا
        self.dept_mode_generated = {}   # index -> dict بالحقول المولّدة
        self.dept_mode_archive_topics = []
        self.dept_mode_matcher = None
        self._dept_mode_current_index = None

        self._queue = queue.Queue()

        style = ttk.Style()
        try:
            style.theme_use("clam")
        except tk.TclError:
            pass

        self.notebook = ttk.Notebook(root)
        self.notebook.pack(fill="both", expand=True)

        self.settings_tab = ttk.Frame(self.notebook)
        self.build_tab = ttk.Frame(self.notebook)
        self.dept_mode_tab = ttk.Frame(self.notebook)
        self.notebook.add(self.settings_tab, text="الإعدادات")
        self.notebook.add(self.build_tab, text="تحويل محضر قسم إلى محضر كلية")
        self.notebook.add(self.dept_mode_tab, text="إنشاء موضوع جديد لمحضر القسم")

        self._build_settings_tab()
        self._build_main_tab()
        self._build_dept_mode_tab()
        self.root.after(200, self._poll_queue)

    # ---------------------------------------------------------------- إعدادات
    def _build_settings_tab(self):
        f = self.settings_tab
        pad = {"padx": 10, "pady": 6}

        ttk.Label(f, text="محرك التوليد:", font=FONT).grid(row=0, column=1, sticky="e", **pad)
        self.backend_var = tk.StringVar(value=self.cfg.get("llm_backend", "ollama"))
        backend_frame = ttk.Frame(f)
        backend_frame.grid(row=0, column=0, sticky="w", **pad)
        ttk.Radiobutton(backend_frame, text="Ollama (خادم محلي)", variable=self.backend_var,
                        value="ollama").pack(side="right", padx=4)
        ttk.Radiobutton(backend_frame, text="نموذج محلي مباشر (GGUF عبر llama-cpp-python)",
                        variable=self.backend_var, value="local").pack(side="right", padx=4)

        ttk.Label(f, text="خادم Ollama المحلي (Host):", font=FONT).grid(row=1, column=1, sticky="e", **pad)
        self.host_var = tk.StringVar(value=self.cfg.get("ollama_host", "http://localhost:11434"))
        ttk.Entry(f, textvariable=self.host_var, font=FONT, width=40, justify="right").grid(row=1, column=0, **pad)

        ttk.Label(f, text="مجلد ملفات النماذج المحلية (GGUF):", font=FONT).grid(row=2, column=1, sticky="e", **pad)
        self.local_models_var = tk.StringVar(value=self.cfg.get("local_models_folder", ""))
        ttk.Entry(f, textvariable=self.local_models_var, font=FONT, width=40, justify="right").grid(row=2, column=0, **pad)
        ttk.Button(f, text="استعراض...", command=self._browse_local_models).grid(row=2, column=2, **pad)

        ttk.Label(f, text="النموذج (Model):", font=FONT).grid(row=3, column=1, sticky="e", **pad)
        self.model_var = tk.StringVar(value=self.cfg.get("ollama_model", ""))
        self.model_combo = ttk.Combobox(f, textvariable=self.model_var, font=FONT, width=37, justify="right")
        self.model_combo.grid(row=3, column=0, **pad)
        ttk.Button(f, text="تحديث قائمة النماذج", command=self._refresh_models).grid(row=3, column=2, **pad)

        ttk.Label(f, text="مجلد أرشيف محاضر مجلس الكلية السابقة:", font=FONT).grid(row=4, column=1, sticky="e", **pad)
        self.archive_var = tk.StringVar(value=self.cfg.get("archive_folder", ""))
        ttk.Entry(f, textvariable=self.archive_var, font=FONT, width=40, justify="right").grid(row=4, column=0, **pad)
        ttk.Button(f, text="استعراض...", command=self._browse_archive).grid(row=4, column=2, **pad)

        ttk.Label(f, text="ملف النموذج (القالب) لمحضر مجلس الكلية:", font=FONT).grid(row=5, column=1, sticky="e", **pad)
        self.template_var = tk.StringVar(value=self.cfg.get("template_path", ""))
        ttk.Entry(f, textvariable=self.template_var, font=FONT, width=40, justify="right").grid(row=5, column=0, **pad)
        ttk.Button(f, text="استعراض...", command=self._browse_template).grid(row=5, column=2, **pad)

        ttk.Separator(f, orient="horizontal").grid(row=6, column=0, columnspan=3, sticky="ew", pady=10)
        ttk.Label(f, text="إعدادات تبويب \"إنشاء موضوع جديد لمحضر القسم\"", font=FONT_BOLD).grid(
            row=7, column=0, columnspan=3, sticky="e", padx=10)

        ttk.Label(f, text="مجلد أرشيف محاضر القسم السابقة:", font=FONT).grid(row=8, column=1, sticky="e", **pad)
        self.dept_archive_var = tk.StringVar(value=self.cfg.get("dept_archive_folder", ""))
        ttk.Entry(f, textvariable=self.dept_archive_var, font=FONT, width=40, justify="right").grid(row=8, column=0, **pad)
        ttk.Button(f, text="استعراض...", command=self._browse_dept_archive).grid(row=8, column=2, **pad)

        ttk.Label(f, text="ملف النموذج (القالب) لمحضر مجلس القسم:", font=FONT).grid(row=9, column=1, sticky="e", **pad)
        self.dept_template_var = tk.StringVar(value=self.cfg.get("dept_template_path", ""))
        ttk.Entry(f, textvariable=self.dept_template_var, font=FONT, width=40, justify="right").grid(row=9, column=0, **pad)
        ttk.Button(f, text="استعراض...", command=self._browse_dept_template).grid(row=9, column=2, **pad)

        ttk.Button(f, text="حفظ الإعدادات", command=self._save_settings).grid(row=10, column=0, columnspan=3, pady=16)

        self.settings_status = ttk.Label(f, text="", font=FONT, foreground="green")
        self.settings_status.grid(row=11, column=0, columnspan=3)

        note = (
            "ملاحظات:\n"
            "- \"Ollama\" يتطلب تثبيت تطبيق Ollama وتشغيله (يحتاج macOS 14 فأعلى في نسخته الحالية).\n"
            "- \"نموذج محلي مباشر\" يعمل بأي إصدار من macOS عبر: pip3 install llama-cpp-python\n"
            "  ثم تحميل ملف نموذج بصيغة GGUF (مثل نسخة Qwen2.5-3B-Instruct GGUF) ووضعه في المجلد أعلاه.\n"
            "- الأداة لا تتصل بالإنترنت أثناء العمل في الحالتين؛ كل المعالجة تتم على جهازك.\n"
            "- عدد أعضاء المجلس في المخرج النهائي يطابق ما هو موجود في ملف القالب.\n"
            "  إن تغيّر تشكيل الأعضاء، عدّل القالب نفسه أولًا."
        )
        ttk.Label(f, text=note, font=FONT, justify="right", foreground="#555").grid(
            row=12, column=0, columnspan=3, sticky="e", padx=10, pady=20)

    def _browse_archive(self):
        path = filedialog.askdirectory(title="اختر مجلد أرشيف محاضر مجلس الكلية")
        if path:
            self.archive_var.set(path)

    def _browse_template(self):
        path = filedialog.askopenfilename(title="اختر ملف النموذج", filetypes=[("Word", "*.docx")])
        if path:
            self.template_var.set(path)

    def _browse_dept_archive(self):
        path = filedialog.askdirectory(title="اختر مجلد أرشيف محاضر مجلس القسم")
        if path:
            self.dept_archive_var.set(path)

    def _browse_dept_template(self):
        path = filedialog.askopenfilename(title="اختر ملف نموذج محضر القسم", filetypes=[("Word", "*.docx")])
        if path:
            self.dept_template_var.set(path)

    def _browse_local_models(self):
        path = filedialog.askdirectory(title="اختر مجلد ملفات النماذج المحلية (GGUF)")
        if path:
            self.local_models_var.set(path)

    def _current_engine(self, model: str) -> Engine:
        return Engine(
            backend=self.backend_var.get(),
            host=self.host_var.get().strip(),
            model=model,
            models_folder=self.local_models_var.get().strip(),
        )

    def _refresh_models(self):
        try:
            models = list_models(self.backend_var.get(), self.host_var.get().strip(), self.local_models_var.get().strip())
        except OllamaError as e:
            messagebox.showerror("خطأ", str(e))
            return
        self.model_combo["values"] = models
        if models and not self.model_var.get():
            self.model_var.set(models[0])
        self.settings_status.config(text=f"تم العثور على {len(models)} نموذج/نماذج.")

    def _save_settings(self):
        self.cfg.update({
            "llm_backend": self.backend_var.get(),
            "ollama_host": self.host_var.get().strip(),
            "ollama_model": self.model_var.get().strip(),
            "local_models_folder": self.local_models_var.get().strip(),
            "archive_folder": self.archive_var.get().strip(),
            "template_path": self.template_var.get().strip(),
            "dept_archive_folder": self.dept_archive_var.get().strip(),
            "dept_template_path": self.dept_template_var.get().strip(),
        })
        save_config(self.cfg)
        self.settings_status.config(text="تم حفظ الإعدادات.")

    # ------------------------------------------------------------ التبويب الرئيسي
    def _build_main_tab(self):
        f = self.build_tab
        top = ttk.Frame(f)
        top.pack(fill="x", padx=10, pady=8)

        ttk.Label(top, text="محاضر مجالس الأقسام:", font=FONT_BOLD).pack(side="right", padx=6)
        ttk.Button(top, text="إضافة محضر قسم...", command=self._add_dept_file).pack(side="right", padx=6)
        ttk.Button(top, text="إزالة المحدد", command=self._remove_dept_file).pack(side="right", padx=6)

        info = ttk.Frame(f)
        info.pack(fill="x", padx=10, pady=4)
        self.dept_files_list = tk.Listbox(info, font=FONT, height=4, exportselection=False)
        self.dept_files_list.pack(fill="x", expand=True)

        # بيانات جلسة محضر الكلية الجديد
        meta = ttk.LabelFrame(f, text="بيانات جلسة محضر مجلس الكلية الجديد")
        meta.pack(fill="x", padx=10, pady=8)
        labels = ["رقم الجلسة", "اليوم", "التاريخ", "المكان", "الوقت", "رقم أول موضوع"]
        self.meta_vars = {}
        for i, lbl in enumerate(labels):
            ttk.Label(meta, text=lbl + ":", font=FONT).grid(row=i // 3, column=(i % 3) * 2 + 1, sticky="e", padx=6, pady=4)
            var = tk.StringVar(value="1" if lbl == "رقم أول موضوع" else "")
            ttk.Entry(meta, textvariable=var, font=FONT, width=18, justify="right").grid(
                row=i // 3, column=(i % 3) * 2, sticky="w", padx=6, pady=4)
            self.meta_vars[lbl] = var

        # قائمة المواضيع
        mid = ttk.Frame(f)
        mid.pack(fill="both", expand=True, padx=10, pady=8)

        left = ttk.Frame(mid)
        left.pack(side="right", fill="y")
        ttk.Label(left, text="جميع المواضيع (من كل الأقسام المحمّلة)", font=FONT_BOLD).pack(anchor="e")
        self.topics_list = tk.Listbox(left, font=FONT, width=45, height=20, exportselection=False)
        self.topics_list.pack(fill="y", expand=True, pady=4)
        self.topics_list.bind("<<ListboxSelect>>", self._on_select_topic)

        btns = ttk.Frame(left)
        btns.pack(fill="x", pady=4)
        ttk.Button(btns, text="توليد الموضوع المحدد", command=self._generate_selected).pack(fill="x", pady=2)
        ttk.Button(btns, text="توليد جميع المواضيع", command=self._generate_all).pack(fill="x", pady=2)

        right = ttk.Frame(mid)
        right.pack(side="right", fill="both", expand=True, padx=10)

        ttk.Label(right, text="السوابق المشابهة الموجودة في الأرشيف لهذا الموضوع:", font=FONT_BOLD).pack(anchor="e", pady=(0, 2))
        self.precedents_preview = tk.Text(right, font=FONT, height=4, wrap="word", foreground="#555")
        self.precedents_preview.pack(fill="x")
        self.precedents_preview.configure(state="disabled")

        self.fields = {}
        field_labels = [
            ("title", "عنوان الموضوع"),
            ("rationale", "حيثيات الموضوع"),
            ("decision", "التوصية / القرار"),
            ("document_ref", "المستند"),
            ("attachments", "المرفقات"),
            ("action_required", "الإجراء المطلوب"),
        ]
        for key, label in field_labels:
            ttk.Label(right, text=label + ":", font=FONT_BOLD).pack(anchor="e", pady=(6, 0))
            height = 6 if key == "rationale" else 2
            txt = tk.Text(right, font=FONT, height=height, wrap="word")
            txt.pack(fill="x")
            self.fields[key] = txt

        bottom = ttk.Frame(f)
        bottom.pack(fill="x", padx=10, pady=10)
        self.status_var = tk.StringVar(value="جاهز.")
        ttk.Label(bottom, textvariable=self.status_var, font=FONT, foreground="blue").pack(side="right")
        ttk.Button(bottom, text="تصدير محضر Word", command=self._export).pack(side="left")

        self._current_index = None

    def _add_dept_file(self):
        path = filedialog.askopenfilename(
            title="اختر محضر مجلس القسم",
            filetypes=[("مستندات مدعومة", "*.docx *.pdf *.txt"), ("الكل", "*.*")],
        )
        if not path:
            return
        try:
            minutes = parse_minutes_file(path)
        except Exception as e:
            messagebox.showerror("خطأ في التحليل", f"تعذّر تحليل الملف:\n{e}")
            return
        if not minutes.topics:
            messagebox.showwarning(
                "تنبيه", "لم يتم العثور على أي مواضيع في هذا الملف. تأكد من أنه يطابق بنية النموذج المتوقعة."
            )

        self.loaded_depts.append({"path": path, "minutes": minutes})
        s = minutes.session
        self.dept_files_list.insert(
            "end",
            f"{s.council_name} — الجلسة {s.session_number} ({s.date})  [{len(minutes.topics)} موضوع]",
        )

        archive_folder = self.archive_var.get().strip()
        self.archive_topics = build_archive(archive_folder)
        self.matcher = TopicMatcher(self.archive_topics) if self.archive_topics else None

        self._refresh_topics_display()
        self.status_var.set(
            f"تم تحميل {len(self.loaded_depts)} محضر قسم بإجمالي {len(self.topics_flat)} موضوعًا. "
            f"({len(self.archive_topics)} موضوع سابق في الأرشيف)"
        )

    def _remove_dept_file(self):
        sel = self.dept_files_list.curselection()
        if not sel:
            messagebox.showinfo("تنبيه", "اختر محضر قسم من القائمة أعلاه لإزالته.")
            return
        idx = sel[0]
        self.dept_files_list.delete(idx)
        del self.loaded_depts[idx]
        self._refresh_topics_display()
        self.status_var.set(f"تم تحميل {len(self.loaded_depts)} محضر قسم بإجمالي {len(self.topics_flat)} موضوعًا.")

    def _refresh_topics_display(self):
        self.topics_flat = []
        for dept_idx, entry in enumerate(self.loaded_depts):
            for t in entry["minutes"].topics:
                self.topics_flat.append((dept_idx, t))
        self.topics_list.delete(0, "end")
        self.generated = {}
        self._current_index = None
        for widget in self.fields.values():
            widget.delete("1.0", "end")
        for dept_idx, t in self.topics_flat:
            dept_name = self.loaded_depts[dept_idx]["minutes"].session.council_name
            self.topics_list.insert("end", f"[{dept_name}] {t.number} - {t.title}")

    @staticmethod
    def _format_precedents_preview(matcher, title: str, rationale: str) -> str:
        if matcher is None:
            return "لم يُحدَّد مجلد أرشيف بعد (تبويب الإعدادات)، أو لم يُعثر على أي ملفات فيه."
        precedents = matcher.find_similar(title, rationale, top_k=3)
        if not precedents:
            return "بُحث في الأرشيف ولم يُعثر على أي موضوع سابق مشابه بدرجة كافية لهذا الموضوع."
        lines = [f"تم البحث في الأرشيف — أفضل {len(precedents)} تطابق/تطابقات:"]
        for topic_dict, score in precedents:
            src = topic_dict.get("source_file", "")
            lines.append(f"• [{score * 100:.0f}%] {topic_dict.get('title', '')[:90]}  ({src})")
        return "\n".join(lines)

    def _update_precedents_preview(self, widget, matcher, title: str, rationale: str):
        text = self._format_precedents_preview(matcher, title, rationale)
        widget.configure(state="normal")
        widget.delete("1.0", "end")
        widget.insert("1.0", text)
        widget.configure(state="disabled")

    def _on_select_topic(self, _event=None):
        sel = self.topics_list.curselection()
        if not sel:
            return
        idx = sel[0]
        self._current_index = idx
        _, dept_topic = self.topics_flat[idx]
        data = self.generated.get(idx, {
            "title": dept_topic.title,
            "rationale": dept_topic.rationale,
            "decision": "",
            "document_ref": dept_topic.document_ref,
            "attachments": dept_topic.attachments,
            "action_required": "",
        })
        for key, widget in self.fields.items():
            widget.delete("1.0", "end")
            widget.insert("1.0", data.get(key, ""))
        self._update_precedents_preview(self.precedents_preview, self.matcher, dept_topic.title, dept_topic.rationale)

    def _save_current_fields(self):
        if self._current_index is None:
            return
        data = {key: widget.get("1.0", "end").strip() for key, widget in self.fields.items()}
        self.generated[self._current_index] = data

    # -------------------------------------------------------------- التوليد
    def _generate_selected(self):
        sel = self.topics_list.curselection()
        if not sel:
            messagebox.showinfo("تنبيه", "الرجاء اختيار موضوع من القائمة أولًا.")
            return
        self._save_current_fields()
        self._run_generation([sel[0]])

    def _generate_all(self):
        if not self.topics_flat:
            messagebox.showinfo("تنبيه", "لم يتم تحميل أي محضر قسم بعد.")
            return
        self._save_current_fields()
        self._run_generation(list(range(len(self.topics_flat))))

    def _run_generation(self, indices):
        model = self.model_var.get().strip()
        if not model:
            messagebox.showwarning("تنبيه", "الرجاء اختيار نموذج من تبويب الإعدادات أولًا.")
            return
        engine = self._current_engine(model)

        self.status_var.set(f"جارٍ توليد {len(indices)} موضوع/مواضيع...")

        def worker():
            for n, idx in enumerate(indices, start=1):
                dept_idx, topic = self.topics_flat[idx]
                session = self.loaded_depts[dept_idx]["minutes"].session
                precedents = []
                if self.matcher:
                    precedents = self.matcher.find_similar(topic.title, topic.rationale, top_k=3)
                try:
                    data = draft_topic(engine, topic, session.council_name, session.session_number,
                                        session.date, precedents)
                    data["title"] = topic.title
                    self._queue.put(("college", "ok", idx, data, n, len(indices)))
                except OllamaError as e:
                    self._queue.put(("college", "error", idx, str(e), n, len(indices)))

        threading.Thread(target=worker, daemon=True).start()

    def _poll_queue(self):
        try:
            while True:
                mode, kind, idx, payload, n, total = self._queue.get_nowait()
                if mode == "college":
                    generated, current_idx, refresh, status_var = (
                        self.generated, self._current_index, self._on_select_topic_refresh, self.status_var
                    )
                else:
                    generated, current_idx, refresh, status_var = (
                        self.dept_mode_generated, self._dept_mode_current_index,
                        self._on_select_dept_mode_topic_refresh, self.dept_mode_status_var
                    )
                if kind == "ok":
                    generated[idx] = payload
                    if current_idx == idx:
                        refresh(idx)
                    status_var.set(f"تم توليد الموضوع {n} من {total}.")
                else:
                    status_var.set(f"خطأ في الموضوع {n} من {total}: {payload}")
                    messagebox.showerror("خطأ في التوليد", payload)
        except queue.Empty:
            pass
        self.root.after(200, self._poll_queue)

    def _on_select_topic_refresh(self, idx):
        data = self.generated.get(idx, {})
        for key, widget in self.fields.items():
            widget.delete("1.0", "end")
            widget.insert("1.0", data.get(key, ""))

    # -------------------------------------------------------------- التصدير
    def _export(self):
        if not self.topics_flat:
            messagebox.showinfo("تنبيه", "لم يتم تحميل أي محضر قسم بعد.")
            return
        template_path = self.template_var.get().strip()
        if not template_path or not os.path.exists(template_path):
            messagebox.showwarning("تنبيه", "الرجاء تحديد ملف النموذج (القالب) من تبويب الإعدادات.")
            return
        self._save_current_fields()

        topics_payload = []
        for idx, (dept_idx, topic) in enumerate(self.topics_flat):
            data = self.generated.get(idx)
            if not data:
                data = {
                    "title": topic.title,
                    "rationale": topic.rationale,
                    "decision": topic.decision,
                    "document_ref": topic.document_ref,
                    "attachments": topic.attachments,
                    "action_required": "",
                }
            topics_payload.append(data)

        try:
            start_number = int(self.meta_vars["رقم أول موضوع"].get().strip() or "1")
        except ValueError:
            start_number = 1

        session_meta = {
            "session_number": self.meta_vars["رقم الجلسة"].get().strip(),
            "day": self.meta_vars["اليوم"].get().strip(),
            "date": self.meta_vars["التاريخ"].get().strip(),
            "place": self.meta_vars["المكان"].get().strip(),
            "time": self.meta_vars["الوقت"].get().strip(),
        }

        out_path = filedialog.asksaveasfilename(
            title="حفظ محضر مجلس الكلية الجديد",
            defaultextension=".docx",
            filetypes=[("Word", "*.docx")],
        )
        if not out_path:
            return
        try:
            build_minutes_document(template_path, out_path, session_meta, topics_payload, start_number)
        except Exception as e:
            messagebox.showerror("خطأ في التصدير", str(e))
            return
        self.status_var.set(f"تم التصدير بنجاح إلى: {out_path}")
        messagebox.showinfo("تم", f"تم إنشاء المحضر بنجاح:\n{out_path}")

    # =============================================================
    # تبويب: إنشاء موضوع جديد لمحضر القسم (للأقسام العلمية مباشرة)
    # =============================================================
    def _build_dept_mode_tab(self):
        f = self.dept_mode_tab

        add_frame = ttk.LabelFrame(f, text="إضافة موضوع جديد")
        add_frame.pack(fill="x", padx=10, pady=8)

        ttk.Label(add_frame, text="عنوان الموضوع:", font=FONT).grid(row=0, column=1, sticky="e", padx=6, pady=4)
        self.new_topic_title_var = tk.StringVar()
        ttk.Entry(add_frame, textvariable=self.new_topic_title_var, font=FONT, width=70, justify="right").grid(
            row=0, column=0, sticky="ew", padx=6, pady=4)

        ttk.Label(add_frame, text="تفاصيل الموضوع (اختياري):", font=FONT).grid(row=1, column=1, sticky="ne", padx=6, pady=4)
        self.new_topic_details_text = tk.Text(add_frame, font=FONT, height=4, wrap="word")
        self.new_topic_details_text.grid(row=1, column=0, sticky="ew", padx=6, pady=4)
        add_frame.columnconfigure(0, weight=1)

        ttk.Button(add_frame, text="إضافة إلى قائمة المواضيع", command=self._add_new_topic).grid(
            row=2, column=0, columnspan=2, pady=6)

        meta = ttk.LabelFrame(f, text="بيانات جلسة محضر القسم الجديد")
        meta.pack(fill="x", padx=10, pady=8)
        labels = ["رقم الجلسة", "اليوم", "التاريخ", "المكان", "الوقت", "رقم أول موضوع"]
        self.dept_mode_meta_vars = {}
        for i, lbl in enumerate(labels):
            ttk.Label(meta, text=lbl + ":", font=FONT).grid(row=i // 3, column=(i % 3) * 2 + 1, sticky="e", padx=6, pady=4)
            var = tk.StringVar(value="1" if lbl == "رقم أول موضوع" else "")
            ttk.Entry(meta, textvariable=var, font=FONT, width=18, justify="right").grid(
                row=i // 3, column=(i % 3) * 2, sticky="w", padx=6, pady=4)
            self.dept_mode_meta_vars[lbl] = var

        mid = ttk.Frame(f)
        mid.pack(fill="both", expand=True, padx=10, pady=8)

        left = ttk.Frame(mid)
        left.pack(side="right", fill="y")
        ttk.Label(left, text="قائمة المواضيع الجديدة", font=FONT_BOLD).pack(anchor="e")
        self.dept_mode_topics_list = tk.Listbox(left, font=FONT, width=45, height=16, exportselection=False)
        self.dept_mode_topics_list.pack(fill="y", expand=True, pady=4)
        self.dept_mode_topics_list.bind("<<ListboxSelect>>", self._on_select_dept_mode_topic)

        btns = ttk.Frame(left)
        btns.pack(fill="x", pady=4)
        ttk.Button(btns, text="إزالة المحدد", command=self._remove_new_topic).pack(fill="x", pady=2)
        ttk.Button(btns, text="توليد الموضوع المحدد", command=self._generate_dept_mode_selected).pack(fill="x", pady=2)
        ttk.Button(btns, text="توليد جميع المواضيع", command=self._generate_dept_mode_all).pack(fill="x", pady=2)

        right = ttk.Frame(mid)
        right.pack(side="right", fill="both", expand=True, padx=10)

        ttk.Label(right, text="السوابق المشابهة الموجودة في الأرشيف لهذا الموضوع:", font=FONT_BOLD).pack(anchor="e", pady=(0, 2))
        self.dept_mode_precedents_preview = tk.Text(right, font=FONT, height=4, wrap="word", foreground="#555")
        self.dept_mode_precedents_preview.pack(fill="x")
        self.dept_mode_precedents_preview.configure(state="disabled")

        self.dept_mode_fields = {}
        field_labels = [
            ("title", "عنوان الموضوع"),
            ("rationale", "حيثيات الموضوع"),
            ("decision", "التوصية / القرار"),
            ("document_ref", "المستند"),
            ("attachments", "المرفقات"),
            ("action_required", "الإجراء المطلوب"),
        ]
        for key, label in field_labels:
            ttk.Label(right, text=label + ":", font=FONT_BOLD).pack(anchor="e", pady=(6, 0))
            height = 6 if key == "rationale" else 2
            txt = tk.Text(right, font=FONT, height=height, wrap="word")
            txt.pack(fill="x")
            self.dept_mode_fields[key] = txt

        bottom = ttk.Frame(f)
        bottom.pack(fill="x", padx=10, pady=10)
        self.dept_mode_status_var = tk.StringVar(value="جاهز.")
        ttk.Label(bottom, textvariable=self.dept_mode_status_var, font=FONT, foreground="blue").pack(side="right")
        ttk.Button(bottom, text="تصدير محضر Word", command=self._export_dept_mode).pack(side="left")

    def _add_new_topic(self):
        title = self.new_topic_title_var.get().strip()
        if not title:
            messagebox.showwarning("تنبيه", "الرجاء كتابة عنوان الموضوع أولًا.")
            return
        details = self.new_topic_details_text.get("1.0", "end").strip()
        topic = Topic(number=f"{len(self.dept_mode_topics) + 1:02d}", title=title, rationale=details)
        self.dept_mode_topics.append(topic)

        dept_archive_folder = self.dept_archive_var.get().strip()
        self.dept_mode_archive_topics = build_archive(dept_archive_folder)
        self.dept_mode_matcher = TopicMatcher(self.dept_mode_archive_topics) if self.dept_mode_archive_topics else None

        self.new_topic_title_var.set("")
        self.new_topic_details_text.delete("1.0", "end")
        self._refresh_dept_mode_topics_display()
        self.dept_mode_status_var.set(
            f"{len(self.dept_mode_topics)} موضوع/مواضيع في القائمة. "
            f"({len(self.dept_mode_archive_topics)} موضوع سابق في أرشيف القسم)"
        )

    def _remove_new_topic(self):
        sel = self.dept_mode_topics_list.curselection()
        if not sel:
            messagebox.showinfo("تنبيه", "اختر موضوعًا من القائمة لإزالته.")
            return
        del self.dept_mode_topics[sel[0]]
        self._refresh_dept_mode_topics_display()

    def _refresh_dept_mode_topics_display(self):
        self.dept_mode_topics_list.delete(0, "end")
        self.dept_mode_generated = {}
        self._dept_mode_current_index = None
        for widget in self.dept_mode_fields.values():
            widget.delete("1.0", "end")
        for t in self.dept_mode_topics:
            self.dept_mode_topics_list.insert("end", f"{t.number} - {t.title}")

    def _on_select_dept_mode_topic(self, _event=None):
        sel = self.dept_mode_topics_list.curselection()
        if not sel:
            return
        idx = sel[0]
        self._dept_mode_current_index = idx
        topic = self.dept_mode_topics[idx]
        data = self.dept_mode_generated.get(idx, {
            "title": topic.title,
            "rationale": topic.rationale,
            "decision": "",
            "document_ref": "",
            "attachments": "",
            "action_required": "",
        })
        for key, widget in self.dept_mode_fields.items():
            widget.delete("1.0", "end")
            widget.insert("1.0", data.get(key, ""))
        self._update_precedents_preview(self.dept_mode_precedents_preview, self.dept_mode_matcher, topic.title, topic.rationale)

    def _on_select_dept_mode_topic_refresh(self, idx):
        data = self.dept_mode_generated.get(idx, {})
        for key, widget in self.dept_mode_fields.items():
            widget.delete("1.0", "end")
            widget.insert("1.0", data.get(key, ""))

    def _save_current_dept_mode_fields(self):
        if self._dept_mode_current_index is None:
            return
        data = {key: widget.get("1.0", "end").strip() for key, widget in self.dept_mode_fields.items()}
        self.dept_mode_generated[self._dept_mode_current_index] = data

    def _generate_dept_mode_selected(self):
        sel = self.dept_mode_topics_list.curselection()
        if not sel:
            messagebox.showinfo("تنبيه", "الرجاء اختيار موضوع من القائمة أولًا.")
            return
        self._save_current_dept_mode_fields()
        self._run_dept_mode_generation([sel[0]])

    def _generate_dept_mode_all(self):
        if not self.dept_mode_topics:
            messagebox.showinfo("تنبيه", "لم تُضِف أي موضوع بعد.")
            return
        self._save_current_dept_mode_fields()
        self._run_dept_mode_generation(list(range(len(self.dept_mode_topics))))

    def _run_dept_mode_generation(self, indices):
        model = self.model_var.get().strip()
        if not model:
            messagebox.showwarning("تنبيه", "الرجاء اختيار نموذج من تبويب الإعدادات أولًا.")
            return
        engine = self._current_engine(model)

        self.dept_mode_status_var.set(f"جارٍ توليد {len(indices)} موضوع/مواضيع...")

        def worker():
            for n, idx in enumerate(indices, start=1):
                topic = self.dept_mode_topics[idx]
                precedents = []
                if self.dept_mode_matcher:
                    precedents = self.dept_mode_matcher.find_similar(topic.title, topic.rationale, top_k=3)
                try:
                    data = draft_new_topic(engine, topic.title, topic.rationale, precedents)
                    data["title"] = topic.title
                    self._queue.put(("dept_mode", "ok", idx, data, n, len(indices)))
                except OllamaError as e:
                    self._queue.put(("dept_mode", "error", idx, str(e), n, len(indices)))

        threading.Thread(target=worker, daemon=True).start()

    def _export_dept_mode(self):
        if not self.dept_mode_topics:
            messagebox.showinfo("تنبيه", "لم تُضِف أي موضوع بعد.")
            return
        template_path = self.dept_template_var.get().strip()
        if not template_path or not os.path.exists(template_path):
            messagebox.showwarning("تنبيه", "الرجاء تحديد ملف نموذج محضر القسم من تبويب الإعدادات.")
            return
        self._save_current_dept_mode_fields()

        topics_payload = []
        for idx, topic in enumerate(self.dept_mode_topics):
            data = self.dept_mode_generated.get(idx)
            if not data:
                data = {
                    "title": topic.title,
                    "rationale": topic.rationale,
                    "decision": "",
                    "document_ref": "",
                    "attachments": "",
                    "action_required": "",
                }
            topics_payload.append(data)

        try:
            start_number = int(self.dept_mode_meta_vars["رقم أول موضوع"].get().strip() or "1")
        except ValueError:
            start_number = 1

        session_meta = {
            "session_number": self.dept_mode_meta_vars["رقم الجلسة"].get().strip(),
            "day": self.dept_mode_meta_vars["اليوم"].get().strip(),
            "date": self.dept_mode_meta_vars["التاريخ"].get().strip(),
            "place": self.dept_mode_meta_vars["المكان"].get().strip(),
            "time": self.dept_mode_meta_vars["الوقت"].get().strip(),
        }

        out_path = filedialog.asksaveasfilename(
            title="حفظ محضر مجلس القسم الجديد",
            defaultextension=".docx",
            filetypes=[("Word", "*.docx")],
        )
        if not out_path:
            return
        try:
            build_minutes_document(template_path, out_path, session_meta, topics_payload, start_number)
        except Exception as e:
            messagebox.showerror("خطأ في التصدير", str(e))
            return
        self.dept_mode_status_var.set(f"تم التصدير بنجاح إلى: {out_path}")
        messagebox.showinfo("تم", f"تم إنشاء المحضر بنجاح:\n{out_path}")


def main():
    root = tk.Tk()
    MinutesApp(root)
    root.mainloop()


if __name__ == "__main__":
    main()
