"""Generate realistic council minutes / forms and run the original tool's workflows on them.

Run under pytest-free python with FN_RECORD_OUT / RE_RECORD_OUT set so every call is recorded.
"""
import copy, os, random, sys, shutil, types

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "stubs"))
sys.path.insert(0, HERE)
os.environ.setdefault("HOME", "/tmp/claude-0/scen_home")

if os.environ.get("RE_RECORD_OUT"):
    import re_recorder
    re_recorder.install()
import fn_recorder
fn_recorder.install()
fn_recorder.install_app_hooks()

from docx import Document
from docx.oxml.ns import qn
from openpyxl import Workbook
from core.docx_struct import set_cell_text, row_texts, norm
from core.minutes_parser import Topic, SessionInfo, parse_minutes_file
from core.archive import build_archive
from core.source_import import import_current_source
from core.scholarship import parse_committee_file
from core.department_form_fields import topic_profile, extract_form_fields, fields_to_text, publication_records_to_text
from core.docx_builder import build_minutes_document
from core.department_docx_builder import build_department_minutes_document
from core.reference_learning import remember_reference_choice
import app as appmod
import department_panel as dpmod

R = random.Random(int(os.environ.get("SCEN_SEED", "7")))
TEMPLATE = os.environ.get("SCEN_TEMPLATE", os.path.join(HERE, "template.docx"))
OUT = os.environ.get("SCEN_OUT", "/tmp/claude-0/scen")

FEMALE = ["هند محمد العتيبي", "نورة سعد الشهري", "ريم عبدالله القحطاني", "سارة فهد الدوسري", "أمل خالد الزهراني", "منى علي الغامدي"]
MALE = ["أحمد علي السبيعي", "خالد عمر الحربي", "فيصل ناصر المطيري", "سلطان سعيد الشمراني", "عبدالله محمد البركاتي", "ماجد حسن العمري"]
DEPTS = ["علوم الحاسب", "تقنية المعلومات"]
DAYS = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس"]
JOURNALS = ["IEEE Access", "Journal of King Saud University - Computer and Information Sciences", "Applied Sciences", "Sensors"]
PAPERS = ["A Hybrid Deep Learning Model for Arabic Sentiment Analysis", "Blockchain for secure e-healthcare records",
          "Federated learning for smart campus energy prediction", "تحليل البيانات الضخمة في التعليم الإلكتروني"]
CONFS = ["International Conference on Computer and Information Sciences (ICCIS)", "IEEE International Conference on Big Data",
         "المؤتمر الدولي للتعليم الإلكتروني", "ACM Conference on Learning at Scale"]
CITIES = [("الرياض", "المملكة العربية السعودية"), ("دبي", "الإمارات العربية المتحدة"), ("لندن", "المملكة المتحدة"), ("طوكيو", "اليابان")]
PROGRAMS = ["برنامج ماجستير علوم البيانات", "برنامج ماجستير الأمن السيبراني", "برنامج بكالوريوس علوم الحاسب", "برنامج بكالوريوس تقنية المعلومات"]
SEMS = ["الفصل الدراسي الأول", "الفصل الدراسي الثاني", "الفصل الدراسي الصيفي"]


def pick(xs):
    return R.choice(xs)


def date():
    return f"{R.randint(1, 28):02d}{pick(['/', '.', '/'])}{R.randint(1, 12):02d}{pick(['/', '.'])}2026"


def person(female=None):
    if female is None:
        female = R.random() < 0.5
    name = pick(FEMALE if female else MALE)
    rank = pick(["أستاذ مساعد", "أستاذ مشارك", "محاضر"]) if not female else pick(["أستاذ مساعد", "أستاذ مشارك", "محاضرة"])
    if "محاضر" in rank:
        hon = "المحاضرة" if female else "المحاضر"
    else:
        hon = "الدكتورة" if female else "الدكتور"
    return hon, name, rank, female


def ordinal_m(n):
    return {1: "الأولى", 2: "الثانية", 3: "الثالثة", 4: "الرابعة", 5: "الخامسة", 6: "السادسة", 7: "السابعة", 8: "الثامنة", 9: "التاسعة", 10: "العاشرة"}.get(n, f"رقم {n}")


