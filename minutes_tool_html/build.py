#!/usr/bin/env python3
"""يبني ملف HTML واحدًا يعمل دون إنترنت من ملفات src/ و vendor/.

التشغيل:  python3 build.py
الناتج:   dist/مساعد_إعداد_المحاضر.html
"""
import base64
import os
import re

ROOT = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(ROOT, "src")
VENDOR = os.path.join(ROOT, "vendor")
DIST = os.path.join(ROOT, "dist")
OUT_NAME = "مساعد_إعداد_المحاضر.html"

VENDOR_SCRIPTS = [
    "fflate-0.8.2.umd.js",
    "pdf-3.11.174.legacy.min.js",
    "pdf.worker-3.11.174.legacy.min.js",
]
APP_SCRIPTS = [
    "py.js",
    "ooxml.js",
    "similarity.js",
    "minutes_parser.js",
    "precedent_transfer.js",
    "department_form_fields.js",
    "department_transfer.js",
    "reference_learning.js",
    "xlsx.js",
    "pdf_text.js",
    "source_import.js",
    "docx_builder.js",
    "app_logic.js",
    "store.js",
    "ui_common.js",
    "ui_app.js",
]


def read(path):
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


def safe_script(code):
    # Inline <script> blocks end at the first "</script"; keep code intact otherwise.
    return re.sub(r"</(script)", r"<\\/\1", code, flags=re.I).replace("<!--", "<\\!--")


def build():
    html = read(os.path.join(SRC, "index.html"))
    css = read(os.path.join(SRC, "styles.css"))
    with open(os.path.join(VENDOR, "university_logo.png"), "rb") as f:
        logo = "data:image/png;base64," + base64.b64encode(f.read()).decode("ascii")

    parts = []
    for name in VENDOR_SCRIPTS:
        parts.append(f"<script>/* {name} */\n{safe_script(read(os.path.join(VENDOR, name)))}\n</script>")
    app = "\n".join(f"// ---- {name}\n{read(os.path.join(SRC, name))}" for name in APP_SCRIPTS)
    parts.append(f"<script>\n{safe_script(app)}\n</script>")

    html = html.replace("/*__STYLES__*/", css)
    html = html.replace("__LOGO__", logo)
    html = html.replace("<!--__SCRIPTS__-->", "\n".join(parts))

    os.makedirs(DIST, exist_ok=True)
    out = os.path.join(DIST, OUT_NAME)
    with open(out, "w", encoding="utf-8") as f:
        f.write(html)
    return out


if __name__ == "__main__":
    path = build()
    print(path, os.path.getsize(path), "bytes")
