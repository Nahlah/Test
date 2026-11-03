/* مطابقة موضوع جديد بمواضيع سابقة مشابهة — منقول من core/similarity.py.
 * يتضمن تنفيذًا مطابقًا لـ TfidfVectorizer من scikit-learn (char_wb و word) مع
 * cosine_similarity.
 */
"use strict";

const Similarity = (() => {
  const { re, strip } = PY;

  const DIACRITICS = re.compile("[\\u0617-\\u061A\\u064B-\\u0652\\u0670\\u06D6-\\u06ED]");
  const TATWEEL = "ـ";

  const TOPIC_FAMILIES = [
    ["research_bonus", ["بدل التميز", "بدل تميز", "مكافأة التميز", "مكافاة التميز"]],
    ["promotion", ["ترقية", "الترقية العلمية"]],
    ["sabbatical", ["تفرغ علمي", "التفرغ العلمي"]],
    ["conference", ["مؤتمر", "ندوة", "مشاركة علمية"]],
    ["scholarship", ["ابتعاث", "بعثة", "تمديد البعثة", "تمديد بعثة"]],
    ["appointment", ["تعيين", "استقطاب", "تعاقد", "تجديد عقد"]],
    ["course_equivalency", ["معادلة مقرر", "معادلة مقررات", "معادلة المقرر", "معادلة المقررات"]],
    ["study_plan", ["الخطة الدراسية", "خطة دراسية", "تعديل خطة", "تطوير خطة"]],
    ["course", ["توصيف مقرر", "تطوير مقرر", "استحداث مقرر", "مقرر دراسي"]],
    ["graduate_program", ["برنامج دراسات عليا", "برنامج ماجستير", "برنامج دكتوراه"]],
    ["research", ["بحث علمي", "مشروع بحثي", "نشر علمي", "ورقة علمية"]],
    ["change_major", ["تغيير تخصص", "تغيير التخصص", "تحويل تخصص", "التحويل من تخصص", "التحويل إلى تخصص"]],
    ["schedules", ["الجداول الدراسية", "الجداول", "الجدول الدراسي", "اعتماد الجداول", "إقرار الجداول"]],
  ];

  const normCache = new Map();
  function normalize_ar(text) {
    if (!text) return "";
    const hit = normCache.get(text);
    if (hit !== undefined) return hit;
    let t = text.normalize("NFKC");
    t = DIACRITICS.sub("", t);
    t = t.split(TATWEEL).join("");
    t = re.sub("[إأآا]", "ا", t);
    t = t.split("ى").join("ي").split("ة").join("ه").split("ؤ").join("و").split("ئ").join("ي");
    t = re.sub("[^\\w\\s]", " ", t);
    t = re.sub("\\s+", " ", t);
    t = strip(t).toLowerCase();
    if (normCache.size > 50000) normCache.clear();
    normCache.set(text, t);
    return t;
  }

  const familyPhraseCache = TOPIC_FAMILIES.map(([f, ps]) => [f, null, ps]);
  function _topic_family(title, rationale = "") {
    const text = normalize_ar(`${title} ${rationale}`);
    for (const entry of familyPhraseCache) {
      if (!entry[1]) entry[1] = entry[2].map(normalize_ar);
      if (entry[1].some((p) => text.includes(p))) return entry[0];
    }
    return "";
  }

  function _body_for_matching(text) {
    text = text || "";
    text = re.sub("\\b[\\w.+-]+@[\\w.-]+\\.[A-Za-z]{2,}\\b", " ", text);
    text = re.sub("https?://\\S+|www\\.\\S+", " ", text);
    text = re.sub("\\b\\d{1,4}[/-]\\d{1,2}[/-]\\d{1,4}\\b", " ", text);
    text = re.sub("\\b\\d+(?:[.,]\\d+)?\\b", " ", text);
    return normalize_ar(text);
  }

  function _title_keyword_bonus(query, candidate) {
    const q = normalize_ar(query);
    const c = normalize_ar(candidate);
    if (!q || !c) return 0.0;
    if (q === c) return 0.42;
    if (c.includes(q) || q.includes(c)) return 0.34;
    const qTokens = PY.split(q).filter((x) => PY.len(x) >= 3);
    const cTokens = new Set(PY.split(c));
    if (!qTokens.length) return 0.0;
    const hits = qTokens.filter((x) => cTokens.has(x)).length;
    const coverage = hits / qTokens.length;
    if (coverage === 1.0) return 0.28;
    if (coverage >= 0.66) return 0.16;
    return 0.0;
  }

  // ---------------------------------------------------------------- TfidfVectorizer
  const WHITE_SPACES = re.compile("\\s\\s+");
  class TfidfVectorizer {
    constructor({ analyzer = "word", ngram_range = [1, 1], token_pattern = "(?u)\\b\\w\\w+\\b", sublinear_tf = false } = {}) {
      this.analyzer = analyzer;
      this.ngram_range = ngram_range;
      this.token_pattern = re.compile(token_pattern.replace(/^\(\?u\)/, ""));
      this.sublinear_tf = sublinear_tf;
    }
    _char_wb_ngrams(text) {
      text = WHITE_SPACES.sub(" ", text);
      const [minN, maxN] = this.ngram_range;
      const out = [];
      for (const w0 of PY.split(text)) {
        const w = Array.from(" " + w0 + " ");
        const wLen = w.length;
        for (let n = minN; n <= maxN; n++) {
          let offset = 0;
          out.push(w.slice(offset, offset + n).join(""));
          while (offset + n < wLen) {
            offset += 1;
            out.push(w.slice(offset, offset + n).join(""));
          }
          if (offset === 0) break;
        }
      }
      return out;
    }
    _word_ngrams(tokens) {
      let [minN, maxN] = this.ngram_range;
      if (maxN !== 1) {
        const original = tokens;
        let out;
        if (minN === 1) {
          out = original.slice();
          minN += 1;
        } else out = [];
        const n0 = original.length;
        for (let n = minN; n < Math.min(maxN + 1, n0 + 1); n++) {
          for (let i = 0; i < n0 - n + 1; i++) out.push(original.slice(i, i + n).join(" "));
        }
        return out;
      }
      return tokens;
    }
    _analyze(doc) {
      const d = doc.toLowerCase();
      if (this.analyzer === "char_wb") return this._char_wb_ngrams(d);
      return this._word_ngrams(this.token_pattern.findall(d));
    }
    _counts(doc) {
      const counts = new Map();
      for (const t of this._analyze(doc)) counts.set(t, (counts.get(t) || 0) + 1);
      return counts;
    }
    _weigh(counts) {
      const vec = [];
      for (const [term, c] of counts) {
        const idx = this.vocabulary.get(term);
        if (idx === undefined) continue;
        const tf = this.sublinear_tf ? Math.log(c) + 1 : c;
        vec.push([idx, tf * this.idf[idx]]);
      }
      vec.sort((a, b) => a[0] - b[0]);
      let ss = 0;
      for (const [, v] of vec) ss += v * v;
      const norm = Math.sqrt(ss);
      if (norm > 0) for (const e of vec) e[1] /= norm;
      return vec;
    }
    fit_transform(docs) {
      const countsList = docs.map((d) => this._counts(d));
      const terms = new Set();
      for (const c of countsList) for (const t of c.keys()) terms.add(t);
      if (!terms.size) throw new Error("empty vocabulary; perhaps the documents only contain stop words");
      const sorted = Array.from(terms).sort(PY.cmpStr);
      this.vocabulary = new Map(sorted.map((t, i) => [t, i]));
      const df = new Float64Array(sorted.length);
      for (const c of countsList) for (const t of c.keys()) df[this.vocabulary.get(t)] += 1;
      const n = docs.length + 1;
      this.idf = new Float64Array(sorted.length);
      for (let i = 0; i < sorted.length; i++) this.idf[i] = Math.log(n / (df[i] + 1)) + 1;
      return countsList.map((c) => this._weigh(c));
    }
    transform(docs) {
      return docs.map((d) => this._weigh(this._counts(d)));
    }
  }

  function dotSparse(q, x) {
    let i = 0, j = 0, s = 0;
    while (i < q.length && j < x.length) {
      if (q[i][0] === x[j][0]) { s += q[i][1] * x[j][1]; i++; j++; }
      else if (q[i][0] < x[j][0]) i++;
      else j++;
    }
    return s;
  }
  function renorm(v) {
    let ss = 0;
    for (const [, x] of v) ss += x * x;
    const n = Math.sqrt(ss);
    if (!(n > 0)) return v;
    return v.map(([i, x]) => [i, x / n]);
  }
  function cosineRow(q, matrix) {
    const qn = renorm(q);
    return matrix.map((x) => dotSparse(qn, x));
  }

  // ---------------------------------------------------------------- TopicMatcher
  class TopicMatcher {
    constructor(archiveTopics) {
      this.archive_topics = archiveTopics;
      this._title_vectorizer = null;
      this._title_matrix = null;
      this._body_vectorizer = null;
      this._body_matrix = null;
      this._families = [];
      if (archiveTopics && archiveTopics.length) {
        const titleCorpus = archiveTopics.map((t) => normalize_ar(t.title ?? "") || _body_for_matching(t.rationale ?? ""));
        const bodyCorpus = archiveTopics.map((t) => _body_for_matching(t.rationale ?? ""));
        this._title_vectorizer = new TfidfVectorizer({ analyzer: "char_wb", ngram_range: [2, 5] });
        this._title_matrix = this._title_vectorizer.fit_transform(titleCorpus).map(renorm);
        this._body_vectorizer = new TfidfVectorizer({ analyzer: "word", token_pattern: "[^\\s]+", ngram_range: [1, 2], sublinear_tf: true });
        this._body_matrix = this._body_vectorizer.fit_transform(bodyCorpus).map(renorm);
        this._families = archiveTopics.map((t) => _topic_family(t.title ?? "", t.rationale ?? ""));
      }
    }
    find_similar(title, rationale = "", top_k = 3, min_score = 0.10) {
      if (!this._title_vectorizer || !this.archive_topics.length) return [];
      const qTitle = normalize_ar(title) || _body_for_matching(rationale);
      const qBody = _body_for_matching(rationale);
      if (!qTitle && !qBody) return [];
      const titleScores = cosineRow(this._title_vectorizer.transform([qTitle])[0], this._title_matrix);
      const bodyScores = qBody
        ? cosineRow(this._body_vectorizer.transform([qBody])[0], this._body_matrix)
        : this.archive_topics.map(() => 0.0);
      const queryFamily = _topic_family(title, rationale);
      const combined = [];
      this.archive_topics.forEach((item, i) => {
        let score = 0.76 * titleScores[i] + 0.24 * bodyScores[i];
        score += _title_keyword_bonus(title, item.title ?? "");
        const af = this._families[i];
        if (queryFamily && af) score += queryFamily === af ? 0.16 : -0.08;
        combined.push(Math.max(0.0, Math.min(1.0, score)));
      });
      const ranked = combined.map((_, i) => i).sort((a, b) => combined[b] - combined[a] || a - b);
      const results = [];
      for (const i of ranked.slice(0, top_k)) {
        if (combined[i] < min_score) continue;
        results.push([this.archive_topics[i], combined[i]]);
      }
      return results;
    }
  }

  // Building a matcher is the expensive part; reuse it for the same pool array.
  const matcherCache = new WeakMap();
  function matcherFor(pool) {
    let m = matcherCache.get(pool);
    if (!m) {
      m = new TopicMatcher(pool);
      matcherCache.set(pool, m);
    }
    return m;
  }

  return { normalize_ar, _topic_family, _body_for_matching, _title_keyword_bonus, TfidfVectorizer, TopicMatcher, matcherFor };
})();

const normalize_ar = Similarity.normalize_ar;
