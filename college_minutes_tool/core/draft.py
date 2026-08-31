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


def _generate_structured(host: str, model: str, prompt: str, system: str, fallback_rationale: str,
                          fallback_document_ref: str = "", fallback_attachments: str = "") -> dict:
    """ينفّذ الاستدعاء ويحاول استخراج JSON صالح، مع محاولة ثانية أشد صرامة عند الفشل،
    وعودة تدريجية (لا يفشل التطبيق) إلى نص خام في الحيثيات إن تعذّر الحصول على JSON."""
    raw = generate(host, model, prompt, system=system)
    try:
        data = _extract_json(raw)
    except (ValueError, json.JSONDecodeError):
        raw2 = generate(
            host, model,
            prompt + "\n\nتذكير: أعد فقط كائن JSON صالحًا واحدًا، بدون أي شرح أو نص إضافي.",
            system=system,
        )
        try:
            data = _extract_json(raw2)
        except (ValueError, json.JSONDecodeError):
            data = {
                "rationale": raw.strip(),
                "decision": "",
                "document_ref": fallback_document_ref,
                "attachments": fallback_attachments,
                "action_required": "",
            }
    for key in ("rationale", "decision", "document_ref", "attachments", "action_required"):
        data.setdefault(key, "")
    return data


def draft_topic(host: str, model: str, dept_topic, department_name: str, dept_session_number,
                 dept_session_date: str, precedents: list) -> dict:
    """يستدعي Ollama لصياغة موضوع محضر الكلية من موضوع محضر قسم. يرجع dict بالحقول الخمسة."""
    prompt = build_prompt(dept_topic, department_name, dept_session_number, dept_session_date, precedents)
    return _generate_structured(
        host, model, prompt, SYSTEM_PROMPT,
        fallback_rationale=dept_topic.rationale,
        fallback_document_ref=dept_topic.document_ref,
        fallback_attachments=dept_topic.attachments,
    )


SYSTEM_PROMPT_SAME_LEVEL = """أنت مساعد إداري متخصص في صياغة محاضر مجالس الأقسام الجامعية باللغة العربية الرسمية،
بأسلوب المحاضر الرسمية السعودية (لغة فصحى، صيغة الغائب، مصطلحات إدارية دقيقة).

مهمتك: تحويل وصف مختصر لموضوع جديد (كتبه منسّق المحضر) إلى الصياغة الرسمية الكاملة المستخدمة في
محاضر هذا المجلس نفسه، بالاعتماد على أسلوب/مستندات/إجراء مواضيع سابقة مشابهة من محاضر المجلس نفسه
(المرفقة أدناه كسوابق) لضمان اتساق الصياغة مع ما اعتاده المجلس.

قواعد الصياغة:
1) حيثيات الموضوع: فقرة رسمية تشرح خلفية الموضوع وتفاصيله، بصيغة الغائب ("استعرض المجلس..."/"ناقش
   المجلس...")، تتضمن كل التفاصيل والأرقام والتواريخ والأسماء التي ذكرها منسّق المحضر دون حذفها،
   وبأسلوب مماثل للسوابق المشابهة إن وُجدت.
2) التوصية / القرار: صياغة قرار المجلس بوضوح (موافقة/رفض/توصية) بأسلوب مماثل للسوابق.
3) المستند: إن ذكر منسّق المحضر مستندًا استخدمه، وإلا استخدم نفس المستند النظامي الذي استُخدم في
   السابقة الأقرب لنفس نوع الموضوع إن وُجدت.
4) المرفقات: اذكر أي مرفقات ذكرها منسّق المحضر، وأضف مرفقات مماثلة لما ورد في السوابق إن كانت من
   نفس نوع الموضوع (مثل: نسخة الورقة العلمية، نموذج الطلب، ...).
5) الإجراء المطلوب: استخدم نفس الإجراء المعتاد لمواضيع من نفس النوع في السوابق إن وُجد.

لا تخترع أسماء أشخاص أو تواريخ أو أرقامًا غير واردة فيما كتبه منسّق المحضر. إن لم تتوفر معلومة، اترك
الحقل بصياغة عامة مناسبة دون اختلاق تفاصيل.

أعد الإجابة بصيغة JSON فقط (بدون أي نص خارج كائن JSON)، بالمفاتيح التالية بالضبط:
{"rationale": "...", "decision": "...", "document_ref": "...", "attachments": "...", "action_required": "..."}
"""


def build_same_level_prompt(topic_title: str, topic_details: str, precedents: list) -> str:
    return f"""الموضوع الجديد المطلوب صياغته لمحضر هذا المجلس:
العنوان: {topic_title}
تفاصيل كتبها منسّق المحضر (قد تكون نقاطًا مختصرة): {topic_details or "لا توجد تفاصيل إضافية."}

مواضيع سابقة مشابهة من محاضر هذا المجلس نفسه (سوابق يُستأنس بصياغتها ومستنداتها وإجراءاتها):
{_format_precedents(precedents)}

اكتب الآن الصياغة الرسمية الكاملة لهذا الموضوع بصيغة JSON فقط كما هو محدد في التعليمات.
"""


def draft_new_topic(host: str, model: str, topic_title: str, topic_details: str, precedents: list) -> dict:
    """يستدعي Ollama لصياغة موضوع جديد لمحضر مجلس (قسم مثلًا) من وصف مختصر يكتبه المستخدم،
    بالاعتماد على سوابق من محاضر المجلس نفسه (وليس ترجمة من مجلس تابع كما في draft_topic)."""
    prompt = build_same_level_prompt(topic_title, topic_details, precedents)
    return _generate_structured(host, model, prompt, SYSTEM_PROMPT_SAME_LEVEL, fallback_rationale=topic_details)
