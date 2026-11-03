/* بناء محضر مجلس الكلية ومحضر مجلس القسم بتعبئة قالب Word الأصلي —
 * منقول من core/docx_builder.py و core/department_docx_builder.py.
 */
"use strict";

const DocxBuilder = (() => {
  const { strip } = PY;
  const X = OOXML;
  const { normalize_ar } = Similarity;

  const LABEL_RATIONALE = X.norm("حيثيات الموضوع");
  const LABEL_RATIONALE_ALT = X.norm("حيثيات/الموضوع");
  const LABEL_DECISION = X.norm("التوصية / القرار");
  const LABEL_DOCUMENT = X.norm("المستند");
  const LABEL_ATTACH = X.norm("المرفقات");
  const LABEL_ACTION = X.norm("الإجراء المطلوب");
  const LABEL_SESSION_NO = X.norm("رقم الجلسة");
  const LABEL_SIGNATURE = X.norm("التوقيع");

  const WORD_FORMAT = { font: "Frutiger LT Arabic", halfPoints: 22, color: "002060" };

  const docTables = (pkg) => X.wChildren(pkg.body, "tbl");

  function _is_topic_block_table(tbl) {
    const rows = X.tableRows(tbl);
    if (!rows.length) return false;
    const texts = X.rowTexts(rows[0]);
    return texts.length > 0 && X.norm(texts[0]).startsWith("الموضوع");
  }

  function _is_signature_table(tbl) {
    for (const tr of X.tableRows(tbl).slice(0, 3)) {
      if (X.rowTexts(tr).some((t) => X.norm(t) === LABEL_SIGNATURE)) return true;
    }
    return false;
  }

  function _find_topic_block_tables(pkg) {
    return docTables(pkg).filter(_is_topic_block_table);
  }

  function _find_signature_table(pkg) {
    return docTables(pkg).find(_is_signature_table) || null;
  }

  function cloneBlocks(blocks, needed, anchor, noBlocksMsg, noSigMsg) {
    if (!blocks.length) throw new Error(noBlocksMsg);
    if (anchor === null) throw new Error(noSigMsg);
    if (blocks.length > needed) {
      for (const extra of blocks.slice(needed)) extra.parentNode.removeChild(extra);
      return blocks.slice(0, needed);
    }
    if (blocks.length < needed) {
      const template = blocks[blocks.length - 1];
      const out = blocks.slice();
      for (let i = 0; i < needed - blocks.length; i++) {
        const el = template.cloneNode(true);
        anchor.parentNode.insertBefore(el, anchor);
        const spacer = X.newW(el.ownerDocument, "p");
        el.parentNode.insertBefore(spacer, el.nextSibling);
        out.push(el);
      }
      return out;
    }
    return blocks;
  }

  function ensure_topic_block_count(pkg, needed) {
    return cloneBlocks(
      _find_topic_block_tables(pkg), needed, _find_signature_table(pkg),
      "لم يتم العثور على أي كتلة 'الموضوع' في ملف القالب.",
      "لم يتم العثور على جدول توقيع الأعضاء في ملف القالب.",
    );
  }

  function _append_data_tables(pkg, tc, data_tables) {
    for (const matrix of data_tables || []) {
      const rows = (matrix || []).filter((row) => row && row.length && row.some((c) => strip(c ? String(c) : ""))).map((r) => Array.from(r));
      if (!rows.length) continue;
      const cols = Math.max(...rows.map((r) => r.length));
      if (cols <= 0) continue;
      const tbl = X.cellAddTable(tc, rows.length, cols);
      try { X.setTableStyleByName(pkg, tbl, "Table Grid"); } catch (e) { /* مثل الأصل: نتجاهل غياب النمط */ }
      try { X.setTableAlignment(tbl, "right"); } catch (e) { /* ignore */ }
      const tblPr = X.wFirst(tbl, "tblPr");
      let bidi = X.wFirst(tblPr, "bidiVisual");
      if (!bidi) {
        bidi = X.newW(tbl.ownerDocument, "bidiVisual");
        tblPr.appendChild(bidi);
      }
      X.setWAttr(bidi, "val", "1");
      const trs = X.tableRows(tbl);
      rows.forEach((row, r) => {
        const cells = X.rowCells(trs[r]);
        for (let c = 0; c < cols; c++) {
          const v = c < row.length ? row[c] : "";
          X.setCellText(pkg, cells[c], Precedent.pyStr(v));
        }
      });
    }
  }

  function fill_topic_block(pkg, tbl, number_label, f) {
    const rows = X.tableRows(tbl);
    if (!rows.length) return;
    const c0 = X.rowCells(rows[0]);
    X.setCellText(pkg, c0[0], `الموضوع ${number_label}`);
    if (X.rowCells(rows[0]).length > 1) X.setCellText(pkg, X.rowCells(rows[0])[1], f.title);
    const field_map = new Map([
      [LABEL_DECISION, f.decision],
      [LABEL_DOCUMENT, f.document_ref],
      [LABEL_ATTACH, f.attachments],
      [LABEL_ACTION, f.action_required],
    ]);
    for (const tr of rows.slice(1)) {
      const texts = X.rowTexts(tr);
      if (!texts.length) continue;
      const label = X.norm(texts[0]);
      const cells = X.rowCells(tr);
      if ((label === LABEL_RATIONALE || label === LABEL_RATIONALE_ALT) && cells.length > 1) {
        X.setCellText(pkg, cells[1], f.rationale);
        _append_data_tables(pkg, cells[1], f.data_tables);
      } else if (field_map.has(label) && cells.length > 1) {
        X.setCellText(pkg, cells[1], field_map.get(label));
      }
    }
  }

  function fill_header(pkg, values) {
    for (const tbl of docTables(pkg)) {
      const rows = X.tableRows(tbl);
      rows.forEach((tr, i) => {
        const texts = X.rowTexts(tr);
        if (texts.length && X.norm(texts[0]) === LABEL_SESSION_NO && i + 1 < rows.length) {
          const target = X.rowCells(rows[i + 1]);
          const n = Math.min(target.length, values.length);
          for (let k = 0; k < n; k++) X.setCellText(pkg, target[k], values[k]);
        }
      });
    }
  }

  function _is_previous_minutes_title(text) {
    return normalize_ar(text || "").split(" ").join("").includes(normalize_ar("ملاحظات على المحضر السابق").split(" ").join(""));
  }

  function _agenda_table_and_start(pkg) {
    for (const tbl of docTables(pkg)) {
      const rows = X.tableRows(tbl);
      for (let i = 0; i < rows.length; i++) {
        const joined = X.rowTexts(rows[i]).join(" ");
        if (normalize_ar(joined).split(" ").join("").includes("جدولالاعمال") && i + 1 < rows.length) return [tbl, i + 1];
      }
    }
    return [null, null];
  }

  function _ensure_agenda_rows(tbl, start_row, needed) {
    while (X.tableRows(tbl).length - start_row < needed) {
      const rows = X.tableRows(tbl);
      tbl.appendChild(rows[rows.length - 1].cloneNode(true));
    }
    return X.tableRows(tbl).slice(start_row, start_row + needed);
  }

  function fill_agenda(pkg, titles) {
    const [tbl, start_row] = _agenda_table_and_start(pkg);
    if (tbl === null) return;
    const rows = X.tableRows(tbl);
    let fixed_first = false;
    if (start_row < rows.length) {
      const t = X.rowTexts(rows[start_row]);
      fixed_first = _is_previous_minutes_title(t.length ? t[0] : "");
    }
    const needed = titles.length + (fixed_first ? 1 : 0);
    const agenda_rows = _ensure_agenda_rows(tbl, start_row, Math.max(needed, 1));
    const offset = fixed_first ? 1 : 0;
    titles.forEach((title, j) => {
      const cells = X.rowCells(agenda_rows[offset + j]);
      if (cells.length) X.setCellText(pkg, cells[0], title);
    });
    for (const tr of X.tableRows(tbl).slice(start_row + needed)) {
      const cells = X.rowCells(tr);
      if (cells.length) X.setCellText(pkg, cells[0], "");
    }
  }

  function topicFields(t) {
    return {
      title: t.title ?? "", rationale: t.rationale ?? "", decision: t.decision ?? "",
      document_ref: t.document_ref ?? "", attachments: t.attachments ?? "", action_required: t.action_required ?? "",
      data_tables: t._data_tables || [],
    };
  }

  // template: Uint8Array of the .docx template. Returns Uint8Array of the new .docx.
  function build_minutes_document(templateBytes, session_meta, topics, templateName = "") {
    const pkg = X.DocxPackage.open(templateBytes, templateName);
    fill_header(pkg, [session_meta.session_number || "", session_meta.day || "", session_meta.date || "", session_meta.place || "", session_meta.time || ""]);
    fill_agenda(pkg, topics.map((t) => t.title ?? ""));
    const existing = _find_topic_block_tables(pkg);
    let has_fixed_first = false;
    if (existing.length) {
      const rows = X.tableRows(existing[0]);
      if (rows.length) {
        const cells = X.rowCells(rows[0]);
        has_fixed_first = cells.length > 1 && _is_previous_minutes_title(X.cellPlainText(cells[1]));
      }
    }
    const total = topics.length + (has_fixed_first ? 1 : 0);
    const blocks = ensure_topic_block_count(pkg, Math.max(total, 1));
    const start_idx = has_fixed_first ? 1 : 0;
    const start_number = has_fixed_first ? 2 : 1;
    topics.forEach((t, i) => {
      fill_topic_block(pkg, blocks[start_idx + i], PY.pad2(start_number + i), topicFields(t));
    });
    X.applyWordFormat(pkg, WORD_FORMAT);
    return pkg.save();
  }

  // ---------------------------------------------------------------- department council
  const D_LABEL_RATIONALE = new Set([X.norm("حيثيات الموضوع"), X.norm("حيثيات / الموضوع"), X.norm("حيثيات/الموضوع")]);
  const ORDINALS = {
    1: "الأول", 2: "الثاني", 3: "الثالث", 4: "الرابع", 5: "الخامس", 6: "السادس", 7: "السابع", 8: "الثامن", 9: "التاسع", 10: "العاشر",
    11: "الحادي عشر", 12: "الثاني عشر", 13: "الثالث عشر", 14: "الرابع عشر", 15: "الخامس عشر", 16: "السادس عشر", 17: "السابع عشر", 18: "الثامن عشر", 19: "التاسع عشر", 20: "العشرون",
  };

  function _dept_is_topic_table(tbl) {
    const rows = X.tableRows(tbl);
    if (rows.length < 3) return false;
    for (let i = 0; i < Math.min(4, rows.length); i++) {
      const vals = X.rowTexts(rows[i]);
      if (vals.length && X.norm(vals[0]).startsWith(X.norm("الموضوع"))) {
        for (const r of rows.slice(i + 1, i + 4)) {
          const rv = X.rowTexts(r);
          if (rv.length && D_LABEL_RATIONALE.has(X.norm(rv[0]))) return true;
        }
      }
    }
    return false;
  }

  function _dept_signature_table(pkg) {
    for (const tbl of docTables(pkg)) {
      for (const tr of X.tableRows(tbl).slice(0, 4)) {
        const joined = X.rowTexts(tr).map((v) => X.norm(v)).join("");
        if (joined.includes(X.norm("التوقيع")) && joined.includes(X.norm("الاسم"))) return tbl;
      }
    }
    return null;
  }

  function _dept_fill_agenda(pkg, titles) {
    let tbl = null, start = null;
    outer: for (const t of docTables(pkg)) {
      const rows = X.tableRows(t);
      for (let i = 0; i < rows.length; i++) {
        const vals = X.rowTexts(rows[i]);
        if (vals.length && normalize_ar(vals.join(" ")).includes("جدول الاعمال")) { tbl = t; start = i + 1; break outer; }
      }
    }
    if (tbl === null) return;
    while (X.tableRows(tbl).length - start < titles.length) {
      const rows = X.tableRows(tbl);
      tbl.appendChild(rows[rows.length - 1].cloneNode(true));
    }
    titles.forEach((title, k) => {
      const i = k + 1;
      const cells = X.rowCells(X.tableRows(tbl)[start + i - 1]);
      if (cells.length) {
        const ordtxt = ORDINALS[i] ?? String(i);
        X.setCellText(pkg, cells[0], `الموضوع ${ordtxt}: ${title}`);
      }
    });
    for (const tr of X.tableRows(tbl).slice(start + titles.length)) {
      const cells = X.rowCells(tr);
      if (cells.length) X.setCellText(pkg, cells[0], "");
    }
  }

  function _dept_fill_topic(pkg, tbl, idx, data) {
    let topic_row = null;
    for (const tr of X.tableRows(tbl).slice(0, 5)) {
      const vals = X.rowTexts(tr);
      if (vals.length && X.norm(vals[0]).startsWith(X.norm("الموضوع"))) { topic_row = tr; break; }
    }
    if (topic_row === null) return;
    X.setCellText(pkg, X.rowCells(topic_row)[0], `الموضوع ${PY.pad2(idx)}`);
    if (X.rowCells(topic_row).length > 1) X.setCellText(pkg, X.rowCells(topic_row)[1], data.title ?? "");
    for (const tr of X.tableRows(tbl)) {
      const vals = X.rowTexts(tr);
      if (!vals.length) continue;
      const label = X.norm(vals[0]);
      const cells = X.rowCells(tr);
      if (cells.length < 2) continue;
      if (D_LABEL_RATIONALE.has(label)) {
        X.setCellText(pkg, cells[1], data.rationale ?? "");
        _append_data_tables(pkg, cells[1], data._data_tables || []);
      } else if (label === LABEL_DECISION) X.setCellText(pkg, cells[1], data.decision ?? "");
      else if (label === LABEL_DOCUMENT) X.setCellText(pkg, cells[1], data.document_ref ?? "");
      else if (label === LABEL_ATTACH) X.setCellText(pkg, cells[1], data.attachments ?? "");
      else if (label === LABEL_ACTION) X.setCellText(pkg, cells[1], data.action_required ?? "");
    }
  }

  function build_department_minutes_document(templateBytes, session_meta, topics, templateName = "") {
    const pkg = X.DocxPackage.open(templateBytes, templateName);
    fill_header(pkg, [session_meta.session_number || "", session_meta.day || "", session_meta.date || "", session_meta.place || "", session_meta.time || ""]);
    _dept_fill_agenda(pkg, topics.map((t) => t.title ?? ""));
    const blocks = cloneBlocks(
      docTables(pkg).filter(_dept_is_topic_table), Math.max(1, topics.length), _dept_signature_table(pkg),
      "لم يتم العثور على كتل موضوعات مجلس القسم في القالب.",
      "لم يتم العثور على جدول توقيعات الأعضاء في قالب مجلس القسم.",
    );
    topics.forEach((data, i) => _dept_fill_topic(pkg, blocks[i], i + 1, data));
    X.applyWordFormat(pkg, WORD_FORMAT);
    return pkg.save();
  }

  return {
    build_minutes_document, build_department_minutes_document, ensure_topic_block_count, fill_topic_block,
    fill_header, fill_agenda, _append_data_tables, _is_previous_minutes_title, WORD_FORMAT,
  };
})();