def topic_spec(kind, level, dept, ses_no, ses_date):
    """Return dict(title, rationale, decision, document_ref, attachments, action_required, table)"""
    hon, name, rank, female = person()
    held = pick([" المنعقدة", ""])
    ref = f"بتوصية من مجلس قسم {dept} في جلسته {ordinal_m(R.randint(1, 10))}{held} بتاريخ {date()}م، "
    vote = pick(["التوصية بالموافقة بالإجماع", "التوصية بالموافقة", "التوصية بالموافقة بالأغلبية"])
    table = None
    if kind == "research_bonus":
        title = f"طلب مكافأة بدل التميز للنشر العلمي المقدم من {hon}/ {name}، {rank} بقسم {dept}" + pick(["", " بكلية الحوسبة والمعلوماتية"])
        paper = pick(PAPERS)
        body = (f"ناقش المجلس الطلب المقدم من {hon}/ {name} بصرف بدل التميز للنشر العلمي للبحث المنشور وفقا للتفاصيل التالية:\n"
                f"عنوان البحث: {paper}\nاسم المجلة: {pick(JOURNALS)}\nتخصص المجلة: علوم الحاسب\nمعامل التأثير: {R.randint(1, 9)}.{R.randint(0, 99):02d}\nتاريخ النشر: {date()}")
        rationale = (ref if level == "college" else "") + body
        decision = f"{vote} على طلب مكافأة بدل التميز المقدم من {hon}/ {name}."
        doc = "اللائحة المنظمة لبدل التميز للنشر العلمي"
        att = f"نموذج طلب بدل التميز\nنسخة من البحث المنشور\nمحضر قسم {dept} في جلسته الثالثة بتاريخ {date()}م"
        action = pick(["الرفع لمجلس الكلية", "الرفع لوكالة الجامعة للدراسات العليا والبحث العلمي"])
    elif kind == "conference":
        title = f"الطلب المقدم من {hon}/ {name}، {rank} في قسم {dept} لحضور مؤتمر علمي" + pick(["", " (الإيراد البديل)"]) + "."
        city, country = pick(CITIES)
        body = (f"استعرض المجلس الطلب المقدم من {hon}/ {name} لحضور مؤتمر علمي وفقا للبيانات التالية:\n"
                f"عنوان المؤتمر: {pick(CONFS)}\nتاريخ عقد المؤتمر: {date()} - {date()}\nالجهة المنظمة: IEEE\nالمدينة: {city}\nالدولة: {country}\n"
                f"نوع المشاركة: {pick(['تقديم بحث', 'حضور'])}\nعنوان البحث المقبول للنشر: {pick(PAPERS)}")
        rationale = (ref if level == "college" else "") + body
        decision = f"{vote} على الطلب المقدم من {hon}/ {name} لحضور مؤتمر علمي."
        doc = "لائحة الحضور والمشاركة في المؤتمرات العلمية"
        att = f"نموذج طلب حضور مؤتمر\nخطاب قبول البحث\nمحضر قسم {dept} في جلسته الخامسة المنعقدة بتاريخ {date()}م"
        action = "الرفع لمجلس الكلية"
    elif kind == "appointment":
        title = f"طلب تعيين {hon}/ {name} على رتبة {rank} بقسم {dept}" + pick(["", " بكلية الحوسبة والمعلوماتية"])
        body = (f"استعرض المجلس طلب تعيين {hon}/ {name} في قسم {dept} وفق البيانات التالية:\n"
                f"اسم العضو: {name}\nالرتبة العلمية: {rank}\nجامعة البكالوريوس: جامعة الملك سعود\nجامعة الماجستير: جامعة {pick(['ليدز', 'مانشستر', 'الملك عبدالعزيز'])}\n"
                f"جامعة الدكتوراه: جامعة {pick(['نوتنغهام', 'كوينزلاند', 'الملك فهد للبترول والمعادن'])}")
        rationale = (ref if level == "college" else "") + body
        decision = f"{vote} على تعيين {hon}/ {name} على رتبة {rank}."
        doc = "اللائحة المنظمة لشؤون منسوبي الجامعات السعوديين من أعضاء هيئة التدريس"
        att = "السيرة الذاتية\nصور المؤهلات"
        action = "الرفع لمجلس الكلية"
        if R.random() < 0.5:
            table = [["المؤهل", "الجامعة", "التخصص", "سنة التخرج"],
                     ["البكالوريوس", "جامعة الملك سعود", "علوم الحاسب", "2010"],
                     ["الماجستير", "جامعة ليدز", "الذكاء الاصطناعي", "2014"],
                     ["الدكتوراه", "جامعة نوتنغهام", "علوم الحاسب", "2019"]]
    elif kind == "promotion":
        target = "أستاذ مشارك" if "مساعد" in rank else "أستاذ"
        cur = rank if "أستاذ" in rank else "أستاذ مساعد"
        title = f"طلب ترقية {hon if 'دكتور' in hon else ('الدكتورة' if female else 'الدكتور')}/ {name} من رتبة {cur} إلى رتبة {target} بقسم {dept}"
        body = (f"استعرض المجلس الطلب المقدم للترقية من رتبة {cur} إلى رتبة {target}، حيث تم التحقق من استيفاء المدة النظامية.\n"
                f"اسم العضو: {name}\nالرتبة الحالية: {cur}\nالرتبة المطلوبة: {target}\nتاريخ الترقية للرتبة الحالية: {date()}")
        rationale = (ref if level == "college" else "") + body
        decision = f"{vote} على ترقية {name} إلى رتبة {target}."
        doc = "ضوابط المجلس العلمي للترقيات"
        att = "استمارة طلب الترقية\nالإنتاج العلمي"
        action = "الرفع للمجلس العلمي"
        if R.random() < 0.6:
            table = [["م", "عنوان العمل (بلغة النشر)", "نوع العمل", "تاريخ النشر"]] + [
                [str(i + 1), f"{pick(MALE)} ({R.randint(2019, 2025)}). {pick(PAPERS)}. {pick(JOURNALS)}.", "مجلة", str(R.randint(2019, 2025))] for i in range(R.randint(2, 4))]
    elif kind == "schedules":
        prog = pick(PROGRAMS)
        sem = pick(SEMS)
        title = f"{pick(['مناقشة واعتماد', 'مناقشة', 'اعتماد'])} جداول {prog} لل{sem[2:] if sem.startswith('ال') else sem} من العام الجامعي 1447هـ."
        body = (f"استعرض المجلس جداول {prog} لل{sem[2:]} والتي تتضمن المقررات والشعب وأعضاء هيئة التدريس، والذي يحتوي على التفاصيل التالية:\n"
                f"عدد المقررات: {R.randint(4, 12)}\nعدد الشعب: {R.randint(4, 20)}")
        rationale = (f"بتوصية من مجلس قسم {dept} في جلسته {ordinal_m(R.randint(1, 10))} بتاريخ {date()}م، " if level == "college" else "") + body
        decision = f"التوصية بالموافقة بالإجماع على جداول {prog} لل{sem[2:]}."
        doc = "-"
        att = f"جداول {prog}\nمحضر قسم {dept} في جلسته الرابعة بتاريخ {date()}م"
        action = "الرفع لعمادة القبول والتسجيل"
        if R.random() < 0.6:
            table = [["رمز المقرر", "اسم المقرر", "الشعبة", "عضو هيئة التدريس"]] + [
                [f"DS{R.randint(500, 699)}", pick(["تعلم الآلة", "تنقيب البيانات", "الإحصاء المتقدم", "قواعد البيانات"]), str(R.randint(1, 9)), pick(MALE)] for _ in range(R.randint(2, 5))]
    elif kind == "change_major":
        st = pick(FEMALE + MALE)
        title = f"طلب تغيير تخصص {pick(['الطالبة', 'الطالب'])}/ {st}"
        body = (f"اسم الطالب: {st}\nالرقم الجامعي: S{R.randint(10**8, 10**9 - 1)}\nالتخصص الحالي: {pick(['علوم الحاسب', 'تقنية المعلومات'])}\n"
                f"التخصص المطلوب: {pick(['علوم البيانات', 'الأمن السيبراني'])}\nالمعدل التراكمي: {R.randint(2, 4)}.{R.randint(0, 99):02d}")
        rationale = (ref if level == "college" else "") + "استعرض المجلس طلب تغيير التخصص وفق البيانات التالية:\n" + body
        decision = f"{vote} على طلب تغيير التخصص."
        doc = "قواعد تغيير التخصص"
        att = "نموذج تغيير التخصص\nالسجل الأكاديمي"
        action = "الرفع لعمادة القبول والتسجيل"
    elif kind == "scholarship":
        title = f"إحاطة المجلس بطلب تمديد بعثة {hon}/ {name}، بكلية الحوسبة والمعلوماتية، لدراسة الدكتوراه في جامعة {pick(['ليدز', 'ملبورن', 'تورنتو'])}"
        rationale = ("بالإشارة إلى تفويض مجلس الكلية للجنة الثلاثية لشؤون الابتعاث بدراسة طلبات التمديد.\n"
                     f"عليه تم استعراض توصية اللجنة الثلاثية في كلية الحوسبة والمعلوماتية لشؤون الابتعاث في جلستها {ordinal_m(R.randint(1, 8))} بتاريخ 2026/0{R.randint(1, 9)}/1{R.randint(0, 9)} والمتضمنة الموافقة على الطلب.")
        decision = "إحاطة المجلس بالموافقة بالإجماع على طلب التمديد."
        doc = "اللائحة الموحدة للابتعاث والتدريب"
        att = f"محضر اللجنة الثلاثية في كلية الحوسبة والمعلوماتية الثالثة بتاريخ 2026/03/1{R.randint(0, 9)}م"
        action = "للإحاطة"
    else:  # generic
        sub = pick(["تأجيل الدراسة", "إعادة القيد", "تشكيل لجنة الخطط الدراسية", "معادلة مقررات", "تعديل الخطة الدراسية"])
        st = pick(FEMALE + MALE)
        title = f"دراسة طلب {sub} {'للطالبة' if R.random() < 0.5 else 'للطالب'}/ {st}" if "لجنة" not in sub else f"{sub} بقسم {dept}"
        body = (f"اسم الطالب: {st}\nالرقم الجامعي: S{R.randint(10**8, 10**9 - 1)}\nالبرنامج: {pick(PROGRAMS)}\nسبب الطلب: ظروف صحية\nالفصل الدراسي: {pick(SEMS)}"
                if "لجنة" not in sub else f"استعرض المجلس مقترح {sub} وفق الأعضاء التالية أسماؤهم:\n1- {pick(MALE)}\n2- {pick(FEMALE)}")
        rationale = (ref if level == "college" else "") + body
        decision = f"{vote} على {sub}."
        doc = pick(["لائحة الدراسة والاختبارات", "-"])
        att = pick(["نموذج الطلب", "السجل الأكاديمي\nالتقارير الطبية", ""])
        action = pick(["الرفع لمجلس الكلية", "الرفع لعمادة القبول والتسجيل", "-"])
    return dict(title=title, rationale=rationale, decision=decision, document_ref=doc, attachments=att, action_required=action, table=table)


