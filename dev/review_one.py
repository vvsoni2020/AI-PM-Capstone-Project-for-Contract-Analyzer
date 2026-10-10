"""Run a review locally and print a compact brief. Usage: python3 dev/review_one.py <filename-substring> [...]"""
import json
import os
import sys
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from aca.db import get_db  # noqa: E402
from aca.review import run_review  # noqa: E402


def show(rev):
    r = rev["result"]
    doc = get_db().select("docs", eq={"id": rev["doc_id"]})[0]
    lines = [f"\n=== {doc['filename']}  [{r['state']}] {r['headline']}  ${r.get('total_cost_usd', 0)} {r.get('duration_s', 0)}s tokens={r.get('total_tokens')}"]
    for f in r["top_risks"]:
        lines.append(f"  TOP {f['id']} [{f['severity']}/{f['category']}/{f['origin']}{'/CHECK' if f.get('needs_kd_check') else ''}] {f['title']}  ({f['draft_clause_ref']} vs {f.get('source_ref')})")
    for f in r.get("other_flags", []):
        lines.append(f"   .. {f['id']} [{f['severity']}/{f['category']}/{f['origin']}] {f['title']}")
    for f in r.get("removed_flags", []):
        lines.append(f"   XX removed [{f['origin']}] {f['title']} :: {f['removed_reason']} {f['citation']}")
    if r.get("mutuality") and r["mutuality"].get("applicable"):
        mu = r["mutuality"]
        lines.append(f"   mutuality: titled={mu['titled_mutual']} actual={mu['actually_mutual']}")
    return "\n".join(lines)


if __name__ == "__main__":
    docs = get_db().select("docs")
    targets = [d for d in docs if d.get("role") == "incoming" and any(s in d["filename"] for s in sys.argv[1:])]
    with ThreadPoolExecutor(max_workers=3) as ex:
        for rev in ex.map(lambda d: run_review(d["id"]), targets):
            print(show(rev), flush=True)
