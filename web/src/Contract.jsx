import { Fragment, useCallback, useEffect, useState } from "react";
import { api, USERS, USER_NAMES } from "./api.js";
import { makeExpander } from "./glossary.js";
import { CATEGORY_LABEL, Deadline, Elapsed, fmtDate, fmtTime, Modal, money, Res, Sev, SOURCE_LABEL, Spinner, useApp } from "./ui.jsx";

const ORIGIN = { rules: "Fixed rule", kd_positions: "KD's positions check", conflicts: "Commitments register check", fairness: "Fairness check" };
const PAST = { deliberate_exception: "Accepted before as a deliberate exception", waved_through: "Waved through before without review" };

export default function Contract({ id }) {
  const { onError, notify } = useApp();
  const [data, setData] = useState(null);
  const [running, setRunning] = useState(null);
  const load = useCallback(() => api.data("doc", { id }).then(setData).catch(onError), [id, onError]);
  useEffect(() => { load(); }, [load]);

  const analyse = async () => {
    setRunning(Date.now());
    try {
      const rev = await api.review(id);
      await load();
      notify(rev.result?.state === "error" ? "Analysis failed – see below" : "Analysis finished");
    } catch (e) { onError(e); } finally { setRunning(null); }
  };

  if (!data) return <Spinner label="Loading the contract" />;
  const { doc, review } = data;
  return (
    <>
      <p className="small"><a href="#/">Back to the queue</a></p>
      <div className="chead">
        <h1>{doc.counterparty}</h1>
        <div className="meta">
          <span>{doc.title}</span>
          <span>{doc.doc_type}{doc.side ? `, AtliQ as ${doc.side}` : ""}</span>
          <span>Status: <b>{doc.status}</b></span>
        </div>
      </div>
      <div className="cgrid">
        <div className="stack">
          <Brief doc={doc} review={review} actions={data.flag_actions} running={running} onAnalyse={analyse} reload={load} />
          <details className="panel">
            <summary>Full contract text</summary>
            <div className="contract-text">{doc.text}</div>
          </details>
        </div>
        <aside className="rail stack">
          <DealFacts doc={doc} links={data.links} reload={load} />
          <Decision doc={doc} reload={load} />
          <Feedback doc={doc} comments={data.comments} reload={load} />
        </aside>
      </div>
    </>
  );
}