def build_minutes(path, council_header, ses_no, ses_date, specs, first_note=True):
    d = Document(TEMPLATE)
    tables = d.tables
    hdr = tables[0]
    set_cell_text(hdr.rows[0].cells[0], council_header)
    vals = [str(ses_no), pick(DAYS), ses_date, pick(["مايكروسوفت تيمز", "قاعة الاجتماعات"]), pick(["10:00", "11:30", "13:00"])]
    for t in (tables[0], tables[1]):
        for i, row in enumerate(t.rows):
            tx = row_texts(row)
            if tx and norm(tx[0]) == norm("رقم الجلسة") and i + 1 < len(t.rows):
                for cell, v in zip(t.rows[i + 1].cells, vals):
                    set_cell_text(cell, v)
    topic_tbls = [t for t in tables if t.rows and row_texts(t.rows[0]) and norm(row_texts(t.rows[0])[0]).startswith("الموضوع")]
    proto = topic_tbls[-1]._tbl
    for t in topic_tbls:
        t._tbl.getparent().remove(t._tbl)
    sig = [t for t in d.tables if any("التوقيع" in "".join(row_texts(r)) for r in t.rows[:3])][0]
    all_specs = list(specs)
    if first_note:
        all_specs = [dict(title="ملاحظات على المحضر السابق", rationale="لا توجد ملاحظات.", decision="-", document_ref="-", attachments="-", action_required="-", table=None)] + all_specs
    from docx.table import Table
    for n, sp in enumerate(all_specs, 1):
        el = copy.deepcopy(proto)
        sig._tbl.addprevious(el)
        t = Table(el, d)
        set_cell_text(t.rows[0].cells[0], f"الموضوع {n:02d}")
        set_cell_text(t.rows[0].cells[1], sp["title"])
        for row in t.rows[1:]:
            tx = row_texts(row)
            if not tx:
                continue
            lab = norm(tx[0])
            target = {norm("حيثيات الموضوع"): "rationale", norm("التوصية / القرار"): "decision", norm("المستند"): "document_ref",
                      norm("المرفقات"): "attachments", norm("الإجراء المطلوب"): "action_required"}.get(lab)
            if target and len(row.cells) > 1:
                set_cell_text(row.cells[1], sp[target])
                if target == "rationale" and sp.get("table"):
                    cell = row.cells[1]
                    m = sp["table"]
                    tb = cell.add_table(rows=len(m), cols=len(m[0]))
                    for ri, r in enumerate(m):
                        for ci, v in enumerate(r):
                            tb.rows[ri].cells[ci].text = v
            if lab == norm("تصويت الأعضاء") and len(row.cells) > 2 and row_texts(row)[1] != "الاسم":
                set_cell_text(row.cells[2], pick(["موافق", "✓", ""]))
    # agenda
    agenda = tables[0]
    for i, row in enumerate(agenda.rows):
        if "جدول الأعمال" in " ".join(row_texts(row)):
            start = i + 1
            break
    rows = agenda.rows
    while len(agenda.rows) - start < len(all_specs):
        agenda._tbl.append(copy.deepcopy(agenda.rows[-1]._tr))
    for j, sp in enumerate(all_specs):
        set_cell_text(agenda.rows[start + j].cells[0], sp["title"])
    d.save(path)


