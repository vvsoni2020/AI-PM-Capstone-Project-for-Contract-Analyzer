"""The three AI-side endpoints (Python): intake, review, register extraction."""
from . import library, parsing
from .db import get_db
from .http import HttpError
from .register import extract_for_doc
from .review import run_review


def intake(body, user):
    mode = body.get("mode")
    if mode == "dataset":
        files = body.get("files") or []
        if not files:
            raise HttpError(400, "No files received")
        return library.import_files(files, actor=user, source=body.get("source", "dataset"))
    if mode == "upload":
        try:
            raw = parsing.decode_b64(body["content_b64"])
            doc = library.intake_upload(body["filename"], raw, body.get("meta") or {}, actor=user)
        except (parsing.ParseError, KeyError) as e:
            raise HttpError(400, str(e))
        return {"doc_id": doc["id"], "status": doc["status"], "scope": doc.get("scope")}
    raise HttpError(400, "mode must be 'dataset' or 'upload'")


def review(body, user):
    doc_id = body.get("doc_id")
    if not doc_id or not get_db().select("docs", eq={"id": doc_id}):
        raise HttpError(404, "Contract not found")
    rev = run_review(doc_id, actor=user)
    rev.pop("outbound", None)
    return rev


def extract(body, user):
    doc_id = body.get("doc_id")
    rows = get_db().select("docs", eq={"id": doc_id}) if doc_id else []
    if not rows or rows[0].get("role") != "signed":
        raise HttpError(400, "Obligations are extracted from signed contracts only")
    return extract_for_doc(doc_id, actor=user)
