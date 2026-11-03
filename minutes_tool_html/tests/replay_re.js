// Replays regex calls recorded from the Python tool and compares results with py.js.
const fs = require("fs");
const PY = require("../src/py.js");
const file = process.argv[2];
const lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
let ok = 0, bad = 0, errs = 0;
const badPatterns = new Map();
function canon(x) {
  if (Array.isArray(x)) return "[" + x.map(canon).join(",") + "]";
  if (x && typeof x === "object") return "{" + Object.keys(x).sort().map((k) => JSON.stringify(k) + ":" + canon(x[k])).join(",") + "}";
  return JSON.stringify(x);
}
function serMatch(m, p) {
  if (!m) return null;
  const groups = [];
  const g = [m.group(0)];
  for (let i = 1; i <= p.groups; i++) { groups.push(m.span(i)); g.push(m.group(i)); }
  return { span: m.span(), groups, g };
}
for (const line of lines) {
  const d = JSON.parse(line);
  let res;
  try {
    const p = PY.re.compile(d.pattern, d.flags);
    const a = d.args;
    switch (d.fn) {
      case "search": res = serMatch(p.search(a[0], a[1] || 0), p); break;
      case "match": res = serMatch(p.match(a[0], a[1] || 0), p); break;
      case "fullmatch": res = serMatch(p.fullmatch(a[0]), p); break;
      case "findall": res = p.findall(a[0]); break;
      case "finditer": res = p.finditer(a[0]).map((m) => serMatch(m, p)); break;
      case "sub": res = p.sub(a[0], a[1], a[2] || 0); break;
      case "sub_fn": res = d.matches; { const mm = p.finditer(a[1]).map((m) => serMatch(m, p)); res = canon(mm) === canon(d.matches) ? d.res : "MISMATCH:" + JSON.stringify(mm); } break;
      case "split": res = p.split(a[0], a[1] || 0); break;
      default: throw new Error("fn " + d.fn);
    }
  } catch (e) {
    errs++;
    badPatterns.set(d.pattern, "ERR " + e.message);
    continue;
  }
  if (canon(res) === canon(d.res)) ok++;
  else {
    bad++;
    if (!badPatterns.has(d.pattern)) badPatterns.set(d.pattern, { fn: d.fn, flags: d.flags, args: d.args, expected: d.res, got: res });
  }
}
console.log(`ok=${ok} bad=${bad} errors=${errs}`);
let n = 0;
for (const [p, info] of badPatterns) {
  if (n++ > 12) break;
  console.log("PATTERN:", JSON.stringify(p));
  console.log("  ", JSON.stringify(info).slice(0, 900));
}
