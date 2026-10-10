"""The review pipeline (PRD §9.3 steps 3-11).

scope check → privacy gate → 4 AI calls in parallel (key terms, KD positions, register conflicts,
fairness) → fixed rules on the key terms → citation check → de-duplicate → rank → brief.
"""
import re
import time
from concurrent.futures import ThreadPoolExecutor

from . import claude, prompts
from .citations import verify
from .config import CATEGORY_RANK, ENTITY_FACTS, MODEL, SEVERITY_RANK, TODAY, TOP_RISK_SEVERITIES
from .db import audit, get_db, now_iso
from .masking import Masker, residual_leaks
from .rules import run_rules

MAX_LINKED_CHARS = 60_000


class LeakBlocked(RuntimeError):
    pass


def _src(name, text):
    return f'<source name="{name}">\n{text}\n</source>'


def load_context(doc):
    db = get_db()
    docs = db.select("docs")
    by_name = {d["filename"]: d for d in docs}
    policy = [d for d in docs if d.get("role") == "policy"]
    incidents = [d for d in docs if d.get("role") == "incident"]
    reference = [d for d in docs if d.get("role") == "reference"]
    register = [r for r in db.select("register") if r.get("status") in ("pending", "confirmed")]
    links = [d for d in docs if d["id"] in (doc.get("links") or [])]
    return {"docs": docs, "by_name": by_name, "policy": policy, "incidents": incidents, "reference": reference,
            "register": register, "links": links}


def _register_block(entries, masker):
    lines = []
    for e in entries:
        lines.append(
            f'<entry id="{e["id"][:8]}" status="{"CONFIRMED by KD" if e["status"] == "confirmed" else "extracted, NOT yet confirmed by KD"}" '
            f'source_file="{e["source_file"]}">\n'
            f'Contract: {e.get("source_title") or e["source_file"]} with {e.get("source_counterparty")} (signed {e.get("source_signed_date")}), clause {e.get("clause_ref")}\n'
            f'Type: {e["type"]}. Restricted: {e.get("restricted_party")} (binds Affiliates: {e.get("binds_affiliates")})\n'
            f'Regions: {", ".join(e.get("regions") or []) or "-"}; sectors: {", ".join(e.get("sectors") or []) or "-"}\n'
            f'Period: {e.get("start_date") or "?"} to {e.get("end_date") or "?"} ({e.get("end_rule") or ""})\n'
            f'Summary: {e.get("summary")}\n'
            f'Quote: "{masker.mask(e.get("quote") or "", e["source_file"])}"\n'
            f'Note: {e.get("note") or ""}\n</entry>')
    return "<register>\n" + "\n".join(lines) + "\n</register>"


EFFORT = {"key_terms": "low", "kd_positions": "medium", "fairness": "medium", "conflicts": "medium"}


def _call(name, system, blocks, tool, outbound, max_tokens=12000):
    text = "\n\n".join(b["text"] for b in blocks)
    leaks = residual_leaks(text)
    if leaks:
        raise LeakBlocked(f"Outbound check blocked call '{name}': {leaks[:3]}")
    outbound.append({"call": name, "chars": len(text), "text": text})
    res = claude.call_tool(system, blocks, tool, max_tokens=max_tokens, effort=EFFORT.get(name))
    res["name"] = name
    return res


