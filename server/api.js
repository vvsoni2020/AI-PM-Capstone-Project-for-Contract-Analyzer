// Node.js data API: queue, contract detail, register, audit log, and every human action.
// Guardrail: only KD can record a decision, mark a contract Signed, act on a flag, or confirm a
// register entry. There is no code path that signs, e-signs or sends anything to a counterparty.
import { audit, getDb, nowIso, storageLabel } from "./db.js";

export const USERS = {
  KD: { name: "Karandeep (KD)", role: "CEO – reviewer and signer", canSign: true },
  Bhavin: { name: "Bhavin", role: "Founder – deal POC", canSign: false },
  Dhaval: { name: "Dhaval", role: "Founder – deal POC", canSign: false },
  Jay: { name: "Jay", role: "Sales – deal POC", canSign: false },
  Pranav: { name: "Pranav", role: "CTO – deal POC", canSign: false },
};
const TODAY = process.env.ACA_TODAY || "2026-09-28";
const SEV = { critical: 1, high: 2, medium: 3, low: 4 };
const DOC_LIST_COLUMNS = ["id", "filename", "title", "role", "doc_type", "counterparty", "poc", "deadline", "value_usd", "country",
  "status", "scope", "scope_reason", "side", "source", "top_severity", "top_group", "top_title", "flag_count", "last_review_id", "received_date",
  "tracker_id", "links", "updated_at", "register_extracted_at", "register_entry_count", "decision", "created_at"];

export class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

export function authenticate(headers) {
  const pass = process.env.ACA_PASSCODE;
  if (pass && headers["x-aca-passcode"] !== pass) throw new HttpError(401, "Wrong or missing passcode");
  const user = headers["x-aca-user"];
  if (!USERS[user]) throw new HttpError(401, "Pick who you are (KD, Bhavin, Dhaval, Jay or Pranav)");
  return user;
}

function requireKD(user, what) {
  if (!USERS[user]?.canSign) throw new HttpError(403, `Only KD can ${what}.`);
}

function daysLeft(deadline) {
  if (!deadline) return null;
  return Math.round((Date.parse(deadline) - Date.parse(TODAY)) / 86400000);
}

// Kill switch state: the latest audit row with action "kill_switch". No row = ACA on.
async function acaEnabled(db) {
  const [last] = await db.select("audit_log", { eq: { action: "kill_switch" }, order: "id", desc: true, limit: 1 });
  return !last || last.details?.enabled !== false;
}

