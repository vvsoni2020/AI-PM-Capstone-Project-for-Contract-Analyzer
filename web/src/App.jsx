import { useCallback, useEffect, useState } from "react";
import { api, session, USERS, USER_NAMES } from "./api.js";
import { Ctx, Deadline, Elapsed, Modal, Sev, Spinner, Toast, CATEGORY_LABEL, fmtDate, useApp } from "./ui.jsx";
import Contract from "./Contract.jsx";
import Register from "./Register.jsx";
import Audit from "./Audit.jsx";
import Setup from "./Setup.jsx";
import Invoice from "./Invoice.jsx";

function useHash() {
  const [hash, setHash] = useState(window.location.hash || "#/");
  useEffect(() => {
    const f = () => setHash(window.location.hash || "#/");
    window.addEventListener("hashchange", f);
    return () => window.removeEventListener("hashchange", f);
  }, []);
  return hash;
}

export default function App() {
  const hash = useHash();
  const [user, setUser] = useState(session.user);
  const [toast, setToast] = useState(null);
  const [needPass, setNeedPass] = useState(false);
  const notify = useCallback((msg, err = false) => {
    setToast({ msg, err });
    setTimeout(() => setToast(null), err ? 6000 : 3000);
  }, []);
  const onError = useCallback((e) => {
    if (e.status === 401 && /passcode/i.test(e.message)) setNeedPass(true);
    else notify(e.message, true);
  }, [notify]);
  const changeUser = (u) => { session.user = u; setUser(u); notify(`Now acting as ${USER_NAMES[u]}`); };
  const [route, id] = hash.replace(/^#\//, "").split("/");
  const isKD = user === "KD";
  const ctx = { user, isKD, notify, onError };

  if (needPass) return <PassGate onDone={() => { setNeedPass(false); window.location.reload(); }} />;

  return (
    <Ctx.Provider value={ctx}>
      <header className="topbar">
        <div className="topbar-inner">
          <a className="brand" href="#/"><b>ACA</b><span>Auto Contract Analyzer · AtliQ internal</span></a>
          <nav className="nav" aria-label="Main">
            <a href="#/" className={!route || route === "contract" || route === "invoice" ? "on" : ""}>Contract queue</a>
            <a href="#/register" className={route === "register" ? "on" : ""}>Commitments register</a>
            <a href="#/audit" className={route === "audit" ? "on" : ""}>Audit log</a>
            <a href="#/setup" className={route === "setup" ? "on" : ""}>Setup and costs</a>
          </nav>
          <label className="whoami">
            Acting as
            <select value={user} onChange={(e) => changeUser(e.target.value)} aria-label="Acting as">
              {USERS.map((u) => <option key={u} value={u}>{USER_NAMES[u]}</option>)}
            </select>
          </label>
        </div>
      </header>
      <main className="page">
        {route === "contract" && id ? <Contract id={id} key={id + user} />
          : route === "register" ? <Register key={user} />
          : route === "audit" ? <Audit />
          : route === "setup" ? <Setup />
          : route === "invoice" && id ? <Invoice id={id} key={id} />
          : <Queue key={user} />}
      </main>
      <Toast toast={toast} />
    </Ctx.Provider>
  );
}

function PassGate({ onDone }) {
  const [v, setV] = useState("");
  return (
    <div className="gate panel">
      <h2>Enter the ACA passcode</h2>
      <p className="muted small">ACA is internal to AtliQ. Ask KD for the passcode.</p>
      <form onSubmit={(e) => { e.preventDefault(); session.passcode = v; onDone(); }}>
        <input type="password" value={v} onChange={(e) => setV(e.target.value)} aria-label="Passcode" autoFocus />
        <div style={{ marginTop: 12 }}><button className="btn primary" type="submit">Continue</button></div>
      </form>
    </div>
  );
}

function Queue() {
  const { notify, onError } = useApp();
  const [q, setQ] = useState(null);
  const [adding, setAdding] = useState(false);
  const [running, setRunning] = useState({});
  const [autoLoading, setAutoLoading] = useState(false);
  const load = useCallback(() => api.data("queue").then(setQ).catch(onError), [onError]);
  useEffect(() => { load(); }, [load]);
  // First start: the bundled AtliQ dataset loads itself once, so the queue is never empty in a demo.
  useEffect(() => {
    if (!q || autoLoading) return;
    const isEmpty = !q.analysed.length && !q.waiting.length && !q.out_of_scope.length && !q.rejected.length && !q.counts.signed_contracts;
    if (!isEmpty) return;
    setAutoLoading(true);
    api.intake({ mode: "bundled" }).then((r) => { notify(`AtliQ dataset loaded (${r.added} files)`); load(); }).catch(onError);
  }, [q, autoLoading, load, notify, onError]);

  const analyse = async (ids) => {
    const start = Date.now();
    setRunning((r) => ({ ...r, ...Object.fromEntries(ids.map((i) => [i, start])) }));
    const pool = [...ids];
    const worker = async () => {
      while (pool.length) {
        const id = pool.shift();
        try { await api.review(id); } catch (e) { onError(e); }
        setRunning((r) => { const n = { ...r }; delete n[id]; return n; });
        load();
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    notify(ids.length > 1 ? `${ids.length} contracts analysed` : "Analysis finished");
  };

  if (!q) return <Spinner label="Loading the queue" />;
  const empty = !q.analysed.length && !q.waiting.length && !q.out_of_scope.length && !q.rejected.length && !q.signed_history.length;
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Contract queue</h1>
          <p>Every client and partner contract waiting for KD, most serious risk first, then nearest deadline. Dataset date: {q.today}.</p>
        </div>
        <button className="btn primary" onClick={() => setAdding(true)}>Add a contract</button>
      </div>
      {empty && (
        <div className="panel">
          <h2>{autoLoading ? "Loading the AtliQ dataset…" : "No contracts yet"}</h2>
          <p>The AtliQ dataset loads automatically on first start. You can also load it (signed contracts, drafts, KD's checklist and notes) on the <a href="#/setup">Setup</a> page, or add a single contract.</p>
        </div>
      )}
      {q.counts.signed_contracts > 0 && q.analysed.length + q.waiting.length > 0 && (
        <p className="small muted">Checked against {q.counts.signed_contracts} signed contracts, KD's checklist and negotiation notes, and {q.counts.incidents} meeting notes.</p>
      )}
      {q.waiting.length > 0 && (
        <>
          <div className="section-label"><h2>Waiting for analysis</h2><span className="muted small">{q.waiting.length}</span>
            <button className="btn small" style={{ marginLeft: "auto" }} disabled={Object.keys(running).length > 0}
              onClick={() => analyse(q.waiting.map((d) => d.id))}>Analyse all {q.waiting.length}</button>
          </div>
          <QTable rows={q.waiting} running={running} onAnalyse={(id) => analyse([id])} />
        </>
      )}
      {q.analysed.length > 0 && (
        <>
          <div className="section-label"><h2>Analysed, ranked</h2><span className="muted small">{q.analysed.length}</span></div>
          <QTable rows={q.analysed} ranked running={running} onAnalyse={(id) => analyse([id])} />
        </>
      )}
      {q.rejected.length > 0 && (
        <>
          <div className="section-label"><h2>Rejected</h2><span className="muted small">KD decided not to sign</span></div>
          <QTable rows={q.rejected} />
        </>
      )}
      {q.signed_history.length > 0 && (
        <>
          <div className="section-label"><h2>Signed Contract History</h2>
            <span className="muted small">{q.signed_history.length} signed · newest first · the commitments register is built from these</span></div>
          <HistoryTable rows={q.signed_history} />
        </>
      )}
      {q.out_of_scope.length > 0 && (
        <>
          <div className="section-label"><h2>Out of scope – HR signs</h2><span className="muted small">Freelancer and employee contracts are not reviewed</span></div>
          <QTable rows={q.out_of_scope} />
        </>
      )}
      {adding && <AddContract onClose={() => setAdding(false)} onAdded={(id) => { setAdding(false); window.location.hash = `#/contract/${id}`; }} />}
    </>
  );
}

function QTable({ rows, ranked, running = {}, onAnalyse }) {
  const go = (id) => { window.location.hash = `#/contract/${id}`; };
  return (
    <div className="table-wrap">
      <table className="qtable">
        <thead>
          <tr>
            {ranked && <th>#</th>}
            <th>Contract</th>
            <th>Top risk</th>
            <th className="hide-sm">POC</th>
            <th>Deadline</th>
            <th className="hide-sm">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((d) => (
            <tr key={d.id} className="click" onClick={() => go(d.id)} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && go(d.id)}>
              {ranked && <td className="rank">{d.rank}</td>}
              <td>
                <div className="cp">{d.counterparty}</div>
                <div className="small muted">{d.doc_type}{d.side ? ` · AtliQ as ${d.side}` : ""}</div>
              </td>
              <td>
                {running[d.id] ? <Elapsed start={running[d.id]} hint="analysing" />
                  : d.last_review_id ? (
                    <>
                      <Sev s={d.top_severity} /> {d.flag_count ? <span className="small muted">{d.flag_count} flag{d.flag_count > 1 ? "s" : ""}</span> : null}
                      {(d.top_title || d.top_group) && <div className="risk-title">{d.top_title || CATEGORY_LABEL[groupCat(d.top_group)]}</div>}
                    </>
                  ) : d.scope === "out" ? <span className="small muted">{d.scope_reason}</span>
                  : onAnalyse ? <button className="btn small" onClick={(e) => { e.stopPropagation(); onAnalyse(d.id); }}>Analyse</button> : "–"}
              </td>
              <td className="hide-sm">{d.poc || "–"}</td>
              <td className="nowrap"><Deadline d={d.deadline} days={d.days_left} /></td>
              <td className="hide-sm">{d.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function HistoryTable({ rows }) {
  const go = (id) => { window.location.hash = `#/contract/${id}`; };
  return (
    <div className="table-wrap">
      <table className="qtable">
        <thead>
          <tr>
            <th>Contract</th>
            <th className="hide-sm">AtliQ role</th>
            <th className="hide-sm">AtliQ entity (in contract)</th>
            <th>Signed</th>
            <th className="hide-sm">Expiry</th>
            <th className="hide-sm">Register</th>
            <th className="hide-sm">POC</th>
            <th>Invoice</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((d) => (
            <tr key={d.id} className="click" onClick={() => go(d.id)} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && go(d.id)}>
              <td>
                <div className="cp">{d.counterparty}{d.via_aca && <span className="tag" style={{ marginLeft: 6 }}>via ACA</span>}</div>
                <div className="small muted">{d.doc_type}{d.tracker_id ? ` · ${d.tracker_id}` : ""}</div>
              </td>
              <td className="hide-sm">{d.atliq_role}</td>
              <td className="hide-sm">{d.contract_entity || <span className="muted">Not stated</span>}</td>
              <td className="nowrap">{fmtDate(d.signed_on)}</td>
              <td className="nowrap hide-sm">{d.expiry ? fmtDate(d.expiry) : <span className="muted">Not set</span>}</td>
              <td className="hide-sm">{d.register_extracted_at ? `${d.register_entry_count || 0} entries` : <span className="muted">Not extracted</span>}</td>
              <td className="hide-sm">{d.poc || "–"}</td>
              <td className="nowrap">{d.billable
                ? <a className="btn small" href={`#/invoice/${d.id}`} onClick={(e) => e.stopPropagation()}>Invoice setup</a>
                : <span className="small muted">No fees</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
const groupCat = (g) => ({ 1: "commitment_conflict", 2: "healthcare_bundle", 3: "exposure" })[g] || "clause_risk";

function AddContract({ onClose, onAdded }) {
  const { onError, notify } = useApp();
  const [file, setFile] = useState(null);
  const [meta, setMeta] = useState({ counterparty: "", poc: "", deadline: "", value_usd: "", country: "" });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setMeta((m) => ({ ...m, [k]: e.target.value }));
  const submit = async (e) => {
    e.preventDefault();
    if (!file) return notify("Choose a file first", true);
    setBusy(true);
    try {
      const b64 = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
      const out = await api.intake({ mode: "upload", filename: file.name, content_b64: b64, meta });
      notify(out.scope === "out" ? "Added – out of scope (HR signs)" : "Contract added to the queue");
      onAdded(out.doc_id);
    } catch (err) { onError(err); } finally { setBusy(false); }
  };
  return (
    <Modal title="Add a contract" onClose={onClose}>
      <p className="muted small">Upload the contract (.docx, .md or .txt) or the forwarded email (.eml) with the contract attached. Details you leave blank are taken from the email or added later.</p>
      <form onSubmit={submit}>
        <label className="f" htmlFor="up">Contract or forwarded email</label>
        <input id="up" type="file" accept=".docx,.md,.txt,.eml" onChange={(e) => setFile(e.target.files[0])} />
        <div className="grid2">
          <div><label className="f">Counterparty</label><input type="text" value={meta.counterparty} onChange={set("counterparty")} /></div>
          <div><label className="f">Client country</label><input type="text" value={meta.country} onChange={set("country")} placeholder="e.g. UAE" /></div>
          <div><label className="f">POC</label>
            <select className="input" value={meta.poc} onChange={set("poc")}><option value="">–</option>{USERS.map((u) => <option key={u}>{u}</option>)}</select></div>
          <div><label className="f">Deadline</label><input type="date" value={meta.deadline} onChange={set("deadline")} /></div>
          <div><label className="f">Contract value (USD)</label><input type="number" value={meta.value_usd} onChange={set("value_usd")} /></div>
        </div>
        <div className="risk-actions">
          <button className="btn primary" type="submit" disabled={busy}>{busy ? "Adding…" : "Add to queue"}</button>
          <button className="btn" type="button" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </Modal>
  );
}