def gen_archives():
    if os.path.exists(OUT):
        shutil.rmtree(OUT)
    col = os.path.join(OUT, "archive_college")
    dep = os.path.join(OUT, "archive_dept")
    os.makedirs(os.path.join(col, "1446"))
    os.makedirs(os.path.join(dep, "cs"))
    os.makedirs(os.path.join(dep, "it"))
    kinds = ["research_bonus", "conference", "appointment", "promotion", "schedules", "change_major", "scholarship", "generic"]
    for s in range(1, 13):
        specs = [topic_spec(pick(kinds), "college", pick(DEPTS), s, date()) for _ in range(R.randint(3, 6))]
        sub = "1446" if s % 3 == 0 else ""
        build_minutes(os.path.join(col, sub, f"محضر مجلس الكلية {s}.docx"), "اسم اللجنة / مجلس كلية الحوسبة والمعلوماتية", s, date(), specs)
    dkinds = ["research_bonus", "conference", "appointment", "promotion", "schedules", "generic"]
    for dname, folder in (("علوم الحاسب", "cs"), ("تقنية المعلومات", "it")):
        for s in range(1, 8):
            specs = [topic_spec(pick(dkinds), "department", dname, s, date()) for _ in range(R.randint(3, 5))]
            build_minutes(os.path.join(dep, folder, f"محضر {s} {folder}.docx"), f"اسم اللجنة / مجلس قسم {dname} (Department Council)", s, date(), specs)
    # a non-minutes file and a text file in the archive
    with open(os.path.join(col, "ملاحظات.txt"), "w", encoding="utf-8") as f:
        f.write("الموضوع 1\nملاحظات عامة\nنص تجريبي\nالبند الثاني\nعنوان آخر\n")
    return col, dep


