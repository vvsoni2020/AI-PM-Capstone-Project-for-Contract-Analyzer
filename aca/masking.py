"""Privacy gate (PRD FR-4): runs before ANY text goes to the Claude API.

1. Patient / personal data lines are WITHHELD entirely (never sent, not even masked).
2. IDs, bank details, addresses, emails and phone numbers are MASKED with tokens like [GSTIN_1].
   AtliQ's own identifiers get labelled tokens ([ATLIQ_PVT_LTD_GSTIN]) so the model can still
   reason about WHICH entity is named without seeing the number.
3. Party names, people's names and commercial figures are NOT masked (decided 7 Oct).

One Masker is shared across all documents in one analysis, so the same value always gets the
same token and quotes can be unmasked locally for display.
"""
import re

from .config import ATLIQ_ADDRESS_HINTS, ATLIQ_IDS

# --- patient / personal data detectors (line level) -------------------------------------
_DATE = r"(?:\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|\d{4}-\d{2}-\d{2}|\d{1,2}\s+[A-Z][a-z]{2,8}\s+\d{4})"
PHI_LINE_PATTERNS = [
    ("SSN", re.compile(r"\b\d{3}-\d{2}-\d{4}\b")),
    ("Date of birth", re.compile(r"\b(?:DOB|D\.O\.B\.|date of birth)\b\s*[:=|]?\s*" + _DATE, re.I)),
    ("Medical record number", re.compile(r"\b(?:MRN|medical record (?:no|number))\b\s*[:#|]?\s*[A-Z0-9-]{4,}", re.I)),
    ("Patient record row", re.compile(r"\|[^|\n]*\b[A-TV-Z]\d{2}(?:\.\d{1,4})?\b[^|\n]*\|.*" + _DATE + r"|" + _DATE + r".*\|[^|\n]*\b[A-TV-Z]\d{2}\.\d{1,4}\b")),
    ("Patient name field", re.compile(r"\bpatient(?:\s+name)?\s*[:=]\s*[A-Z][a-z]+\s+[A-Z][a-z]+")),
]

# --- identifier patterns (value level). Order matters: specific before generic. ------------
ID_PATTERNS = [
    ("EMAIL", re.compile(r"\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b")),
    ("CIN", re.compile(r"\b[LU]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}\b")),
    ("GSTIN", re.compile(r"\b\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b")),
    ("PAN", re.compile(r"\b[A-Z]{3}[PCHFATBLJG][A-Z]\d{4}[A-Z]\b")),
    ("IBAN", re.compile(r"\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){3,7}(?:\s?[A-Z0-9]{1,3})?\b")),
    ("IFSC", re.compile(r"\b[A-Z]{4}0[A-Z0-9]{6}\b")),
    ("EIN", re.compile(r"\b\d{2}-\d{7}\b")),
    ("SWIFT", re.compile(r"(?<=SWIFT)(?:\s*(?:code|/BIC)?\s*[:.]?\s*)([A-Z]{6}[A-Z0-9]{2}(?:[A-Z0-9]{3})?)\b", re.I)),
    ("BANK_ACCOUNT", re.compile(r"(?:account|a/c)\s*(?:no\.?|number|#)\s*[:.]?\s*([0-9][0-9 -]{6,20}[0-9])", re.I)),
    # US routing / ABA and UK sort codes (QA edge case D5, 10 Oct)
    ("BANK_ROUTING", re.compile(r"(?:routing|ABA|sort\s+code)\s*(?:transit\s+)?(?:no\.?|number|code)?\s*[:.]?\s*([0-9][0-9 -]{4,12}[0-9])", re.I)),
    ("REG_ID", re.compile(
        r"(?:licen[cs]e\s+no\.?|commercial\s+registration\s+no\.?|registration\s+no\.?|CR\s+no\.?|HRB|VAT\s+ID|UEN|"
        r"company\s+number|tax\s+(?:id|registration)\s+(?:no\.?|number)?|TRN|NPI)\s*[:.]?\s*([A-Z]{0,3}\s?[0-9][0-9A-Z-]{3,})", re.I)),
    ("PHONE", re.compile(r"(?:\+\d{1,3}[\s-]?)\(?\d{1,4}\)?(?:[\s-]?\d{2,4}){2,4}\b")),
]

ADDRESS_LEAD = re.compile(
    r"((?:registered\s+office|principal\s+(?:office|place\s+of\s+business)|head\s+office|office|"
    r"residing|resident|located|business\s+address)\s+(?:is\s+)?at\s+)", re.I)
