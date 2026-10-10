"""Citation check (PRD §9.3 step 10): "no source, no flag".

A quote counts as verified when every fragment of it (fragments are separated by "...") is found,
in order, in the source text after light normalisation (markdown, quotes, dashes, whitespace,
case). A small tolerance (90% of a fragment as one exact run) absorbs OCR noise and
punctuation slips without letting invented text through.
"""
import re
from difflib import SequenceMatcher

_TRANS = str.maketrans({"’": "'", "‘": "'", "“": '"', "”": '"', "–": "-", "—": "-", " ": " ", "§": "s"})


def norm(s):
    s = (s or "").translate(_TRANS)
    s = re.sub(r"[*_`]", "", s)
    s = re.sub(r"[#>|]", " ", s)
    s = re.sub(r"\s+", "", s)  # compare without whitespace: markdown and line breaks don't matter
    return s.lower()


def _fragments(quote):
    parts = re.split(r"\.\.\.|…|\[\.\.\.\]", quote or "")
    return [norm(p).strip(".,;:\"'()") for p in parts if len(norm(p).strip(".,;:\"'()")) >= 6]


def verify(quote, text):
    """Return (verified: bool, score: float 0..1)."""
    frags = _fragments(quote)
    if not frags:
        return False, 0.0
    hay = norm(text)
    pos, scores = 0, []
    for f in frags:
        i = hay.find(f, pos)
        if i >= 0:
            pos = i + len(f)
            scores.append(1.0)
            continue
        sm = SequenceMatcher(None, hay, f, autojunk=False)
        m = sm.find_longest_match(0, len(hay), 0, len(f))
        scores.append(m.size / len(f))
        if m.size >= 0.9 * len(f):
            pos = m.a + m.size
    score = sum(scores) / len(scores)
    return all(s >= 0.9 for s in scores), round(score, 3)