function Brief({ doc, review, actions, running, onAnalyse, reload }) {
  const r = review?.result;
  const outOfScope = doc.scope === "out";
  const head = (
    <div className="brief-head">
      <h2>Risk brief</h2>
      {running ? <Elapsed start={running} hint="masking, 4 checks in parallel, citation check – usually 20–45 s" />
        : !outOfScope && <button className={`btn ${r ? "" : "primary"}`} onClick={onAnalyse}>{r ? "Analyse again" : "Analyse this contract"}</button>}
    </div>
  );
  if (!r) {
    return (
      <div className="panel">
        {head}
        {outOfScope ? <p>Out of scope – HR signs ({doc.scope_reason}). ACA does not review freelancer or employee contracts.</p>
          : <p className="muted">Not analysed yet. ACA masks IDs and bank details, withholds any patient data, checks the draft against KD's positions, past incidents and every signed contract, and returns the top 3 risks with exact clause quotes.</p>}
      </div>
    );
  }
  if (r.state === "out_of_scope") return <div className="panel">{head}<p>{r.headline}</p></div>;
  if (r.state === "error") {
    return (
      <div className="panel state-error">
        {head}
        <p><b>{r.headline}</b></p>
        <ul className="small">{Object.entries(r.errors || {}).map(([k, v]) => <li key={k}>{k}: {v}</li>)}</ul>
      </div>
    );
  }
  const actionFor = (fid) => [...actions].reverse().find((a) => a.review_id === review.id && a.flag_id === fid);
  return (
    <>
      <div className={`panel ${r.state === "clean" ? "state-clean" : ""}`}>
        {head}
        <p style={{ fontSize: "1.05rem" }}><b>{makeExpander()(r.headline)}</b></p>
        <p className="small muted">
          Analysed {fmtTime(review.created_at)} by {review.actor} in {r.duration_s} s with {review.model} · {(r.usage || []).length} AI calls ·{" "}
          {Number(r.total_tokens || 0).toLocaleString()} tokens · ${Number(r.total_cost_usd || 0).toFixed(3)}
        </p>
        {r.register_note && <p className="small muted">Commitments register: {r.register_note}</p>}
        {r.state === "clean" && <p>Nothing in this draft needs KD's attention beyond the checks below. ACA never calls a contract safe without evidence, so every check and its result is listed.</p>}
      </div>
      {r.top_risks.map((f) => <RiskCard key={f.id} f={f} doc={doc} reviewId={review.id} act={actionFor(f.id)} reload={reload} />)}
      {r.other_flags.length > 0 && <MoreFlags flags={r.other_flags} doc={doc} reviewId={review.id} actionFor={actionFor} reload={reload} />}
      {r.mutuality?.applicable && <Mutuality m={r.mutuality} />}
      <Checks checks={r.checks} />
      <Bundle bundle={r.bundle} />
      <Privacy review={review} />
      {r.removed_flags?.length > 0 && (
        <details className="panel">
          <summary>Removed by the citation check ({r.removed_flags.length})</summary>
          <p className="small muted">These findings were dropped because a quote could not be found word for word in the contract or in the source it cited. No source, no flag.</p>
          <ul className="small">{r.removed_flags.map((f, i) => <li key={i}><b>{f.title}</b> – {f.removed_reason}</li>)}</ul>
        </details>
      )}
      <details className="panel">
        <summary>Key terms ACA read from the draft</summary>
        <KeyTerms kt={r.key_terms} />
      </details>
    </>
  );
}

function RiskCard({ f, doc, reviewId, act, reload, compact }) {
  const { isKD, onError, notify } = useApp();
  const [mode, setMode] = useState(null);
  const [reason, setReason] = useState("");
  const state = act && act.action !== "restore" ? act.action : null;
  const send = async (action) => {
    try {
      await api.action({ type: "flag_feedback", doc_id: doc.id, review_id: reviewId, flag_id: f.id, flag_title: f.title, action, reason });
      notify(action === "dismiss" ? "Flag dismissed" : action === "wrong" ? "Marked as wrong" : action === "useful" ? "Marked as useful" : "Flag restored");
      setMode(null); setReason(""); reload();
    } catch (e) { onError(e); }
  };
  const hasSource = f.source_quote && f.source_quote.trim();
  // First use of each abbreviation in this card is written out; quotes stay verbatim.
  const ex = makeExpander();
  return (
    <article className={`risk ${f.severity} ${state === "dismiss" || state === "wrong" ? "dismissed" : ""}`} aria-label={f.title}>
      <div className="risk-top">
        <div className="risk-bar" />
        <div className="risk-body">
          <div className="risk-title-row">
            <h3>{f.title}</h3>
            <div className="risk-chips">
              <Sev s={f.severity} />
              {f.needs_kd_check && <span className="tag check">Needs KD check</span>}
              {state && <span className="tag">{state === "dismiss" ? "Dismissed by KD" : state === "wrong" ? "Marked wrong by KD" : "Marked useful"}</span>}
            </div>
          </div>
          <div className="small muted" style={{ marginTop: 4 }}>{CATEGORY_LABEL[f.category] || f.category} · found by {ORIGIN[f.origin] || f.origin}</div>
          <div className={`evidence ${hasSource ? "" : "single"}`}>
            <div>
              <div className="ev-label"><span><b>This draft</b> {f.draft_clause_ref}</span>{f.citation?.draft_verified && <span className="verified">Quote verified</span>}</div>
              <blockquote className="quote"><mark>{f.draft_quote}</mark></blockquote>
            </div>
            {hasSource && (
              <div>
                <div className="ev-label"><span><b>{SOURCE_LABEL[f.source_type] || "Source"}</b> {f.source_ref}</span>{f.citation?.source_verified && <span className="verified">Quote verified</span>}</div>
                <blockquote className="quote source"><mark>{f.source_quote}</mark></blockquote>
              </div>
            )}
          </div>
          <dl className="facts">
            <dt>Why it matters</dt><dd>{ex(f.why_it_matters)}</dd>
            {f.kd_position && <><dt>KD's position</dt><dd>{ex(f.kd_position)}</dd></>}
            {f.past_exception && f.past_exception !== "none" && <><dt>History</dt><dd>{PAST[f.past_exception]}{f.past_exception_note ? `: ${f.past_exception_note}` : ""}</dd></>}
            {f.needs_kd_check && f.uncertainty_note && <><dt>KD to confirm</dt><dd>{ex(f.uncertainty_note)}</dd></>}
          </dl>
          <div className="suggestion">{ex(f.suggestion)}</div>
          {f.also_flagged_by?.length > 0 && (
            <details className="also">
              <summary>Also found by {f.also_flagged_by.length} other check{f.also_flagged_by.length > 1 ? "s" : ""}</summary>
              <ul>{f.also_flagged_by.map((a, i) => (
                <li key={i}><b>{ORIGIN[a.origin] || a.origin}:</b> {a.title}{a.why_it_matters ? ` – ${a.why_it_matters}` : ""}
                  {a.source_quote && <div className="muted">“{a.source_quote}” ({a.source_ref})</div>}</li>))}
              </ul>
            </details>
          )}
          {isKD && !compact && (
            <div className="risk-actions">
              {mode ? (
                <>
                  <input type="text" placeholder={mode === "wrong" ? "Why is this flag wrong?" : "Why dismiss it?"} value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Reason" style={{ flex: "1 1 240px" }} />
                  <button className="btn small primary" disabled={!reason.trim()} onClick={() => send(mode)}>{mode === "wrong" ? "Mark wrong" : "Dismiss flag"}</button>
                  <button className="btn small" onClick={() => setMode(null)}>Cancel</button>
                </>
              ) : state ? (
                <button className="btn small" onClick={() => send("restore")}>Restore flag</button>
              ) : (
                <>
                  <button className="btn small" onClick={() => send("useful")}>Useful</button>
                  <button className="btn small" onClick={() => setMode("dismiss")}>Dismiss</button>
                  <button className="btn small danger" onClick={() => setMode("wrong")}>Mark wrong</button>
                </>
              )}
            </div>
          )}
          {act?.reason && state && <p className="small muted" style={{ marginTop: 8 }}>KD's reason: {act.reason}</p>}
        </div>
      </div>
    </article>
  );
}

function MoreFlags({ flags, doc, reviewId, actionFor, reload }) {
  const [open, setOpen] = useState(null);
  return (
    <div className="panel">
      <div className="panel-title"><h2>{flags.length} more flag{flags.length > 1 ? "s" : ""}</h2><span className="small muted">Ranked below the top 3. Open one to see its evidence.</span></div>
      <ul className="flaglist">
        {flags.map((f) => (
          <li key={f.id}>
            <button className="flagrow" onClick={() => setOpen(open === f.id ? null : f.id)} aria-expanded={open === f.id}>
              <Sev s={f.severity} /><span className="t">{f.title}</span>
              {f.needs_kd_check && <span className="tag check">Needs KD check</span>}
              <span className="small muted hide-sm">{f.draft_clause_ref}</span>
            </button>
            {open === f.id && <div style={{ marginTop: 10 }}><RiskCard f={f} doc={doc} reviewId={reviewId} act={actionFor(f.id)} reload={reload} /></div>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Checks({ checks }) {
  let last = null;
  return (
    <details className="panel" open>
      <summary>Checks run ({checks.length})</summary>
      <div className="table-wrap">
        <table className="checks">
          <tbody>
            {checks.map((c, i) => {
              const grp = c.group !== last ? (last = c.group) : null;
              return (
                <Fragment key={i}>
                  {grp && <tr className="grp"><td colSpan={3}>{grp}</td></tr>}
                  <tr><td>{c.check}</td><td><Res r={c.result} /></td><td className="muted">{c.evidence}</td></tr>
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function Mutuality({ m }) {
  return (
    <div className="panel">
      <div className="panel-title">
        <h2>Is this NDA really mutual?</h2>
        {m.actually_mutual ? <span className="sev clean">Mutual</span> : <span className="sev critical">One-way{m.titled_mutual ? " despite the title" : ""}</span>}
      </div>
      <table className="checks"><tbody>
        {m.dimensions.map((d, i) => (
          <tr key={i}><td>{d.dimension}</td><td><span className={`res ${d.result === "mutual" ? "pass" : "flag"}`}>{d.result.replace("_", " ")}</span></td>
            <td className="muted">{d.note} {d.ref && <span className="nowrap">({d.ref})</span>}</td></tr>
        ))}
      </tbody></table>
    </div>
  );
}

function Bundle({ bundle }) {
  if (!bundle) return null;
  return (
    <div className="panel">
      <h2 style={{ marginBottom: 10 }}>Deal paperwork and regulations</h2>
      {bundle.documents?.length > 0 && (
        <table className="checks"><tbody>
          {bundle.documents.map((d, i) => <tr key={i}><td>{d.document}</td><td><span className={`res ${/signed|included|this document|in this contract/.test(d.status) ? "pass" : "flag"}`}>{d.status}</span></td><td className="muted">{d.required ? "Required" : "Expected"}</td></tr>)}
        </tbody></table>
      )}
      <h3 style={{ margin: "14px 0 6px" }}>Laws that likely apply</h3>
      {bundle.regulations?.length ? (
        <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
          {bundle.regulations.map((g, i) => <li key={i}><b>{g.name}</b> – {g.requires}. <i>{g.label}.</i></li>)}
        </ul>
      ) : <p className="small muted">None from ACA's fixed list for this country, sector and data.</p>}
      <p className="small muted" style={{ marginTop: 8 }}>A fixed, curated list by country and sector. Not legal advice.</p>
    </div>
  );
}

function Privacy({ review }) {
  const { onError } = useApp();
  const p = review.result.privacy || {};
  const [out, setOut] = useState(null);
  const [loading, setLoading] = useState(false);
  const show = async () => {
    setLoading(true);
    try { setOut(await api.data("outbound", { id: review.id })); } catch (e) { onError(e); } finally { setLoading(false); }
  };
  const counts = Object.entries(p.masked_counts || {});
  return (
    <div className="panel">
      <div className="panel-title"><h2>What left AtliQ</h2>
        {!out && <button className="btn small" onClick={show} disabled={loading}>{loading ? "Loading…" : "Show the exact text sent"}</button>}</div>
      <p className="small">
        Only masked text went to the Claude API. {counts.length ? <>Masked: {counts.map(([k, v]) => `${v} ${k.toLowerCase().replace(/_/g, " ")}`).join(", ")}.</> : "Nothing needed masking."}{" "}
        {p.withheld_lines?.length ? <b style={{ color: "var(--crit)" }}>{p.withheld_lines.length} line(s) of patient or personal data were withheld entirely and never sent.</b> : "No patient or personal data was found."}
        {" "}Party names and commercial figures are sent as they are.
      </p>
      {out && out.outbound.map((o, i) => (
        <details key={i} style={{ marginTop: 8 }}>
          <summary>{o.call.replace("_", " ")} call · {o.chars.toLocaleString()} characters</summary>
          <pre className="outbound">{renderTokens(o.text)}</pre>
        </details>
      ))}
    </div>
  );
}

function renderTokens(text) {
  const parts = text.split(/(\[WITHHELD:[^\]]*\]|\[[A-Z_]+_\d+\]|\[ATLIQ_[A-Z_]+\])/g);
  return parts.map((s, i) => (i % 2 ? <span key={i} className={s.startsWith("[WITHHELD") ? "wh" : "tok"}>{s}</span> : s));
}

function KeyTerms({ kt }) {
  if (!kt) return null;
  const rows = [
    ["AtliQ signs as", kt.signing_entity, kt.signing_entity_ref], ["Invoices from", kt.invoicing_entity, kt.invoicing_ref],
    ["Governing law", kt.governing_law, kt.governing_law_ref], ["Disputes", kt.dispute_venue, kt.venue_ref],
    ["Prevailing language", kt.prevailing_language], ["Contract value", kt.contract_value_usd ? money(kt.contract_value_usd) : "not stated"],
    ["Liability cap", kt.liability_uncapped ? "Uncapped" : kt.liability_cap_text, kt.liability_ref],
    ["Liquidated damages", kt.ld_present ? kt.ld_text : "None", kt.ld_ref],
    ["Client-caused delay excluded", kt.ld_client_delay_excluded], ["Indemnity", `${kt.indemnity_mutual ? "Mutual" : "One-way"}${kt.indemnity_covers_counterparty_negligence ? ", covers their negligence" : ""}`, kt.indemnity_ref],
    ["Payment", kt.payment_days ? `${kt.payment_days} days` : "not stated", kt.payment_ref],
    ["Personal / patient data", `${kt.handles_personal_data ? "Yes" : "No"}${kt.handles_phi ? ", patient data (PHI)" : ""}`, kt.data_ref],
    ["Companion documents", (kt.companion_documents || []).join(", ") || "none"],
  ];
  return <div className="kv">{rows.map(([k, v, ref]) => <div key={k}><span>{k}</span>{v || "–"}{ref ? <span className="small">{ref}</span> : null}</div>)}</div>;
}

function DealFacts({ doc, links, reload }) {
  const { onError, notify } = useApp();
  const [edit, setEdit] = useState(false);
  const [f, setF] = useState({});
  const open = () => { setF({ poc: doc.poc || "", deadline: doc.deadline || "", value_usd: doc.value_usd ?? "", country: doc.country || "" }); setEdit(true); };
  const save = async (e) => {
    e.preventDefault();
    try { await api.action({ type: "set_meta", doc_id: doc.id, fields: f }); notify("Deal details saved"); setEdit(false); reload(); } catch (err) { onError(err); }
  };
  return (
    <div className="panel">
      <div className="panel-title"><h3>Deal details</h3><button className="linkbtn small" onClick={open}>Edit</button></div>
      <dl className="facts" style={{ gridTemplateColumns: "110px 1fr" }}>
        <dt>POC</dt><dd>{doc.poc ? USER_NAMES[doc.poc] || doc.poc : "–"}</dd>
        <dt>Deadline</dt><dd><Deadline d={doc.deadline} days={doc.days_left} />{doc.deadline_note && <div className="small muted">{doc.deadline_note}</div>}</dd>
        <dt>Value</dt><dd>{money(doc.value_usd)}</dd>
        <dt>Country</dt><dd>{doc.country || "–"}</dd>
        <dt>Received</dt><dd>{fmtDate(doc.received_date || doc.created_at)}{doc.source === "email" ? " by email" : ""}</dd>
        {doc.tracker_id && <><dt>Tracker</dt><dd>{doc.tracker_id}</dd></>}
        {doc.email_info && <><dt>Email</dt><dd className="small">{doc.email_info.from}<br />{doc.email_info.subject}</dd></>}
        <dt>Linked</dt><dd>{links?.length ? links.map((l) => <div key={l.id}><a href={`#/contract/${l.id}`}>{l.counterparty} {l.doc_type}</a> <span className="small muted">({l.role === "signed" ? "signed" : l.status})</span></div>) : "–"}</dd>
      </dl>
      {doc.tracker_notes && <p className="note" style={{ marginTop: 10 }}>Tracker note: {doc.tracker_notes}</p>}
      {edit && (
        <Modal title="Edit deal details" onClose={() => setEdit(false)}>
          <form onSubmit={save}>
            <div className="grid2">
              <div><label className="f">POC</label><select className="input" value={f.poc} onChange={(e) => setF({ ...f, poc: e.target.value })}><option value="">–</option>{USERS.map((u) => <option key={u}>{u}</option>)}</select></div>
              <div><label className="f">Deadline</label><input type="date" value={f.deadline} onChange={(e) => setF({ ...f, deadline: e.target.value })} /></div>
              <div><label className="f">Contract value (USD)</label><input type="number" value={f.value_usd} onChange={(e) => setF({ ...f, value_usd: e.target.value })} /></div>
              <div><label className="f">Client country</label><input type="text" value={f.country} onChange={(e) => setF({ ...f, country: e.target.value })} /></div>
            </div>
            <p className="small muted" style={{ marginTop: 10 }}>Run the analysis again after changing the value or country.</p>
            <div className="risk-actions"><button className="btn primary" type="submit">Save details</button><button className="btn" type="button" onClick={() => setEdit(false)}>Cancel</button></div>
          </form>
        </Modal>
      )}
    </div>
  );
}

function Decision({ doc, reload }) {
  const { isKD, onError, notify } = useApp();
  const [note, setNote] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [extracting, setExtracting] = useState(null);
  const decide = async (decision) => {
    try { const r = await api.action({ type: "decision", doc_id: doc.id, decision, note }); notify(`Decision recorded: ${r.status}`); setNote(""); reload(); } catch (e) { onError(e); }
  };
  const markSigned = async () => {
    try { await api.action({ type: "mark_signed", doc_id: doc.id, confirm }); notify("Marked Signed"); reload(); } catch (e) { onError(e); }
  };
  const extract = async () => {
    setExtracting(Date.now());
    try { const r = await api.extract(doc.id); notify(`${r.entries} obligations extracted – confirm them in the register`); reload(); } catch (e) { onError(e); } finally { setExtracting(null); }
  };
  if (doc.scope === "out") return null;
  return (
    <div className="panel">
      <h3>KD's decision</h3>
      {doc.status === "Signed" ? (
        <>
          <p>Signed by KD outside ACA. <a href={`#/invoice/${doc.id}`}>Invoice setup →</a></p>
          {doc.register_extracted_at
            ? <p className="small">{doc.register_entry_count} obligations extracted. <a href="#/register">Confirm them in the register</a>.</p>
            : extracting ? <Elapsed start={extracting} hint="extracting obligations" />
              : <button className="btn primary" onClick={extract}>Extract new obligations for the register</button>}
        </>
      ) : isKD ? (
        <>
          <textarea placeholder="Note for the team (optional)" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Decision note" />
          <div className="decisions" style={{ marginTop: 8 }}>
            <button className="btn" onClick={() => decide("sign")}>Approve to sign</button>
            <button className="btn" onClick={() => decide("negotiate")}>Negotiate</button>
            <button className="btn" onClick={() => decide("counsel")}>Send to counsel</button>
            <button className="btn danger" onClick={() => decide("reject")}>Reject</button>
          </div>
          <div className="note" style={{ marginTop: 12 }}>
            ACA never signs or sends anything. Sign the contract outside ACA, then record it here.
            <label style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "flex-start" }}>
              <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} /> I have signed this contract myself
            </label>
            <button className="btn small" style={{ marginTop: 8 }} disabled={!confirm} onClick={markSigned}>Mark Signed</button>
          </div>
        </>
      ) : (
        <p className="note">Only KD can record a decision or mark a contract Signed. You can add feedback below.</p>
      )}
      {doc.decision && doc.status !== "Signed" && <p className="small muted" style={{ marginTop: 10 }}>Last decision: {doc.status}{doc.decision_note ? ` – ${doc.decision_note}` : ""}</p>}
    </div>
  );
}

function Feedback({ doc, comments, reload }) {
  const { isKD, user, onError, notify } = useApp();
  const [text, setText] = useState("");
  const [to, setTo] = useState([]);
  const post = async (type) => {
    try {
      await api.action(type === "comment" ? { type, doc_id: doc.id, text } : { type, doc_id: doc.id, to, text });
      notify(type === "comment" ? "Comment added" : "Feedback requested"); setText(""); setTo([]); reload();
    } catch (e) { onError(e); }
  };
  return (
    <div className="panel">
      <h3>Feedback</h3>
      {comments.length === 0 && <p className="small muted">No comments yet.</p>}
      {comments.map((c) => (
        <div key={c.id} className="comment">
          <span className="who">{USER_NAMES[c.author] || c.author}</span> <span className="small muted">{fmtTime(c.created_at)}</span>
          {c.kind === "feedback_request" && <div className="small">Asked {c.to.join(", ")} for feedback</div>}
          <div>{c.text}</div>
        </div>
      ))}
      <textarea style={{ marginTop: 8 }} placeholder={`Comment as ${USER_NAMES[user]}`} value={text} onChange={(e) => setText(e.target.value)} aria-label="Comment" />
      <div className="risk-actions" style={{ marginTop: 8 }}>
        <button className="btn small" disabled={!text.trim()} onClick={() => post("comment")}>Add comment</button>
      </div>
      {isKD && (
        <div style={{ marginTop: 12 }}>
          <div className="small muted">Ask for feedback from</div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", margin: "6px 0" }}>
            {USERS.filter((u) => u !== "KD").map((u) => (
              <label key={u} className="small"><input type="checkbox" checked={to.includes(u)} onChange={(e) => setTo(e.target.checked ? [...to, u] : to.filter((x) => x !== u))} /> {u}</label>
            ))}
          </div>
          <button className="btn small" disabled={!to.length} onClick={() => post("feedback_request")}>Ask for feedback</button>
        </div>
      )}
    </div>
  );
}
