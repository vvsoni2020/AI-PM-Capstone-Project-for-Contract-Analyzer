// Abbreviation glossary (added 10 Oct, Vaibhav's rule: "full form (ABBR)", hover where space is tight).
// 1. initAbbrTooltips(): every glossary abbreviation anywhere in the app gets a dotted underline and a
//    hover (or tap) tooltip with its full form. It works on AI-written text too, and never edits the DOM
//    React owns: the underline uses the CSS Custom Highlight API and the tooltip is a separate element.
// 2. makeExpander(): in roomy explanatory text (why it matters, KD's position, suggestion) the first use
//    of an abbreviation in each card is written out as "Full form (ABBR)".

export const GLOSSARY = {
  ACA: { full: "Auto Contract Analyzer", note: "this app" },
  KD: { full: "Karandeep", note: "AtliQ's CEO, who signs every contract" },
  AI: { full: "Artificial Intelligence" },
  API: { full: "Application Programming Interface" },
  POC: { full: "Point of Contact", expand: true },
  HR: { full: "Human Resources" },
  // Contract types
  MSA: { full: "Master Services Agreement", expand: true },
  SOW: { full: "Statement of Work", expand: true },
  NDA: { full: "Non-Disclosure Agreement", expand: true },
  MNDA: { full: "Mutual Non-Disclosure Agreement", expand: true },
  BAA: { full: "Business Associate Agreement", note: "required by HIPAA before patient data is shared", expand: true },
  DPA: { full: "Data Processing Agreement", note: "required by GDPR when personal data is processed", expand: true },
  SCC: { full: "Standard Contractual Clauses", note: "EU-approved terms for moving personal data abroad", expand: true },
  // Contract terms
  LD: { full: "Liquidated Damages", note: "a fixed penalty for delay or breach", expand: true },
  MFN: { full: "Most-Favoured-Nation", note: "a promise that no other customer gets a better price", expand: true },
  IP: { full: "Intellectual Property", expand: true },
  CGL: { full: "Commercial General Liability", note: "insurance", expand: true },
  FTE: { full: "Full-Time Equivalent", expand: true },
  UAT: { full: "User Acceptance Testing", expand: true },
  // Health and privacy law
  PHI: { full: "Protected Health Information", note: "health data that identifies a patient", expand: true },
  HIPAA: { full: "Health Insurance Portability and Accountability Act", note: "US health-privacy law", expand: true },
  HITECH: { full: "Health Information Technology for Economic and Clinical Health Act", note: "US", expand: true },
  HHS: { full: "US Department of Health and Human Services", expand: true },
  EHR: { full: "Electronic Health Record", expand: true },
  GDPR: { full: "General Data Protection Regulation", note: "EU and UK privacy law", expand: true },
  CCPA: { full: "California Consumer Privacy Act", expand: true },
  CPRA: { full: "California Privacy Rights Act", expand: true },
  PDPL: { full: "Personal Data Protection Law", note: "Saudi Arabia / UAE", expand: true },
  NIST: { full: "National Institute of Standards and Technology", note: "US", expand: true },
  // Places, courts and regions
  GCC: { full: "Gulf Cooperation Council", note: "Saudi Arabia, UAE, Qatar, Kuwait, Bahrain, Oman", expand: true },
  UAE: { full: "United Arab Emirates" },
  KSA: { full: "Kingdom of Saudi Arabia", expand: true },
  DACH: { full: "Germany, Austria and Switzerland", expand: true },
  DIFC: { full: "Dubai International Financial Centre", expand: true },
  SIAC: { full: "Singapore International Arbitration Centre", expand: true },
  LCIA: { full: "London Court of International Arbitration", expand: true },
  CISG: { full: "UN Convention on Contracts for the International Sale of Goods", expand: true },
  BGB: { full: "Bürgerliches Gesetzbuch", note: "German Civil Code", expand: true },
  HRB: { full: "Handelsregister B", note: "German commercial register number" },
  FZ: { full: "Free Zone", note: "UAE" },
  // Company and tax IDs, payments
  CIN: { full: "Corporate Identification Number", note: "India" },
  GSTIN: { full: "Goods and Services Tax Identification Number", note: "India" },
  GST: { full: "Goods and Services Tax", note: "India" },
  EIN: { full: "Employer Identification Number", note: "US" },
  PAN: { full: "Permanent Account Number", note: "India tax ID" },
  TDS: { full: "Tax Deducted at Source", note: "India", expand: true },
  SSN: { full: "Social Security Number", note: "US" },
  DOB: { full: "Date of Birth" },
  IBAN: { full: "International Bank Account Number" },
  ACH: { full: "Automated Clearing House", note: "US bank transfers" },
  KYC: { full: "Know Your Customer", expand: true },
  RBI: { full: "Reserve Bank of India", expand: true },
  NBFC: { full: "Non-Banking Financial Company", note: "India", expand: true },
  // Industry and tech
  FMCG: { full: "Fast-Moving Consumer Goods", expand: true },
  OTA: { full: "Online Travel Agency", expand: true },
  BI: { full: "Business Intelligence", expand: true },
  CRM: { full: "Customer Relationship Management" },
  ERP: { full: "Enterprise Resource Planning" },
  ML: { full: "Machine Learning" },
  OCR: { full: "Optical Character Recognition", note: "turning a scan into text", expand: true },
  QA: { full: "Quality Assurance" },
  SKU: { full: "Stock Keeping Unit" },
  POS: { full: "Point of Sale" },
  ROI: { full: "Return on Investment" },
  UX: { full: "User Experience" },
  MQTT: { full: "Message Queuing Telemetry Transport", note: "a device messaging protocol" },
};

