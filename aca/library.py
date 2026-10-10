"""Document library: dataset import, new-contract intake, linking deal documents."""
import os
import re

from . import parsing
from .db import audit, get_db, now_iso

SKIP = re.compile(r"(readme|\.ds_store|\.xlsx$|key|secret|\.env)", re.I)


def _counterparty_from_filename(fname):
    base = os.path.splitext(os.path.basename(fname))[0]
    base = re.sub(r"^\d{4}-\d{2}-\d{2}_", "", base)
    base = re.sub(r"_(msa|nda|baa|sow\d*|draft|scanned|agreement|mutual|services|strategic|partnership|pilot|"
                  r"subcontractor|contractor|letter|waiver|intercompany|health|analytics).*$", "", base)
    return base.replace("_", " ").title()


def _role_for_path(path):
    p = path.replace("\\", "/").lower()
    if "signed_contracts/" in p:
        return "signed"
    if "incoming/" in p:
        return "incoming"
    if "meeting_notes/" in p:
        return "incident"
    if "checklist" in p or "negotiation_notes" in p:
        return "policy"
    if "entities" in p:
        return "reference"
    if p.endswith("contract_tracker.csv"):
        return "tracker"
    if "samples/" in p or "edge" in p:
        return "incoming"
    return "incoming"


def _side_of(note, text, role):
    n = (note or "").lower()
    if "atliq draft" in n or "our own" in n or "atliq's own" in n or "vendor template" in n:
        return "buyer" if re.search(r"subcontract|vendor|contractor", text[:3000], re.I) else "supplier (AtliQ paper)"
    if "partner" in n:
        return "partner"
    return "supplier"


def import_files(files, actor="KD", source="dataset"):
    """files: list of {"path": str, "text": str}. Upserts by path. Returns a summary."""
    db = get_db()
    existing = {d["path"]: d for d in db.select("docs", columns=["id", "path"])}
    tracker_rows = []
    for f in files:
        if f["path"].lower().endswith("contract_tracker.csv"):
            tracker_rows = parsing.parse_tracker(f["text"])
    if not tracker_rows:
        tr = db.select("docs", eq={"role": "tracker"})
        if tr:
            tracker_rows = parsing.parse_tracker(tr[0]["text"])

    summary = {"added": 0, "updated": 0, "skipped": []}
    for f in files:
        path, text = f["path"].replace("\\", "/"), f["text"]
        if SKIP.search(os.path.basename(path)):
            summary["skipped"].append(path)
            continue
        role = f.get("role") or _role_for_path(path)
        note = parsing.header_note(text)
        rec = {
            "path": path,
            "filename": os.path.basename(path),
            "role": role,
            "text": text,
            "title": parsing.title_of(text) if role != "tracker" else "Contract tracker",
            "header_note": note,
            "source": f.get("source", source),
        }
        if role in ("signed", "incoming"):
            row = parsing.match_tracker(path, tracker_rows, role) if tracker_rows else None
            rec.update({
                "doc_type": parsing.doc_type_of(text, path),
                "counterparty": (row or {}).get("counterparty") or f.get("counterparty") or _counterparty_from_filename(path),
                "tracker_id": (row or {}).get("contract_id"),
                "tracker_notes": (row or {}).get("notes"),
                "country": (row or {}).get("client_country") or f.get("country"),
                "entity": (row or {}).get("atliq_entity"),
                "value_usd": parsing.value_from_row(row or {}) or f.get("value_usd"),
                "poc": f.get("poc") or parsing.poc_from_note(note) or {"Karandeep": "KD"}.get((row or {}).get("requested_by"), (row or {}).get("requested_by")),
                "side": _side_of(note, text, role),
                "received_date": (re.match(r"(\d{4}-\d{2}-\d{2})", os.path.basename(path)) or [None, None])[1],
            })
            if role == "incoming":
                rec["deadline"] = f.get("deadline") or parsing.deadline_from_notes((row or {}).get("notes"))
                reason = parsing.out_of_scope_reason(text)
                rec["scope"] = "out" if reason else "in"
                rec["scope_reason"] = reason
                rec["status"] = "Out of scope – HR signs" if reason else "Received"
            else:
                rec["status"] = "Signed"
                rec["scope"] = "in"
        if path in existing:
            db.update("docs", {"id": existing[path]["id"]}, rec)
            summary["updated"] += 1
        else:
            db.insert("docs", rec)
            summary["added"] += 1
    link_documents()
    audit(actor, "import_documents", None, {"source": source, **{k: v for k, v in summary.items() if k != "skipped"},
                                           "skipped": len(summary["skipped"])})
    return summary


