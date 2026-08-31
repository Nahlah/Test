"""أدوات مساعدة للتعامل مع بنية ملفات Word (فقرات وجداول) بترتيبها الفعلي في المستند."""
import re
import unicodedata

from docx.document import Document as _Document
from docx.oxml.ns import qn
from docx.table import Table, _Cell
from docx.text.paragraph import Paragraph


def iter_block_items(parent):
    """يمرّ على الفقرات والجداول بالترتيب الذي تظهر به فعليًا في المستند."""
    if isinstance(parent, _Document):
        parent_elm = parent.element.body
    elif isinstance(parent, _Cell):
        parent_elm = parent._tc
    else:
        raise ValueError("parent يجب أن يكون Document أو Cell")

    for child in parent_elm.iterchildren():
        if child.tag == qn("w:p"):
            yield Paragraph(child, parent)
        elif child.tag == qn("w:tbl"):
            yield Table(child, parent)


def norm(text: str) -> str:
    """يزيل المسافات والأسطر الفارغة لمقارنة تسميات الحقول (مثل 'حيثيات\nالموضوع')."""
    if text is None:
        return ""
    return re.sub(r"\s+", "", text)


def cell_text(cell: _Cell) -> str:
    """نص كل فقرات الخلية مفصولة بسطر جديد (يحافظ على الفواصل بين الأسطر داخل نفس الخلية).
    يُطبَّع النص عبر NFKC لتصحيح بعض النصوص العربية التي تُخزَّن أحيانًا بأشكال عرض حروف
    منفصلة (Presentation Forms) داخل مربعات نص/WordArt فتظهر بلا مسافات صحيحة.
    """
    text = "\n".join(p.text for p in cell.paragraphs).strip()
    return unicodedata.normalize("NFKC", text)


def row_texts(row) -> list:
    return [cell_text(c) for c in row.cells]


def clear_cell(cell: _Cell):
    """يفرغ محتوى الخلية ويبقي فقرة واحدة فارغة بنفس التنسيق الافتراضي للفقرة الأولى."""
    for p in cell.paragraphs[1:]:
        p._element.getparent().remove(p._element)
    p0 = cell.paragraphs[0]
    for run in list(p0.runs):
        run._element.getparent().remove(run._element)


def set_cell_text(cell: _Cell, text: str):
    """يستبدل محتوى الخلية بنص جديد (قد يشمل أسطرًا متعددة مفصولة بـ \n)، مع محاولة الحفاظ على الخط الأساسي."""
    lines = (text or "").split("\n")
    clear_cell(cell)
    p0 = cell.paragraphs[0]
    base_font = None
    try:
        base_font = cell.paragraphs[0].style
    except Exception:
        base_font = None
    run = p0.add_run(lines[0])
    for extra in lines[1:]:
        p = cell.add_paragraph()
        if base_font is not None:
            p.style = base_font
        p.add_run(extra)
