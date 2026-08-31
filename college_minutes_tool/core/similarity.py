"""مطابقة موضوع جديد بمواضيع سابقة مشابهة من أرشيف محاضر مجلس الكلية (بدون اتصال بالإنترنت)."""
import re
import unicodedata

from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

_DIACRITICS = re.compile(r"[ؗ-ًؚ-ْٰۖ-ۭ]")
_TATWEEL = "ـ"


def normalize_ar(text: str) -> str:
    if not text:
        return ""
    text = unicodedata.normalize("NFKC", text)
    text = _DIACRITICS.sub("", text)
    text = text.replace(_TATWEEL, "")
    text = re.sub(r"[إأآا]", "ا", text)
    text = text.replace("ى", "ي").replace("ة", "ه").replace("ؤ", "و").replace("ئ", "ي")
    text = re.sub(r"[^\w\s]", " ", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip().lower()


class TopicMatcher:
    """يبني فهرسًا لمواضيع الأرشيف ويعثر على أقربها لموضوع جديد عبر TF-IDF محلي بالكامل."""

    def __init__(self, archive_topics: list):
        self.archive_topics = archive_topics
        self._vectorizer = None
        self._matrix = None
        if archive_topics:
            corpus = [self._topic_text(t) for t in archive_topics]
            self._vectorizer = TfidfVectorizer(analyzer="word", token_pattern=r"[^\s]+")
            self._matrix = self._vectorizer.fit_transform(corpus)

    @staticmethod
    def _topic_text(topic: dict) -> str:
        raw = " ".join([topic.get("title", ""), topic.get("rationale", "")])
        return normalize_ar(raw)

    def find_similar(self, title: str, rationale: str = "", top_k: int = 3, min_score: float = 0.08):
        if not self._vectorizer or not self.archive_topics:
            return []
        query = normalize_ar(" ".join([title, rationale]))
        if not query:
            return []
        qvec = self._vectorizer.transform([query])
        scores = cosine_similarity(qvec, self._matrix)[0]
        ranked = sorted(range(len(scores)), key=lambda i: scores[i], reverse=True)
        results = []
        for i in ranked[:top_k]:
            if scores[i] < min_score:
                continue
            results.append((self.archive_topics[i], float(scores[i])))
        return results
