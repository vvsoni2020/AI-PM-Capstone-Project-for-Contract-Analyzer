"""Static configuration for ACA: users, model, prices, AtliQ entity facts, regulation list.

Everything here is deliberately plain data so a PM can read and change it without touching logic.
"""
import os

# ---- Users and roles (PRD §4: all five see everything; only KD signs / confirms register entries)
USERS = {
    "KD": {"name": "Karandeep (KD)", "role": "CEO – reviewer and signer", "can_sign": True},
    "Bhavin": {"name": "Bhavin", "role": "Founder – deal POC", "can_sign": False},
    "Dhaval": {"name": "Dhaval", "role": "Founder – deal POC", "can_sign": False},
    "Jay": {"name": "Jay", "role": "Sales – deal POC", "can_sign": False},
    "Pranav": {"name": "Pranav", "role": "CTO – deal POC", "can_sign": False},
}

# ---- Model and prices (Deliverable #4 cost estimate, Claude API pricing 10 Oct 2026, USD per 1M tokens)
MODEL = os.environ.get("ACA_MODEL", "claude-sonnet-5-5")
PRICES = {
    "claude-fable-5-1": (10.0, 50.0),
    "claude-opus-5-5": (4.0, 20.0),
    "claude-sonnet-5-5": (2.0, 10.0),
    "claude-haiku-5-5": (0.10, 0.50),
}
CACHE_READ_FACTOR = 0.1
CACHE_WRITE_FACTOR = 1.25

# "Today" in the dataset is 28 Sep 2026 (dataset README). Deadlines are counted from this date.
TODAY = os.environ.get("ACA_TODAY", "2026-09-28")

# ---- AtliQ entity facts (atliq_entities.md)
ENTITY_FACTS = """AtliQ has exactly two legal entities:
1. AtliQ Technologies Pvt Ltd (India, parent company). Serves clients in India, the Middle East, Europe and every region outside the United States. Governing law per KD's checklist: India.
2. AtliQ Inc (Delaware, USA). 100% owned by AtliQ Technologies Pvt Ltd, so it is an Affiliate of Pvt Ltd under any common-control definition. Serves clients in the United States only. Governing law per KD's checklist: US.
Delivery teams for both entities sit in Pune, India; AtliQ Inc sub-contracts delivery to Pvt Ltd under an intercompany agreement.
The entity named in a client contract determines which entity invoices, which tax regime applies and which bank account is paid. Contracting-vs-invoicing entity mismatches caused payment delays twice in 2025.
AtliQ's cyber insurance cover is USD 1M (Harrington huddle, 27 Sep 2026)."""

ATLIQ_CYBER_COVER_USD = 1_000_000

# AtliQ's own identifiers. They are masked with labeled tokens so the model knows WHICH entity
# an identifier belongs to without seeing the number.
ATLIQ_IDS = {
    "U72900MH2019PTC321456": "ATLIQ_PVT_LTD_CIN",
    "27AAKCA4821F1Z3": "ATLIQ_PVT_LTD_GSTIN",
    "88-4410273": "ATLIQ_INC_EIN",
}
ATLIQ_ADDRESS_HINTS = {
    "Baner Business Bay": "ATLIQ_PVT_LTD_ADDRESS",
    "101 College Road East": "ATLIQ_INC_ADDRESS",
}

# ---- Curated regulation list by country + sector (PRD FR-8). Always shown as
# "Likely applies – confirm with counsel". Never legal advice.
REGULATIONS = [
    # (countries, sectors or None for any, needs personal data?, name, what it usually requires)
    (["United States"], ["healthcare"], True, "HIPAA (Privacy, Security and Breach Notification Rules)",
     "Business Associate Agreement before any PHI is shared; subcontractor BAAs flowed down; breach notice duties"),
    (["United States"], ["financial services"], True, "Gramm-Leach-Bliley Act (GLBA) safeguards",
     "Information-security program and vendor oversight for customer financial data"),
    (["United States"], None, True, "US state privacy laws (e.g. CCPA/CPRA)",
     "Service-provider / processor terms if consumer personal data is processed"),
    (["India"], None, True, "Digital Personal Data Protection Act, 2023 (DPDP)",
     "Processor contract with the data fiduciary; security safeguards; breach reporting"),
    (["India"], ["financial services"], False, "RBI outsourcing / IT governance directions",
     "Audit and inspection rights, data localization and sub-contracting controls for regulated entities"),
    (["United Arab Emirates"], None, True, "UAE Federal Decree-Law No. 45 of 2021 (PDPL); DIFC/ADGM data law if in a free zone",
     "Processing terms; cross-border transfer conditions"),
    (["Saudi Arabia"], None, True, "Saudi Personal Data Protection Law (PDPL)",
     "Processing terms; strict cross-border transfer rules; data may need to stay in KSA"),
    (["Oman"], None, True, "Oman Personal Data Protection Law (Royal Decree 6/2022)",
     "Processing terms; permits for some processing; transfer conditions"),
    (["Germany", "European Union"], None, True, "EU GDPR (+ German BDSG)",
     "Art. 28 Data Processing Agreement; SCCs for transfers to India; sub-processor approval"),
    (["United Kingdom"], None, True, "UK GDPR + Data Protection Act 2018",
     "Processor terms (DPA); UK IDTA / Addendum for transfers to India"),
    (["Singapore"], None, True, "Singapore PDPA 2012",
     "Protection and transfer-limitation obligations"),
]

# Ranking of flag categories: most serious first (decided 9 Oct: breach of existing commitment →
# healthcare/BAA gap → uncapped/disproportionate exposure → rest).
CATEGORY_RANK = {
    "commitment_conflict": 1,
    "healthcare_bundle": 2,
    "exposure": 3,
}
SEVERITY_RANK = {"critical": 1, "high": 2, "medium": 3, "low": 4}
TOP_RISK_SEVERITIES = ("critical", "high", "medium")