def gen_current_department_minutes():
    out = []
    for dname in DEPTS:
        specs = [topic_spec(k, "department", dname, 9, date()) for k in ["research_bonus", "conference", "appointment", "promotion", "schedules", "generic", "change_major"]]
        p = os.path.join(OUT, f"current_{dname}.docx")
        build_minutes(p, f"اسم اللجنة / مجلس قسم {dname}", R.randint(5, 15), date(), specs)
        out.append(p)
    return out


def gen_committee():
    sp = topic_spec("scholarship", "college", "علوم الحاسب", 3, date())
    sp["title"] = "دراسة طلب تمديد بعثة المحاضرة/ نورة سعد الشهري، محاضر بقسم علوم الحاسب في كلية الحوسبة والمعلوماتية، لدراسة الدكتوراه في جامعة ليدز."
    sp["rationale"] = ("بناءً على توصية إدارة الابتعاث والاستقطاب رقم (us 12345) وتاريخ 2026/04/22 بشأن الطلب، رقم سجل مدني (1098765432) "
                       "كما اطلعت اللجنة على مالحظات المشرف حول تقدم الدراسة وذلك وفق البيانات التالية:\nاسم الجامعة: University of Leeds\n"
                       "التخصص العام: علوم الحاسب\nبلد الابتعاث: المملكة المتحدة\nبداية البعثة: 2022/09/01\nمبررات الطلب: استكمال متطلبات الرسالة.")
    sp["decision"] = "التوصية بالموافقة بالإجماع على التمديد."
    p = os.path.join(OUT, "committee.docx")
    build_minutes(p, "اسم اللجنة / اللجنة الثلاثية لكلية الحوسبة والمعلوماتية لشؤون الابتعاث", 3, "2026/05/04", [sp], first_note=False)
    return p


