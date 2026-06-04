import openpyxl
import zipfile
import os
import re

EXCEL     = "/root/.claude/uploads/32783ae4-1890-45a7-be14-608154d31e88/c55e1afa-________________.xlsx"
TEMPLATE_F = "/root/.claude/uploads/32783ae4-1890-45a7-be14-608154d31e88/e2c38c30-tempalte_1_otherdocx.docx"  # female
TEMPLATE_M = "/root/.claude/uploads/32783ae4-1890-45a7-be14-608154d31e88/ea97cc2d-tempalte_2other.docx"       # male
OUT_DIR   = "/home/user/Test/certificates"

def replace_in_xml(xml, placeholder, value):
    return xml.replace(f'<w:t>{placeholder}</w:t>', f'<w:t>{value}</w:t>')

def generate_docx(template, arabic_name, arabic_title, english_name,
                  english_prefix, arabic_role, out_path):
    with zipfile.ZipFile(template, 'r') as z:
        names = z.namelist()
        files = {n: z.read(n) for n in names}

    xml = files['word/document.xml'].decode('utf-8')

    # Connect ك with role (remove space between ك and X)
    xml = xml.replace('<w:t xml:space="preserve"> ك</w:t>', '<w:t></w:t>')

    xml = replace_in_xml(xml, 'A', arabic_name)
    xml = replace_in_xml(xml, 'B', arabic_title)
    xml = replace_in_xml(xml, 'C', english_name)
    xml = replace_in_xml(xml, 'D', english_prefix)
    xml = replace_in_xml(xml, 'X', 'ك' + arabic_role)

    files['word/document.xml'] = xml.encode('utf-8')

    with zipfile.ZipFile(out_path, 'w', zipfile.ZIP_DEFLATED) as zout:
        for n in names:
            zout.writestr(n, files[n])

def main():
    os.makedirs(OUT_DIR, exist_ok=True)

    wb = openpyxl.load_workbook(EXCEL)
    ws = wb.active

    generated = 0
    skipped   = 0

    for row in range(7, ws.max_row + 1):
        gender       = ws.cell(row, 2).value   # col B
        arabic_role  = ws.cell(row, 7).value   # col G = X
        english_name = ws.cell(row, 8).value   # col H = C
        arabic_name  = ws.cell(row, 9).value   # col I = A
        eng_prefix   = ws.cell(row, 10).value  # col J = D
        arabic_title = ws.cell(row, 11).value  # col K = B
        num          = ws.cell(row, 12).value  # col L = #

        # Skip rows missing essential data
        if not arabic_name or not english_name:
            if num:
                print(f"  ⚠ Row {row} (#{num}): missing name — skipped")
            skipped += 1
            continue

        arabic_name  = arabic_name.strip()
        english_name = english_name.strip()
        arabic_role  = (arabic_role  or '').strip()
        arabic_title = (arabic_title or '').strip()
        eng_prefix   = (eng_prefix   or '').strip()
        male = str(gender or '').strip().startswith('ذكر')

        template = TEMPLATE_M if male else TEMPLATE_F

        safe = arabic_name.replace(' ', '_').replace('.', '').replace('/', '')
        out_path = os.path.join(OUT_DIR, f'{safe}.docx')

        print(f"Generating: {arabic_name} ({'M' if male else 'F'})")
        generate_docx(template, arabic_name, arabic_title, english_name,
                      eng_prefix, arabic_role, out_path)
        generated += 1

    print(f"\nDone: {generated} generated, {skipped} skipped (incomplete data).")

if __name__ == '__main__':
    main()
