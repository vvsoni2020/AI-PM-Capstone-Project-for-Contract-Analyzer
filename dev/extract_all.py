"""Build the commitments register from every signed contract (local testing)."""
import os
import sys
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from aca.db import get_db  # noqa: E402
from aca.register import extract_for_doc  # noqa: E402

docs = [d for d in get_db().select("docs") if d.get("role") == "signed"]
with ThreadPoolExecutor(max_workers=5) as ex:
    for r in ex.map(lambda d: extract_for_doc(d["id"]), docs):
        print(r["file"], r["entries"], r["usage"])
