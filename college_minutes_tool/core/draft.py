"""صياغة نص موضوع محضر مجلس الكلية اعتمادًا على محضر مجلس القسم ومواضيع سابقة مشابهة من الأرشيف."""
import json
import re

from .ollama_client import generate, OllamaError

SYSTEM_PROMPT = """أنت مساعد إداري متخصص في صياغة محاضر مجالس الكليات الجامعية باللغة العربية الرسمية،
بأسلوب المحاضر الرسمية السعودية (لغة فصحى، صيغة الغائب، مصطلحات إدارية دقيقة).

مهمتك: تحويل "موضوع" كما ورد في محضر مجلس القسم إلى الصياغة المكافئة له في محضر مجلس الكلية،
باتّباع الأنماط المعتادة التالية (استُخلصت من محاضر فعلية):

1) حيثيات الموضوع في محضر الكلية تبدأ غالبًا بعبارة مثل:
   "بتوصية من مجلس قسم {القسم} في جلسته {رقم الجلسة بالحروف} المنعقدة بتاريخ {التاريخ}، ..."
   ثم يُعاد صياغة حيثيات القسم بأسلوب الكلية (مثلاً "ناقش المجلس" بدل "استعرض المجلس")
   مع الحفاظ على جميع التفاصيل والأرقام والتواريخ والأسماء كما وردت في محضر القسم دون تغييرها أو اختراع معلومات جديدة.

2) التوصية / القرار: تُصاغ كتوصية من مجلس الكلية (وليس كإحالة)، مثل:
   "التوصية بالموافقة بالإجماع على ..." إن كانت جميع الأصوات في محضر القسم موافقة،
   أو "التوصية بالموافقة بأغلبية الأصوات على ..." إن وُجدت اعتراضات أو ملاحظات في تصويت القسم (اذكرها إن كانت جوهرية).

3) المستند: كرّر المستند الوارد في محضر القسم، وإن وردت في "مواضيع سابقة مشابهة" مستندات إضافية معتمدة
   لنفس نوع الموضوع (كأنظمة أو تعاميم إضافية) أضِفها بنفس الصياغة المستخدمة سابقًا.

4) المرفقات: كرّر مرفقات محضر القسم، وأضف في النهاية: "محضر قسم {القسم} في جلسته {رقم الجلسة بالحروف}
   المنعقدة بتاريخ {التاريخ}."

5) الإجراء المطلوب: استند إلى الإجراء المعتاد لمواضيع مشابهة في الأرشيف إن وُجد (مثل "موافقة سعادة رئيس
   الجامعة" أو الرفع لجهة معينة)، وإلا استخدم "موافقة سعادة رئيس الجامعة" كإجراء افتراضي معقول.

لا تخترع أسماء أشخاص أو تواريخ أو أرقامًا غير واردة في المعطيات. إن لم تتوفر معلومة، اترك الحقل بصياغة
عامة مناسبة دون اختلاق تفاصيل.

أعد الإجابة بصيغة JSON فقط (بدون أي نص خارج كائن JSON)، بالمفاتيح التالية بالضبط:
{"rationale": "...", "decision": "...", "document_ref": "...", "attachments": "...", "action_required": "..."}
"""


def _arabic_ordinal_feminine(n) -> str:
    words = {
        1: "الأولى", 2: "الثانية", 3: "الثالثة", 4: "الرابعة", 5: "الخامسة",
        6: "السادسة", 7: "السابعة", 8: "الثامنة", 9: "التاسعة", 10: "العاشرة",
        11: "الحادية عشرة", 12: "الثانية عشرة", 13: "الثالثة عشرة", 14: "الرابعة عشرة",
        15: "الخامسة عشرة", 16: "السادسة عشرة", 17: "السابعة عشرة", 18: "الثامنة عشرة",
        19: "التاسعة عشرة", 20: "العشرون",
    }
    try:
        num = int(re.sub(r"\D", "", str(n)))
    except ValueError:
        return str(n)
    return words.get(num, f"رقم {num}")


def session_ordinal(session_number) -> str:
    """يحوّل رقم جلسة (نص أو رقم) إلى صيغة الجلسة العربية المؤنثة إن أمكن."""
    if isinstance(session_number, str) and any(c.isalpha() for c in session_number):
        return session_number  # وردت أصلًا كنص عربي مثل "الأولى"
    return _arabic_ordinal_feminine(session_number)


