"""Produce the Python tool's PDF reading results (reference for tests/compare_pdf.js).

usage: python3 tests/pdf_reference.py <python tool dir> <out.json> <pdf files...>
"""
import json
import os
import sys

tool = sys.argv[1]
sys.path.insert(0, tool)
from core.pdf_source_reader import read_pdf_source  # noqa: E402
from core.extract import read_text  # noqa: E402
import fitz  # noqa: E402

out = {}
for p in sys.argv[3:]:
    src = read_pdf_source(p)
    doc = fitz.open(p)
    sorted_pages = [page.get_text("text", sort=True) or "" for page in doc]
    out[os.path.basename(p)] = {
        "source": {"text": src.text, "tables": src.tables, "searchable": src.searchable, "page_count": src.page_count},
        "sorted": sorted_pages,
        "plumber": read_text(p),
    }
with open(sys.argv[2], "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False)
print("ok", len(out))