def gen_forms():
    paths = []
    # appointment-like form with key/value tables
    d = Document()
    d.add_paragraph("نموذج طلب تعيين عضو هيئة تدريس")
    t = d.add_table(rows=3, cols=4)
    vals = [["الاسم", "ريم عبدالله القحطاني", "الجنس", "☑ أنثى ☐ ذكر"], ["الرتبة العلمية", "أستاذ مساعد", "القسم", "علوم الحاسب"], ["البريد", "r@x.sa", "الجوال", "0500000000"]]
    for ri, r in enumerate(vals):
        for ci, v in enumerate(r):
            t.rows[ri].cells[ci].text = v
    t2 = d.add_table(rows=4, cols=3)
    for ri, r in enumerate([["المؤهل", "الجامعة", "التخصص"], ["البكالوريوس", "جامعة الملك سعود", "علوم الحاسب"], ["الماجستير", "جامعة ليدز", "الذكاء الاصطناعي"], ["الدكتوراه", "جامعة نوتنغهام", "تعلم الآلة"]]):
        for ci, v in enumerate(r):
            t2.rows[ri].cells[ci].text = v
    p = os.path.join(OUT, "form_appointment.docx"); d.save(p); paths.append(p)
    # excellence form with publication table
    d = Document()
    d.add_paragraph("طلب مكافأة بدل التميز للنشر العلمي")
    t = d.add_table(rows=2, cols=4)
    for ri, r in enumerate([["اسم العضو", "خالد عمر الحربي", "الرتبة", "أستاذ مشارك"], ["القسم", "تقنية المعلومات", "الجنس", "ذكر"]]):
        for ci, v in enumerate(r):
            t.rows[ri].cells[ci].text = v
    t2 = d.add_table(rows=3, cols=5)
    for ri, r in enumerate([["عنوان البحث", "اسم المجلة", "تخصص المجلة", "معامل التأثير", "تاريخ النشر"],
                            ["Blockchain for secure e-healthcare records", "IEEE Access", "Computer Science", "3.9", "2025-11-02"],
                            ["Federated learning for smart campus energy prediction", "Sensors", "Engineering", "3.4", "2026-01-15"]]):
        for ci, v in enumerate(r):
            t2.rows[ri].cells[ci].text = v
    p = os.path.join(OUT, "form_excellence.docx"); d.save(p); paths.append(p)
    # conference form
    d = Document()
    d.add_paragraph("طلب الحضور/المشاركة في المؤتمرات")
    t = d.add_table(rows=2, cols=2)
    for ri, r in enumerate([["اسم مقدم الطلب", "فيصل ناصر المطيري"], ["الجنس", "ذكر"]]):
        for ci, v in enumerate(r):
            t.rows[ri].cells[ci].text = v
    t2 = d.add_table(rows=2, cols=2)
    for ri, r in enumerate([["الرتبة العلمية الحالية", "التخصص الدقيق"], ["محاضر", "الشبكات"]]):
        for ci, v in enumerate(r):
            t2.rows[ri].cells[ci].text = v
    t3 = d.add_table(rows=4, cols=4)
    for ri, r in enumerate([["عنوان المؤتمر أو الندوة", "IEEE International Conference on Big Data", "", "المدينة: لندن"],
                            ["نبذة موجزة عن المؤتمر", "مؤتمر دولي محكم", "", "الدولة: المملكة المتحدة"],
                            ["الجهة المنظمة للمؤتمر", "IEEE", "", "من: 2026/06/10 إلى: 2026/06/12"],
                            ["عنوان البحث", "Edge computing for smart cities", "", ""]]):
        for ci, v in enumerate(r):
            t3.rows[ri].cells[ci].text = v
    d.add_paragraph("نوع المشاركة: تقديم بحث")
    p = os.path.join(OUT, "form_conference.docx"); d.save(p); paths.append(p)
    # promotion form
    d = Document()
    d.add_paragraph("استمارة طلب ترقية علمية")
    d.add_paragraph("المرتبة العلمية المتقدم للترقية إليها: ☐ أستاذ ☑ أستاذ مشارك")
    t = d.add_table(rows=2, cols=4)
    for ri, r in enumerate([["الاسم", "منى علي الغامدي", "الجنس", "☐ ذكر ☑ أنثى"], ["الجنسية", "سعودية", "القسم", "علوم الحاسب"]]):
        for ci, v in enumerate(r):
            t.rows[ri].cells[ci].text = v
    t2 = d.add_table(rows=2, cols=3)
    for ri, r in enumerate([["الرتبة الحالية", "تاريخ التعيين/الترقية", "الجامعة"], ["أستاذ مساعد", "1440/05/12", "جامعة الأمير مساعد"]]):
        for ci, v in enumerate(r):
            t2.rows[ri].cells[ci].text = v
    t3 = d.add_table(rows=4, cols=3)
    for ri, r in enumerate([["م", "عنوان العمل (بلغة النشر)", "نوع العمل (1-10)"],
                            ["1", "Al-Ghamdi, M. (2024). A Hybrid Deep Learning Model for Arabic Sentiment Analysis. IEEE Access, 12, 1-10.", "3"],
                            ["2", "Al-Ghamdi, M., Ali, S. (2025). \"Privacy preserving analytics\". Sensors, 25(3).", "4"],
                            ["المجموع", "", "7"]]):
        for ci, v in enumerate(r):
            t3.rows[ri].cells[ci].text = v
    p = os.path.join(OUT, "form_promotion.docx"); d.save(p); paths.append(p)
    # Excel: multiple requests grouped by type
    wb = Workbook()
    ws = wb.active
    ws.title = "الطلبات"
    ws.append(["نوع الطلب", "اسم الطالب", "الرقم الجامعي", "البرنامج", "المرفق"])
    ws.append(["تأجيل الدراسة", "سارة فهد الدوسري", 441234567, "بكالوريوس علوم الحاسب", "نموذج التأجيل"])
    ws.append(["تأجيل الدراسة", "أحمد علي السبيعي", 441234568, "بكالوريوس تقنية المعلومات", "نموذج التأجيل"])
    ws.append(["إعادة القيد", "نورة سعد الشهري", 431234569, "بكالوريوس علوم الحاسب", "خطاب"])
    ws2 = wb.create_sheet("بيانات")
    ws2.append(["الحقل", "القيمة"])
    ws2.append(["الموضوع", "طلب معادلة مقررات"])
    ws2.append(["اسم الطالب", "ماجد حسن العمري"])
    ws2.append(["المعدل", 3.75])
    import datetime
    ws2.append(["تاريخ الطلب", datetime.datetime(2026, 3, 1)])
    p = os.path.join(OUT, "requests.xlsx"); wb.save(p); paths.append(p)
    return paths