export async function getData(q, user) {
  const db = getDb();
  const view = q.view || "queue";
  if (view === "queue") {
    const docs = await db.select("docs", { columns: DOC_LIST_COLUMNS });
    const incoming = docs.filter((d) => d.role === "incoming");
    const rank = (d) => [d.top_severity ? 0 : 1, SEV[d.top_severity] ?? 9, d.deadline ?? "9999", d.top_group ?? 9];
    const cmp = (a, b) => { const x = rank(a), y = rank(b); for (let i = 0; i < x.length; i++) { if (x[i] < y[i]) return -1; if (x[i] > y[i]) return 1; } return 0; };
    const open = incoming.filter((d) => d.scope !== "out" && !["Signed", "Rejected"].includes(d.status));
    const analysed = open.filter((d) => d.last_review_id).sort(cmp);
    const waiting = open.filter((d) => !d.last_review_id).sort((a, b) => (a.deadline ?? "9999").localeCompare(b.deadline ?? "9999"));
    const rejected = incoming.filter((d) => d.status === "Rejected");
    const history = await signedHistory(db, docs);
    const outOfScope = incoming.filter((d) => d.scope === "out");
    // Feedback KD asked for: who was asked, and whether they have commented since.
    const comments = await db.select("comments", { columns: ["doc_id", "author", "kind", "to", "created_at"], order: "created_at" });
    const feedback = {};
    for (const c of comments) {
      if (c.kind !== "feedback_request") continue;
      for (const u of c.to || []) {
        const answered = comments.some((x) => x.doc_id === c.doc_id && x.author === u && x.kind === "comment" && x.created_at > c.created_at);
        (feedback[c.doc_id] ||= {})[u] = answered;
      }
    }
    const add = (d, i) => ({ ...d, rank: i, days_left: daysLeft(d.deadline),
      feedback: Object.entries(feedback[d.id] || {}).map(([u, answered]) => ({ user: u, answered })) });
    const counts = {
      signed_contracts: docs.filter((d) => d.role === "signed").length,
      policy: docs.filter((d) => d.role === "policy").length,
      incidents: docs.filter((d) => d.role === "incident").length,
    };
    return { today: TODAY, aca_enabled: await acaEnabled(db), analysed: analysed.map((d, i) => add(d, i + 1)), waiting: waiting.map((d) => add(d, null)),
      signed_history: history.map((d) => add(d, null)), rejected: rejected.map((d) => add(d, null)), out_of_scope: outOfScope.map((d) => add(d, null)), counts };
  }
  if (view === "doc") {
    const [doc] = await db.select("docs", { eq: { id: q.id } });
    if (!doc) throw new HttpError(404, "Contract not found");
    const reviews = await db.select("reviews", { eq: { doc_id: q.id }, order: "created_at", desc: true,
      columns: ["id", "created_at", "result", "model", "cost_usd", "duration_s", "actor"] });
    const comments = await db.select("comments", { eq: { doc_id: q.id }, order: "created_at" });
    const flagActions = await db.select("flag_actions", { eq: { doc_id: q.id }, order: "created_at" });
    const all = await db.select("docs", { columns: ["id", "filename", "counterparty", "doc_type", "role", "status"] });
    const links = (doc.links || []).map((id) => all.find((d) => d.id === id)).filter(Boolean);
    return { doc: { ...doc, days_left: daysLeft(doc.deadline) }, review: reviews[0] || null, review_count: reviews.length,
      comments, flag_actions: flagActions, links, aca_enabled: await acaEnabled(db) };
  }
  if (view === "invoice") {
    const [doc] = await db.select("docs", { eq: { id: q.id } });
    if (!doc || doc.role !== "signed") throw new HttpError(404, "Signed contract not found");
    const tracker = await trackerIndex(db);
    const card = invoiceSetup(doc, tracker[doc.tracker_id] || {});
    await audit(user, "invoice_setup_viewed", doc.id, { issuer: card.issuer?.short || null, warnings: card.warnings.length });
    return card;
  }
  if (view === "outbound") {
    const [rev] = await db.select("reviews", { eq: { id: q.id }, columns: ["id", "doc_id", "outbound", "result"] });
    if (!rev) throw new HttpError(404, "Analysis not found");
    return { outbound: rev.outbound || [], privacy: rev.result?.privacy || {} };
  }
  if (view === "register") {
    const rows = (await db.select("register", { order: "source_signed_date" })).filter((r) => r.status !== "superseded");
    const signed = (await db.select("docs", { columns: ["id", "filename", "counterparty", "title", "role", "register_extracted_at", "register_entry_count"] }))
      .filter((d) => d.role === "signed");
    return { entries: rows, signed_contracts: signed, today: TODAY };
  }
  if (view === "audit") {
    return { entries: await db.select("audit_log", { order: "id", desc: true, limit: Number(q.limit) || 300 }) };
  }
  if (view === "stats") {
    const reviews = await db.select("reviews", { columns: ["id", "doc_id", "cost_usd", "duration_s", "usage", "created_at"] });
    const done = reviews.filter((r) => r.usage && r.usage.length);
    const sum = (f) => done.reduce((a, r) => a + f(r), 0);
    const tok = (r, k) => r.usage.reduce((a, u) => a + (u[k] || 0), 0);
    return {
      storage: storageLabel(),
      analyses: done.length,
      total_cost_usd: Number(sum((r) => r.cost_usd || 0).toFixed(4)),
      avg_cost_usd: done.length ? Number((sum((r) => r.cost_usd || 0) / done.length).toFixed(4)) : 0,
      avg_seconds: done.length ? Number((sum((r) => r.duration_s || 0) / done.length).toFixed(1)) : 0,
      max_seconds: done.reduce((a, r) => Math.max(a, r.duration_s || 0), 0),
      input_tokens: sum((r) => tok(r, "input_tokens") + tok(r, "cache_read_tokens") + tok(r, "cache_write_tokens")),
      output_tokens: sum((r) => tok(r, "output_tokens")),
    };
  }
  throw new HttpError(400, `Unknown view ${view}`);
}

