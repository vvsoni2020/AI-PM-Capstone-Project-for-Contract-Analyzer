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

export async function getData(q, user) {
  const db = getDb();
  const view = q.view || "queue";
  if (view === "queue") {
    const docs = await db.select("docs", { columns: DOC_LIST_COLUMNS });
    const incoming = docs.filter((d) => d.role === "incoming" || (d.role === "signed" && d.source !== "dataset"));
    const rank = (d) => [d.top_severity ? 0 : 1, SEV[d.top_severity] ?? 9, d.deadline ?? "9999", d.top_group ?? 9];
    const cmp = (a, b) => { const x = rank(a), y = rank(b); for (let i = 0; i < x.length; i++) { if (x[i] < y[i]) return -1; if (x[i] > y[i]) return 1; } return 0; };
    const open = incoming.filter((d) => d.scope !== "out" && !["Signed", "Rejected"].includes(d.status));
    const analysed = open.filter((d) => d.last_review_id).sort(cmp);
    const waiting = open.filter((d) => !d.last_review_id).sort((a, b) => (a.deadline ?? "9999").localeCompare(b.deadline ?? "9999"));
    const closed = incoming.filter((d) => ["Signed", "Rejected"].includes(d.status));
    const outOfScope = incoming.filter((d) => d.scope === "out");
    const add = (d, i) => ({ ...d, rank: i, days_left: daysLeft(d.deadline) });
    const counts = {
      signed_contracts: docs.filter((d) => d.role === "signed").length,
      policy: docs.filter((d) => d.role === "policy").length,
      incidents: docs.filter((d) => d.role === "incident").length,
    };
    return { today: TODAY, analysed: analysed.map((d, i) => add(d, i + 1)), waiting: waiting.map((d) => add(d, null)),
      closed: closed.map((d) => add(d, null)), out_of_scope: outOfScope.map((d) => add(d, null)), counts };
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
      comments, flag_actions: flagActions, links };
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