def _format_precedents(precedents: list) -> str:
    if not precedents:
        return "لا توجد مواضيع سابقة مشابهة كافية في الأرشيف."
    parts = []
    for topic, score in precedents:
        parts.append(
            "- عنوان سابق: {title}\n"
            "  حيثيات سابقة (مختصرة): {rationale}\n"
            "  التوصية سابقًا: {decision}\n"
            "  المستند سابقًا: {document_ref}\n"
            "  الإجراء سابقًا: {action_required}".format(
                title=topic.get("title", "")[:200],
                rationale=topic.get("rationale", "")[:400],
                decision=topic.get("decision", "")[:200],
                document_ref=topic.get("document_ref", "")[:300],
                action_required=topic.get("action_required", "")[:200],
            )
        )
    return "\n\n".join(parts)


def build_prompt(dept_topic, department_name: str, dept_session_number, dept_session_date: str,
                  precedents: list) -> str:
    ordinal = session_ordinal(dept_session_number)
    votes_summary = "لا توجد بيانات تصويت."
    if dept_topic.votes:
        disagree = [v for v in dept_topic.votes if norm_vote(v.get("disagree", ""))]
        notes = [v.get("note", "") for v in dept_topic.votes if v.get("note", "").strip() and "لم يحضر" not in v.get("note", "")]
        if disagree:
            votes_summary = f"لم يوافق {len(disagree)} من الأعضاء. ملاحظات: {'؛ '.join(notes) if notes else 'لا توجد'}"
        else:
            votes_summary = "وافق جميع الأعضاء الحاضرين (بالإجماع)."

    return f"""بيانات موضوع من محضر مجلس القسم:
القسم: {department_name}
رقم جلسة القسم: {ordinal}
تاريخ جلسة القسم: {dept_session_date}

عنوان الموضوع: {dept_topic.title}
حيثيات الموضوع (كما وردت في محضر القسم): {dept_topic.rationale}
التوصية/القرار في محضر القسم: {dept_topic.decision}
المستند في محضر القسم: {dept_topic.document_ref}
المرفقات في محضر القسم: {dept_topic.attachments}
الإجراء المطلوب في محضر القسم: {dept_topic.action_required}
ملخص تصويت أعضاء القسم: {votes_summary}

مواضيع سابقة مشابهة من محاضر مجلس الكلية (للاسترشاد بالصياغة والمستندات والإجراء فقط، لا تنسخها حرفيًا إن لم تُطابق الموضوع الحالي):
{_format_precedents(precedents)}

اكتب الآن صياغة موضوع محضر مجلس الكلية المقابل بصيغة JSON فقط كما هو محدد في التعليمات.
"""


def norm_vote(text: str) -> bool:
    t = (text or "").strip()
    return t not in ("", "-")


def _extract_json(text: str) -> dict:
    text = text.strip()
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if not match:
        raise ValueError("لم يتم العثور على JSON في رد النموذج")
    return json.loads(match.group(0))


def draft_topic(host: str, model: str, dept_topic, department_name: str, dept_session_number,
                 dept_session_date: str, precedents: list) -> dict:
    """يستدعي Ollama لصياغة موضوع الكلية. يرجع dict بالحقول الخمسة، أو يرفع OllamaError."""
    prompt = build_prompt(dept_topic, department_name, dept_session_number, dept_session_date, precedents)
    raw = generate(host, model, prompt, system=SYSTEM_PROMPT)
    try:
        data = _extract_json(raw)
    except (ValueError, json.JSONDecodeError):
        # محاولة ثانية بتعليمات أشد صرامة
        raw2 = generate(
            host, model,
            prompt + "\n\nتذكير: أعد فقط كائن JSON صالحًا واحدًا، بدون أي شرح أو نص إضافي.",
            system=SYSTEM_PROMPT,
        )
        try:
            data = _extract_json(raw2)
        except (ValueError, json.JSONDecodeError):
            # فشل التوليد المهيكل: نعيد النص الخام في الحيثيات ليراجعه المستخدم يدويًا
            data = {
                "rationale": raw.strip(),
                "decision": "",
                "document_ref": dept_topic.document_ref,
                "attachments": dept_topic.attachments,
                "action_required": "موافقة سعادة رئيس الجامعة",
            }
    for key in ("rationale", "decision", "document_ref", "attachments", "action_required"):
        data.setdefault(key, "")
    return data
