import openpyxl
import zipfile
import os
import re
import mammoth
from weasyprint import HTML

EXCEL = "/root/.claude/uploads/502651ea-f994-43cc-a929-2fb4f7777bdc/435c3242-____________________________________________________________________________.xlsx"
TEMPLATE = "/root/.claude/uploads/502651ea-f994-43cc-a929-2fb4f7777bdc/d153a707-tempalte.docx"
OUT_DIR = "/home/user/Test/certificates"

ROLE_TRANSLATIONS = {
    "مشرفة برنامج ماجستير علوم البيانات": "Supervisor of the Master's Program in Data Science",
    "مشرف برنامج ماجستير الأمن السيبراني": "Supervisor of the Master's Program in Cybersecurity",
    "شاركت في دورة القبول للماجستير للعام القادم": "Participation in the Master's Admission Process for the Upcoming Academic Year",
}

def translate_role(arabic_role):
    return ROLE_TRANSLATIONS.get(arabic_role.strip(), arabic_role)

def is_male(arabic_name):
    return "بنت" not in arabic_name

def replace_in_xml(xml, placeholder, value):
    return xml.replace(f'<w:t>{placeholder}</w:t>', f'<w:t>{value}</w:t>')

def apply_gender(xml, male):
    if male:
        xml = xml.replace('>للدكتورة<', '>للدكتور<')
        xml = xml.replace('>جهودها<', '>جهوده<')
        xml = xml.replace('>في عملها <', '>في عمله <')
        xml = xml.replace('>her outstanding efforts<', '>his outstanding efforts<')
        xml = xml.replace('>her role<', '>his role<')
    return xml

def generate_docx(arabic_name, english_name, arabic_role, english_role, out_path):
    with zipfile.ZipFile(TEMPLATE, 'r') as z:
        names = z.namelist()
        files = {name: z.read(name) for name in names}

    xml = files['word/document.xml'].decode('utf-8')
    male = is_male(arabic_name)
    xml = apply_gender(xml, male)
    xml = replace_in_xml(xml, 'A', arabic_name)
    xml = replace_in_xml(xml, 'X', arabic_role)
    xml = replace_in_xml(xml, 'C', english_name)
    xml = replace_in_xml(xml, 'Y', english_role)
    files['word/document.xml'] = xml.encode('utf-8')

    with zipfile.ZipFile(out_path, 'w', zipfile.ZIP_DEFLATED) as zout:
        for name in names:
            zout.writestr(name, files[name])

def generate_pdf(docx_path, pdf_path):
    with open(docx_path, 'rb') as f:
        result = mammoth.convert_to_html(f)
        html = result.value

    full_html = f"""<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>body {{ margin: 0; padding: 0; }} img {{ max-width: 100%; }}</style>
</head><body>{html}</body></html>"""

    HTML(string=full_html).write_pdf(pdf_path)

def main():
    os.makedirs(OUT_DIR, exist_ok=True)

    wb = openpyxl.load_workbook(EXCEL)
    ws = wb.active

    for row in range(7, ws.max_row + 1):
        arabic_name = ws.cell(row, 11).value   # col K - Arabic name
        english_name = ws.cell(row, 10).value  # col J - English name
        arabic_role = ws.cell(row, 9).value    # col I - Arabic role

        if not arabic_name and not english_name:
            continue

        arabic_name = (arabic_name or "").strip()
        english_name = (english_name or "").strip()
        arabic_role = (arabic_role or "").strip()
        english_role = translate_role(arabic_role)

        safe_name = re.sub(r'[^\w\s.-]', '', english_name).strip().replace(' ', '_')
        docx_out = os.path.join(OUT_DIR, f"certificate_{safe_name}.docx")
        pdf_out = os.path.join(OUT_DIR, f"certificate_{safe_name}.pdf")

        print(f"Generating: {english_name}")
        generate_docx(arabic_name, english_name, arabic_role, english_role, docx_out)
        generate_pdf(docx_out, pdf_out)
        print(f"  Word: {os.path.basename(docx_out)}")
        print(f"  PDF:  {os.path.basename(pdf_out)}")

    print(f"\nDone! All certificates saved to: {OUT_DIR}")

if __name__ == "__main__":
    main()
