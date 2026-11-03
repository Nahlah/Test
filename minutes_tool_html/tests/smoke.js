// Opens the built HTML in Chromium, reports console errors and takes screenshots of each tab.
const { chromium } = require("playwright");
const path = require("path");
(async () => {
  const file = path.resolve(__dirname, "../dist/مساعد_إعداد_المحاضر.html");
  const out = process.argv[2] || "/tmp";
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1360, height: 1000 } });
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") errors.push(m.type() + ": " + m.text()); });
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  await page.goto("file://" + file);
  await page.waitForTimeout(800);
  for (const [panel, name] of [["panel-settings", "settings"], ["panel-college", "college"], ["panel-dept", "dept"]]) {
    await page.click(`.tab[data-panel="${panel}"]`);
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${out}/shot_${name}.png`, fullPage: true });
  }
  console.log("errors:", JSON.stringify(errors, null, 1));
  await browser.close();
})();
