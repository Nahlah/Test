#!/usr/bin/env python3
"""
أداة كتابة محاضر مجلس الكلية (أوف لاين بالكامل)
=================================================
تعمل محليًا على جهازك دون اتصال بالإنترنت، وتستخدم نموذج ذكاء اصطناعي محلي عبر Ollama
لصياغة نصوص كل موضوع اعتمادًا على محضر مجلس القسم، مع الرجوع لأرشيف محاضر مجلس الكلية
السابقة لإيجاد مواضيع مشابهة يُستأنس بصياغتها ومستنداتها.
"""
import os
import queue
import threading
import tkinter as tk
from tkinter import ttk, filedialog, messagebox

from core.config import load_config, save_config
from core.minutes_parser import parse_minutes_file
from core.archive import build_archive
from core.similarity import TopicMatcher
from core.ollama_client import list_models, OllamaError
from core.draft import draft_topic, session_ordinal
from core.docx_builder import build_minutes_document

FONT = ("Tahoma", 11)
FONT_BOLD = ("Tahoma", 11, "bold")


class MinutesApp:
    def __init__(self, root):
        self.root = root
        root.title("أداة كتابة محاضر مجلس الكلية")
        root.geometry("1000x700")

        self.cfg = load_config()
        self.dept_minutes = None
        self.archive_topics = []
        self.matcher = None
        self.generated = {}  # index -> dict with fields
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
        self.notebook.add(self.settings_tab, text="الإعدادات")
        self.notebook.add(self.build_tab, text="إنشاء محضر جديد")

        self._build_settings_tab()
        self._build_main_tab()
        self.root.after(200, self._poll_queue)

    # ---------------------------------------------------------------- إعدادات
    def _build_settings_tab(self):
        f = self.settings_tab
        pad = {"padx": 10, "pady": 6}

        ttk.Label(f, text="خادم Ollama المحلي (Host):", font=FONT).grid(row=0, column=1, sticky="e", **pad)
        self.host_var = tk.StringVar(value=self.cfg.get("ollama_host", "http://localhost:11434"))
        ttk.Entry(f, textvariable=self.host_var, font=FONT, width=40, justify="right").grid(row=0, column=0, **pad)

        ttk.Label(f, text="النموذج المحلي (Model):", font=FONT).grid(row=1, column=1, sticky="e", **pad)
        self.model_var = tk.StringVar(value=self.cfg.get("ollama_model", ""))
        self.model_combo = ttk.Combobox(f, textvariable=self.model_var, font=FONT, width=37, justify="right")
        self.model_combo.grid(row=1, column=0, **pad)
        ttk.Button(f, text="تحديث قائمة النماذج", command=self._refresh_models).grid(row=1, column=2, **pad)

        ttk.Label(f, text="مجلد أرشيف محاضر مجلس الكلية السابقة:", font=FONT).grid(row=2, column=1, sticky="e", **pad)
        self.archive_var = tk.StringVar(value=self.cfg.get("archive_folder", ""))
        ttk.Entry(f, textvariable=self.archive_var, font=FONT, width=40, justify="right").grid(row=2, column=0, **pad)
        ttk.Button(f, text="استعراض...", command=self._browse_archive).grid(row=2, column=2, **pad)

        ttk.Label(f, text="ملف النموذج (القالب) لمحضر مجلس الكلية:", font=FONT).grid(row=3, column=1, sticky="e", **pad)
        self.template_var = tk.StringVar(value=self.cfg.get("template_path", ""))
        ttk.Entry(f, textvariable=self.template_var, font=FONT, width=40, justify="right").grid(row=3, column=0, **pad)
        ttk.Button(f, text="استعراض...", command=self._browse_template).grid(row=3, column=2, **pad)

        ttk.Button(f, text="حفظ الإعدادات", command=self._save_settings).grid(row=4, column=0, columnspan=3, pady=16)

        self.settings_status = ttk.Label(f, text="", font=FONT, foreground="green")
        self.settings_status.grid(row=5, column=0, columnspan=3)

        note = (
            "ملاحظات:\n"
            "- يجب تشغيل Ollama محليًا (ollama serve) وتثبيت نموذج يدعم العربية جيدًا،\n"
            "  مثل: ollama pull qwen2.5:7b-instruct  أو  ollama pull aya-expanse\n"
            "- الأداة لا تتصل بالإنترنت أثناء العمل؛ كل المعالجة تتم على جهازك.\n"
            "- عدد أعضاء مجلس الكلية في المخرج النهائي يطابق ما هو موجود في ملف القالب.\n"
            "  إن تغيّر تشكيل الأعضاء، عدّل القالب نفسه أولًا."
        )
        ttk.Label(f, text=note, font=FONT, justify="right", foreground="#555").grid(
            row=6, column=0, columnspan=3, sticky="e", padx=10, pady=20)

    def _browse_archive(self):
        path = filedialog.askdirectory(title="اختر مجلد أرشيف محاضر مجلس الكلية")
        if path:
            self.archive_var.set(path)

    def _browse_template(self):
        path = filedialog.askopenfilename(title="اختر ملف النموذج", filetypes=[("Word", "*.docx")])
        if path:
            self.template_var.set(path)

    def _refresh_models(self):
        try:
            models = list_models(self.host_var.get())
        except OllamaError as e:
            messagebox.showerror("خطأ", str(e))
            return
        self.model_combo["values"] = models
        if models and not self.model_var.get():
            self.model_var.set(models[0])
        self.settings_status.config(text=f"تم العثور على {len(models)} نموذج/نماذج.")

    def _save_settings(self):
        self.cfg.update({
            "ollama_host": self.host_var.get().strip(),
            "ollama_model": self.model_var.get().strip(),
            "archive_folder": self.archive_var.get().strip(),
            "template_path": self.template_var.get().strip(),
        })
        save_config(self.cfg)
        self.settings_status.config(text="تم حفظ الإعدادات.")

    # ------------------------------------------------------------ التبويب الرئيسي
    def _build_main_tab(self):
        f = self.build_tab
        top = ttk.Frame(f)
        top.pack(fill="x", padx=10, pady=8)

        ttk.Label(top, text="محضر مجلس القسم:", font=FONT).pack(side="right", padx=6)
        self.dept_path_var = tk.StringVar()
        ttk.Entry(top, textvariable=self.dept_path_var, font=FONT, width=55, justify="right").pack(side="right", padx=6)
        ttk.Button(top, text="استعراض...", command=self._browse_dept).pack(side="right", padx=6)
        ttk.Button(top, text="تحميل وتحليل", command=self._load_dept).pack(side="right", padx=6)

        info = ttk.Frame(f)
        info.pack(fill="x", padx=10, pady=4)
        self.dept_info_label = ttk.Label(info, text="لم يتم تحميل أي محضر قسم بعد.", font=FONT, justify="right")
        self.dept_info_label.pack(side="right")

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
        ttk.Label(left, text="مواضيع محضر القسم", font=FONT_BOLD).pack(anchor="e")
        self.topics_list = tk.Listbox(left, font=FONT, width=45, height=20, exportselection=False)
        self.topics_list.pack(fill="y", expand=True, pady=4)
        self.topics_list.bind("<<ListboxSelect>>", self._on_select_topic)

        btns = ttk.Frame(left)
        btns.pack(fill="x", pady=4)
        ttk.Button(btns, text="توليد الموضوع المحدد", command=self._generate_selected).pack(fill="x", pady=2)
        ttk.Button(btns, text="توليد جميع المواضيع", command=self._generate_all).pack(fill="x", pady=2)

        right = ttk.Frame(mid)
        right.pack(side="right", fill="both", expand=True, padx=10)

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

    def _browse_dept(self):
        path = filedialog.askopenfilename(
            title="اختر محضر مجلس القسم",
            filetypes=[("مستندات مدعومة", "*.docx *.pdf *.txt"), ("الكل", "*.*")],
        )
        if path:
            self.dept_path_var.set(path)

    def _load_dept(self):
        path = self.dept_path_var.get().strip()
        if not path or not os.path.exists(path):
            messagebox.showwarning("تنبيه", "الرجاء اختيار ملف محضر مجلس القسم أولًا.")
            return
        try:
            self.dept_minutes = parse_minutes_file(path)
        except Exception as e:
            messagebox.showerror("خطأ في التحليل", f"تعذّر تحليل ملف محضر القسم:\n{e}")
            return
        if not self.dept_minutes.topics:
            messagebox.showwarning("تنبيه", "لم يتم العثور على أي مواضيع في هذا الملف. تأكد من أنه يطابق بنية النموذج المتوقعة.")

        s = self.dept_minutes.session
        self.dept_info_label.config(
            text=f"{s.council_name}\nالجلسة {s.session_number} | {s.day} {s.date} | {s.place} {s.time}"
        )
        self.topics_list.delete(0, "end")
        self.generated = {}
        for t in self.dept_minutes.topics:
            self.topics_list.insert("end", f"{t.number} - {t.title}")

        archive_folder = self.archive_var.get().strip()
        self.archive_topics = build_archive(archive_folder)
        self.matcher = TopicMatcher(self.archive_topics) if self.archive_topics else None
        self.status_var.set(
            f"تم تحميل {len(self.dept_minutes.topics)} موضوعًا. "
            f"({len(self.archive_topics)} موضوع سابق في الأرشيف)"
        )

    def _on_select_topic(self, _event=None):
        sel = self.topics_list.curselection()
        if not sel:
            return
        idx = sel[0]
        self._current_index = idx
        dept_topic = self.dept_minutes.topics[idx]
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
        if not self.dept_minutes or not self.dept_minutes.topics:
            messagebox.showinfo("تنبيه", "لم يتم تحميل محضر مجلس قسم بعد.")
            return
        self._save_current_fields()
        self._run_generation(list(range(len(self.dept_minutes.topics))))

    def _run_generation(self, indices):
        host = self.host_var.get().strip()
        model = self.model_var.get().strip()
        if not model:
            messagebox.showwarning("تنبيه", "الرجاء اختيار نموذج Ollama من تبويب الإعدادات أولًا.")
            return
        dept_name = self.dept_minutes.session.council_name
        dept_session_number = self.dept_minutes.session.session_number
        dept_session_date = self.dept_minutes.session.date

        self.status_var.set(f"جارٍ توليد {len(indices)} موضوع/مواضيع...")

        def worker():
            for n, idx in enumerate(indices, start=1):
                topic = self.dept_minutes.topics[idx]
                precedents = []
                if self.matcher:
                    precedents = self.matcher.find_similar(topic.title, topic.rationale, top_k=3)
                try:
                    data = draft_topic(host, model, topic, dept_name, dept_session_number,
                                        dept_session_date, precedents)
                    data["title"] = topic.title
                    self._queue.put(("ok", idx, data, n, len(indices)))
                except OllamaError as e:
                    self._queue.put(("error", idx, str(e), n, len(indices)))

        threading.Thread(target=worker, daemon=True).start()

    def _poll_queue(self):
        try:
            while True:
                kind, idx, payload, n, total = self._queue.get_nowait()
                if kind == "ok":
                    self.generated[idx] = payload
                    if self._current_index == idx:
                        self._on_select_topic_refresh(idx)
                    self.status_var.set(f"تم توليد الموضوع {n} من {total}.")
                else:
                    self.status_var.set(f"خطأ في الموضوع {n} من {total}: {payload}")
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
        if not self.dept_minutes or not self.dept_minutes.topics:
            messagebox.showinfo("تنبيه", "لم يتم تحميل محضر مجلس قسم بعد.")
            return
        template_path = self.template_var.get().strip()
        if not template_path or not os.path.exists(template_path):
            messagebox.showwarning("تنبيه", "الرجاء تحديد ملف النموذج (القالب) من تبويب الإعدادات.")
            return
        self._save_current_fields()

        topics_payload = []
        for idx, topic in enumerate(self.dept_minutes.topics):
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


def main():
    root = tk.Tk()
    MinutesApp(root)
    root.mainloop()


if __name__ == "__main__":
    main()
