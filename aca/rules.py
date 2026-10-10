"""Fixed rules - no AI (PRD §5 'minimum sufficient intelligence', FR-7, FR-8, FR-10).

Inputs are the key terms the AI extracted (each with a verbatim quote) plus deal metadata.
The DECISION is deterministic: entity vs law vs invoicing, deal bundle (BAA / DPA / insurance),
regulation list by country and sector, liability vs 1x contract value.
"""
import re

from .config import ATLIQ_CYBER_COVER_USD, REGULATIONS

COUNTRY_ALIASES = {
    "usa": "United States", "us": "United States", "united states": "United States", "united states of america": "United States",
    "uae": "United Arab Emirates", "united arab emirates": "United Arab Emirates", "dubai": "United Arab Emirates",
    "ksa": "Saudi Arabia", "saudi arabia": "Saudi Arabia", "kingdom of saudi arabia": "Saudi Arabia",
    "uk": "United Kingdom", "united kingdom": "United Kingdom", "england": "United Kingdom",
    "india": "India", "germany": "Germany", "oman": "Oman", "singapore": "Singapore",
}
EU = {"Germany", "France", "Netherlands", "Spain", "Italy", "Ireland", "Belgium", "Austria", "Poland", "Sweden", "European Union"}

ENTITY_SOURCE = ("atliq_entities.md", "AtliQ entity fact sheet", "Clients in **the United States only**")
ENTITY_SOURCE_PVT = ("atliq_entities.md", "AtliQ entity fact sheet",
                     "Clients in **India, the Middle East, Europe**, and any other region outside the United States")
CHECKLIST = "karandeep_contract_checklist.md"
PRINCIPLES = "kd_stated_principles.md"
HUDDLE = "2026-09-27_harrington_huddle.md"


def country(name):
    if not name:
        return None
    n = name.strip().lower().rstrip("?")
    return COUNTRY_ALIASES.get(n, name.strip().rstrip("?"))


def _entity(v):
    v = (v or "").lower()
    if "inc" in v and "pvt" not in v:
        return "AtliQ Inc"
    if "pvt" in v or "private" in v or "technologies" in v:
        return "AtliQ Technologies Pvt Ltd"
    return None


def _flag(**kw):
    base = {"source_type": "rule", "past_exception": "none", "past_exception_note": "", "needs_kd_check": False,
            "uncertainty_note": "", "kd_position": "", "origin": "rule"}
    base.update(kw)
    return base


def _nest(k):
    """Map the flat key-terms output to the structure the rules read."""
    z = lambda v: v or None  # noqa: E731  (0 means unknown)
    return {
        "atliq_side": k.get("atliq_side"), "counterparty_country": k.get("counterparty_country"),
        "counterparty_sector": k.get("counterparty_sector"), "doc_type": k.get("doc_type", ""),
        "atliq_signing_entity": {"value": k.get("signing_entity"), "ref": k.get("signing_entity_ref", ""), "quote": k.get("signing_entity_quote", "")},
        "invoicing_entity": {"value": k.get("invoicing_entity"), "ref": k.get("invoicing_ref", ""), "quote": k.get("invoicing_quote", "")},
        "governing_law": {"value": k.get("governing_law", ""), "ref": k.get("governing_law_ref", ""), "quote": k.get("governing_law_quote", "")},
        "dispute_venue": {"value": k.get("dispute_venue", ""), "ref": k.get("venue_ref", ""), "quote": k.get("venue_quote", "")},
        "prevailing_language": k.get("prevailing_language", ""),
        "contract_value_usd": z(k.get("contract_value_usd")),
        "liability_cap": {"uncapped": k.get("liability_uncapped"), "cap_text": k.get("liability_cap_text", ""),
                          "cap_usd": z(k.get("liability_cap_usd")), "multiple_of_fees": z(k.get("liability_multiple_of_fees")),
                          "ref": k.get("liability_ref", ""), "quote": k.get("liability_quote", "")},
        "liquidated_damages": {"present": k.get("ld_present"), "uncapped": k.get("ld_uncapped"), "rate_text": k.get("ld_text", ""),
                               "ref": k.get("ld_ref", ""), "quote": k.get("ld_quote", "")},
        "personal_data": {"handles_personal_data": k.get("handles_personal_data"), "handles_phi": k.get("handles_phi"),
                          "data_subject_countries": k.get("data_subject_countries") or [], "ref": k.get("data_ref", ""), "quote": k.get("data_quote", "")},
        "baa_included": k.get("baa_included"), "dpa_included": k.get("dpa_included"),
        "insurance_requirements": [{"type": i.get("type"), "amount_usd": z(i.get("amount_usd")), "ref": i.get("ref"), "quote": i.get("quote")}
                                   for i in k.get("insurance") or []],
    }


