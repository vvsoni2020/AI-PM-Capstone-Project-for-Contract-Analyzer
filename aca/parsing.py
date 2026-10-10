"""Turning uploaded files into ACA documents (intake, FR-1 / FR-2 / FR-3).

Supported without any packages: .md, .txt, .docx (Word), .eml (forwarded email with the
contract attached or pasted). PDF is not supported in the prototype (see README).
"""
import base64
import csv
import email
import email.policy
import io
import re
import zipfile
from xml.etree import ElementTree

SUPPORTED = (".md", ".txt", ".docx", ".eml")


class ParseError(ValueError):
    pass


def docx_to_text(raw):
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        xml = z.read("word/document.xml")
    ns = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
    root = ElementTree.fromstring(xml)
    paras = []
    for p in root.iter(ns + "p"):
        texts = [t.text or "" for t in p.iter(ns + "t")]
        paras.append("".join(texts))
    return "\n".join(paras).strip()


def file_to_text(filename, raw):
    name = filename.lower()
    if name.endswith((".md", ".txt")):
        return raw.decode("utf-8", "replace")
    if name.endswith(".docx"):
        return docx_to_text(raw)
    if name.endswith(".pdf"):
        raise ParseError("PDF upload isn't supported in the prototype yet – please upload the Word (.docx) or text version.")
    raise ParseError(f"Unsupported file type: {filename}")


def parse_email(raw):
    """Email intake (simulated, FR-1): a POC forwards the contract email; we take the attachment."""
    msg = email.message_from_bytes(raw, policy=email.policy.default)
    info = {
        "from": str(msg.get("From", "")),
        "subject": str(msg.get("Subject", "")),
        "date": str(msg.get("Date", "")),
    }
    attachments, body = [], ""
    for part in msg.walk():
        if part.is_multipart():
            continue
        fname = part.get_filename()
        if fname and fname.lower().endswith(SUPPORTED[:3] + (".pdf",)):
            attachments.append((fname, part.get_payload(decode=True) or b""))
        elif part.get_content_type() == "text/plain" and not fname:
            body += part.get_content()
    return info, attachments, body


# ---------------------------------------------------------------- metadata helpers
HEADER_RE = re.compile(r"^\*\((.+?)\)\*", re.S)


def header_note(text):
    m = HEADER_RE.match(text.strip())
    return m.group(1).strip() if m else ""


def title_of(text):
    m = re.search(r"^#\s+(.+)$", text, re.M)
    if m:
        return m.group(1).strip()
    for line in text.splitlines():
        if line.strip() and not line.startswith("*("):
            return line.strip()[:120]
    return "Untitled"


POC_NAMES = ("Karandeep", "Bhavin", "Dhaval", "Jay", "Pranav")


def poc_from_note(note):
    for n in POC_NAMES:
        if n in note:
            return "KD" if n == "Karandeep" else n
    return None


def out_of_scope_reason(text):
    """FR-3: freelancer and employee contracts are HR's, not KD's. Deterministic rule."""
    head = text[:4000]
    if re.search(r"\bEMPLOYMENT AGREEMENT\b|\bOFFER OF EMPLOYMENT\b", head, re.I):
        return "Employee contract"
    if re.search(r"INDEPENDENT CONTRACTOR AGREEMENT|FREELANC", head, re.I):
        return "Freelancer (independent contractor) agreement"
    if re.search(r"\ban individual residing\b", head, re.I) and re.search(r"independent contractor|freelanc", text, re.I):
        return "Agreement with an individual freelancer"
    return None


def doc_type_of(text, filename=""):
    t = (title_of(text) + " " + filename).upper()
    for key, label in (("BUSINESS ASSOCIATE", "BAA"), ("NON-DISCLOSURE", "NDA"), ("NONDISCLOSURE", "NDA"),
                       ("NDA", "NDA"), ("STATEMENT OF WORK", "SOW"), ("SOW", "SOW"), ("PARTNERSHIP", "Partnership"),
                       ("SUBCONTRACTOR", "Subcontractor"), ("CONTRACTOR", "Contractor"), ("WAIVER", "Waiver letter"),
                       ("PILOT", "Pilot agreement"), ("MASTER", "MSA"), ("SERVICES AGREEMENT", "Services agreement"),
                       ("AGREEMENT", "Agreement")):
        if key in t:
            return label
    return "Contract"


# ---------------------------------------------------------------- dataset tracker
DEADLINE_RE = re.compile(r"(?:\bby|\bbefore|start)\s+(?:[A-Z][a-z]{2}\s+)?(\d{1,2})\s*(?:st|nd|rd|th)?\s+Oct", re.I)


def parse_tracker(csv_text):
    return list(csv.DictReader(io.StringIO(csv_text)))


def _norm(s):
    return re.sub(r"[^a-z0-9]+", " ", (s or "").lower()).strip()


def match_tracker(filename, rows, role):
    """Find the tracker row for a dataset file by counterparty name + document type."""
    fname = _norm(filename)
    best, best_score = None, 0
    for r in rows:
        words = [w for w in _norm(r["counterparty"]).split() if w not in ("inc", "ltd", "pvt", "llc", "the", "group", "co", "gmbh")]
        if not words or words[0] not in fname:
            continue
        score = 1 + sum(1 for w in words[1:] if w in fname)
        dt = _norm(r["doc_type"])
        for key in ("nda", "baa", "sow", "contractor", "partnership", "waiver", "msa"):
            if key in dt and key in fname:
                score += 3
        if "sow 2" in dt and "sow2" in fname.replace(" ", ""):
            score += 3
        status = (r.get("status") or "").lower()
        if role == "incoming" and status in ("in review", "draft", ""):
            score += 2
        if role == "signed" and status == "signed":
            score += 2
        if score > best_score:
            best, best_score = r, score
    return best


def deadline_from_notes(notes, year=2026):
    m = DEADLINE_RE.search(notes or "")
    if not m:
        return None
    return f"{year}-10-{int(m.group(1)):02d}"


def value_from_row(row):
    try:
        return float(row.get("value_usd") or "") or None
    except ValueError:
        return None


def decode_b64(s):
    return base64.b64decode(s.split(",", 1)[-1])
