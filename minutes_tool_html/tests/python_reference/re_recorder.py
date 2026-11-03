"""Record every regex call made from the tool's own modules (core/, app.py, department_panel.py)."""
import json, os, re, sys, atexit

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.environ.get("RE_RECORD_OUT", "/tmp/re_calls.jsonl")
_seen = set()
_fh = open(OUT, "a", encoding="utf-8")
atexit.register(_fh.close)

_orig = {n: getattr(re, n) for n in ("compile", "search", "match", "fullmatch", "sub", "subn", "split", "findall", "finditer")}

def _ours():
    f = sys._getframe(2)
    fn = f.f_code.co_filename
    return fn.startswith(ROOT) and "/tests/" not in fn and "re_recorder" not in fn

def _ser_match(m):
    if m is None:
        return None
    return {"span": list(m.span()), "groups": [list(m.span(i)) for i in range(1, (m.re.groups or 0) + 1)],
            "g": [m.group(i) for i in range(0, (m.re.groups or 0) + 1)]}

def _log(rec):
    key = json.dumps(rec, ensure_ascii=False, sort_keys=True)
    if key in _seen:
        return
    _seen.add(key)
    _fh.write(key + "\n")

def _pat(p):
    return (p.pattern, p.flags & ~re.UNICODE) if isinstance(p, re.Pattern) else (p, None)

class _P:
    def __init__(self, p):
        self._p = p
        self.pattern, self.flags, self.groups = p.pattern, p.flags, p.groups
    def _rec(self, fn, args, res):
        _log({"fn": fn, "pattern": self._p.pattern, "flags": self._p.flags & ~re.UNICODE, "args": args, "res": res})
    def search(self, s, *a):
        r = self._p.search(s, *a); self._rec("search", [s] + list(a), _ser_match(r)); return r
    def match(self, s, *a):
        r = self._p.match(s, *a); self._rec("match", [s] + list(a), _ser_match(r)); return r
    def fullmatch(self, s, *a):
        r = self._p.fullmatch(s, *a); self._rec("fullmatch", [s] + list(a), _ser_match(r)); return r
    def finditer(self, s, *a):
        r = list(self._p.finditer(s, *a)); self._rec("finditer", [s] + list(a), [_ser_match(m) for m in r]); return iter(r)
    def findall(self, s, *a):
        r = self._p.findall(s, *a); self._rec("findall", [s] + list(a), [list(x) if isinstance(x, tuple) else x for x in r]); return r
    def sub(self, repl, s, count=0):
        r = self._p.sub(repl, s, count)
        if isinstance(repl, str):
            self._rec("sub", [repl, s, count], r)
        else:
            _log({"fn": "sub_fn", "pattern": self._p.pattern, "flags": self._p.flags & ~re.UNICODE, "args": [None, s, count], "res": r,
                  "matches": [_ser_match(m) for m in self._p.finditer(s)]})
        return r
    def split(self, s, maxsplit=0):
        r = self._p.split(s, maxsplit); self._rec("split", [s, maxsplit], r); return r

def compile(p, flags=0):
    c = _orig["compile"](p, flags)
    return _P(c) if _ours() else c

def _wrap(name):
    def f(pattern, *args, **kw):
        if not _ours():
            return _orig[name](pattern, *args, **kw)
        flags = kw.pop("flags", 0)
        if name in ("search", "match", "fullmatch", "findall", "finditer"):
            s = args[0]
            if len(args) > 1: flags = args[1]
            p = _orig["compile"](pattern, flags)
            return getattr(_P(p), name)(s)
        if name == "sub":
            repl, s = args[0], args[1]
            count = kw.pop("count", args[2] if len(args) > 2 else 0)
            if len(args) > 3: flags = args[3]
            p = _orig["compile"](pattern, flags)
            if callable(repl):
                r = p.sub(repl, s, count)
                _log({"fn": "sub_fn", "pattern": p.pattern, "flags": p.flags & ~re.UNICODE, "args": [None, s, count], "res": r,
                      "matches": [_ser_match(m) for m in p.finditer(s)]})
                return r
            return _P(p).sub(repl, s, count)
        if name == "split":
            s = args[0]
            maxsplit = kw.pop("maxsplit", args[1] if len(args) > 1 else 0)
            if len(args) > 2: flags = args[2]
            p = _orig["compile"](pattern, flags)
            return _P(p).split(s, maxsplit)
        return _orig[name](pattern, *args, **kw)
    return f

def install():
    re.compile = compile
    for n in ("search", "match", "fullmatch", "sub", "split", "findall", "finditer"):
        setattr(re, n, _wrap(n))