class Var:
    def __init__(self, v): self.v = v
    def get(self): return self.v
    def set(self, v): self.v = v


def run():
    col, dep = gen_archives()
    college_topics = build_archive(col, council_level="college")
    dept_topics = build_archive(dep, council_level="department")
    print("college topics", len(college_topics), "dept topics", len(dept_topics))
    template = TEMPLATE

    # ---------------- college council
    a = appmod.MinutesApp.__new__(appmod.MinutesApp)
    a.archive_topics = college_topics
    a.items = []
    for p in gen_current_department_minutes():
        m = parse_minutes_file(p)
        for t in m.topics:
            if a._is_previous_minutes_note(t):
                continue
            a.items.append(a._new_item(t, m.session, "department", "src", p, True))
    src = parse_committee_file(gen_committee())
    a.items.append(a._new_item(src.topic, src.session, "committee", "committee", "", True, "scholarship_notice"))
    for title, det, att in [("الجداول", "", "جداول الفصل القادم"), ("تغيير التخصص", "", ""), ("موضوع خاص جديد", "التوصية: التوصية بالموافقة.\nالمرفقات: مرفق", "مرفق رئيسي")]:
        a.items.append(a._new_item(Topic(title=title, rationale=det, attachments=att), SessionInfo(), "manual", "manual", "", True, ""))
    a.items[-1]["new_topic_mode"] = True
    generated = []
    for i in range(len(a.items)):
        try:
            generated.append(a._generate_item(i))
        except Exception as e:
            print("college gen error:", str(e)[:80])
    # manual overrides
    for i in range(0, len(a.items) - 1, 3):
        p = college_topics[R.randrange(len(college_topics))]
        a.items[i]["precedent_override"] = (p["source_file"], p["title"])
        try:
            a._generate_item(i)
        except Exception as e:
            print("override gen error:", str(e)[:80])
    if generated:
        out = os.path.join(OUT, "out_college.docx")
        build_minutes_document(template, out, {"session_number": "12", "day": "الأحد", "date": "2026/11/08", "place": "قاعة المجلس", "time": "10:00"}, generated)

    # ---------------- department council
    for target in ("علوم الحاسب", "تقنية المعلومات"):
        for scope in dpmod.SCOPE_LABELS:
            d = dpmod.DepartmentPanel.__new__(dpmod.DepartmentPanel)
            d.archive_topics = dept_topics
            d.items = []
            d.target_department_var = Var(target)
            d.scope_var = Var(scope)
            for fp in gen_forms():
                try:
                    topics, ses, kind = import_current_source(fp)
                except Exception as e:
                    print("import error", e)
                    continue
                for t in topics:
                    d.items.append(d._new_item(t, fp, kind, True))
                # attach flow: profile + extraction
                try:
                    topics2, _s, _k = import_current_source(fp, prefer_form=True)
                except Exception:
                    topics2 = []
                for t in topics2:
                    for prof in ("appointment", "excellence", "conference", "promotion"):
                        ex = extract_form_fields(t, prof)
                        fields_to_text(ex, ex.values)
                        publication_records_to_text(ex.records)
                    prof = topic_profile(t.title, "")
                    if prof:
                        ex = extract_form_fields(t, prof)
                        it = d._new_item(Topic(title=t.title, rationale=fields_to_text(ex, ex.values)), fp, "attach", True)
                        it["structured_fields"] = dict(ex.values)
                        it["structured_records"] = list(ex.records or [])
                        d.items.append(it)
            for t in [Topic(title="بدل تميز"), Topic(title="حضور مؤتمر"), Topic(title="طلب تعيين الدكتور/ ــــــــــــ بقسم " + target)]:
                d.items.append(d._new_item(t, "", "manual", True))
            outs = []
            for i in range(len(d.items)):
                try:
                    outs.append(d.generate_item(i))
                except Exception as e:
                    pass
            if outs and scope == dpmod.SCOPE_LABELS[0]:
                build_department_minutes_document(template, os.path.join(OUT, f"out_dept_{target}.docx"),
                                                  {"session_number": "4", "day": "الإثنين", "date": "2026/11/09", "place": "عن بعد", "time": "11:00"}, outs)


if __name__ == "__main__":
    run()
    print("done")
