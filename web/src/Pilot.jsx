import { useCallback, useEffect, useState } from "react";
import { api } from "./api.js";
import { Spinner, fmtTime, useApp } from "./ui.jsx";

const pct = (v) => (v === null || v === undefined ? "–" : `${Math.round(v * 100)}%`);

// Pilot metrics: visible to everyone, so the pilot's progress is open to the whole team.
export default function Pilot() {
  const { onError } = useApp();
  const [m, setM] = useState(null);
  const load = useCallback(() => api.data("pilot").then(setM).catch(onError), [onError]);
  useEffect(() => { load(); }, [load]);

  if (!m) return <Spinner label="Loading pilot metrics" />;
  const { targets } = m;
  const precisionOk = m.precision !== null && m.precision >= targets.precision;
  const wrongOk = m.wrong_rate !== null && m.wrong_rate <= targets.wrong;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Pilot metrics</h1>
          <p>How accurate ACA's top-3 flags are, based on the Useful, Dismiss and Mark wrong clicks in each brief. Visible to everyone.</p>
        </div>
        <button className="btn small" onClick={load}>Refresh</button>
      </div>

      <section className="panel" aria-label="Headline metrics">
        <div className="grid3">
          <div className="metric">
            <span className="small muted">Precision (Useful + Dismissed)</span>
            <b className={precisionOk ? "ok" : "warn"}>{pct(m.precision)}</b>
            <span className="small muted">target ≥ {pct(targets.precision)}</span>
          </div>
          <div className="metric">
            <span className="small muted">Marked wrong</span>
            <b className={wrongOk ? "ok" : "warn"}>{pct(m.wrong_rate)}</b>
            <span className="small muted">target ≤ {pct(targets.wrong)}</span>
          </div>
          <div className="metric">
            <span className="small muted">Coverage</span>
            <b>{m.reviewed} of {m.shown}</b>
            <span className="small muted">top-3 flags acted on, across {m.contracts} contracts</span>
          </div>
        </div>
        <p className="small muted">Counts: {m.counts.useful} useful · {m.counts.dismiss} dismissed · {m.counts.wrong} marked wrong. Recall for conflicts is checked against the known test cases, not here.</p>
      </section>

      <section className="panel" aria-label="By category">
        <div className="panel-title"><h2>By category</h2></div>
        {m.by_category.length === 0 ? <p className="muted">No flags acted on yet.</p> : (
          <div className="table-wrap"><table className="qtable">
            <thead><tr><th>Category</th><th>Useful</th><th>Dismissed</th><th>Marked wrong</th><th>Precision</th></tr></thead>
            <tbody>
              {m.by_category.map((c) => {
                const n = c.useful + c.dismiss + c.wrong;
                return (
                  <tr key={c.label}>
                    <td>{c.label}</td><td>{c.useful}</td><td>{c.dismiss}</td><td>{c.wrong}</td>
                    <td>{pct(n ? (c.useful + c.dismiss) / n : null)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        )}
      </section>

      <section className="panel" aria-label="Flags marked wrong">
        <div className="panel-title"><h2>Flags marked wrong</h2><span className="small muted">Latest first; the reason shows what to fix</span></div>
        {m.wrong_flags.length === 0 ? <p className="muted">No flags marked wrong yet.</p> : (
          <ul className="wronglist">
            {m.wrong_flags.map((w, i) => (
              <li key={i}>
                <b>{w.counterparty}</b> · {w.title}
                <div className="small">Reason: {w.reason || "–"} <span className="muted">({w.by}, {fmtTime(w.at)})</span></div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
