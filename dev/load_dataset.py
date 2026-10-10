"""Load a dataset folder into the local DB (for local testing). Usage: python3 dev/load_dataset.py <folder>"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from aca.library import import_files  # noqa: E402

root = sys.argv[1]
files = []
for dp, _, fns in os.walk(root):
    for fn in fns:
        if fn.endswith((".md", ".csv", ".txt")):
            full = os.path.join(dp, fn)
            files.append({"path": os.path.relpath(full, root), "text": open(full, encoding="utf-8").read()})
print(import_files(files, actor="KD", source=sys.argv[2] if len(sys.argv) > 2 else "dataset"))
