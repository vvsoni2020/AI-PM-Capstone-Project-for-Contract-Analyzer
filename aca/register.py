"""Commitments register (PRD FR-5 / FR-17): AI extracts, KD confirms each entry."""
import os
import re
import time

from . import claude, prompts
from .citations import verify
from .config import ENTITY_FACTS
from .db import audit, get_db, now_iso
from .masking import Masker, residual_leaks


def extract_for_doc(doc_id, actor="KD"):
    db = get_db()
    doc = db.select("docs", eq={"id": doc_id})[0]
    m = Masker()
    masked = m.mask(doc["text"], doc["filename"])
    signed = (re.match(r"(\d{4}-\d{2}-\d{2})", doc["filename"]) or [None, None])[1]
    blocks = [
        {"type": "text", "text": f'<source name="atliq_entity_facts">\n{ENTITY_FACTS}\n</source>'},
        {"type": "text", "text": f'Signed contract: {doc["filename"]} (counterparty {doc.get("counterparty")}, signed {signed or "unknown"}).\n'
                                 f'<contract name="{doc["filename"]}">\n{masked}\n</contract>'},
    ]
    leaks = residual_leaks("\n".join(b["text"] for b in blocks))
    if leaks:
        raise RuntimeError(f"Outbound check blocked the call: {leaks[:3]}")
    t0 = time.time()
    res = claude.call_tool(prompts.COMMON_RULES + "\n\n" + prompts.REGISTER_TASK, blocks, prompts.REGISTER_TOOL, max_tokens=10000, effort="medium")
    entries = res["input"].get("entries", [])

    # supersede previous unconfirmed extractions for this contract (confirmed ones stay)
    for old in db.select("register", eq={"source_doc_id": doc_id}):
        if old.get("status") == "pending":
            db.update("register", {"id": old["id"]}, {"status": "superseded"})

    rows = []
    for e in entries:
        ok, score = verify(e.get("quote"), masked)
        rows.append({
            **{k: (m.unmask(v) if isinstance(v, str) else v) for k, v in e.items()},
            "source_doc_id": doc_id,
            "source_file": doc["filename"],
            "source_title": doc.get("title"),
            "source_counterparty": doc.get("counterparty"),
            "source_signed_date": signed,
            "quote_verified": ok,
            "quote_score": score,
            "status": "pending",
            "extracted_at": now_iso(),
        })
    if rows:
        db.insert("register", rows)
    usage = {"input_tokens": res["usage"].get("input_tokens", 0), "output_tokens": res["usage"].get("output_tokens", 0),
             "cost_usd": res["cost_usd"], "seconds": round(time.time() - t0, 1)}
    db.update("docs", {"id": doc_id}, {"register_extracted_at": now_iso(), "register_entry_count": len(rows)})
    audit(actor, "register_extracted", doc_id, {"entries": len(rows), "unverified_quotes": sum(1 for r in rows if not r["quote_verified"]),
                                               "cost_usd": res["cost_usd"], "outbound_chars": sum(len(b["text"]) for b in blocks),
                                               "masked": m.report()["masked_counts"]})
    return {"doc_id": doc_id, "file": os.path.basename(doc["filename"]), "entries": len(rows), "usage": usage}
