// Page-side dispatcher for replay_fn.js. Loaded into the built HTML page.
(function () {
  const TOPIC_KEYS = ["number", "title", "rationale", "decision", "document_ref", "attachments", "action_required", "votes", "guests", "data_tables"];
  const SESSION_KEYS = ["council_name", "session_number", "day", "date", "place", "time"];

  function des(x) {
    if (Array.isArray(x)) return x.map(des);
    if (x && typeof x === "object") {
      const o = {};
      for (const [k, v] of Object.entries(x)) if (k !== "__type") o[k] = des(v);
      if (x.__type === "Topic") return Minutes.Topic(o);
      if (x.__type === "SessionInfo") return Minutes.SessionInfo(o);
      if (x.__type === "ExtractedFormFields") return new FormFields.ExtractedFormFields(o.profile, o.values, o.display_fields, o.records);
      return o;
    }
    return x;
  }
  function isTopic(o) {
    return TOPIC_KEYS.every((k) => k in o);
  }
  function isSession(o) {
    const ks = Object.keys(o);
    return ks.length === SESSION_KEYS.length && SESSION_KEYS.every((k) => k in o);
  }
  function ser(x) {
    if (x === undefined) return null;
    if (x === null || typeof x !== "object") return x;
    if (x instanceof Precedent.Applicant) return { honorific: x.honorific, name: x.name, rank: x.rank, department: x.department, __type: "Applicant" };
    if (x instanceof FormFields.ExtractedFormFields) {
      return { profile: x.profile, values: ser(x.values), display_fields: ser(x.display_fields), records: ser(x.records), __type: "ExtractedFormFields" };
    }
    if (Array.isArray(x)) return x.map(ser);
    if (x instanceof Set) return Array.from(x).map(ser).sort();
    const o = {};
    if (isTopic(x)) {
      for (const k of TOPIC_KEYS) o[k] = ser(x[k]);
      for (const k of ["_structured_fields", "_structured_records"]) if (k in x) o[k] = ser(x[k]);
      o.__type = "Topic";
      return o;
    }
    if (isSession(x)) {
      for (const k of SESSION_KEYS) o[k] = ser(x[k]);
      o.__type = "SessionInfo";
      return o;
    }
    for (const [k, v] of Object.entries(x)) o[k] = ser(v);
    return o;
  }
  function b64(s) {
    const bin = atob(s);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u;
  }
  function fileArg(ref, files) {
    if (!ref) return null;
    return { name: ref.name, path: ref.rel || ref.name, bytes: b64(files[ref.file]) };
  }
  function positional(rec, sigs) {
    const names = sigs[rec.fn];
    const args = des(rec.in.args || []);
    const kw = des(rec.in.kw || {});
    if (!names) return args;
    const out = args.slice();
    for (const [k, v] of Object.entries(kw)) {
      const i = names.indexOf(k);
      if (i < 0) throw new Error("unknown kwarg " + k);
      while (out.length < i) out.push(undefined);
      out[i] = v;
    }
    return out;
  }

  // ------------------------------------------------------------ docx comparison
  const decoder = new TextDecoder();
  function canonXml(text, dropHdrRefs) {
    const doc = new DOMParser().parseFromString(text, "application/xml");
    const walk = (n) => {
      if (dropHdrRefs && n.nodeType === 1 && (n.localName === "headerReference" || n.localName === "footerReference")) return "";
      if (n.nodeType === 3) {
        const p = n.parentNode;
        if (!/\S/.test(n.nodeValue) && !(p && p.localName === "t")) return "";
        return JSON.stringify(n.nodeValue);
      }
      if (n.nodeType !== 1) return "";
      const attrs = Array.from(n.attributes)
        .filter((a) => a.namespaceURI !== "http://www.w3.org/2000/xmlns/")
        .map((a) => `${a.namespaceURI || ""}|${a.localName}=${a.value}`).sort();
      let s = `<${n.namespaceURI}|${n.localName} ${attrs.join(" ")}>`;
      for (let c = n.firstChild; c; c = c.nextSibling) s += walk(c);
      return s + "</>";
    };
    return walk(doc.documentElement);
  }
  function compareDocx(pyBytes, jsBytes) {
    const a = fflate.unzipSync(pyBytes), b = fflate.unzipSync(jsBytes);
    // python-docx adds an empty default header/footer part when a template has none.
    const isEmptyPart = (bytes) => !/<w:t[ >]/.test(decoder.decode(bytes));
    const extra = Object.keys(a).filter((k) => /^word\/(header|footer)\d*\.xml$/.test(k) && !b[k]);
    const extraNonEmpty = extra.filter((k) => !isEmptyPart(a[k]));
    if (extraNonEmpty.length) return "only in python output: " + extraNonEmpty.join(", ");
    const drop = extra.length > 0;
    const parts = Object.keys(b).filter((k) => /^word\/(document|header\d*|footer\d*)\.xml$/.test(k));
    for (const k of parts) {
      if (!a[k]) return `part ${k} missing in python output`;
      const ca = canonXml(decoder.decode(a[k]), drop), cb = canonXml(decoder.decode(b[k]), drop);
      if (ca !== cb) {
        let i = 0;
        while (i < ca.length && ca[i] === cb[i]) i++;
        return `${k} differs at ${i}:\n py: ${ca.slice(Math.max(0, i - 200), i + 300)}\n js: ${cb.slice(Math.max(0, i - 200), i + 300)}`;
      }
    }
    return null;
  }

  // ------------------------------------------------------------ dispatcher
  window.__replay = async function (rec, sigs, files) {
    try {
      try { localStorage.clear(); } catch (e) { /* ignore */ }
      const fn = rec.fn;
      const A = () => positional(rec, sigs);
      let out;
      switch (fn) {
        case "core.similarity.normalize_ar": out = Similarity.normalize_ar(...A()); break;
        case "core.precedent_transfer.topic_family": out = Precedent.topic_family(...A()); break;
        case "core.precedent_transfer.extract_applicant": out = Precedent.extract_applicant(...A()); break;
        case "core.precedent_transfer.build_from_precedent": out = Precedent.build_from_precedent(...A()); break;
        case "core.precedent_transfer.build_from_selected_reference": out = Precedent.build_from_selected_reference(...A()); break;
        case "core.precedent_transfer.reference_topics_for_current": out = Precedent.reference_topics_for_current(...A()); break;
        case "core.precedent_transfer._parse_labeled_sections": out = Precedent._parse_labeled_sections(...A()); break;
        case "core.precedent_transfer._schedule_transfer": out = Precedent._schedule_transfer(...A()); break;
        case "core.precedent_transfer._force_current_department_context": out = Precedent._force_current_department_context(...A()); break;
        case "core.precedent_transfer._split_lines": out = Precedent._split_lines(...A()); break;
        case "core.precedent_transfer._dedupe_lines": out = Precedent._dedupe_lines(...A()); break;
        case "core.department_form_fields.extract_form_fields": out = FormFields.extract_form_fields(...A()); break;
        case "core.department_form_fields.topic_profile": out = FormFields.topic_profile(...A()); break;
        case "core.department_form_fields.fields_to_text": out = FormFields.fields_to_text(...A()); break;
        case "core.department_form_fields.publication_records_to_text": out = FormFields.publication_records_to_text(...A()); break;
        case "core.department_form_fields.field_for_label": out = FormFields.field_for_label(...A()); break;
        case "core.department_form_fields._promotion_research_records": out = FormFields._promotion_research_records(...A()); break;
        case "core.department_transfer.build_department_from_reference": out = DeptTransfer.build_department_from_reference(...A()); break;
        case "core.department_transfer.reference_title_template": out = DeptTransfer.reference_title_template(...A()); break;
        case "core.department_transfer._all_current_fields": out = DeptTransfer._all_current_fields(...A()); break;
        case "core.reference_learning.title_similarity": out = Learning.title_similarity(...A()); break;
        case "core.draft_helpers.session_ordinal_text": out = Precedent.session_ordinal_text(...A()); break;
        case "core.similarity.TopicMatcher.find_similar": {
          const arch = des(rec.in.archive);
          const m = new Similarity.TopicMatcher(arch);
          const res = m.find_similar(rec.in.title, rec.in.rationale, rec.in.top_k, rec.in.min_score);
          out = res.map(([p, s]) => [arch.indexOf(p), s]);
          break;
        }
        case "core.minutes_parser.parse_minutes_file": {
          const m = await Minutes.parseMinutesFile(fileArg(rec.in.file, files));
          m.source_path = null;
          out = Object.assign(ser(m), { __type: "Minutes" });
          rec.out = Object.assign({}, rec.out, { source_path: null });
          break;
        }
        case "core.extract.read_text": out = await Minutes.readText(fileArg(rec.in.file, files)); break;
        case "core.source_import.import_current_source": {
          const kw = rec.in.kw || {};
          const args = rec.in.args || [];
          const prefer = kw.prefer_form !== undefined ? kw.prefer_form : (args.length ? args[0] : false);
          out = await SourceImport.import_current_source(fileArg(rec.in.file, files), prefer);
          break;
        }
        case "core.scholarship.parse_committee_file": {
          const r = await SourceImport.parse_committee_file(fileArg(rec.in.file, files));
          out = { session: r.session, topic: r.topic, raw_text: r.raw_text, __type: "CommitteeSource" };
          break;
        }
        case "core.archive.build_archive": {
          const fl = rec.in.files.map((f) => fileArg(f, files));
          out = await Minutes.buildArchive(fl, rec.in.level);
          for (const t of out) delete t.source_path;
          rec.out = (rec.out || []).map((t) => { const c = Object.assign({}, t); delete c.source_path; return c; });
          break;
        }
        case "core.docx_builder.build_minutes_document":
        case "core.department_docx_builder.build_department_minutes_document": {
          const tpl = fileArg(rec.in.template, files);
          const topics = des(rec.in.topics);
          const bytes = fn.includes("department")
            ? DocxBuilder.build_department_minutes_document(tpl.bytes, rec.in.meta, topics, tpl.name)
            : DocxBuilder.build_minutes_document(tpl.bytes, rec.in.meta, topics, tpl.name);
          if (rec.in.output && files[rec.in.output.file]) {
            const d = compareDocx(b64(files[rec.in.output.file]), bytes);
            if (d) return { error: d };
          }
          out = null;
          break;
        }
        case "app.MinutesApp._generate_item": {
          const c = new AppLogic.College();
          c.archive_topics = des(rec.in.archive);
          const item = des(rec.in.item);
          item.extra_details = item.extra_details || "";
          c.items = [item];
          out = c.generate_item(0);
          break;
        }
        case "department_panel.generate_item": {
          const d = new AppLogic.Department();
          d.archive_topics = des(rec.in.archive);
          if (rec.in.target) d.target_department = rec.in.target;
          if (rec.in.scope) d.scope = rec.in.scope;
          d.items = [des(rec.in.item)];
          out = d.generate_item(0);
          break;
        }
        default:
          return { skip: true };
      }
      return { out: ser(out) };
    } catch (e) {
      return { error: String((e && e.message) || e) };
    }
  };
})();