def run_review(doc_id, actor="KD"):
    db = get_db()
    doc = db.select("docs", eq={"id": doc_id})[0]
    t0 = time.time()
    if doc.get("scope") == "out":
        result = {"state": "out_of_scope", "headline": f"Out of scope – HR signs ({doc.get('scope_reason')}). No review run.",
                  "top_risks": [], "other_flags": [], "checks": [{"group": "Scope", "check": "Client or partner contract",
                  "result": "flag", "evidence": doc.get("scope_reason")}]}
        rev = db.insert("reviews", {"doc_id": doc_id, "result": result, "model": None, "cost_usd": 0, "duration_s": 0,
                                    "outbound": [], "actor": actor})
        audit(actor, "analysis_stopped_out_of_scope", doc_id, {"review_id": rev["id"]})
        return rev

    ctx = load_context(doc)
    m = Masker()
    draft = m.mask(doc["text"], doc["filename"])
    contract_block = f'<contract name="{doc["filename"]}" counterparty="{doc.get("counterparty")}">\n{draft}\n</contract>'
    meta = (f"Deal metadata (from intake): counterparty {doc.get('counterparty')}; client country {doc.get('country') or 'unknown'}; "
            f"POC {doc.get('poc')}; deadline {doc.get('deadline') or 'none'}; contract value "
            f"{('USD ' + format(doc['value_usd'], ',.0f')) if doc.get('value_usd') else 'unknown'}; AtliQ side per intake note: "
            f"{doc.get('side')}. Today is {TODAY}.")

    sources = {}  # name -> masked text, used for citation checks
    pol_txt = []
    for d in ctx["policy"]:
        sources[d["filename"]] = m.mask(d["text"], d["filename"])
        pol_txt.append(_src(d["filename"], sources[d["filename"]]))
    sources[prompts.KD_PRINCIPLES_NAME] = prompts.KD_PRINCIPLES
    pol_txt.append(_src(prompts.KD_PRINCIPLES_NAME, prompts.KD_PRINCIPLES))
    inc_txt = []
    for d in ctx["incidents"]:
        sources[d["filename"]] = m.mask(d["text"], d["filename"])
        inc_txt.append(_src(d["filename"], sources[d["filename"]]))
    for d in ctx["reference"]:
        sources[d["filename"]] = m.mask(d["text"], d["filename"])
    for e in ctx["register"]:
        sd = ctx["by_name"].get(e["source_file"])
        if sd and e["source_file"] not in sources:
            sources[e["source_file"]] = m.mask(sd["text"], sd["filename"])
    linked_txt, used = [], 0
    for d in ctx["links"]:
        if used > MAX_LINKED_CHARS:
            break
        sources[d["filename"]] = m.mask(d["text"], d["filename"])
        linked_txt.append(_src(d["filename"], sources[d["filename"]]) + f"\n(Linked {d['role']} document, {d.get('doc_type')}, counterparty {d.get('counterparty')}, status {d.get('status')})")
        used += len(d["text"])

    entity_block = _src("atliq_entity_facts", ENTITY_FACTS)
    outbound, calls = [], []
    jobs = {
        "key_terms": (prompts.COMMON_RULES + "\n\n" + prompts.KEY_TERMS_TASK,
                      [{"type": "text", "text": entity_block}, {"type": "text", "text": meta + "\n\n" + contract_block}],
                      prompts.KEY_TERMS_TOOL),
        "kd_positions": (prompts.COMMON_RULES + "\n\n" + prompts.POSITIONS_TASK,
                         [{"type": "text", "text": entity_block + "\n\n" + "\n\n".join(pol_txt) + "\n\n" + "\n\n".join(inc_txt),
                           "cache_control": {"type": "ephemeral"}},
                          {"type": "text", "text": meta + "\n\n" + contract_block}],
                         prompts.FLAGS_TOOL),
        "fairness": (prompts.COMMON_RULES + "\n\n" + prompts.FAIRNESS_TASK,
                     [{"type": "text", "text": entity_block + "\n\n" + "\n\n".join(pol_txt), "cache_control": {"type": "ephemeral"}},
                      {"type": "text", "text": (("Linked documents of the same deal:\n" + "\n\n".join(linked_txt)) if linked_txt else "No linked documents.")
                       + "\n\n" + meta + "\n\n" + contract_block}],
                     prompts.FAIRNESS_TOOL),
    }
    register_note = None
    if ctx["register"]:
        pending = sum(1 for e in ctx["register"] if e["status"] != "confirmed")
        jobs["conflicts"] = (prompts.COMMON_RULES + "\n\n" + prompts.CONFLICT_TASK,
                             [{"type": "text", "text": entity_block + "\n\n" + _register_block(ctx["register"], m)},
                              {"type": "text", "text": meta + "\n\n" + contract_block}],
                             prompts.FLAGS_TOOL)
        register_note = f"{len(ctx['register'])} register entries compared ({pending} not yet confirmed by KD)."
    errors = {}
    with ThreadPoolExecutor(max_workers=4) as ex:
        futs = {name: ex.submit(_call, name, sys, blocks, tool, outbound) for name, (sys, blocks, tool) in jobs.items()}
        out = {}
        for name, f in futs.items():
            try:
                out[name] = f.result()
                calls.append(out[name])
            except Exception as e:  # noqa: BLE001
                errors[name] = str(e)[:500]

    usage = [{"call": c["name"], "input_tokens": c["usage"].get("input_tokens", 0),
              "cache_read_tokens": c["usage"].get("cache_read_input_tokens", 0) or 0,
              "cache_write_tokens": c["usage"].get("cache_creation_input_tokens", 0) or 0,
              "output_tokens": c["usage"].get("output_tokens", 0), "cost_usd": c["cost_usd"], "seconds": c["seconds"]} for c in calls]
    total_cost = round(sum(u["cost_usd"] for u in usage), 4)

    if errors:
        result = {"state": "error", "headline": "Analysis pending – the AI service failed. Nothing below is a complete brief; KD can review manually.",
                  "errors": errors, "top_risks": [], "other_flags": [], "checks": []}
        rev = db.insert("reviews", {"doc_id": doc_id, "result": result, "model": MODEL, "usage": usage, "cost_usd": total_cost,
                                    "duration_s": round(time.time() - t0, 1), "outbound": outbound, "actor": actor})
        db.update("docs", {"id": doc_id}, {"status": "Analysis pending", "updated_at": now_iso()})
        audit(actor, "analysis_failed", doc_id, {"review_id": rev["id"], "errors": errors})
        return rev

    kt = out["key_terms"]["input"]
    rule_flags, rule_checks, bundle = run_rules(kt, doc, ctx["docs"])
    flags = []
    for f in rule_flags:
        f["origin"] = "rules"
        flags.append(f)
    for name in ("conflicts", "kd_positions", "fairness"):
        if name in out:
            for f in out[name]["input"].get("flags", []):
                f["origin"] = name
                flags.append(f)

    # --- citation check -----------------------------------------------------------------
    kept, removed = [], []
    for f in flags:
        ok_d, sc_d = verify(f.get("draft_quote"), draft)
        src_name = f.get("source_doc") or ""
        ok_s, sc_s = (False, 0.0)
        if f.get("source_quote"):
            if src_name in sources:
                ok_s, sc_s = verify(f["source_quote"], sources[src_name])
            if not ok_s:  # the model may have named the wrong file; accept only an exact home elsewhere
                for n, t in sources.items():
                    ok2, sc2 = verify(f["source_quote"], t)
                    if ok2:
                        ok_s, sc_s, f["source_doc"] = True, sc2, n
                        break
        no_source_needed = f.get("category") == "unusual_instruction" or (f.get("source_type") in ("none", "rule") and not f.get("source_quote"))
        f["citation"] = {"draft_verified": ok_d, "draft_score": sc_d, "source_verified": ok_s or no_source_needed, "source_score": sc_s}
        if ok_d and (ok_s or no_source_needed):
            kept.append(f)
        else:
            f["removed_reason"] = ("draft quote not found in the contract" if not ok_d else "source quote not found in the cited source")
            removed.append(f)

    # --- de-duplicate across origins (same topic) -------------------------------------------
    def group(f):
        if f["category"] == "commitment_conflict":
            return 1
        if f["category"] == "healthcare_bundle" or f.get("topic") == "phi_baa":
            return 2
        if f["category"] == "exposure" or (f.get("topic") in ("liability_cap", "liquidated_damages", "indemnity") and f["severity"] in ("critical", "high")):
            return 3
        return 4

    def rank(f):
        # Critical findings first; within the same severity tier, the decided order:
        # existing-commitment breach → healthcare/BAA gap → uncapped exposure → the rest.
        return (0 if f["severity"] == "critical" else 1, group(f), SEVERITY_RANK.get(f["severity"], 9),
                1 if f.get("needs_kd_check") else 0, 0 if f.get("origin") == "conflicts" else 1)

    kept.sort(key=rank)
    final, seen = [], {}

    def ref_key(f):
        return re.sub(r"[^0-9a-z.()]", "", (f.get("draft_clause_ref") or "").lower().replace("clause", "").replace("section", ""))

    def related(x):
        return {k: x.get(k) for k in ("origin", "title", "severity", "draft_clause_ref", "draft_quote", "source_ref",
                                       "source_quote", "why_it_matters", "kd_position")}

    for f in kept:
        keys = [("topic", f.get("topic"), f.get("source_doc") if f["category"] == "commitment_conflict" else None),
                ("clause", ref_key(f), f["category"] == "commitment_conflict")]
        dup = None
        if f.get("source_type") != "incident":  # live incidents are never folded into another flag
            dup = next((seen[k] for k in keys if k in seen and seen[k]["origin"] != f["origin"]
                        and seen[k].get("source_type") != "incident"
                        and (k[0] == "clause" and k[1] or f.get("topic") != "other")), None)
        if dup is not None:
            if dup.get("origin") == "rules" and f.get("origin") != "rules":
                # keep the AI's richer wording (KD position, history) but the rule's severity if higher
                merged = dict(f)
                if SEVERITY_RANK.get(dup["severity"], 9) < SEVERITY_RANK.get(f["severity"], 9):
                    merged["severity"] = dup["severity"]
                merged["also_flagged_by"] = [related(dup)] + dup.get("also_flagged_by", [])
                final[final.index(dup)] = merged
                for k, v in list(seen.items()):
                    if v is dup:
                        seen[k] = merged
            else:
                dup.setdefault("also_flagged_by", []).append(related(f))
            continue
        for k in keys:
            seen.setdefault(k, f)
        final.append(f)
    final.sort(key=rank)

    for i, f in enumerate(final, 1):
        f["id"] = f"F{i}"
        f["group"] = group(f)
        for k in ("draft_quote", "source_quote", "why_it_matters", "suggestion", "title", "uncertainty_note"):
            if f.get(k):
                f[k] = m.unmask(f[k])
        for rel in f.get("also_flagged_by", []):
            for k in ("draft_quote", "source_quote", "why_it_matters", "title"):
                if rel.get(k):
                    rel[k] = m.unmask(rel[k])
    for f in removed:
        for k in ("draft_quote", "source_quote", "title"):
            if f.get(k):
                f[k] = m.unmask(f[k])

    top = [f for f in final if f["severity"] in TOP_RISK_SEVERITIES][:3]
    others = [f for f in final if f not in top]

    checks = [{"group": "Rules (no AI)", **c} for c in rule_checks]
    for name, label in (("kd_positions", "KD's positions & past incidents"), ("conflicts", "Commitments register"), ("fairness", "Fairness & mutuality")):
        if name in out:
            checks += [{"group": label, **c} for c in out[name]["input"].get("checks", [])]
    if not ctx["register"]:
        checks.append({"group": "Commitments register", "check": "Conflict check against signed contracts", "result": "not_run",
                       "evidence": "The commitments register is empty – conflict check not run. Build the register first."})
    checks.append({"group": "Citation check", "check": "Every flag quotes text that exists in its source",
                   "result": "pass" if not removed else "flag",
                   "evidence": f"{len(kept)} flags verified; {len(removed)} removed because a quote could not be found."})

    def unmask_deep(o):
        if isinstance(o, str):
            return m.unmask(o)
        if isinstance(o, list):
            return [unmask_deep(x) for x in o]
        if isinstance(o, dict):
            return {k: unmask_deep(v) for k, v in o.items()}
        return o

    mutuality = out["fairness"]["input"].get("mutuality") if "fairness" in out else None
    if top:
        state = "risks_found"
        headline = f"{len(top)} top risk{'s' if len(top) > 1 else ''}, most serious first" + (f" · {len(others)} more flag{'s' if len(others) != 1 else ''}" if others else "")
    else:
        state = "clean"
        headline = "No top risks found. Every check run is listed below with its evidence." + (f" {len(others)} low-severity note{'s' if len(others) != 1 else ''}." if others else "")
    result = {
        "state": state,
        "headline": headline,
        "summaries": {n: unmask_deep(out[n]["input"].get("headline", "")) for n in ("kd_positions", "conflicts", "fairness") if n in out},
        "top_risks": top,
        "other_flags": others,
        "removed_flags": removed,
        "checks": unmask_deep(checks),
        "key_terms": unmask_deep(kt),
        "mutuality": unmask_deep(mutuality),
        "bundle": bundle,
        "register_note": register_note,
        "privacy": m.report(),
        "usage": usage,
        "total_cost_usd": total_cost,
        "total_tokens": sum(u["input_tokens"] + u["cache_read_tokens"] + u["cache_write_tokens"] + u["output_tokens"] for u in usage),
    }
    duration = round(time.time() - t0, 1)
    result["duration_s"] = duration
    rev = db.insert("reviews", {"doc_id": doc_id, "result": result, "model": MODEL, "usage": usage, "cost_usd": total_cost,
                                "duration_s": duration, "outbound": outbound, "actor": actor})
    patch = {"updated_at": now_iso(), "last_review_id": rev["id"], "top_severity": top[0]["severity"] if top else None,
             "top_group": top[0]["group"] if top else None, "top_title": top[0]["title"] if top else None,
             "flag_count": len(final)}
    if doc.get("status") in ("Received", "Analysis pending", None):
        patch["status"] = "Reviewing"
    db.update("docs", {"id": doc_id}, patch)
    audit(actor, "analysis_run", doc_id, {"review_id": rev["id"], "top_risks": len(top), "flags": len(final),
                                          "removed_by_citation_check": len(removed), "cost_usd": total_cost, "seconds": duration,
                                          "masked": m.report()["masked_counts"], "withheld_lines": len(m.withheld),
                                          "outbound_calls": [{"call": o["call"], "chars": o["chars"]} for o in outbound]})
    return rev
