/* طبقة توافق مع بايثون: التعابير النمطية، دوال النصوص، difflib.SequenceMatcher.
 *
 * الأداة الأصلية مكتوبة ببايثون وتعتمد كثيرًا على سلوك re وstr في بايثون
 * (مثل \w و\d و\s و\b بمعناها في Unicode). هذه الطبقة تحوّل أنماط بايثون إلى
 * أنماط JavaScript مكافئة، وتوفّر واجهة re نفسها حتى تبقى منطقيات النقل مطابقة.
 */
"use strict";

const PY = (() => {
  // ---------------------------------------------------------------- whitespace
  // str.isspace() / re \s في بايثون (Unicode).
  const WS_CHARS = "\t\n\x0b\x0c\r\x1c\x1d\x1e\x1f \x85\xa0\u1680" +
    "\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a" +
    "\u2028\u2029\u202f\u205f\u3000";
  const WS_SET = new Set(Array.from(WS_CHARS));
  const WS_CLASS = "\\t\\n\\x0B\\x0C\\r\\x1C-\\x1F \\x85\\xA0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000";
  const WORD_CLASS = "\\p{L}\\p{N}_";
  const LINE_BREAKS = new Set(["\n", "\r", "\x0b", "\x0c", "\x1c", "\x1d", "\x1e", "\x85", "\u2028", "\u2029"]);

  // ---------------------------------------------------------------- regex translation
  const RE_I = 2, RE_L = 4, RE_M = 8, RE_S = 16, RE_U = 32, RE_X = 64, RE_A = 256;

  class PyRegexError extends Error {}

  function hex(cp, width) {
    return cp.toString(16).toUpperCase().padStart(width, "0");
  }

  function cpEscape(ch) {
    const cp = ch.codePointAt(0);
    if (cp > 0xffff) return "\\u{" + hex(cp, 1) + "}";
    return "\\u" + hex(cp, 4);
  }

  function literal(ch, inClass) {
    const cp = ch.codePointAt(0);
    if (cp < 0x20 || (cp >= 0x7f && cp <= 0x9f) || cp === 0x2028 || cp === 0x2029) return cpEscape(ch);
    if (inClass) return "\\]^-[".includes(ch) ? "\\" + ch : ch;
    return "^$\\.*+?()[]{}|/".includes(ch) ? "\\" + ch : ch;
  }

  const HEXD = /^[0-9A-Fa-f]$/;
  const OCT = /^[0-7]$/;

  // Parse an escape starting at cps[i] === "\\".  Returns {kind, ...}:
  //  kind "char": a single literal code point (ch)
  //  kind "class": shorthand set; {pos: class-content, neg: bool, content}
  //  kind "raw": already-translated JS fragment (outside classes only)
  function parseEscape(cps, i, inClass) {
    const d = cps[i + 1];
    if (d === undefined) throw new PyRegexError("bad escape (end of pattern)");
    const one = (kind, extra, len = 2) => Object.assign({ kind, next: i + len }, extra);
    switch (d) {
      case "d": return one("class", { content: "\\p{Nd}", neg: false });
      case "D": return one("class", { content: "\\p{Nd}", neg: true });
      case "w": return one("class", { content: WORD_CLASS, neg: false });
      case "W": return one("class", { content: WORD_CLASS, neg: true });
      case "s": return one("class", { content: WS_CLASS, neg: false });
      case "S": return one("class", { content: WS_CLASS, neg: true });
      case "n": return one("char", { ch: "\n" });
      case "t": return one("char", { ch: "\t" });
      case "r": return one("char", { ch: "\r" });
      case "f": return one("char", { ch: "\x0c" });
      case "v": return one("char", { ch: "\x0b" });
      case "a": return one("char", { ch: "\x07" });
      case "b":
        if (inClass) return one("char", { ch: "\x08" });
        return one("raw", { js: "(?:(?<=[" + WORD_CLASS + "])(?![" + WORD_CLASS + "])|(?<![" + WORD_CLASS + "])(?=[" + WORD_CLASS + "]))" });
      case "B":
        if (inClass) throw new PyRegexError("bad escape \\B");
        return one("raw", { js: "(?:(?<=[" + WORD_CLASS + "])(?=[" + WORD_CLASS + "])|(?<![" + WORD_CLASS + "])(?![" + WORD_CLASS + "]))" });
      case "A":
        if (inClass) throw new PyRegexError("bad escape \\A");
        return one("raw", { js: "(?<![\\s\\S])" });
      case "Z":
        if (inClass) throw new PyRegexError("bad escape \\Z");
        return one("raw", { js: "(?![\\s\\S])" });
      case "x": {
        const h = (cps[i + 2] || "") + (cps[i + 3] || "");
        if (!/^[0-9A-Fa-f]{2}$/.test(h)) throw new PyRegexError("incomplete escape \\x");
        return one("char", { ch: String.fromCodePoint(parseInt(h, 16)) }, 4);
      }
      case "u": {
        const h = cps.slice(i + 2, i + 6).join("");
        if (!/^[0-9A-Fa-f]{4}$/.test(h)) throw new PyRegexError("incomplete escape \\u");
        return one("char", { ch: String.fromCodePoint(parseInt(h, 16)) }, 6);
      }
      case "U": {
        const h = cps.slice(i + 2, i + 10).join("");
        if (!/^[0-9A-Fa-f]{8}$/.test(h)) throw new PyRegexError("incomplete escape \\U");
        return one("char", { ch: String.fromCodePoint(parseInt(h, 16)) }, 10);
      }
      default: break;
    }
    if (d === "0") {
      let j = i + 2, v = "";
      while (j < i + 4 && OCT.test(cps[j] || "")) v += cps[j++];
      return { kind: "char", ch: String.fromCodePoint(parseInt("0" + v, 8)), next: j };
    }
    if (/^[1-9]$/.test(d)) {
      // octal escape of 3 digits, otherwise a backreference (outside classes)
      const three = cps.slice(i + 1, i + 4).join("");
      if (/^[0-7]{3}$/.test(three)) return { kind: "char", ch: String.fromCodePoint(parseInt(three, 8)), next: i + 4 };
      if (inClass) throw new PyRegexError("bad escape in class");
      let j = i + 1, num = "";
      while (j < i + 3 && /^[0-9]$/.test(cps[j] || "")) num += cps[j++];
      return { kind: "raw", js: "\\" + num, next: j, backref: true };
    }
    if (/^[A-Za-z]$/.test(d)) throw new PyRegexError("bad escape \\" + d);
    return { kind: "char", ch: d, next: i + 2 };
  }

  function translateClass(cps, i) {
    // cps[i] === "["
    let j = i + 1;
    let neg = false;
    if (cps[j] === "^") { neg = true; j++; }
    const pos = [];      // JS class-content fragments (positive)
    const negSets = [];  // contents whose complement is part of the set (\W, \S)
    let first = true;
    const readAtom = (k) => {
      const c = cps[k];
      if (c === "\\") {
        const e = parseEscape(cps, k, true);
        return e;
      }
      return { kind: "char", ch: c, next: k + 1 };
    };
    for (;;) {
      if (j >= cps.length) throw new PyRegexError("unterminated character set");
      const c = cps[j];
      if (c === "]" && !first) { j++; break; }
      first = false;
      const a = readAtom(j);
      if (a.kind === "char" && cps[a.next] === "-" && cps[a.next + 1] !== undefined && cps[a.next + 1] !== "]") {
        const b = readAtom(a.next + 1);
        if (b.kind !== "char") throw new PyRegexError("bad character range");
        if (b.ch.codePointAt(0) < a.ch.codePointAt(0)) throw new PyRegexError("bad character range");
        pos.push(literal(a.ch, true) + "-" + literal(b.ch, true));
        j = b.next;
        continue;
      }
      if (a.kind === "char") pos.push(literal(a.ch, true));
      else if (a.kind === "class") {
        if (a.neg) {
          if (a.content === "\\p{Nd}") pos.push("\\P{Nd}");
          else negSets.push(a.content);
        } else pos.push(a.content);
      } else throw new PyRegexError("unsupported escape in class");
      j = a.next;
    }
    const P = pos.join("");
    if (!negSets.length) return { js: (neg ? "[^" : "[") + P + "]", next: j };
    if (!neg) {
      const alts = [];
      if (P) alts.push("[" + P + "]");
      for (const n of negSets) alts.push("[^" + n + "]");
      return { js: "(?:" + alts.join("|") + ")", next: j };
    }
    let s = "(?:";
    if (P) s += "(?![" + P + "])";
    for (let k = 0; k < negSets.length - 1; k++) s += "(?=[" + negSets[k] + "])";
    s += "[" + negSets[negSets.length - 1] + "])";
    return { js: s, next: j };
  }

  function translate(pattern, flags) {
    const cps = Array.from(pattern);
    let I = !!(flags & RE_I), M = !!(flags & RE_M), S = !!(flags & RE_S);
    if (flags & RE_X) throw new PyRegexError("re.VERBOSE is not supported");
    let out = "";
    let i = 0;
    let groups = 0;
    const names = [];
    while (i < cps.length) {
      const c = cps[i];
      if (c === "\\") {
        const e = parseEscape(cps, i, false);
        if (e.kind === "char") out += literal(e.ch, false);
        else if (e.kind === "class") out += (e.neg ? "[^" : "[") + e.content + "]";
        else out += e.js;
        i = e.next;
        continue;
      }
      if (c === "[") {
        const r = translateClass(cps, i);
        out += r.js;
        i = r.next;
        continue;
      }
      if (c === ".") { out += S ? "[\\s\\S]" : "[^\\n]"; i++; continue; }
      if (c === "^") { out += M ? "(?:(?<![\\s\\S])|(?<=\\n))" : "(?<![\\s\\S])"; i++; continue; }
      if (c === "$") { out += M ? "(?=\\n|(?![\\s\\S]))" : "(?=\\n?(?![\\s\\S]))"; i++; continue; }
      if (c === "(") {
        if (cps[i + 1] === "?") {
          const c2 = cps[i + 2];
          if (c2 === "P" && cps[i + 3] === "<") {
            let j = i + 4, name = "";
            while (j < cps.length && cps[j] !== ">") name += cps[j++];
            groups++; names.push([name, groups]);
            out += "(?<" + name + ">";
            i = j + 1;
            continue;
          }
          if (c2 === "P" && cps[i + 3] === "=") {
            let j = i + 4, name = "";
            while (j < cps.length && cps[j] !== ")") name += cps[j++];
            out += "\\k<" + name + ">";
            i = j + 1;
            continue;
          }
          if (c2 === "#") {
            let j = i + 3;
            while (j < cps.length && cps[j] !== ")") j++;
            i = j + 1;
            continue;
          }
          if (c2 === "<" && cps[i + 3] !== "=" && cps[i + 3] !== "!") {
            // (?<name>...) is also accepted by Python 3.x? Only (?P<name>); treat as error.
            throw new PyRegexError("unknown extension ?<" + cps[i + 3]);
          }
          if (/^[aiLmsux-]$/.test(c2 || "")) {
            let j = i + 2, letters = "";
            while (j < cps.length && /^[aiLmsux-]$/.test(cps[j])) letters += cps[j++];
            if (cps[j] === ")") {
              if (letters.includes("i")) I = true;
              if (letters.includes("m")) M = true;
              if (letters.includes("s")) S = true;
              if (letters.includes("x")) throw new PyRegexError("verbose inline flag unsupported");
              i = j + 1;
              continue;
            }
            throw new PyRegexError("scoped inline flags are not supported");
          }
          // (?: (?= (?! (?<= (?<!  — copied verbatim
          out += "(?";
          i += 2;
          continue;
        }
        groups++;
        out += "(";
        i++;
        continue;
      }
      if (c === "{") {
        const rest = cps.slice(i, i + 24).join("");
        const m = /^\{(\d*)(,?)(\d*)\}/.exec(rest);
        if (m && (m[1] !== "" || (m[2] === "," && m[3] !== ""))) {
          const lo = m[1] === "" ? "0" : m[1];
          out += "{" + lo + m[2] + m[3] + "}";
          i += m[0].length;
          continue;
        }
        out += "\\{";
        i++;
        continue;
      }
      if (c === "}") { out += "\\}"; i++; continue; }
      if (c === "]") { out += "\\]"; i++; continue; }
      if (c === "/") { out += "\\/"; i++; continue; }
      const cp = c.codePointAt(0);
      if (cp < 0x20 || cp === 0x2028 || cp === 0x2029) out += cpEscape(c);
      else out += c;
      i++;
    }
    return { src: out, I, groups, names };
  }

  // ---------------------------------------------------------------- match objects
  class PyMatch {
    constructor(m, string, pattern) {
      this._m = m;
      this.string = string;
      this.re = pattern;
    }
    _idx(k) {
      if (typeof k === "number") {
        if (k < 0 || k >= this._m.length) throw new Error("IndexError: no such group");
        return k;
      }
      const n = this.re._nameIndex.get(k);
      if (n === undefined) throw new Error("IndexError: no such group " + k);
      return n;
    }
    group(...args) {
      if (args.length === 0) args = [0];
      const vals = args.map((a) => {
        const v = this._m[this._idx(a)];
        return v === undefined ? null : v;
      });
      return args.length === 1 ? vals[0] : vals;
    }
    groups(dflt = null) {
      return this._m.slice(1).map((v) => (v === undefined ? dflt : v));
    }
    groupdict(dflt = null) {
      const out = {};
      for (const [name, n] of this.re._nameIndex) {
        const v = this._m[n];
        out[name] = v === undefined ? dflt : v;
      }
      return out;
    }
    start(k = 0) {
      const ix = this._m.indices[this._idx(k)];
      return ix ? ix[0] : -1;
    }
    end(k = 0) {
      const ix = this._m.indices[this._idx(k)];
      return ix ? ix[1] : -1;
    }
    span(k = 0) {
      return [this.start(k), this.end(k)];
    }
  }

  // ---------------------------------------------------------------- pattern objects
  function codePointLenAt(s, i) {
    const cp = s.codePointAt(i);
    return cp !== undefined && cp > 0xffff ? 2 : 1;
  }

  class PyPattern {
    constructor(pattern, flags = 0) {
      this.pattern = pattern;
      this.flags = flags;
      const t = translate(pattern, flags);
      this._src = t.src;
      this._jsflags = "ud" + (t.I ? "i" : "");
      this._g = new RegExp(t.src, this._jsflags + "g");
      this._y = new RegExp(t.src, this._jsflags + "y");
      this._full = null;
      this.groups = t.groups;
      this._nameIndex = new Map(t.names);
    }
    search(s, pos = 0) {
      this._g.lastIndex = pos;
      const m = this._g.exec(s);
      return m ? new PyMatch(m, s, this) : null;
    }
    match(s, pos = 0) {
      this._y.lastIndex = pos;
      const m = this._y.exec(s);
      return m ? new PyMatch(m, s, this) : null;
    }
    fullmatch(s) {
      if (!this._full) this._full = new RegExp("(?:" + this._src + ")(?![\\s\\S])", this._jsflags + "y");
      this._full.lastIndex = 0;
      const m = this._full.exec(s);
      return m ? new PyMatch(m, s, this) : null;
    }
    finditer(s) {
      const out = [];
      let pos = 0;
      const re = this._g;
      while (pos <= s.length) {
        re.lastIndex = pos;
        const m = re.exec(s);
        if (!m) break;
        out.push(new PyMatch(m, s, this));
        const end = m.index + m[0].length;
        if (m[0].length === 0) {
          if (end >= s.length) break;
          pos = end + codePointLenAt(s, end);
        } else {
          pos = end;
        }
      }
      return out;
    }
    findall(s) {
      return this.finditer(s).map((m) => {
        if (this.groups === 0) return m.group(0);
        if (this.groups === 1) return m.group(1) ?? "";
        return m.groups("");
      });
    }
    subn(repl, s, count = 0) {
      const fn = typeof repl === "function" ? repl : compileTemplate(repl, this);
      let out = "";
      let last = 0;
      let n = 0;
      for (const m of this.finditer(s)) {
        if (count && n >= count) break;
        out += s.slice(last, m.start()) + fn(m);
        last = m.end();
        n++;
      }
      return [out + s.slice(last), n];
    }
    sub(repl, s, count = 0) {
      return this.subn(repl, s, count)[0];
    }
    split(s, maxsplit = 0) {
      const out = [];
      let last = 0;
      let n = 0;
      for (const m of this.finditer(s)) {
        if (maxsplit && n >= maxsplit) break;
        out.push(s.slice(last, m.start()));
        for (let g = 1; g <= this.groups; g++) out.push(m.group(g));
        last = m.end();
        n++;
      }
      out.push(s.slice(last));
      return out;
    }
  }

  // Python replacement templates: \1, \g<1>, \g<name>, \n ...
  function compileTemplate(tpl, pattern) {
    const parts = [];
    let lit = "";
    const cps = Array.from(tpl);
    for (let i = 0; i < cps.length; i++) {
      const c = cps[i];
      if (c !== "\\") { lit += c; continue; }
      const d = cps[i + 1];
      if (d === undefined) throw new PyRegexError("bad escape (end of pattern)");
      if (d === "g") {
        if (cps[i + 2] !== "<") throw new PyRegexError("missing <");
        let j = i + 3, name = "";
        while (j < cps.length && cps[j] !== ">") name += cps[j++];
        if (lit) { parts.push(lit); lit = ""; }
        parts.push(/^\d+$/.test(name) ? parseInt(name, 10) : name);
        i = j;
        continue;
      }
      if (d === "0") {
        let j = i + 2, v = "";
        while (j < i + 4 && OCT.test(cps[j] || "")) v += cps[j++];
        lit += String.fromCodePoint(parseInt("0" + v, 8));
        i = j - 1;
        continue;
      }
      if (/^[1-9]$/.test(d)) {
        const three = cps.slice(i + 1, i + 4).join("");
        if (/^[0-7]{3}$/.test(three)) { lit += String.fromCodePoint(parseInt(three, 8)); i += 3; continue; }
        let j = i + 1, num = "";
        while (j < i + 3 && /^[0-9]$/.test(cps[j] || "")) num += cps[j++];
        if (lit) { parts.push(lit); lit = ""; }
        parts.push(parseInt(num, 10));
        i = j - 1;
        continue;
      }
      const esc = { n: "\n", t: "\t", r: "\r", f: "\x0c", v: "\x0b", a: "\x07", b: "\x08", "\\": "\\" };
      if (d in esc) { lit += esc[d]; i++; continue; }
      if (/^[A-Za-z]$/.test(d)) throw new PyRegexError("bad escape \\" + d);
      lit += "\\" + d;
      i++;
    }
    if (lit) parts.push(lit);
    return (m) => {
      let s = "";
      for (const p of parts) {
        if (typeof p === "string") s += p;
        else {
          const v = m.group(p);
          s += v === null ? "" : v;
        }
      }
      return s;
    };
  }

  const cache = new Map();
  function compile(p, flags = 0) {
    if (p instanceof PyPattern) return p;
    const key = flags + "\u0000" + p;
    let c = cache.get(key);
    if (!c) {
      c = new PyPattern(p, flags);
      if (cache.size > 2000) cache.clear();
      cache.set(key, c);
    }
    return c;
  }

  function escape(s) {
    let out = "";
    for (const ch of String(s)) {
      if ("()[]{}?*+-|^$\\.&~# \t\n\r\x0b\x0c".includes(ch)) out += "\\" + ch;
      else out += ch;
    }
    return out;
  }

  const re = {
    I: RE_I, IGNORECASE: RE_I, L: RE_L, M: RE_M, MULTILINE: RE_M, S: RE_S, DOTALL: RE_S,
    U: RE_U, UNICODE: RE_U, X: RE_X, A: RE_A,
    compile,
    escape,
    error: PyRegexError,
    search: (p, s, flags = 0) => compile(p, flags).search(s),
    match: (p, s, flags = 0) => compile(p, flags).match(s),
    fullmatch: (p, s, flags = 0) => compile(p, flags).fullmatch(s),
    finditer: (p, s, flags = 0) => compile(p, flags).finditer(s),
    findall: (p, s, flags = 0) => compile(p, flags).findall(s),
    sub: (p, repl, s, count = 0, flags = 0) => compile(p, flags).sub(repl, s, count),
    subn: (p, repl, s, count = 0, flags = 0) => compile(p, flags).subn(repl, s, count),
    split: (p, s, maxsplit = 0, flags = 0) => compile(p, flags).split(s, maxsplit),
    _translate: translate,
  };

  // ---------------------------------------------------------------- str helpers
  function isspace(ch) { return WS_SET.has(ch); }

  function _stripSet(chars) {
    if (chars === undefined || chars === null) return WS_SET;
    return new Set(Array.from(chars));
  }
  function strip(s, chars) {
    s = s ?? "";
    const set = _stripSet(chars);
    let a = 0, b = s.length;
    while (a < b && set.has(s[a])) a++;
    while (b > a && set.has(s[b - 1])) b--;
    return s.slice(a, b);
  }
  function lstrip(s, chars) {
    s = s ?? "";
    const set = _stripSet(chars);
    let a = 0;
    while (a < s.length && set.has(s[a])) a++;
    return s.slice(a);
  }
  function rstrip(s, chars) {
    s = s ?? "";
    const set = _stripSet(chars);
    let b = s.length;
    while (b > 0 && set.has(s[b - 1])) b--;
    return s.slice(0, b);
  }
  // str.split(sep=None, maxsplit=-1)
  function split(s, sep = null, maxsplit = -1) {
    s = s ?? "";
    if (sep === null || sep === undefined) {
      const out = [];
      let i = 0;
      const n = s.length;
      while (i < n) {
        while (i < n && WS_SET.has(s[i])) i++;
        if (i >= n) break;
        if (maxsplit >= 0 && out.length >= maxsplit) {
          let rest = s.slice(i);
          rest = rstrip(rest);
          out.push(rest);
          return out;
        }
        let j = i;
        while (j < n && !WS_SET.has(s[j])) j++;
        out.push(s.slice(i, j));
        i = j;
      }
      return out;
    }
    if (sep === "") throw new Error("ValueError: empty separator");
    if (maxsplit < 0) return s.split(sep);
    const out = [];
    let pos = 0;
    while (out.length < maxsplit) {
      const k = s.indexOf(sep, pos);
      if (k < 0) break;
      out.push(s.slice(pos, k));
      pos = k + sep.length;
    }
    out.push(s.slice(pos));
    return out;
  }
  function splitlines(s, keepends = false) {
    s = s ?? "";
    const out = [];
    let i = 0, start = 0;
    const n = s.length;
    while (i < n) {
      const ch = s[i];
      if (LINE_BREAKS.has(ch)) {
        let eol = i + 1;
        if (ch === "\r" && s[i + 1] === "\n") eol = i + 2;
        out.push(s.slice(start, keepends ? eol : i));
        start = eol;
        i = eol;
      } else i++;
    }
    if (start < n) out.push(s.slice(start));
    return out;
  }
  function startswith(s, prefix) {
    s = s ?? "";
    if (Array.isArray(prefix)) return prefix.some((p) => s.startsWith(p));
    return s.startsWith(prefix);
  }
  function endswith(s, suffix) {
    s = s ?? "";
    if (Array.isArray(suffix)) return suffix.some((p) => s.endsWith(p));
    return s.endsWith(suffix);
  }
  function replace(s, old, nw, count = -1) {
    s = s ?? "";
    if (count < 0) return s.split(old).join(nw);
    let out = "", pos = 0, n = 0;
    while (n < count) {
      const k = s.indexOf(old, pos);
      if (k < 0 || old === "") break;
      out += s.slice(pos, k) + nw;
      pos = k + old.length;
      n++;
    }
    return out + s.slice(pos);
  }
  function isalphaChar(ch) { return /^\p{L}$/u.test(ch); }
  function anyAlpha(s) { return /\p{L}/u.test(String(s ?? "")); }
  // len() in code points
  function len(x) {
    if (typeof x === "string") { let n = 0; for (const _ of x) n++; return n; }
    return x.length;
  }

  // ---------------------------------------------------------------- int()
  let DIGIT_VALUE = null;
  function digitValue(ch) {
    if (!DIGIT_VALUE) {
      DIGIT_VALUE = new Map();
      const isNd = /^\p{Nd}$/u;
      let runStart = -1;
      for (let cp = 0x30; cp <= 0x1fbff; cp++) {
        const c = String.fromCodePoint(cp);
        if (isNd.test(c)) {
          if (runStart < 0) runStart = cp;
          DIGIT_VALUE.set(c, (cp - runStart) % 10);
        } else runStart = -1;
      }
    }
    return DIGIT_VALUE.get(ch);
  }
  class PyValueError extends Error {}
  function int(x) {
    if (typeof x === "number") return Math.trunc(x);
    const s = strip(String(x ?? "None"));
    const m = /^([+-]?)(.*)$/su.exec(s);
    const body = m[2];
    if (!body) throw new PyValueError("invalid literal for int(): " + JSON.stringify(x));
    let v = 0;
    let prevUnderscore = true;
    for (const ch of body) {
      if (ch === "_") {
        if (prevUnderscore) throw new PyValueError("invalid literal for int()");
        prevUnderscore = true;
        continue;
      }
      const d = digitValue(ch);
      if (d === undefined) throw new PyValueError("invalid literal for int(): " + JSON.stringify(x));
      v = v * 10 + d;
      prevUnderscore = false;
    }
    if (prevUnderscore) throw new PyValueError("invalid literal for int()");
    return m[1] === "-" ? -v : v;
  }
  function pad2(n) {
    const v = typeof n === "number" ? n : int(n);
    return v < 0 ? "-" + String(-v).padStart(2, "0") : String(v).padStart(2, "0");
  }
  // f"{x:.0f}" (round-half-even on exact binary value)
  function fmt0(x) {
    const f = Math.floor(x);
    const diff = x - f;
    if (diff === 0.5) return String(f % 2 === 0 ? f : f + 1);
    const r = x.toFixed(0);
    return r === "-0" ? "0" : r;
  }
  // Python str(float)/str(int) for values coming from Excel etc.
  function strNumber(v) {
    if (Number.isInteger(v) && !Object.is(v, -0)) return String(v);
    return pyFloatRepr(v);
  }
  function pyFloatRepr(v) {
    if (Number.isNaN(v)) return "nan";
    if (v === Infinity) return "inf";
    if (v === -Infinity) return "-inf";
    if (Object.is(v, -0)) return "-0.0";
    // shortest repr digits (same algorithm in JS and Python), different exponent formatting
    let s = String(v);
    const m = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]\d+))?$/.exec(s);
    if (!m) return s;
    const sign = m[1];
    const digitsAll = (m[2] + (m[3] || "")).replace(/^0+/, "") || "0";
    // decimal exponent of the first significant digit
    let exp;
    if (m[4] !== undefined) {
      exp = parseInt(m[4], 10) + (m[2].length - 1);
    } else if (/^0+$/.test(m[2])) {
      const frac = m[3] || "";
      const lead = frac.length - frac.replace(/^0+/, "").length;
      exp = -(lead + 1);
    } else {
      exp = m[2].replace(/^0+/, "").length - 1;
    }
    const digits = digitsAll.replace(/0+$/, "") || "0";
    if (exp < -4 || exp >= 16) {
      const mant = digits.length > 1 ? digits[0] + "." + digits.slice(1) : digits;
      const e = exp < 0 ? "-" + String(-exp).padStart(2, "0") : "+" + String(exp).padStart(2, "0");
      return sign + mant + "e" + e;
    }
    if (exp < 0) return sign + "0." + "0".repeat(-exp - 1) + digits;
    const intPart = digits.length > exp + 1 ? digits.slice(0, exp + 1) : digits + "0".repeat(exp + 1 - digits.length);
    const frac = digits.length > exp + 1 ? digits.slice(exp + 1) : "0";
    return sign + intPart + "." + frac;
  }

  // ---------------------------------------------------------------- difflib.SequenceMatcher
  class SequenceMatcher {
    constructor(isjunk, a = "", b = "", autojunk = true) {
      this.isjunk = isjunk;
      this.autojunk = autojunk;
      this.a = this.b = null;
      this.set_seqs(a, b);
    }
    set_seqs(a, b) { this.set_seq1(a); this.set_seq2(b); }
    set_seq1(a) {
      this.a = typeof a === "string" ? Array.from(a) : a;
      this.matching_blocks = null;
    }
    set_seq2(b) {
      this.b = typeof b === "string" ? Array.from(b) : b;
      this.matching_blocks = null;
      this.fullbcount = null;
      this._chain_b();
    }
    _chain_b() {
      const b = this.b;
      const b2j = new Map();
      for (let i = 0; i < b.length; i++) {
        const elt = b[i];
        let ix = b2j.get(elt);
        if (!ix) { ix = []; b2j.set(elt, ix); }
        ix.push(i);
      }
      const junk = new Set();
      if (this.isjunk) {
        for (const elt of b2j.keys()) if (this.isjunk(elt)) junk.add(elt);
        for (const elt of junk) b2j.delete(elt);
      }
      const popular = new Set();
      const n = b.length;
      if (this.autojunk && n >= 200) {
        const ntest = Math.floor(n / 100) + 1;
        for (const [elt, idxs] of b2j) if (idxs.length > ntest) popular.add(elt);
        for (const elt of popular) b2j.delete(elt);
      }
      this.b2j = b2j;
      this.bjunk = junk;
      this.bpopular = popular;
    }
    find_longest_match(alo = 0, ahi = null, blo = 0, bhi = null) {
      const a = this.a, b = this.b, b2j = this.b2j, junk = this.bjunk;
      if (ahi === null) ahi = a.length;
      if (bhi === null) bhi = b.length;
      let besti = alo, bestj = blo, bestsize = 0;
      let j2len = new Map();
      const nothing = [];
      for (let i = alo; i < ahi; i++) {
        const newj2len = new Map();
        for (const j of b2j.get(a[i]) || nothing) {
          if (j < blo) continue;
          if (j >= bhi) break;
          const k = (j2len.get(j - 1) || 0) + 1;
          newj2len.set(j, k);
          if (k > bestsize) { besti = i - k + 1; bestj = j - k + 1; bestsize = k; }
        }
        j2len = newj2len;
      }
      while (besti > alo && bestj > blo && !junk.has(b[bestj - 1]) && a[besti - 1] === b[bestj - 1]) {
        besti--; bestj--; bestsize++;
      }
      while (besti + bestsize < ahi && bestj + bestsize < bhi && !junk.has(b[bestj + bestsize]) && a[besti + bestsize] === b[bestj + bestsize]) {
        bestsize++;
      }
      while (besti > alo && bestj > blo && junk.has(b[bestj - 1]) && a[besti - 1] === b[bestj - 1]) {
        besti--; bestj--; bestsize++;
      }
      while (besti + bestsize < ahi && bestj + bestsize < bhi && junk.has(b[bestj + bestsize]) && a[besti + bestsize] === b[bestj + bestsize]) {
        bestsize++;
      }
      return [besti, bestj, bestsize];
    }
    get_matching_blocks() {
      if (this.matching_blocks !== null) return this.matching_blocks;
      const la = this.a.length, lb = this.b.length;
      const queue = [[0, la, 0, lb]];
      const blocks = [];
      while (queue.length) {
        const [alo, ahi, blo, bhi] = queue.pop();
        const x = this.find_longest_match(alo, ahi, blo, bhi);
        const [i, j, k] = x;
        if (k) {
          blocks.push(x);
          if (alo < i && blo < j) queue.push([alo, i, blo, j]);
          if (i + k < ahi && j + k < bhi) queue.push([i + k, ahi, j + k, bhi]);
        }
      }
      blocks.sort((p, q) => p[0] - q[0] || p[1] - q[1] || p[2] - q[2]);
      let i1 = 0, j1 = 0, k1 = 0;
      const nonAdjacent = [];
      for (const [i2, j2, k2] of blocks) {
        if (i1 + k1 === i2 && j1 + k1 === j2) k1 += k2;
        else {
          if (k1) nonAdjacent.push([i1, j1, k1]);
          i1 = i2; j1 = j2; k1 = k2;
        }
      }
      if (k1) nonAdjacent.push([i1, j1, k1]);
      nonAdjacent.push([la, lb, 0]);
      this.matching_blocks = nonAdjacent;
      return nonAdjacent;
    }
    ratio() {
      let matches = 0;
      for (const t of this.get_matching_blocks()) matches += t[2];
      const length = this.a.length + this.b.length;
      return length ? (2.0 * matches) / length : 1.0;
    }
  }

  // ---------------------------------------------------------------- misc
  function deepEqual(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  function clone(x) {
    if (x === null || x === undefined) return x;
    if (typeof structuredClone === "function") return structuredClone(x);
    return JSON.parse(JSON.stringify(x));
  }
  // Python tuple-like comparison of arrays (numbers / strings).
  function cmpTuple(a, b) {
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) {
      const x = a[i], y = b[i];
      if (x < y) return -1;
      if (x > y) return 1;
    }
    return a.length - b.length;
  }
  // Python's code-point string comparison (JS compares UTF-16 units).
  function cmpStr(a, b) {
    if (a === b) return 0;
    const A = Array.from(a), B = Array.from(b);
    const n = Math.min(A.length, B.length);
    for (let i = 0; i < n; i++) {
      const x = A[i].codePointAt(0), y = B[i].codePointAt(0);
      if (x !== y) return x < y ? -1 : 1;
    }
    return A.length - B.length;
  }

  return {
    re, PyPattern, PyMatch, PyRegexError, PyValueError,
    WS_CHARS, isspace, strip, lstrip, rstrip, split, splitlines, startswith, endswith, replace,
    isalphaChar, anyAlpha, len, int, pad2, fmt0, strNumber, pyFloatRepr,
    SequenceMatcher, deepEqual, clone, cmpTuple, cmpStr,
  };
})();

if (typeof module !== "undefined") module.exports = PY;
