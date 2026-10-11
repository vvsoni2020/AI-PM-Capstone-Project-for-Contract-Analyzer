import { usSpelling } from "./glossary.js";
import { useCallback, useEffect, useState } from "react";
import { api } from "./api.js";
import { Elapsed, fmtDate, Spinner, useApp } from "./ui.jsx";

const TYPE = {
  non_compete: "Non-compete", exclusivity: "Exclusivity", mfn_pricing: "Most-favored pricing", ip_assignment: "IP handed over",
  ip_licence_retained: "IP kept by someone else", no_hire: "No-hire / non-solicit", data_location: "Data location",
  subcontracting_limit: "Subcontracting limit", consent_or_waiver: "Consent or waiver", other_restriction: "Other restriction",
};
const IMPORTANT = ["non_compete", "exclusivity", "mfn_pricing", "consent_or_waiver", "ip_assignment", "ip_licence_retained"];

export default function Register() {
  const { isKD, onError, notify, user } = useApp();
  const [data, setData] = useState(null);
  const [filter, setFilter] = useState("key");
  const [running, setRunning] = useState(null);
  const [progress, setProgress] = useState("");
  const load = useCallback(() => api.data("register").then(setData).catch(onError), [onError]);
  useEffect(() => { load(); }, [load]);

  const extractAll = async () => {
    const todo = data.signed_contracts.filter((d) => !d.register_extracted_at);
    const list = todo.length ? todo : data.signed_contracts;
    setRunning(Date.now());
    let done = 0;
    const pool = [...list];
    const worker = async () => {
      while (pool.length) {
        const d = pool.shift();
        try { await api.extract(d.id); } catch (e) { onError(e); }
        done += 1; setProgress(`${done} of ${list.length} contracts`);
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    setRunning(null); setProgress(""); notify("Extraction finished – KD to confirm each entry"); load();
  };
  const [rejecting, setRejecting] = useState(null);
  const [note, setNote] = useState("");
  const act = async (e, type) => {
    try { await api.action({ type, entry_id: e.id, note }); setRejecting(null); setNote(""); load(); } catch (err) { onError(err); }
  };

  if (!data) return <Spinner label="Loading the register" />;
  const all = data.entries;
  const shown = all.filter((e) => filter === "all" || (filter === "key" ? IMPORTANT.includes(e.type) : e.status === filter));
  const bySource = {};
  for (const e of shown) (bySource[e.source_file] ||= []).push(e);
  const count = (s) => all.filter((e) => e.status === s).length;
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Commitments register</h1>
          <p>What AtliQ has already promised in its signed contracts: non-competes, exclusivity, pricing promises, IP handed over, no-hire. ACA extracts each entry with its clause; an entry counts once KD confirms it. Every new draft is checked against this list.</p>
        </div>
        {running ? <Elapsed start={running} hint={progress || "extracting"} />
          : <button className="btn primary" onClick={extractAll} disabled={!data.signed_contracts.length}>
            {data.signed_contracts.some((d) => !d.register_extracted_at) ? `Extract from ${data.signed_contracts.filter((d) => !d.register_extracted_at).length} signed contracts` : "Extract again from all signed contracts"}
          </button>}
      </div>
      <p className="small">
        <b>{all.length}</b> entries from {data.signed_contracts.filter((d) => d.register_extracted_at).length} of {data.signed_contracts.length} signed contracts ·{" "}
        <b>{count("confirmed")}</b> confirmed by KD · <b>{count("pending")}</b> waiting for KD · {count("rejected")} rejected
        {!isKD && count("pending") > 0 && <span className="muted"> · only KD can confirm entries</span>}
      </p>
      <div className="risk-actions" role="group" aria-label="Filter">
        {[["key", "Restrictions that limit new deals"], ["pending", "Waiting for KD"], ["confirmed", "Confirmed"], ["all", "All entries"]].map(([k, l]) => (
          <button key={k} className={`btn small ${filter === k ? "primary" : ""}`} onClick={() => setFilter(k)} aria-pressed={filter === k}>{l}</button>
        ))}
      </div>
      {all.length === 0 && <div className="panel" style={{ marginTop: 16 }}><h2>The register is empty</h2><p>Extract obligations from the signed contracts to build it. Until then, drafts can't be checked against what AtliQ already signed.</p></div>}
      {Object.entries(bySource).map(([src, entries]) => (
        <section className="panel" key={src} style={{ marginTop: 16 }}>
          <div className="panel-title"><h2>{entries[0].source_counterparty}</h2><span className="small muted">{entries[0].source_title} · signed {fmtDate(entries[0].source_signed_date)}</span></div>
          {entries.map((e) => (
            <div className="reg-entry" key={e.id}>
              <div>
                <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                  <b>{TYPE[e.type] || e.type}</b>
                  <span className={`reg-status ${e.status}`}>{e.status === "pending" ? "Waiting for KD" : e.status === "confirmed" ? `Confirmed by ${e.confirmed_by}` : "Rejected"}</span>
                  {e.binds_affiliates && <span className="tag petrol">Binds Affiliates (both entities)</span>}
                  {e.needs_kd_check && <span className="tag check">KD to check</span>}
                </div>
                <p style={{ margin: "6px 0" }}>{usSpelling(e.summary)}</p>
                <div className="small muted">
                  {e.clause_ref} · {e.start_date ? fmtDate(e.start_date) : "?"} to {e.end_date ? fmtDate(e.end_date) : "no end date"}{e.end_rule ? ` (${usSpelling(e.end_rule)})` : ""}
                  {(e.regions || []).length > 0 && <> · {e.regions.join(", ")}</>}{(e.sectors || []).length > 0 && <> · {e.sectors.join(", ")}</>}
                </div>
                <details style={{ marginTop: 6 }}>
                  <summary className="small" style={{ fontWeight: 500 }}>Clause text {e.quote_verified ? <span className="verified">verified</span> : <span className="tag check">not verified</span>}</summary>
                  <blockquote className="quote"><mark>{e.quote}</mark></blockquote>
                  {e.note && <p className="small muted">{usSpelling(e.note)}</p>}
                </details>
                {e.kd_note && <p className="small muted">KD: {e.kd_note}</p>}
              </div>
              {isKD && e.status === "pending" && (rejecting === e.id ? (
                <div style={{ display: "flex", gap: 6, alignItems: "flex-start", flexWrap: "wrap", maxWidth: 260 }}>
                  <input type="text" placeholder="Why is this entry wrong?" value={note} onChange={(ev) => setNote(ev.target.value)} aria-label="Reason" />
                  <button className="btn small primary" disabled={!note.trim()} onClick={() => act(e, "register_reject")}>Reject entry</button>
                  <button className="btn small" onClick={() => setRejecting(null)}>Cancel</button>
                </div>
              ) : (
                <div style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
                  <button className="btn small primary" onClick={() => act(e, "register_confirm")}>Confirm</button>
                  <button className="btn small" onClick={() => { setRejecting(e.id); setNote(""); }}>Reject</button>
                </div>
              ))}
            </div>
          ))}
        </section>
      ))}
      <p className="small muted" style={{ marginTop: 16 }}>Acting as {user}. Dates are as written in the contracts; ACA never decides on its own that a restriction has ended.</p>
    </>
  );
}
