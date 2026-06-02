import openpyxl
import zipfile
import os
import mammoth
from weasyprint import HTML

EXCEL = "/root/.claude/uploads/08d794ce-260f-42e6-8f06-48c7dfe21b84/b2bae84f-______.xlsx"
TEMPLATE = "/root/.claude/uploads/08d794ce-260f-42e6-8f06-48c7dfe21b84/7fbfe9b9-tempalte.docx"
OUT_DIR = "/home/user/Test/certificates"

def replace_in_xml(xml, placeholder, value):
    return xml.replace(f'<w:t>{placeholder}</w:t>', f'<w:t>{value}</w:t>')

def feminize_arabic_role(role):
    # Ensure role uses feminine form (منسقة instead of منسق)
    if role.startswith('منسق ') and not role.startswith('منسقة'):
        return 'منسقة ' + role[len('منسق '):]
    if role == 'منسق':
        return 'منسقة'
    return role

def apply_gender(xml, male):
    if male:
        xml = xml.replace('>للدكتورة<', '>للدكتور<')
        xml = xml.replace('>جهودها<', '>جهوده<')
        xml = xml.replace('>في عملها<', '>في عمله<')
        xml = xml.replace('>her outstanding efforts<', '>his outstanding efforts<')
        xml = xml.replace('>her role as <', '>his role as <')
        # Male section stays as-is (template default is Female Section)
        xml = xml.replace('>Female Section<', '>Male Section<')
    return xml

def generate_docx(arabic_name, english_name, arabic_role, english_role, male, out_path):
    with zipfile.ZipFile(TEMPLATE, 'r') as z:
        names = z.namelist()
        files = {name: z.read(name) for name in names}

    xml = files['word/document.xml'].decode('utf-8')
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
        arabic_name  = ws.cell(row, 11).value  # col K
        english_name = ws.cell(row, 10).value  # col J
        arabic_role  = ws.cell(row, 9).value   # col I
        english_role = ws.cell(row, 5).value   # col E
        gender       = ws.cell(row, 3).value   # col C: ذكر / أنثى

        if not arabic_name and not english_name:
            continue

        arabic_name  = (arabic_name  or "").strip()
        english_name = (english_name or "").strip()
        arabic_role  = (arabic_role  or "").strip()
        english_role = (english_role or "").strip()
        male = str(gender or "").strip() == "ذكر"

        # Feminize Arabic role for female participants
        if not male:
            arabic_role = feminize_arabic_role(arabic_role)

        # Name files by Arabic name (placeholder A)
        safe_name = arabic_name.replace(' ', '_').replace('.', '').replace('/', '')
        docx_out = os.path.join(OUT_DIR, f"{safe_name}.docx")
        pdf_out  = os.path.join(OUT_DIR, f"{safe_name}.pdf")

        print(f"Generating: {arabic_name} ({'M' if male else 'F'})")
        generate_docx(arabic_name, english_name, arabic_role, english_role, male, docx_out)
        generate_pdf(docx_out, pdf_out)

    print(f"\nDone! {OUT_DIR}")

if __name__ == "__main__":
    main()