const DECISION_STATUS = { sign: "Approved to sign", negotiate: "Negotiating", counsel: "With counsel", reject: "Rejected" };

export async function postAction(body, user) {
  const db = getDb();
  const t = body.type;
  const needDoc = async () => {
    const [doc] = await db.select("docs", { eq: { id: body.doc_id }, columns: ["id", "status", "role", "filename", "counterparty"] });
    if (!doc) throw new HttpError(404, "Contract not found");
    return doc;
  };
  if (t === "comment") {
    const doc = await needDoc();
    if (!String(body.text || "").trim()) throw new HttpError(400, "Comment is empty");
    const c = await db.insert("comments", { doc_id: doc.id, author: user, text: String(body.text).slice(0, 4000), kind: "comment" });
    await audit(user, "comment_added", doc.id, { comment_id: c.id });
    return { ok: true, comment: c };
  }
  if (t === "feedback_request") {
    requireKD(user, "ask for feedback");
    const doc = await needDoc();
    const to = (body.to || []).filter((u) => USERS[u] && u !== "KD");
    if (!to.length) throw new HttpError(400, "Pick who should give feedback");
    const c = await db.insert("comments", { doc_id: doc.id, author: user, kind: "feedback_request", to, text: String(body.text || "Please review the brief and add your feedback.").slice(0, 2000) });
    await audit(user, "feedback_requested", doc.id, { to });
    return { ok: true, comment: c };
  }
  if (t === "decision") {
    requireKD(user, "record a decision");
    const doc = await needDoc();
    const status = DECISION_STATUS[body.decision];
    if (!status) throw new HttpError(400, "Decision must be sign, negotiate, counsel or reject");
    await db.update("docs", { id: doc.id }, { status, decision: body.decision, decision_note: body.note || "", decision_at: nowIso(), updated_at: nowIso() });
    await audit(user, "decision_recorded", doc.id, { decision: body.decision, note: body.note || "", previous_status: doc.status });
    return { ok: true, status };
  }
  if (t === "mark_signed") {
    // Recording that KD signed OUTSIDE ACA. ACA itself never signs or sends anything.
    requireKD(user, "mark a contract Signed");
    const doc = await needDoc();
    if (!body.confirm) throw new HttpError(400, "Confirm that you signed this contract outside ACA");
    await db.update("docs", { id: doc.id }, { status: "Signed", role: "signed", signed_date: TODAY, updated_at: nowIso() });
    await audit(user, "marked_signed", doc.id, { previous_status: doc.status, note: "Signed by KD outside ACA" });
    return { ok: true, status: "Signed", next: "extract_obligations" };
  }
  if (t === "flag_feedback") {
    requireKD(user, "dismiss a flag or mark it wrong");
    const doc = await needDoc();
    if (!["dismiss", "wrong", "useful", "restore"].includes(body.action)) throw new HttpError(400, "Unknown flag action");
    if (["dismiss", "wrong"].includes(body.action) && !String(body.reason || "").trim()) throw new HttpError(400, "A reason is required");
    const a = await db.insert("flag_actions", { doc_id: doc.id, review_id: body.review_id, flag_id: body.flag_id, flag_title: body.flag_title || "",
      action: body.action, reason: body.reason || "", actor: user });
    await audit(user, `flag_${body.action}`, doc.id, { review_id: body.review_id, flag_id: body.flag_id, reason: body.reason || "" });
    return { ok: true, action: a };
  }
  if (t === "register_confirm" || t === "register_reject") {
    requireKD(user, "confirm or reject register entries");
    const [e] = await db.select("register", { eq: { id: body.entry_id } });
    if (!e) throw new HttpError(404, "Register entry not found");
    const status = t === "register_confirm" ? "confirmed" : "rejected";
    await db.update("register", { id: e.id }, { status, confirmed_by: user, confirmed_at: nowIso(), kd_note: body.note || "" });
    await audit(user, `register_${status}`, e.source_doc_id, { entry_id: e.id, type: e.type, summary: e.summary, note: body.note || "" });
    return { ok: true, status };
  }
  if (t === "kill_switch") {
    // KD only. Stop: no contract is sent to ACA until KD starts it again. Logged in the audit log.
    requireKD(user, "stop or start ACA");
    if (typeof body.enabled !== "boolean") throw new HttpError(400, "enabled must be true or false");
    await audit(user, "kill_switch", null, { enabled: body.enabled, note: String(body.note || "").slice(0, 300) });
    return { ok: true, aca_enabled: body.enabled };
  }
  if (t === "set_meta") {
    const doc = await needDoc();
    const allowed = ["poc", "deadline", "value_usd", "country", "counterparty"];
    const patch = Object.fromEntries(Object.entries(body.fields || {}).filter(([k]) => allowed.includes(k)));
    if (patch.value_usd !== undefined) patch.value_usd = patch.value_usd === "" ? null : Number(patch.value_usd);
    await db.update("docs", { id: doc.id }, { ...patch, updated_at: nowIso() });
    await audit(user, "metadata_updated", doc.id, patch);
    return { ok: true };
  }
  throw new HttpError(400, `Unknown action ${t}`);
}


