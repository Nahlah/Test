"""
صياغة آلية (بدون ذكاء اصطناعي) لأنواع مواضيع شديدة الانتظام مثل "بدل تميز نشر علمي"،
حيث يكون خطر أن يخترع نموذج لغوي صغير اسمًا أو رقمًا أو تاريخًا غير مقبول إطلاقًا في
مستند رسمي. بدل الاعتماد على النموذج لإعادة الصياغة، تُستخرَج البيانات المتغيّرة (اسم
العضو ورتبته وتفاصيل البحث/الأبحاث) من نص محضر القسم عبر تعابير نمطية (regex)، وتُملأ في
قالب صياغة ثابت مطابق للأسلوب الفعلي المستخدم في محاضر مجلس الكلية السابقة، مع نسخ
"المستند" و"الإجراء المطلوب" حرفيًا من أقرب سابقة مطابقة (فهي عبارات نظامية ثابتة لا
تتغير بتغيّر مقدّم الطلب).

إن تعذّر استخراج أي من البيانات المطلوبة، تُرجع الدالة None ليعود المستدعي لاستخدام
الصياغة عبر النموذج اللغوي كخيار احتياطي.
"""
import re

_RESEARCH_BONUS_KEYWORDS = ("بدل التميز", "بدل تميز", "مكافأة تميز", "مكافأة التميز")

_NAME_RE = re.compile(
    r"(?:من\s+)?(?:سعادة\s+)?"
    r"(الأستاذة?\s+الدكتور(?:ة)?|الدكتور(?:ة)?)"
    r"\s*/\s*"
    r"(.+?)"
    r"\s*[,،]\s*"
    r"(أستاذ(?:ة)?(?:\s+(?:مساعد|مشارك))?)"
    r"\s*(?:في\s+|ب)?قسم\s+"
    r"(.+?)"
    r"(?:\s*(?:بصرف|بكلية|[,،]|\.|$))"
)

_FIELD_PATTERNS = {
    "title": r"عنوان\s*البحث\s*:?\s*",
    "journal": r"(?:اسم\s*)?المجلة\s*:?\s*",
    "impact": r"معامل\s*(?:التأثير|تأثيرها)\s*:?\s*(?:\([^)]*\)\s*)?",
    "date": r"تاريخ\s*النشر\s*:?\s*",
    "specialty": r"تخصص\s*المجلة\s*:?\s*",
    "volume": r"المجلد\s*:?\s*",
    "authors_count": r"عدد\s*المؤلفين\s*:?\s*",
    "author_rank": r"ترتيب\s*المتقدم\s*:?\s*",
}

_PAPER_SPLIT_RE = re.compile(r"البحث\s*(?:ال)?(?:أول|الأولى|الثاني|الثالث|الرابع)\s*:?")


def is_research_bonus_topic(title: str, rationale: str) -> bool:
    text = f"{title} {rationale}"
    has_bonus = any(k in text for k in _RESEARCH_BONUS_KEYWORDS)
    has_publication = "نشر" in text and ("علمي" in text or "عملي" in text)
    return has_bonus and has_publication


def extract_member(text: str):
    """يرجع dict فيه اللقب والاسم والرتبة والقسم، أو None إن تعذّر الاستخراج."""
    m = _NAME_RE.search(text)
    if not m:
        return None
    title_word, name, rank, dept = m.groups()
    return {
        "title_word": title_word.strip(),
        "name": name.strip(),
        "rank": rank.strip(),
        "department": dept.strip(),
    }


def _extract_labeled_fields(block: str) -> dict:
    """يفحص الفقرة عن كل تسميات الحقول المعروفة بغض النظر عن ترتيبها، ويأخذ قيمة كل حقل
    من نهاية تسميته حتى بداية أقرب تسمية تالية (يدعم وجود القيمة في السطر التالي للتسمية،
    كما هو شائع عند اللصق من PDF أو Word)."""
    matches = []  # (start, end, key)
    for key, pat in _FIELD_PATTERNS.items():
        for m in re.finditer(pat, block):
            matches.append((m.start(), m.end(), key))
    matches.sort(key=lambda t: t[0])

    values = {}
    for i, (start, end, key) in enumerate(matches):
        next_start = matches[i + 1][0] if i + 1 < len(matches) else len(block)
        raw = block[end:next_start]
        value = ""
        for line in raw.splitlines():
            line = line.strip(" \t•-–.,،؛:")
            if line:
                value = line
                break
        if key not in values and value:
            values[key] = value
    return values


def extract_research_entries(rationale: str) -> list:
    """يستخرج تفاصيل بحث واحد أو أكثر (عند وجود أكثر من بحث في نفس الموضوع)."""
    parts = _PAPER_SPLIT_RE.split(rationale)
    blocks = list(parts[1:]) if len(parts) > 1 else [rationale]
    entries = []
    for block in blocks:
        entry = _extract_labeled_fields(block)
        for key in _FIELD_PATTERNS:
            entry.setdefault(key, "")
        if entry.get("title") and entry.get("journal"):
            entries.append(entry)
    return entries


def _format_entry_block(entry: dict, numbered_label: str = "") -> str:
    lines = []
    if numbered_label:
        lines.append(f"{numbered_label}:")
    lines.append(f"عنوان البحث: {entry['title']}")
    lines.append(f"اسم المجلة: {entry['journal']}")
    if entry.get("specialty"):
        lines.append(f"تخصص المجلة: {entry['specialty']}")
    if entry.get("impact"):
        lines.append(f"معامل التأثير: {entry['impact']}")
    if entry.get("volume"):
        lines.append(f"المجلد: {entry['volume']}")
    if entry.get("authors_count"):
        lines.append(f"عدد المؤلفين: {entry['authors_count']}")
    if entry.get("author_rank"):
        lines.append(f"ترتيب المتقدم: {entry['author_rank']}")
    lines.append(f"تاريخ النشر: {entry['date']}")
    return "\n".join(lines)


