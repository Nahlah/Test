/* عناصر الواجهة المشتركة: إنشاء العناصر، النوافذ المنبثقة، اختيار الملفات والمجلدات وحفظها. */
"use strict";

const UI = (() => {
  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v === null || v === undefined || v === false) continue;
        if (k === "class") el.className = v;
        else if (k === "text") el.textContent = v;
        else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
        else if (k === "value") el.value = v;
        else if (v === true) el.setAttribute(k, "");
        else el.setAttribute(k, v);
      }
    }
    for (const c of children.flat()) {
      if (c === null || c === undefined || c === false) continue;
      el.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    }
    return el;
  }

  // ---------------------------------------------------------------- modal dialogs
  const stack = [];
  function modal({ title, body, buttons = [], wide = false, onClose = null }) {
    const backdrop = h("div", { class: "modal-backdrop" });
    const box = h("div", { class: "modal" + (wide ? " wide" : ""), role: "dialog", "aria-modal": "true" });
    const head = h("div", { class: "modal-head" }, h("h2", { text: title || "" }));
    const closeBtn = h("button", { class: "modal-x", type: "button", "aria-label": "إغلاق", text: "×" });
    head.appendChild(closeBtn);
    const content = h("div", { class: "modal-body" });
    if (body) content.appendChild(body);
    const foot = h("div", { class: "modal-foot" });
    box.append(head, content, foot);
    backdrop.appendChild(box);
    let closed = false;
    const ctl = {
      el: box,
      body: content,
      close(result) {
        if (closed) return;
        closed = true;
        backdrop.remove();
        const i = stack.indexOf(ctl);
        if (i >= 0) stack.splice(i, 1);
        document.removeEventListener("keydown", onKey, true);
        if (onClose) onClose(result);
      },
    };
    for (const b of buttons) {
      const btn = h("button", { type: "button", class: b.primary ? "primary" : (b.danger ? "danger" : ""), text: b.label });
      btn.addEventListener("click", async () => {
        if (b.onClick) {
          const r = await b.onClick(ctl);
          if (r === false) return;
        }
        if (b.close !== false) ctl.close(b.value);
      });
      foot.appendChild(btn);
    }
    closeBtn.addEventListener("click", () => ctl.close(undefined));
    const onKey = (e) => {
      if (e.key === "Escape" && stack[stack.length - 1] === ctl) {
        e.preventDefault();
        ctl.close(undefined);
      }
    };
    document.addEventListener("keydown", onKey, true);
    document.body.appendChild(backdrop);
    stack.push(ctl);
    const first = box.querySelector("input, textarea, select, .listbox");
    if (first) setTimeout(() => first.focus(), 30);
    return ctl;
  }

  function message(kind, title, text) {
    return new Promise((resolve) => {
      const body = h("div", { class: "msg msg-" + kind }, h("div", { class: "msg-text", text }));
      modal({ title, body, buttons: [{ label: "حسنًا", primary: true }], onClose: () => resolve() });
    });
  }
  const info = (t, m) => message("info", t, m);
  const warn = (t, m) => message("warn", t, m);
  const error = (t, m) => message("error", t, m);
  function confirm(title, text) {
    return new Promise((resolve) => {
      const body = h("div", { class: "msg msg-warn" }, h("div", { class: "msg-text", text }));
      modal({
        title, body,
        buttons: [{ label: "نعم", primary: true, value: true }, { label: "لا", value: false }],
        onClose: (v) => resolve(v === true),
      });
    });
  }
  function textPopup(title, header, text) {
    const body = h("div", { class: "popup-text" },
      header ? h("div", { class: "popup-header", text: header }) : null,
      h("textarea", { class: "readonly", readonly: true, dir: "rtl", rows: 22 }));
    body.querySelector("textarea").value = text;
    return modal({ title, body, wide: true, buttons: [{ label: "إغلاق" }] });
  }

  // ---------------------------------------------------------------- busy overlay
  let busyEl = null;
  function busy(text) {
    if (!busyEl) {
      busyEl = h("div", { class: "busy" }, h("div", { class: "busy-box" }, h("div", { class: "spinner" }), h("div", { class: "busy-text" })));
      document.body.appendChild(busyEl);
    }
    busyEl.querySelector(".busy-text").textContent = text || "جارٍ العمل...";
    busyEl.style.display = "flex";
  }
  function idle() {
    if (busyEl) busyEl.style.display = "none";
  }
  const nextFrame = () => new Promise((r) => setTimeout(r, 0));

  // ---------------------------------------------------------------- listbox
  // A simple accessible single-selection list (replaces Tk Listbox).
  function listbox({ onActivate = null, onSelect = null, height = 18 } = {}) {
    const el = h("div", { class: "listbox", role: "listbox", tabindex: "0", style: `max-height:${height * 2.1}em` });
    let items = [];
    let sel = -1;
    const render = () => {
      el.innerHTML = "";
      items.forEach((it, i) => {
        const opt = h("div", { class: "opt" + (i === sel ? " sel" : ""), role: "option", "aria-selected": i === sel ? "true" : "false", text: it.label });
        opt.addEventListener("click", () => { sel = i; render(); if (onSelect) onSelect(i); });
        opt.addEventListener("dblclick", () => { sel = i; render(); if (onActivate) onActivate(i); });
        el.appendChild(opt);
      });
      if (!items.length) el.appendChild(h("div", { class: "opt empty", text: "لا توجد نتائج." }));
    };
    el.addEventListener("keydown", (e) => {
      if (!items.length) return;
      if (e.key === "ArrowDown") { sel = Math.min(items.length - 1, sel + 1); render(); e.preventDefault(); if (onSelect) onSelect(sel); }
      else if (e.key === "ArrowUp") { sel = Math.max(0, sel - 1); render(); e.preventDefault(); if (onSelect) onSelect(sel); }
      else if (e.key === "Enter" && sel >= 0 && onActivate) { onActivate(sel); e.preventDefault(); }
      const cur = el.querySelector(".sel");
      if (cur) cur.scrollIntoView({ block: "nearest" });
    });
    return {
      el,
      set(list, keepSelection = false) {
        items = list;
        if (!keepSelection) sel = -1;
        if (sel >= items.length) sel = -1;
        render();
      },
      select(i) { sel = i; render(); },
      selected() { return sel; },
    };
  }

  // ---------------------------------------------------------------- files
  async function readFile(file, relPath) {
    const buf = await file.arrayBuffer();
    return { name: file.name, path: relPath || file.name, bytes: new Uint8Array(buf), size: file.size };
  }

  function pickFile(accept) {
    return new Promise((resolve) => {
      const input = h("input", { type: "file", accept, style: "display:none" });
      input.addEventListener("change", async () => {
        const f = input.files && input.files[0];
        if (!f) { input.remove(); resolve(null); return; }
        try {
          resolve(await readFile(f));
        } catch (e) {
          resolve(null);
          error("تعذر قراءة الملف", String(e && e.message || e));
        } finally {
          input.remove();
        }
      });
      input.addEventListener("cancel", () => { input.remove(); resolve(null); });
      document.body.appendChild(input);
      input.click();
    });
  }

  const ARCHIVE_EXTS = [".docx", ".pdf", ".txt"];
  const wanted = (name) => ARCHIVE_EXTS.some((e) => name.toLowerCase().endsWith(e));

  async function readDirectoryHandle(handle, onProgress) {
    const out = [];
    const walk = async (dir, prefix) => {
      for await (const [name, entry] of dir.entries()) {
        if (entry.kind === "directory") await walk(entry, prefix + name + "/");
        else if (wanted(name)) {
          const f = await entry.getFile();
          out.push(await readFile(f, prefix + name));
          if (onProgress) onProgress(out.length);
        }
      }
    };
    await walk(handle, "");
    return out;
  }

  function supportsDirectoryHandles() {
    return typeof window.showDirectoryPicker === "function";
  }

  // Returns {name, files, handle} or null.
  async function pickFolder(onProgress) {
    if (supportsDirectoryHandles()) {
      let handle;
      try {
        handle = await window.showDirectoryPicker({ mode: "read" });
      } catch (e) {
        if (e && e.name === "AbortError") return null;
        handle = null;
      }
      if (handle) {
        busy("جارٍ قراءة ملفات المجلد...");
        try {
          const files = await readDirectoryHandle(handle, (n) => busy(`جارٍ قراءة ملفات المجلد... (${n})`));
          return { name: handle.name, files, handle };
        } finally {
          idle();
        }
      }
    }
    return new Promise((resolve) => {
      const input = h("input", { type: "file", multiple: true, style: "display:none" });
      input.setAttribute("webkitdirectory", "");
      input.setAttribute("directory", "");
      input.addEventListener("change", async () => {
        const list = Array.from(input.files || []);
        if (!list.length) { input.remove(); resolve(null); return; }
        busy("جارٍ قراءة ملفات المجلد...");
        try {
          const root = (list[0].webkitRelativePath || "").split("/")[0] || "";
          const files = [];
          for (const f of list) {
            const rel = (f.webkitRelativePath || f.name).split("/").slice(1).join("/") || f.name;
            if (!wanted(f.name)) continue;
            files.push(await readFile(f, rel));
            busy(`جارٍ قراءة ملفات المجلد... (${files.length})`);
          }
          resolve({ name: root, files, handle: null });
        } catch (e) {
          resolve(null);
          error("تعذر قراءة المجلد", String(e && e.message || e));
        } finally {
          idle();
          input.remove();
        }
      });
      input.addEventListener("cancel", () => { input.remove(); resolve(null); });
      document.body.appendChild(input);
      input.click();
    });
  }

  async function rereadHandle(handle) {
    if (!handle || typeof handle.queryPermission !== "function") return null;
    let perm = await handle.queryPermission({ mode: "read" });
    if (perm !== "granted") perm = await handle.requestPermission({ mode: "read" });
    if (perm !== "granted") return null;
    busy("جارٍ قراءة ملفات المجلد...");
    try {
      const files = await readDirectoryHandle(handle, (n) => busy(`جارٍ قراءة ملفات المجلد... (${n})`));
      return { name: handle.name, files, handle };
    } finally {
      idle();
    }
  }

  const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  async function saveBytes(bytes, suggestedName) {
    if (typeof window.showSaveFilePicker === "function") {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName,
          types: [{ description: "Word", accept: { [DOCX_MIME]: [".docx"] } }],
        });
        const w = await handle.createWritable();
        await w.write(new Blob([bytes], { type: DOCX_MIME }));
        await w.close();
        return handle.name;
      } catch (e) {
        if (e && e.name === "AbortError") return null;
        // نكمل بالتنزيل العادي
      }
    }
    const url = URL.createObjectURL(new Blob([bytes], { type: DOCX_MIME }));
    const a = h("a", { href: url, download: suggestedName, style: "display:none" });
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 4000);
    return suggestedName;
  }

  function downloadText(text, name) {
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    const a = h("a", { href: url, download: name, style: "display:none" });
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 4000);
  }

  return {
    h, modal, info, warn, error, confirm, textPopup, busy, idle, nextFrame, listbox,
    pickFile, pickFolder, rereadHandle, supportsDirectoryHandles, saveBytes, downloadText,
  };
})();
