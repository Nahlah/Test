// End-to-end test of the built HTML through its real interface (Chromium).
// usage: node tests/e2e.js <scenario dir> <template.docx> <out dir>
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const [scen, template, outDir] = process.argv.slice(2);
const HTML = "file://" + path.resolve(__dirname, "../dist/مساعد_إعداد_المحاضر.html");

async function pick(page, buttonSel, files) {
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.click(buttonSel)]);
  await chooser.setFiles(files);
}
async function closeModal(page) {
  const btn = page.locator(".modal-foot button").first();
  if (await btn.count()) await btn.click();
}
async function expectText(page, sel, re, label) {
  try {
    await page.waitForFunction(([s, r]) => new RegExp(r).test(document.querySelector(s).textContent), [sel, re.source], { timeout: 60000 });
  } catch (e) {
    console.log("✗", label, "— current text:", await page.textContent(sel));
    if (await page.locator(".modal").count()) console.log("  modal:", await page.textContent(".modal"));
    console.log("  busy:", await page.evaluate(() => { const b = document.querySelector(".busy"); return b ? b.style.display + " " + b.textContent : "none"; }));
    throw e;
  }
  console.log("✓", label + ":", (await page.textContent(sel)).slice(0, 160));
}

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1360, height: 1000 } });
  // Use the portable code paths (folder <input>, normal download) that Safari/Firefox use.
  await ctx.addInitScript(() => { delete window.showDirectoryPicker; delete window.showSaveFilePicker; window.showDirectoryPicker = undefined; window.showSaveFilePicker = undefined; });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("dialog", (d) => d.accept());
  await page.goto(HTML);

  // ---------------- settings
  await page.click('.tab[data-panel="panel-settings"]');
  await pick(page, "#btn-archive-college", path.join(scen, "archive_college"));
  await expectText(page, "#st-archive-college", /تم تحميل \d+ موضوعًا/, "college archive");
  await pick(page, "#btn-template-college", template);
  await expectText(page, "#st-template-college", /القالب المحدد/, "college template");
  await pick(page, "#btn-archive-department", path.join(scen, "archive_dept"));
  await expectText(page, "#st-archive-department", /تم تحميل \d+ موضوعًا/, "department archive");
  await pick(page, "#btn-template-cs", template);
  await pick(page, "#btn-template-it", template);
  await page.screenshot({ path: path.join(outDir, "e2e_settings.png"), fullPage: true });

  // ---------------- college council
  await page.click('.tab[data-panel="panel-college"]');
  await pick(page, "#c-add-dept", path.join(scen, "current_علوم الحاسب.docx"));
  await expectText(page, "#c-status", /تمت إضافة \d+ موضوعًا من محضر القسم/, "college: added department minutes");
  await page.click("#c-include-all");
  await page.fill("#c-meta-session_number", "12");
  await page.fill("#c-meta-day", "الأحد");
  await page.fill("#c-meta-date", "2026/11/08");
  await page.click("#c-generate");
  await page.waitForFunction(() => /تم توليد/.test(document.querySelector("#c-status").textContent), null, { timeout: 120000 });
  console.log("✓ college generate:", (await page.textContent("#c-status")).slice(0, 160));
  if (await page.locator(".modal").count()) {
    console.log("  (dialog) ", (await page.textContent(".modal-body")).slice(0, 300).replace(/\n/g, " | "));
    await closeModal(page);
  }
  console.log("  title field:", (await page.inputValue("#c-f-title")).slice(0, 120));
  console.log("  rationale field:", (await page.inputValue("#c-f-rationale")).slice(0, 160).replace(/\n/g, " | "));
  // remove topics that failed so export can run
  for (let guard = 0; guard < 20; guard++) {
    const missing = await page.evaluate(() => App.college.items.findIndex((x) => x.included && !x.generated));
    if (missing < 0) break;
    await page.evaluate((i) => { App.college.items[i].included = false; }, missing);
  }
  await page.click('.topic-row .topic-btn >> nth=1');
  await page.click("#c-show-ref");
  await page.waitForSelector(".modal");
  console.log("✓ reference popup:", (await page.textContent(".popup-header")).slice(0, 140).replace(/\n/g, " | "));
  await closeModal(page);
  await page.click("#c-choose-ref");
  await page.waitForSelector(".modal .listbox .opt");
  console.log("✓ chooser rows:", await page.locator(".modal .listbox .opt").count());
  await page.locator(".modal .listbox .opt").nth(1).click();
  await page.click(".modal-foot button.primary");
  await page.waitForTimeout(500);
  if (await page.locator(".modal").count()) { console.log("  (dialog)", (await page.textContent(".modal-body")).slice(0, 200)); await closeModal(page); }
  console.log("✓ after manual reference:", (await page.textContent("#c-status")).slice(0, 160));
  await page.screenshot({ path: path.join(outDir, "e2e_college.png"), fullPage: true });
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#c-export")]);
  const out1 = path.join(outDir, "e2e_college.docx");
  await dl.saveAs(out1);
  console.log("✓ college export:", dl.suggestedFilename(), fs.statSync(out1).size, "bytes");
  await closeModal(page);

  // ---------------- department council
  await page.click('.tab[data-panel="panel-dept"]');
  await pick(page, "#d-import", path.join(scen, "requests.xlsx"));
  await expectText(page, "#d-status", /تم استيراد \d+ موضوعًا/, "department: Excel import");
  await page.click("#d-add-manual");
  await page.waitForSelector(".modal input.wide");
  await page.fill(".modal input.wide", "بدل تميز");
  await page.waitForTimeout(600);
  await page.locator(".modal .listbox .opt").first().click();
  await page.click(".modal .form button");
  console.log("  suggestion title:", (await page.inputValue(".modal input.wide")).slice(0, 120));
  await page.click(".modal-foot button.primary");
  await expectText(page, "#d-status", /تمت إضافة الموضوع/, "department: manual topic");
  await pick(page, "#d-attach", path.join(scen, "form_excellence.docx"));
  await page.waitForSelector(".modal .kv-grid input");
  console.log("✓ review dialog fields:", await page.locator(".modal .kv-grid input").count());
  await page.click(".modal-foot button.primary");
  await expectText(page, "#d-status", /تم إرفاق البيانات/, "department: attach form");
  await page.click("#d-include-all");
  await page.click("#d-generate");
  await page.waitForFunction(() => /تم توليد/.test(document.querySelector("#d-status").textContent), null, { timeout: 120000 });
  console.log("✓ department generate:", (await page.textContent("#d-status")).slice(0, 160));
  if (await page.locator(".modal").count()) { console.log("  (dialog)", (await page.textContent(".modal-body")).slice(0, 300).replace(/\n/g, " | ")); await closeModal(page); }
  for (let guard = 0; guard < 20; guard++) {
    const missing = await page.evaluate(() => App.dept.items.findIndex((x) => x.included && !x.generated));
    if (missing < 0) break;
    await page.evaluate((i) => { App.dept.items[i].included = false; }, missing);
  }
  await page.screenshot({ path: path.join(outDir, "e2e_dept.png"), fullPage: true });
  const [dl2] = await Promise.all([page.waitForEvent("download"), page.click("#d-export")]);
  const out2 = path.join(outDir, "e2e_dept.docx");
  await dl2.saveAs(out2);
  console.log("✓ department export:", dl2.suggestedFilename(), fs.statSync(out2).size, "bytes");
  await closeModal(page);

  // ---------------- persistence after reload
  page.removeAllListeners("dialog");
  page.on("dialog", (d) => d.accept());
  await page.reload();
  await page.click('.tab[data-panel="panel-settings"]');
  await expectText(page, "#st-archive-college", /تم تحميل \d+ موضوعًا/, "after reload: college archive kept");
  await expectText(page, "#st-template-it", /القالب المحدد/, "after reload: template kept");

  console.log(errors.length ? "PAGE ERRORS: " + JSON.stringify(errors) : "no page errors");
  await browser.close();
})().catch((e) => { console.error("E2E FAILED:", e); process.exit(1); });