def run_rules(kt, doc, all_docs):
    """Return (flags, checks, bundle_panel)."""
    kt = _nest(kt)
    flags, checks = [], []
    side = kt.get("atliq_side")
    cty = country(kt.get("counterparty_country")) or country(doc.get("country"))
    sector = kt.get("counterparty_sector")
    signer = _entity(kt.get("atliq_signing_entity", {}).get("value"))
    invoicer = _entity(kt.get("invoicing_entity", {}).get("value"))
    value = doc.get("value_usd") or kt.get("contract_value_usd")

    # --- entity / law / invoicing (FR-7) -------------------------------------------------
    expected = None
    if side in ("supplier", "nda_party") and cty:
        expected = "AtliQ Inc" if cty == "United States" else "AtliQ Technologies Pvt Ltd"
    if expected and signer and signer != expected:
        src = ENTITY_SOURCE if expected == "AtliQ Inc" else ENTITY_SOURCE_PVT
        flags.append(_flag(
            title=f"Wrong AtliQ entity: {signer} for a client in {cty}", category="entity_law", topic="entity_mismatch",
            severity="high", draft_clause_ref=kt["atliq_signing_entity"].get("ref", ""),
            draft_quote=kt["atliq_signing_entity"].get("quote", ""),
            source_doc=src[0], source_ref=src[1], source_quote=src[2] if expected == "AtliQ Inc" else ENTITY_SOURCE_PVT[2],
            why_it_matters=f"Per AtliQ's entity sheet a client in {cty} should contract with {expected}. The wrong entity changes who invoices, the tax regime and which bank is paid; mismatches caused payment delays twice in 2025.",
            kd_position="Governing law and entity must match: India for Pvt Ltd, US for Inc (KD checklist).",
            suggestion=f"Suggestion – KD decides: ask the client to name {expected} as the contracting party."))
        checks.append({"check": "Signing entity matches client region", "result": "flag",
                       "evidence": f"{signer} named; {expected} expected for {cty} ({kt['atliq_signing_entity'].get('ref', '')})"})
    elif expected and signer:
        checks.append({"check": "Signing entity matches client region", "result": "pass", "evidence": f"{signer} for a client in {cty}"})
    else:
        checks.append({"check": "Signing entity matches client region", "result": "not_applicable" if side in ("buyer", "partner") else "needs_kd_check",
                       "evidence": f"AtliQ side: {side}; signer: {signer or 'unclear'}; country: {cty or 'unknown'}"})

    if signer and invoicer and invoicer != signer:
        flags.append(_flag(
            title=f"Contract signed by {signer} but invoiced by {invoicer}", category="entity_law", topic="invoicing",
            severity="high", draft_clause_ref=kt["invoicing_entity"].get("ref", ""), draft_quote=kt["invoicing_entity"].get("quote", ""),
            source_doc="atliq_entities.md", source_ref="AtliQ entity fact sheet",
            source_quote="Mismatches between the contracting entity and the invoicing entity have caused payment delays twice in 2025.",
            why_it_matters="The party that signs is not the party that invoices. That breaks the tax and payment chain and has already delayed payments twice.",
            kd_position="Governing law and entity must match the signing entity (KD checklist).",
            suggestion="Suggestion – KD decides: make the signing entity and the invoicing entity the same in the contract."))
        checks.append({"check": "Invoicing entity = signing entity", "result": "flag", "evidence": f"{signer} signs, {invoicer} invoices"})
    elif signer and invoicer:
        checks.append({"check": "Invoicing entity = signing entity", "result": "pass", "evidence": f"{signer}"})

    law = (kt.get("governing_law") or {}).get("value", "") or ""
    venue = (kt.get("dispute_venue") or {}).get("value", "") or ""
    ent = signer or expected
    if ent and law:
        home_ok = ("india" in law.lower()) if ent == "AtliQ Technologies Pvt Ltd" else bool(
            re.search(r"united states|u\.s\.|\busa?\b|delaware|new york|new jersey|illinois|texas|california|ohio|arizona|connecticut|state of", law, re.I))
        venue_foreign = bool(venue) and bool(re.search(r"singapore|siac|london|lcia|england|riyadh|saudi|dubai|difc|uae|germany|munich|icc", venue, re.I)) and not (
            ent == "AtliQ Technologies Pvt Ltd" and re.search(r"india|mumbai|pune|delhi|bengaluru", venue, re.I))
        if not home_ok or (venue_foreign and ent == "AtliQ Inc"):
            what = law if not home_ok else venue
            flags.append(_flag(
                title=f"Governing law / venue outside AtliQ's home: {what}"[:90], category="entity_law", topic="governing_law",
                severity="medium", draft_clause_ref=(kt.get("governing_law") or {}).get("ref", "") if not home_ok else (kt.get("dispute_venue") or {}).get("ref", ""),
                draft_quote=(kt.get("governing_law") or {}).get("quote", "") if not home_ok else (kt.get("dispute_venue") or {}).get("quote", ""),
                source_doc=CHECKLIST, source_ref="KD checklist (2024)", source_quote="gov law → ours (India for Pvt Ltd, US for Inc)",
                why_it_matters=f"Disputes would run under {law or 'foreign law'}{(' in ' + venue) if venue else ''}. Foreign law and venue mean outside-counsel bills (Brightwater: $14.2k under English law).",
                kd_position="gov law → ours (India for Pvt Ltd, US for Inc). KD has accepted foreign law before when the client insisted (Northwind English law, Al Noor DIFC, CloudSpan Singapore).",
                past_exception="deliberate_exception",
                past_exception_note="Accepted before for Northwind (English law), Al Noor (DIFC) and CloudSpan (Singapore/SIAC) after discussion.",
                suggestion=f"Suggestion – KD decides: ask for {'Indian' if ent == 'AtliQ Technologies Pvt Ltd' else 'US'} law and venue, or accept knowingly and budget for local counsel."))
            checks.append({"check": "Governing law and venue match signing entity", "result": "flag", "evidence": f"Law: {law}; venue: {venue}"})
        else:
            checks.append({"check": "Governing law and venue match signing entity", "result": "pass", "evidence": f"Law: {law}; venue: {venue or 'not stated'}"})

    lang = (kt.get("prevailing_language") or "")
    if lang and re.search(r"arabic|german|hindi|prevail", lang, re.I) and not re.search(r"english prevails|^english$", lang, re.I):
        checks.append({"check": "English text prevails", "result": "needs_kd_check", "evidence": lang})

    # --- proportionality and uncapped exposure (FR-10) --------------------------------------
    lc = kt.get("liability_cap") or {}
    if lc.get("uncapped"):
        flags.append(_flag(
            title="Liability is uncapped", category="exposure", topic="liability_cap", severity="critical",
            draft_clause_ref=lc.get("ref", ""), draft_quote=lc.get("quote", ""), source_doc=CHECKLIST, source_ref="KD checklist (2024)",
            source_quote="liability → 1x fees. NOT unlimited",
            why_it_matters=f"One incident could cost more than the whole deal{f' (${value:,.0f})' if value else ''}. KD walked away from Kessler (€120k) over exactly this.",
            kd_position="liability → 1x fees. NOT unlimited", past_exception="none",
            past_exception_note="Kessler Mobility (Jan 2026): KD refused unlimited liability and lost the deal rather than sign.",
            suggestion="Suggestion – KD decides: cap liability at 1x fees (carve-outs only for fraud/wilful misconduct)."))
        checks.append({"check": "Liability ≤ 1x contract value", "result": "flag", "evidence": f"Uncapped ({lc.get('ref', '')})"})
    else:
        cap_usd = lc.get("cap_usd")
        mult = lc.get("multiple_of_fees")
        # A cap stated as a multiple of fees wins; a USD figure is only used when no multiple is given.
        if value and ((mult and mult > 1.01) or (not mult and cap_usd and cap_usd > value * 1.01)):
            flags.append(_flag(
                title=f"Liability cap above 1x contract value ({lc.get('cap_text', '')[:40]})", category="exposure", topic="liability_cap",
                severity="high", draft_clause_ref=lc.get("ref", ""), draft_quote=lc.get("quote", ""), source_doc=PRINCIPLES,
                source_ref="KD's stated principles", source_quote="Liability, liquidated damages or indemnity exposure above 1x the contract value is disproportionate",
                why_it_matters=f"Exposure is larger than the deal itself (contract value ≈ ${value:,.0f}).",
                kd_position="liability → 1x fees. NOT unlimited", suggestion="Suggestion – KD decides: bring the cap down to 1x fees."))
            checks.append({"check": "Liability ≤ 1x contract value", "result": "flag", "evidence": lc.get("cap_text", "")})
        elif not value:
            checks.append({"check": "Liability ≤ 1x contract value", "result": "not_run", "evidence": "Proportionality not checked – contract value missing"})
        else:
            checks.append({"check": "Liability ≤ 1x contract value", "result": "pass", "evidence": f"{lc.get('cap_text', '')} vs value ${value:,.0f}"})

    ld = kt.get("liquidated_damages") or {}
    if ld.get("present") and ld.get("uncapped"):
        flags.append(_flag(
            title="Liquidated damages have no cap", category="exposure", topic="liquidated_damages", severity="critical",
            draft_clause_ref=ld.get("ref", ""), draft_quote=ld.get("quote", ""), source_doc=CHECKLIST, source_ref="KD checklist (2024)",
            source_quote="LDs → cap it. never open ended",
            why_it_matters="Open-ended delay damages: Brightwater claimed $18.4k for a 19-day delay the client caused; under uncapped daily LD the same slip can run to a large share of the contract.",
            kd_position="LD 0.5% of the affected milestone per week, max 5% of that milestone, no LD for client-caused delay (Acme, Northwind, Trustline).",
            past_exception="waved_through", past_exception_note="Brightwater (Nov 2025): uncapped LD signed from an airport – cost ~$23.2k.",
            suggestion="Suggestion – KD decides: counter with 0.5%/week of the milestone, capped at 5%, client delays excluded."))

    # --- healthcare bundle (FR-8 + KD principle 4) ------------------------------------------
    pdx = kt.get("personal_data") or {}
    bundle = []
    is_health = sector == "healthcare" or pdx.get("handles_phi")
    cp_phrase = _phrase(doc.get("counterparty"))
    same_cp = [d for d in all_docs if d["id"] != doc["id"] and _phrase(d.get("counterparty")) == cp_phrase]
    signed_baa = [d for d in same_cp if d.get("role") == "signed" and (d.get("doc_type") == "BAA")]
    draft_baa = [d for d in same_cp if d.get("role") == "incoming" and d.get("doc_type") == "BAA"]
    signed_nda = [d for d in same_cp if d.get("role") == "signed" and d.get("doc_type") == "NDA"]
    if is_health and cty == "United States" and (pdx.get("handles_phi") or kt.get("doc_type", "").upper() != "NDA"):
        if not signed_baa:
            this_is_baa = doc.get("doc_type") == "BAA"
            status = "this BAA is still a draft" if this_is_baa else ("the BAA is a draft, NOT signed" if draft_baa or kt.get("baa_included") else "no BAA exists")
            flags.append(_flag(
                title="Patient data: no signed BAA yet – sign all BAAs before any data moves", category="healthcare_bundle", topic="phi_baa",
                severity="critical", draft_clause_ref=pdx.get("ref", ""), draft_quote=pdx.get("quote", ""), source_doc=PRINCIPLES,
                source_ref="KD's stated principles", source_quote="Healthcare project: sign the BAA first, including with freelancers and subcontractors, before any patient data moves.",
                why_it_matters=f"This deal involves patient data (HIPAA) and {status}. Every BAA, including subcontractor flow-down to anyone AtliQ brings in, must be signed before any data moves.",
                kd_position="Sign the BAA first, including with freelancers and subcontractors, before any patient data moves.",
                suggestion="Suggestion – KD decides: stop any data transfer, sign the BAA and subcontractor BAAs first, and have US counsel review."))
        bundle.append({"document": "Business Associate Agreement (BAA)", "status": "signed" if signed_baa else ("in this contract" if kt.get("baa_included") or doc.get("doc_type") == "BAA" else ("draft – not signed" if draft_baa else "missing")), "required": True})
        bundle.append({"document": "Subcontractor BAA flow-down (anyone AtliQ brings in)", "status": "confirm with KD", "required": True})
    bundle.append({"document": "NDA", "status": "signed" if signed_nda else ("this document" if (doc.get("doc_type") == "NDA") else "not found"), "required": False})

    for ins in kt.get("insurance_requirements") or []:
        amt = ins.get("amount_usd")
        if amt and "cyber" in (ins.get("type") or "").lower() and amt > ATLIQ_CYBER_COVER_USD:
            flags.append(_flag(
                title=f"Requires ${amt / 1e6:.0f}M cyber insurance – AtliQ has $1M", category="healthcare_bundle" if is_health else "exposure",
                topic="insurance", severity="high", draft_clause_ref=ins.get("ref", ""), draft_quote=ins.get("quote", ""), source_doc=HUDDLE,
                source_ref="Harrington huddle, 27 Sep 2026", source_quote="Our cyber policy is $1M btw",
                why_it_matters="AtliQ would be in breach from day one unless it buys more cover or the requirement changes.",
                kd_position="No recorded KD position", suggestion="Suggestion – KD decides: get a quote for extra cyber cover or negotiate the amount before signing."))
            bundle.append({"document": f"Cyber insurance ${amt / 1e6:.0f}M", "status": "AtliQ has $1M", "required": True})

    subj = {country(c) for c in (pdx.get("data_subject_countries") or [])} | ({cty} if cty else set())
    gdpr = bool(subj & (EU | {"United Kingdom"}))
    if pdx.get("handles_personal_data") and gdpr:
        if not kt.get("dpa_included"):
            flags.append(_flag(
                title="EU/UK personal data with no data processing agreement", category="flowdown" if side == "buyer" else "clause_risk",
                topic="data_protection", severity="high", draft_clause_ref=pdx.get("ref", ""), draft_quote=pdx.get("quote", ""),
                source_doc="", source_ref="Regulation list: GDPR / UK GDPR", source_quote="", source_type="rule",
                why_it_matters="Personal data of EU/UK people is processed without a GDPR Art. 28 data processing agreement; AtliQ would carry the compliance risk.",
                kd_position="No recorded KD position", suggestion="Suggestion – KD decides: add a GDPR DPA (and SCCs for transfer to India) before any data is shared."))
        bundle.append({"document": "GDPR data processing agreement (DPA)", "status": "included" if kt.get("dpa_included") else "missing", "required": True})

    # --- regulation list (always 'likely applies – confirm with counsel') -------------------
    regs = []
    countries = {c for c in subj if c} | ({"European Union"} if subj & EU else set())
    for ctys, sectors, needs_pd, name, req in REGULATIONS:
        if not countries & set(ctys):
            continue
        if sectors and sector not in sectors:
            continue
        if needs_pd and not (pdx.get("handles_personal_data") or pdx.get("handles_phi")):
            continue
        regs.append({"name": name, "requires": req, "label": "Likely applies – confirm with counsel"})
    checks.append({"check": "Deal bundle and regulations", "result": "flag" if any(f["category"] == "healthcare_bundle" for f in flags) else "pass",
                   "evidence": "; ".join(f"{b['document']}: {b['status']}" for b in bundle) or "No companion documents required"})
    return flags, checks, {"documents": bundle, "regulations": regs}


def _phrase(cp):
    words = [w for w in re.findall(r"[a-z]+", (cp or "").lower()) if w not in {"inc", "ltd", "pvt", "llc", "co", "gmbh", "the"}]
    return " ".join(words[:2])