// ---------------- Signed Contract History + invoice setup (added 10 Oct) ----------------
// AtliQ's two entities, from the finance fact sheet (dataset/atliq_entities.md).
const ENTITIES = {
  inc: {
    short: "AtliQ Inc", name: "AtliQ Inc", type: "Delaware corporation (100% owned by AtliQ Technologies Pvt Ltd)",
    address: "101 College Road East, Suite 210, Princeton, NJ 08540, USA",
    ids: [["EIN", "88-4410273"]], tax: "US", currencies: ["USD"], signatory: "Karandeep (President)",
  },
  pvt: {
    short: "AtliQ Technologies Pvt Ltd", name: "AtliQ Technologies Pvt Ltd", type: "Private limited company (India)",
    address: "4th Floor, Baner Business Bay, Pune 411045, Maharashtra, India",
    ids: [["CIN", "U72900MH2019PTC321456"], ["GSTIN", "27AAKCA4821F1Z3"]], tax: "GST (India)", currencies: ["INR", "USD", "EUR"],
    signatory: "Karandeep (CEO)",
  },
};
const ENTITY_RULE = "US clients are invoiced by AtliQ Inc; clients in every other region by AtliQ Technologies Pvt Ltd (atliq_entities.md; decided 10 Oct).";
const isUS = (c) => /^(usa|us|united states)/i.test(String(c || "").trim());
const EU = /germany|france|netherlands|spain|italy|ireland|europe/i;

function parseCsv(text) {
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch; }
    else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n") { row.push(cell.replace(/\r$/, "")); rows.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows;
  return body.filter((r) => r.length > 1).map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] || "").trim()])));
}

async function trackerIndex(db) {
  const [tr] = await db.select("docs", { eq: { role: "tracker" }, columns: ["id", "text"] });
  if (!tr || !tr.text) return {};
  return Object.fromEntries(parseCsv(tr.text).map((r) => [r.contract_id, r]));
}

function contractEntity(text, counterparty) {
  if (/atliq/i.test(counterparty || "")) return "Both AtliQ entities (intercompany)";
  const head = String(text || "").slice(0, 6000);
  const inc = head.search(/AtliQ\s+Inc\b/i);
  const pvt = head.search(/AtliQ\s+Technologies\s+(Pvt\.?\s*Ltd|Private\s+Limited)/i);
  if (inc < 0 && pvt < 0) return null;
  if (pvt < 0 || (inc >= 0 && inc < pvt)) return "AtliQ Inc";
  return "AtliQ Technologies Pvt Ltd";
}

function atliqRole(d) {
  const t = `${d.doc_type || ""} ${d.title || ""}`.toLowerCase();
  if (/atliq/i.test(d.counterparty || "")) return "Intercompany";
  if (/\bnda\b|non-disclosure|confidential/.test(t)) return "NDA party";
  if (/contractor|subcontract|vendor|freelanc/.test(t)) return "Buyer";
  if (/partner/.test(t)) return "Partner";
  if (/waiver|consent/.test(t)) return "Supplier (waiver letter)";
  return "Supplier";
}