_PAPER_ORDINALS = ["البحث الأول", "البحث الثاني", "البحث الثالث", "البحث الرابع", "البحث الخامس"]


def _reused_document_and_action(precedents: list, fallback_document_ref: str):
    """نسخ المستند/الإجراء المطلوب حرفيًا من أقرب سابقة من نفس النوع (نص نظامي ثابت لا يتغير بتغيّر مقدّم الطلب)."""
    same_type_precedents = [
        p for p, _score in precedents
        if is_research_bonus_topic(p.get("title", ""), p.get("rationale", "")) and p.get("document_ref")
    ]
    if same_type_precedents:
        document_ref = same_type_precedents[0]["document_ref"]
        action_required = same_type_precedents[0].get("action_required", "") or "موافقة سعادة رئيس الجامعة"
    else:
        document_ref = fallback_document_ref
        action_required = "موافقة سعادة رئيس الجامعة"
    return document_ref, action_required


def _build_details_and_phrase(entries: list, is_female: bool):
    if len(entries) == 1:
        return _format_entry_block(entries[0]), "للبحث المنشور"
    details = "\n".join(
        _format_entry_block(e, _PAPER_ORDINALS[i] if i < len(_PAPER_ORDINALS) else f"البحث رقم {i + 1}")
        for i, e in enumerate(entries)
    )
    return details, ("لأبحاثها المنشورة" if is_female else "لأبحاثه المنشورة")


def build_research_bonus_fields(dept_topic, department_name: str, session_ordinal_str: str,
                                 session_date: str, precedents: list):
    """
    يبني حقول موضوع "بدل تميز نشر علمي" آليًا (بدون نموذج لغوي) عند ترجمته من محضر قسم
    (تابع) إلى محضر مجلس أعلى (الكلية)، بصيغة "بتوصية من مجلس قسم ...".
    يرجع dict بالحقول الخمسة أو None إن تعذّر الاستخراج (فيُستخدم النموذج اللغوي بدلًا منه).
    """
    if not is_research_bonus_topic(dept_topic.title, dept_topic.rationale):
        return None
    member = extract_member(dept_topic.title) or extract_member(dept_topic.rationale)
    if not member:
        return None
    entries = extract_research_entries(dept_topic.rationale)
    if not entries:
        return None

    name_with_rank = f"{member['title_word']}/ {member['name']}، {member['rank']} بقسم {member['department']}"
    is_female = "ة" in member["title_word"] or member["rank"].endswith("ة")
    details, research_phrase = _build_details_and_phrase(entries, is_female)

    rationale = (
        f"بتوصية من مجلس قسم {department_name} في جلسته {session_ordinal_str} المنعقدة بتاريخ "
        f"{session_date}، ناقش المجلس الطلب المقدم من {name_with_rank} بصرف بدل التميز للنشر "
        f"العلمي {research_phrase} وفقًا للتفاصيل التالية:\n{details}"
    )
    decision = f"التوصية بالموافقة بالإجماع على طلب مكافأة بدل التميز المقدم من {name_with_rank}."
    document_ref, action_required = _reused_document_and_action(precedents, dept_topic.document_ref)

    attachments_parts = [dept_topic.attachments or "نموذج بدل التميز (للنشر العلمي)، نسخة من الورقة العلمية المنشورة."]
    attachments_parts.append(f"محضر قسم {department_name} في جلسته {session_ordinal_str} المنعقدة بتاريخ {session_date}.")

    return {
        "title": dept_topic.title,
        "rationale": rationale,
        "decision": decision,
        "document_ref": document_ref,
        "attachments": " ".join(attachments_parts),
        "action_required": action_required,
    }


def build_research_bonus_fields_same_level(topic_title: str, topic_details: str, precedents: list):
    """نفس المنطق أعلاه، لكن لموضوع يُكتب مباشرة لمحضر المجلس نفسه (لا يوجد مجلس تابع
    يُترجَم عنه)، بصيغة "استعرض المجلس..." بدل "بتوصية من مجلس قسم..."."""
    if not is_research_bonus_topic(topic_title, topic_details):
        return None
    member = extract_member(topic_title) or extract_member(topic_details)
    if not member:
        return None
    entries = extract_research_entries(topic_details)
    if not entries:
        return None

    name_with_rank = f"{member['title_word']}/ {member['name']}، {member['rank']} بقسم {member['department']}"
    is_female = "ة" in member["title_word"] or member["rank"].endswith("ة")
    details, research_phrase = _build_details_and_phrase(entries, is_female)

    rationale = (
        f"استعرض المجلس الطلب المقدم من {name_with_rank} بصرف بدل التميز للنشر العلمي "
        f"{research_phrase} وفقًا للتفاصيل التالية:\n{details}"
    )
    decision = f"التوصية بالموافقة بالإجماع على طلب مكافأة بدل التميز المقدم من {name_with_rank}."
    document_ref, action_required = _reused_document_and_action(precedents, "")

    attachments = "نموذج بدل التميز (للنشر العلمي)، نسخة من الورقة العلمية المنشورة."

    return {
        "title": topic_title,
        "rationale": rationale,
        "decision": decision,
        "document_ref": document_ref,
        "attachments": attachments,
        "action_required": action_required,
    }
