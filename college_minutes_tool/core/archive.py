"""بناء أرشيف قابل للبحث من محاضر مجلس الكلية السابقة (مجلد يحوي ملفات .docx / .pdf / .txt)."""
import os

from .minutes_parser import parse_minutes_file

SUPPORTED_EXTS = (".docx", ".pdf", ".txt")


def build_archive(folder: str) -> list:
    """يرجع قائمة مسطّحة من المواضيع كل عنصر منها قاموس (dict) جاهز لمطابقة TF-IDF.
    ملفات .docx تُحلَّل بدقة كاملة عبر بنية الجداول؛ ملفات PDF/نص تُحلَّل تحليلًا تقريبيًا.
    """
    topics = []
    if not folder or not os.path.isdir(folder):
        return topics
    for name in sorted(os.listdir(folder)):
        if not name.lower().endswith(SUPPORTED_EXTS):
            continue
        path = os.path.join(folder, name)
        try:
            minutes = parse_minutes_file(path)
        except Exception:
            continue
        for t in minutes.topics:
            topics.append({
                "title": t.title,
                "rationale": t.rationale,
                "decision": t.decision,
                "document_ref": t.document_ref,
                "attachments": t.attachments,
                "action_required": t.action_required,
                "source_file": name,
                "session_number": minutes.session.session_number,
                "session_date": minutes.session.date,
            })
    return topics