async function signedHistory(db, docs) {
  const signed = docs.filter((d) => d.role === "signed");
  if (!signed.length) return [];
  const tracker = await trackerIndex(db);
  const texts = await db.select("docs", { eq: { role: "signed" }, columns: ["id", "text", "signed_date"] });
  const byId = Object.fromEntries(texts.map((t) => [t.id, t]));
  return signed.map((d) => {
    const tr = tracker[d.tracker_id] || {};
    const viaAca = Boolean(byId[d.id]?.signed_date);
    const fileDate = (String(d.filename || "").match(/^(\d{4}-\d{2}-\d{2})/) || [])[1];
    return {
      ...d,
      signed_on: byId[d.id]?.signed_date || tr.signed_date || fileDate || null,
      expiry: tr.expiry_date || null,
      contract_entity: contractEntity(byId[d.id]?.text, d.counterparty),
      atliq_role: atliqRole(d),
      billable: billableOf(d, atliqRole(d))[0],
      via_aca: viaAca,
    };
  }).sort((a, b) => String(b.signed_on || "").localeCompare(String(a.signed_on || "")));
}

function paymentTerms(text) {
  const t = String(text || "");
  const re = /(\d{1,3})\s*\)?\s*(?:calendar\s+|business\s+)?days/gi;
  let m;
  while ((m = re.exec(t))) {
    const win = t.slice(Math.max(0, m.index - 220), m.index + 60);
    if (/invoice|payment|paid|payable/i.test(win)) {
      const start = Math.max(0, t.lastIndexOf("\n", m.index) + 1);
      const end = t.indexOf("\n", m.index);
      return { days: Number(m[1]), quote: t.slice(start, end < 0 ? undefined : end).trim().slice(0, 400) };
    }
  }
  return null;
}

function billableOf(doc, role) {
  const t = `${doc.doc_type || ""} ${doc.title || ""}`.toLowerCase();
  if (role === "Intercompany") return [false, "Intercompany agreement – handled through finance's intercompany process, not a client invoice."];
  if (role === "Buyer") return [false, "AtliQ is the buyer here: the vendor invoices AtliQ, not the other way round."];
  if (role === "NDA party" || /\bbaa\b|business associate|waiver|consent|settlement/.test(t))
    return [false, "This document carries no fees, so there is nothing to invoice. Invoices follow the main services agreement."];
  return [true, ""];
}

function invoiceSetup(doc, tr) {
  const role = atliqRole(doc);
  const country = doc.country || tr.client_country || null;
  const issuerKey = isUS(country) ? "inc" : "pvt";
  const issuer = ENTITIES[issuerKey];
  const named = contractEntity(doc.text, doc.counterparty);
  const [billable, reason] = billableOf(doc, role);
  const warnings = [];
  if (!country) warnings.push("Client country is not recorded – confirm it before choosing the invoicing entity.");
  if (billable && named && !named.startsWith("Both") && named !== issuer.short)
    warnings.push(`The contract names ${named} as the AtliQ party, but ${country} clients are invoiced by ${issuer.short}. Finance says entity mismatches delayed payments twice in 2025 – align the contract (amendment) or agree the invoicing entity with the client before the first invoice.`);
  if (billable && !tr.atliq_entity) warnings.push("The tracker has no AtliQ entity for this contract – update the tracker.");
  if (billable && !doc.value_usd) warnings.push("No contract value in the tracker – take amounts from the SOW / fee schedule.");
  const currency = issuerKey === "inc" ? "USD" : /india/i.test(country || "") ? "INR" : EU.test(country || "") ? "EUR" : "USD";
  return {
    doc: { id: doc.id, counterparty: doc.counterparty, doc_type: doc.doc_type, title: doc.title, tracker_id: doc.tracker_id,
      signed_on: doc.signed_date || tr.signed_date || null, expiry: tr.expiry_date || null, value_usd: doc.value_usd, country, poc: doc.poc },
    atliq_role: role, billable, reason,
    issuer: billable ? issuer : null, rule: ENTITY_RULE, contract_entity: named,
    currency: billable ? currency : null,
    payment_terms: billable ? paymentTerms(doc.text) : null,
    bill_to: billable ? { name: doc.counterparty, country } : null,
    warnings,
    note: "Draft for finance. ACA never issues or sends invoices; finance raises the invoice in its own system. Bank details are not stored in ACA.",
  };
}
