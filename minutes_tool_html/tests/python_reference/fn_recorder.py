"""Record inputs/outputs of the tool's main functions for replay against the JS port."""
import dataclasses, hashlib, json, os, shutil, sys, atexit, copy, functools

OUT = os.environ.get("FN_RECORD_OUT", "/tmp/fn_calls.jsonl")
FILES = os.path.join(os.path.dirname(OUT), "files")
os.makedirs(FILES, exist_ok=True)
_fh = open(OUT, "a", encoding="utf-8")
atexit.register(_fh.close)
_seen = set()
_depth = {"n": 0}


def store_file(path):
    if not path or not os.path.isfile(path):
        return None
    with open(path, "rb") as f:
        data = f.read()
    h = hashlib.sha1(data).hexdigest()[:16]
    ext = os.path.splitext(path)[1].lower()
    dst = os.path.join(FILES, h + ext)
    if not os.path.exists(dst):
        with open(dst, "wb") as f:
            f.write(data)
    return {"file": h + ext, "name": os.path.basename(path)}


def ser(x, depth=0):
    from core.minutes_parser import Topic, SessionInfo, Minutes
    if depth > 30:
        return "<deep>"
    if isinstance(x, (str, int, float, bool)) or x is None:
        return x
    if isinstance(x, dict):
        return {str(k): ser(v, depth + 1) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [ser(v, depth + 1) for v in x]
    if isinstance(x, (set, frozenset)):
        return sorted(ser(v, depth + 1) for v in x)
    if isinstance(x, Topic):
        d = {f.name: ser(getattr(x, f.name), depth + 1) for f in dataclasses.fields(x)}
        for extra in ("_structured_fields", "_structured_records"):
            if hasattr(x, extra):
                d[extra] = ser(getattr(x, extra), depth + 1)
        d["__type"] = "Topic"
        return d
    if dataclasses.is_dataclass(x):
        d = {f.name: ser(getattr(x, f.name), depth + 1) for f in dataclasses.fields(x)}
        d["__type"] = type(x).__name__
        return d
    if hasattr(x, "__dict__") and type(x).__name__ in ("Applicant",):
        return {"honorific": x.honorific, "name": x.name, "rank": x.rank, "department": x.department, "__type": "Applicant"}
    if type(x).__name__ == "SimpleNamespace":
        return {k: ser(v, depth + 1) for k, v in vars(x).items()}
    return repr(x)


def log(rec):
    try:
        key = json.dumps(rec, ensure_ascii=False, sort_keys=True)
    except TypeError as e:
        return
    if key in _seen:
        return
    _seen.add(key)
    _fh.write(key + "\n")
    _fh.flush()


def wrap(modname, fname, fn, argser=None, keep_nested=True):
    @functools.wraps(fn)
    def w(*args, **kw):
        nested = _depth["n"] > 0
        if nested and not keep_nested:
            return fn(*args, **kw)
        try:
            sargs = argser(*args, **kw) if argser else {"args": ser(list(args)), "kw": ser(kw)}
        except Exception as e:
            sargs = None
        _depth["n"] += 1
        try:
            res = fn(*args, **kw)
        except Exception as e:
            _depth["n"] -= 1
            if sargs is not None:
                log({"fn": f"{modname}.{fname}", "in": sargs, "error": str(e), "etype": type(e).__name__})
            raise
        _depth["n"] -= 1
        if sargs is not None:
            log({"fn": f"{modname}.{fname}", "in": sargs, "out": ser(res)})
        return res
    w.__wrapped_orig__ = fn
    return w


def install():
    import importlib
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    mods = {}
    for m in ("core.similarity", "core.precedent_transfer", "core.department_form_fields", "core.department_transfer",
              "core.minutes_parser", "core.source_import", "core.archive", "core.docx_builder",
              "core.department_docx_builder", "core.scholarship", "core.reference_learning", "core.draft_helpers",
              "core.extract"):
        mods[m] = importlib.import_module(m)

    path_arg = lambda path, *a, **k: {"file": store_file(path), "args": ser(list(a)), "kw": ser(k)}

    def build_doc_args(template_path, output_path, session_meta, topics):
        return {"template": store_file(template_path), "meta": ser(session_meta), "topics": ser(topics), "_out": output_path}

    def archive_args(folder, council_level=None):
        files = []
        if folder and os.path.isdir(folder):
            for root, _d, fs in os.walk(folder):
                for n in fs:
                    p = os.path.join(root, n)
                    r = store_file(p)
                    if r:
                        r["rel"] = os.path.relpath(p, folder)
                        files.append(r)
        return {"files": files, "level": council_level}

    targets = {
        "core.similarity": ["normalize_ar"],
        "core.precedent_transfer": ["topic_family", "extract_applicant", "build_from_precedent", "build_from_selected_reference",
                                    "reference_topics_for_current", "_parse_labeled_sections", "_schedule_transfer",
                                    "_force_current_department_context", "_split_lines", "_dedupe_lines"],
        "core.department_form_fields": ["extract_form_fields", "topic_profile", "fields_to_text", "publication_records_to_text",
                                        "field_for_label", "_promotion_research_records"],
        "core.department_transfer": ["build_department_from_reference", "reference_title_template", "_all_current_fields"],
        "core.reference_learning": ["title_similarity"],
        "core.draft_helpers": ["session_ordinal_text"],
    }
    file_targets = {
        "core.minutes_parser": ["parse_minutes_file"],
        "core.source_import": ["import_current_source"],
        "core.scholarship": ["parse_committee_file"],
        "core.extract": ["read_text"],
    }
    originals = {}
    for m, names in targets.items():
        for n in names:
            fn = getattr(mods[m], n)
            originals[fn] = wrap(m, n, fn)
    for m, names in file_targets.items():
        for n in names:
            fn = getattr(mods[m], n)
            originals[fn] = wrap(m, n, fn, argser=path_arg)
    fn = mods["core.archive"].build_archive
    originals[fn] = wrap("core.archive", "build_archive", fn, argser=archive_args)

    def record_doc(modname, fname, fn):
        @functools.wraps(fn)
        def w(template_path, output_path, session_meta, topics):
            sargs = build_doc_args(template_path, output_path, session_meta, topics)
            try:
                res = fn(template_path, output_path, session_meta, topics)
            except Exception as e:
                log({"fn": f"{modname}.{fname}", "in": sargs, "error": str(e), "etype": type(e).__name__})
                raise
            sargs["output"] = store_file(output_path)
            log({"fn": f"{modname}.{fname}", "in": sargs, "out": None})
            return res
        return w
    fn = mods["core.docx_builder"].build_minutes_document
    originals[fn] = record_doc("core.docx_builder", "build_minutes_document", fn)
    fn = mods["core.department_docx_builder"].build_department_minutes_document
    originals[fn] = record_doc("core.department_docx_builder", "build_department_minutes_document", fn)

    # TopicMatcher.find_similar: record archive + query
    TM = mods["core.similarity"].TopicMatcher
    orig_fs = TM.find_similar
    def fs(self, title, rationale="", top_k=3, min_score=0.10):
        res = orig_fs(self, title, rationale, top_k, min_score)
        idx = {id(t): i for i, t in enumerate(self.archive_topics)}
        log({"fn": "core.similarity.TopicMatcher.find_similar",
             "in": {"archive": ser(self.archive_topics), "title": title, "rationale": rationale, "top_k": top_k, "min_score": min_score},
             "out": [[idx.get(id(p)), s] for p, s in res]})
        return res
    TM.find_similar = fs

    # replace references everywhere (handles `from x import f`)
    for modname, mod in list(sys.modules.items()):
        if not modname or not (modname.startswith("core") or modname in ("app", "department_panel")):
            continue
        for attr, val in list(vars(mod).items()):
            if callable(val) and val in originals:
                setattr(mod, attr, originals[val])
    return originals


def install_app_hooks():
    """Record MinutesApp._generate_item and DepartmentPanel.generate_item with their state."""
    import app, department_panel
    orig = app.MinutesApp._generate_item
    def gen(self, idx):
        state = {"archive": ser(self.archive_topics), "item": ser({k: v for k, v in self.items[idx].items() if k not in ("generated",)})}
        try:
            res = orig(self, idx)
        except Exception as e:
            log({"fn": "app.MinutesApp._generate_item", "in": state, "error": str(e), "etype": type(e).__name__})
            raise
        log({"fn": "app.MinutesApp._generate_item", "in": state, "out": ser(res)})
        return res
    app.MinutesApp._generate_item = gen
    dorig = department_panel.DepartmentPanel.generate_item
    def dgen(self, idx):
        try:
            target = self.target_department_var.get()
            scope = self.scope_var.get()
        except Exception:
            target, scope = None, None
        state = {"archive": ser(self.archive_topics), "item": ser({k: v for k, v in self.items[idx].items() if k not in ("generated",)}),
                 "target": target, "scope": scope}
        try:
            res = dorig(self, idx)
        except Exception as e:
            log({"fn": "department_panel.generate_item", "in": state, "error": str(e), "etype": type(e).__name__})
            raise
        log({"fn": "department_panel.generate_item", "in": state, "out": ser(res)})
        return res
    department_panel.DepartmentPanel.generate_item = dgen