ADDRESS_STOP = re.compile(r"\s*\(|[\"“;]|\)|\s+—|\n|,\s+(?:and|each|hereinafter|represented|registered in|a|an|which|whose|"
                          r"on behalf|acting|being|PAN|CIN|GSTIN|EIN|holding|licensed|incorporated)\b", re.I)
PO_BOX_LINE = re.compile(r"^[^\n]*\b(?:P\.?\s?O\.?\s+Box|PO Box)\b[^\n]*$", re.M)

TOKEN_RE = re.compile(r"\[(?:[A-Z_]+_\d+|ATLIQ_[A-Z_]+)\]")


class Masker:
    def __init__(self):
        self.value_to_token = {}
        self.token_to_value = {}
        self.counts = {}
        self.withheld = []  # list of {"doc", "reason", "line_no"}

    # -- helpers
    def _token(self, kind, value):
        value = value.strip()
        if value in self.value_to_token:
            return self.value_to_token[value]
        if value in ATLIQ_IDS:
            tok = "[" + ATLIQ_IDS[value] + "]"
        elif kind == "ADDRESS" and any(h in value for h in ATLIQ_ADDRESS_HINTS):
            tok = "[" + next(v for h, v in ATLIQ_ADDRESS_HINTS.items() if h in value) + "]"
        else:
            n = sum(1 for t in self.token_to_value if t.startswith("[" + kind + "_")) + 1
            tok = f"[{kind}_{n}]"
        self.value_to_token[value] = tok
        self.token_to_value[tok] = value
        self.counts[kind] = self.counts.get(kind, 0) + 1
        return tok

    def _sub_group(self, kind, pattern, text):
        def repl(m):
            if m.lastindex:  # mask only the captured value, keep the label ("licence no.")
                s, e = m.span(1)
                ms, me = m.span(0)
                whole = m.group(0)
                return whole[: s - ms] + self._token(kind, m.group(1)) + whole[e - ms:]
            return self._token(kind, m.group(0))
        return pattern.sub(repl, text)

    def _mask_addresses(self, text):
        out, pos = [], 0
        for m in ADDRESS_LEAD.finditer(text):
            start = m.end()
            if start < pos:
                continue
            stop = ADDRESS_STOP.search(text, start)
            end = stop.start() if stop else len(text)
            addr = text[start:end]
            if len(addr.strip()) < 8 or TOKEN_RE.fullmatch(addr.strip()):
                continue
            out.append(text[pos:start])
            out.append(self._token("ADDRESS", addr))
            pos = end
        out.append(text[pos:])
        text = "".join(out)
        return PO_BOX_LINE.sub(lambda m: self._token("ADDRESS", m.group(0)) if "[" not in m.group(0) else m.group(0), text)

    # -- public API
    def mask(self, text, doc_label="document"):
        lines = text.split("\n")
        kept = []
        for i, line in enumerate(lines, 1):
            reason = next((name for name, pat in PHI_LINE_PATTERNS if pat.search(line)), None)
            if reason:
                self.withheld.append({"doc": doc_label, "line_no": i, "reason": reason})
                self.counts["WITHHELD_LINE"] = self.counts.get("WITHHELD_LINE", 0) + 1
                kept.append(f"[WITHHELD: patient/personal data line – {reason}]")
            else:
                kept.append(line)
        text = "\n".join(kept)
        # AtliQ's own IDs first, so they get labelled tokens
        for value in ATLIQ_IDS:
            if value in text:
                text = text.replace(value, self._token("ATLIQ", value))
        for kind, pat in ID_PATTERNS:
            text = self._sub_group(kind, pat, text)
        text = self._mask_addresses(text)
        return text

    def unmask(self, text):
        if not text:
            return text
        return TOKEN_RE.sub(lambda m: self.token_to_value.get(m.group(0), m.group(0)), text)

    def report(self):
        return {
            "masked_counts": {k: v for k, v in self.counts.items() if k != "WITHHELD_LINE"},
            "withheld_lines": self.withheld,
            "tokens": sorted(self.token_to_value.keys()),
        }


def residual_leaks(text):
    """Outbound safety net: anything that still looks like an ID or patient data after masking."""
    leaks = []
    for kind, pat in ID_PATTERNS:
        if kind in ("PHONE",):
            continue
        for m in pat.finditer(text):
            val = m.group(m.lastindex or 0)
            if not TOKEN_RE.fullmatch(val.strip()):
                leaks.append({"type": kind, "value": val[:4] + "…"})
    for name, pat in PHI_LINE_PATTERNS:
        if pat.search(text):
            leaks.append({"type": name})
    return leaks