SUFFIX = {"inc", "ltd", "pvt", "llc", "co", "gmbh", "limited", "private", "plc", "fz", "the", "and", "&"}


def _phrase(counterparty):
    words = [w for w in re.findall(r"[a-z]+", (counterparty or "").lower()) if w not in SUFFIX]
    return " ".join(words[:2])


def link_documents():
    """Link documents of the same deal: same counterparty, or a counterparty named in the text
    (e.g. Kriti's draft names Rheinwerk as the End Client). Linked docs feed the flow-down check."""
    db = get_db()
    docs = db.select("docs")
    contracts = [d for d in docs if d.get("role") in ("signed", "incoming")]
    for d in contracts:
        if d["role"] != "incoming":
            continue
        mine = _phrase(d.get("counterparty"))
        links = []
        for o in contracts:
            if o["id"] == d["id"]:
                continue
            ph = _phrase(o.get("counterparty"))
            if not ph:
                continue
            same = ph == mine
            named = o["role"] == "incoming" and re.search(r"\b" + re.escape(ph) + r"\b", d["text"], re.I)
            if same or named:
                links.append(o["id"])
        patch = {}
        if sorted(links) != sorted(d.get("links") or []):
            patch["links"] = links
        if not d.get("deadline"):  # a deal document without its own date inherits the deal's earliest deadline
            dates = sorted(o["deadline"] for o in contracts if o["id"] in links and o.get("deadline")
                           and o["role"] == "incoming" and _phrase(o.get("counterparty")) == mine)
            if dates:
                patch.update({"deadline": dates[0], "deadline_note": "Same deadline as the linked deal document"})
        if patch:
            db.update("docs", {"id": d["id"]}, patch)


def intake_upload(filename, raw, meta, actor, via="upload"):
    """A POC or KD adds a new contract (file upload or forwarded email)."""
    email_info = None
    if filename.lower().endswith(".eml"):
        email_info, attachments, body = parsing.parse_email(raw)
        if attachments:
            filename, raw = attachments[0]
        elif body.strip():
            filename, raw = (email_info.get("subject") or "email") + ".txt", body.encode()
        else:
            raise parsing.ParseError("The email has no contract attached")
        via = "email"
        poc = parsing.poc_from_note(email_info.get("from", "")) or meta.get("poc")
        meta = {**meta, "poc": meta.get("poc") or poc}
    text = parsing.file_to_text(filename, raw)
    if len(text.strip()) < 200:
        raise parsing.ParseError("The file has too little readable text to review. If it is a scan, run OCR first.")
    path = f"uploads/{now_iso()[:19].replace(':', '')}_{os.path.basename(filename)}"
    import_files([{"path": path, "text": text, "role": "incoming", "source": via,
                   "counterparty": meta.get("counterparty") or None, "poc": meta.get("poc"),
                   "deadline": meta.get("deadline") or None, "value_usd": _num(meta.get("value_usd")),
                   "country": meta.get("country") or None}], actor=actor, source=via)
    doc = get_db().select("docs", eq={"path": path})[0]
    if email_info:
        get_db().update("docs", {"id": doc["id"]}, {"email_info": email_info})
    audit(actor, "contract_received", doc["id"], {"via": via, "filename": filename, "email": email_info})
    return doc


def _num(v):
    try:
        return float(str(v).replace(",", "").replace("$", "")) if v not in (None, "") else None
    except ValueError:
        return None
