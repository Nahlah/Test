// Replays function calls recorded from the Python tool (fn_recorder.py) inside the built
// HTML page (Chromium) and compares the JS results with the recorded Python results.
//
// usage: node tests/replay_fn.js <calls.jsonl> [--verbose] [--only=substring]
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const SIGS = {
  "core.similarity.normalize_ar": ["text"],
  "core.precedent_transfer.topic_family": ["title", "rationale"],
  "core.precedent_transfer.extract_applicant": ["title", "rationale", "default_department"],
  "core.precedent_transfer.build_from_precedent": ["current_topic", "department_name", "session_number", "session_date", "precedents", "family_override"],
  "core.precedent_transfer.build_from_selected_reference": ["current_topic", "department_name", "session_number", "session_date", "precedent"],
  "core.precedent_transfer.reference_topics_for_current": ["archive_topics", "title", "rationale"],
  "core.precedent_transfer._parse_labeled_sections": ["text"],
  "core.precedent_transfer._schedule_transfer": ["current_topic", "department_name", "session_number", "session_date", "precedent", "score"],
  "core.precedent_transfer._force_current_department_context": ["text", "department_name", "session_number", "session_date", "precedent"],
  "core.precedent_transfer._split_lines": ["text"],
  "core.precedent_transfer._dedupe_lines": ["lines", "threshold"],
  "core.department_form_fields.extract_form_fields": ["topic", "profile"],
  "core.department_form_fields.topic_profile": ["current_title", "reference_title"],
  "core.department_form_fields.fields_to_text": ["extracted", "values"],
  "core.department_form_fields.publication_records_to_text": ["records"],
  "core.department_form_fields.field_for_label": ["label", "allowed"],
  "core.department_form_fields._promotion_research_records": ["matrix"],
  "core.department_transfer.build_department_from_reference": ["current_topic", "reference", "score", "target_department"],
  "core.department_transfer.reference_title_template": ["reference", "target_department", "placeholder"],
  "core.department_transfer._all_current_fields": ["topic"],
  "core.reference_learning.title_similarity": ["a", "b"],
  "core.draft_helpers.session_ordinal_text": ["session_number"],
  "core.source_import.import_current_source": ["path", "prefer_form"],
};

const IGNORE_KEYS = new Set(["source_path"]);
function canon(x) {
  if (Array.isArray(x)) return x.map(canon);
  if (x && typeof x === "object") {
    const o = {};
    for (const k of Object.keys(x).sort()) if (!IGNORE_KEYS.has(k)) o[k] = canon(x[k]);
    return o;
  }
  return x;
}
function diff(a, b, p = "") {
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a)) ? null : `${p}: ${a} != ${b}`;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return `${p}: length ${a.length} != ${b.length}`;
    for (let i = 0; i < a.length; i++) { const d = diff(a[i], b[i], `${p}[${i}]`); if (d) return d; }
    return null;
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    const ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
    const all = new Set([...ka, ...kb]);
    for (const k of all) {
      if (!(k in a)) return `${p}.${k}: missing in python`;
      if (!(k in b)) return `${p}.${k}: missing in js`;
      const d = diff(a[k], b[k], `${p}.${k}`);
      if (d) return d;
    }
    return null;
  }
  return a === b ? null : `${p}: ${JSON.stringify(a).slice(0, 300)} != ${JSON.stringify(b).slice(0, 300)}`;
}

(async () => {
  const file = process.argv[2];
  const verbose = process.argv.includes("--verbose");
  const only = (process.argv.find((a) => a.startsWith("--only=")) || "").slice(7);
  const filesDir = path.join(path.dirname(file), "files");
  const recs = fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((r) => !only || r.fn.includes(only));
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  await page.goto("file://" + path.resolve(__dirname, "../dist/مساعد_إعداد_المحاضر.html"));
  await page.waitForFunction(() => typeof App !== "undefined");
  await page.addScriptTag({ path: path.resolve(__dirname, "replay_page.js") });

  const stats = {};
  let fails = 0;
  for (const r of recs) {
    const files = {};
    const collect = (x) => {
      if (!x || typeof x !== "object") return;
      if (x.file && typeof x.file === "string" && x.name !== undefined) {
        const p = path.join(filesDir, x.file);
        if (fs.existsSync(p)) files[x.file] = fs.readFileSync(p).toString("base64");
      }
      Object.values(x).forEach(collect);
    };
    collect(r.in);
    let res;
    try {
      res = await page.evaluate(([rec, sigs, files]) => window.__replay(rec, sigs, files), [r, SIGS, files]);
    } catch (e) {
      res = { error: "harness: " + e.message };
    }
    const s = (stats[r.fn] = stats[r.fn] || { ok: 0, bad: 0 });
    let problem = null;
    if (res && res.skip) { s.skip = (s.skip || 0) + 1; continue; }
    if ("error" in r) {
      if (!res || !("error" in res)) problem = `python raised (${r.etype}: ${r.error}) but js returned ${JSON.stringify(res && res.out).slice(0, 300)}`;
    } else if (res && "error" in res) problem = `js raised: ${res.error}`;
    else problem = diff(canon(r.out), canon(res.out), "out");
    if (problem) {
      s.bad++;
      fails++;
      if (verbose || s.bad <= 3) {
        console.log(`\n✗ ${r.fn}: ${problem}`);
        if (verbose) console.log("   input:", JSON.stringify(r.in).slice(0, 1500));
      }
    } else s.ok++;
  }
  console.log("\n=== summary ===");
  for (const [k, v] of Object.entries(stats)) console.log(`${v.bad ? "✗" : "✓"} ${k}: ok=${v.ok} bad=${v.bad}${v.skip ? " skip=" + v.skip : ""}`);
  if (pageErrors.length) console.log("page errors:", pageErrors);
  console.log(fails ? `\nFAILED: ${fails}` : "\nALL MATCH");
  await browser.close();
  process.exit(fails ? 1 : 0);
})();