const KEYS = Object.keys(GLOSSARY).sort((a, b) => b.length - a.length);
// Whole word, optional plural "s" (NDAs, SOWs). Case-sensitive so ordinary words never match.
const RE_SRC = `(?<![A-Za-z0-9])(${KEYS.join("|")})(s?)(?![A-Za-z0-9])`;

export function lookup(word) {
  if (!word) return null;
  if (GLOSSARY[word]) return { abbr: word, plural: false, ...GLOSSARY[word] };
  if (word.endsWith("s") && GLOSSARY[word.slice(0, -1)]) return { abbr: word.slice(0, -1), plural: true, ...GLOSSARY[word.slice(0, -1)] };
  return null;
}

// "Full form (ABBR)" on first use per card, for explanatory text only (never for contract quotes).
export function makeExpander() {
  const seen = new Set();
  return (text) => {
    if (!text || typeof text !== "string") return text;
    const re = new RegExp(RE_SRC, "g");
    return text.replace(re, (m, abbr, s, offset) => {
      const g = GLOSSARY[abbr];
      if (!g.expand || seen.has(abbr)) return m;
      seen.add(abbr);
      // Already written out somewhere in this text, e.g. "Business Associate Agreement (BAA)".
      if (text.toLowerCase().includes(g.full.toLowerCase())) return m;
      // Inside brackets, e.g. "patient data (HIPAA)": write "(Health Insurance ... Act, HIPAA)".
      if (text[offset - 1] === "(" && text[offset + m.length] === ")") return `${g.full}, ${m}`;
      return `${g.full}${s && !g.full.endsWith("s") ? "s" : ""} (${m})`;
    });
  };
}

export function tooltipText(hit) {
  return `${hit.abbr}: ${hit.full}${hit.note ? ` – ${hit.note}` : ""}`;
}

// ---------- hover / tap tooltips ----------
export function initAbbrTooltips(root) {
  if (!root || window.__acaAbbr) return;
  window.__acaAbbr = true;
  const tip = document.createElement("div");
  tip.className = "abbr-tip";
  tip.setAttribute("role", "tooltip");
  tip.hidden = true;
  document.body.appendChild(tip);

  // Dotted underline on every match (no DOM changes, so React is unaffected).
  const canHighlight = typeof CSS !== "undefined" && CSS.highlights && typeof Highlight !== "undefined";
  let pending = null;
  const SKIP = new Set(["SCRIPT", "STYLE", "TEXTAREA", "INPUT", "SELECT", "OPTION"]);
  const scan = () => {
    pending = null;
    if (!canHighlight) return;
    const ranges = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.parentElement && !SKIP.has(n.parentElement.tagName) && /[A-Z]{2}/.test(n.data) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
    });
    const re = new RegExp(RE_SRC, "g");
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(n.data))) {
        const r = new Range();
        r.setStart(n, m.index);
        r.setEnd(n, m.index + m[0].length);
        ranges.push(r);
      }
    }
    CSS.highlights.set("abbr", new Highlight(...ranges));
  };
  const schedule = () => { if (!pending) pending = setTimeout(scan, 120); };
  new MutationObserver(schedule).observe(root, { childList: true, subtree: true, characterData: true });
  schedule();

  // Find the abbreviation under the pointer.
  const hitAt = (x, y) => {
    let node, offset;
    if (document.caretPositionFromPoint) {
      const p = document.caretPositionFromPoint(x, y);
      if (p) { node = p.offsetNode; offset = p.offset; }
    } else if (document.caretRangeFromPoint) {
      const r = document.caretRangeFromPoint(x, y);
      if (r) { node = r.startContainer; offset = r.startOffset; }
    }
    if (!node || node.nodeType !== 3 || !root.contains(node) || SKIP.has(node.parentElement?.tagName)) return null;
    const t = node.data;
    let a = offset, b = offset;
    while (a > 0 && /[A-Za-z0-9]/.test(t[a - 1])) a--;
    while (b < t.length && /[A-Za-z0-9]/.test(t[b])) b++;
    const hit = lookup(t.slice(a, b));
    if (!hit) return null;
    const r = new Range();
    r.setStart(node, a); r.setEnd(node, b);
    const rect = [...r.getClientRects()].find((q) => x >= q.left - 1 && x <= q.right + 1 && y >= q.top - 1 && y <= q.bottom + 1);
    return rect ? { hit, rect } : null;
  };

  let shownFor = null;
  const show = (h) => {
    const key = `${h.hit.abbr}@${Math.round(h.rect.left)},${Math.round(h.rect.top)}`;
    if (shownFor === key) return;
    shownFor = key;
    tip.textContent = tooltipText(h.hit);
    tip.hidden = false;
    const w = tip.offsetWidth, hgt = tip.offsetHeight;
    let left = Math.min(Math.max(8, h.rect.left), window.innerWidth - w - 8);
    let top = h.rect.bottom + 6;
    if (top + hgt > window.innerHeight - 8) top = h.rect.top - hgt - 6;
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  };
  const hide = () => { if (!tip.hidden) { tip.hidden = true; shownFor = null; } root.style.cursor = ""; };

  let frame = null;
  root.addEventListener("mousemove", (e) => {
    if (frame) return;
    const { clientX: x, clientY: y } = e;
    frame = requestAnimationFrame(() => {
      frame = null;
      const h = hitAt(x, y);
      if (h) { show(h); root.style.cursor = "help"; } else hide();
    });
  });
  root.addEventListener("mouseleave", hide);
  window.addEventListener("scroll", hide, { passive: true });
  // Touch screens have no hover: a tap on an abbreviation shows its full form.
  root.addEventListener("click", (e) => {
    if (e.pointerType === "mouse") return;
    const h = hitAt(e.clientX, e.clientY);
    if (h) show(h); else hide();
  });
}
