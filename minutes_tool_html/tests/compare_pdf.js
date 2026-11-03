// Compares PDF reading between the Python tool (results in a JSON file produced by
// tests/pdf_reference.py) and the HTML version (pdf.js based), for each PDF.
// usage: node tests/compare_pdf.js <reference.json> <pdf files...>
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

function ratio(a, b) {
  // simple token-set similarity (order-insensitive) and sequence similarity
  const ta = new Set(a.split(/\s+/).filter(Boolean)), tb = new Set(b.split(/\s+/).filter(Boolean));
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return ta.size + tb.size ? (2 * inter) / (ta.size + tb.size) : 1;
}

(async () => {
  const ref = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
  const files = process.argv.slice(3);
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto("file://" + path.resolve(__dirname, "../dist/مساعد_إعداد_المحاضر.html"));
  await page.waitForFunction(() => typeof App !== "undefined");
  for (const f of files) {
    const b64 = fs.readFileSync(f).toString("base64");
    const out = await page.evaluate(async ([name, b64]) => {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const file = { name, path: name, bytes };
      const src = await PDFText.readPdfSource(file);
      const sorted = await PDFText.readSortedTextPages(file);
      const plumber = await PDFText.readPlumberText(file);
      return { src, sorted, plumber };
    }, [path.basename(f), b64]);
    const r = ref[path.basename(f)];
    console.log(`\n=== ${path.basename(f)}`);
    console.log(`source text similarity: ${ratio(r.source.text, out.src.text).toFixed(3)} (py ${r.source.text.length} chars, js ${out.src.text.length})`);
    console.log(`tables: py ${r.source.tables.length}, js ${out.src.tables.length}; searchable py=${r.source.searchable} js=${out.src.searchable}`);
    const n = Math.min(r.source.tables.length, out.src.tables.length);
    for (let i = 0; i < n; i++) {
      const a = JSON.stringify(r.source.tables[i]), b = JSON.stringify(out.src.tables[i]);
      console.log(`  table ${i}: ${a === b ? "identical" : "differs"} (py ${r.source.tables[i].length}x${(r.source.tables[i][0] || []).length}, js ${out.src.tables[i].length}x${(out.src.tables[i][0] || []).length}) sim=${ratio(a, b).toFixed(3)}`);
      if (a !== b && process.argv.includes("--verbose")) { console.log("    py:", a.slice(0, 400)); console.log("    js:", b.slice(0, 400)); }
    }
    console.log(`sorted text similarity: ${ratio(r.sorted.join("\n"), out.sorted.join("\n")).toFixed(3)}`);
    console.log(`plumber text similarity: ${ratio(r.plumber, out.plumber).toFixed(3)}`);
    if (process.argv.includes("--verbose")) {
      console.log("PY source:", r.source.text.slice(0, 600));
      console.log("JS source:", out.src.text.slice(0, 600));
    }
  }
  await browser.close();
})();
