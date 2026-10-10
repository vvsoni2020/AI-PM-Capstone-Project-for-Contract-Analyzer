import { useEffect, useState } from "react";
import { api, USER_NAMES } from "./api.js";
import { fmtTime, Spinner, useApp } from "./ui.jsx";

const LABEL = {
  import_documents: "Imported documents", contract_received: "Contract received", analysis_run: "Analysis run",
  analysis_failed: "Analysis failed", analysis_stopped_out_of_scope: "Stopped: out of scope", register_extracted: "Obligations extracted",
  register_confirmed: "Register entry confirmed", register_rejected: "Register entry rejected", comment_added: "Comment added",
  feedback_requested: "Feedback requested", decision_recorded: "Decision recorded", marked_signed: "Marked Signed (signed outside ACA)",
  flag_dismiss: "Flag dismissed", flag_wrong: "Flag marked wrong", flag_useful: "Flag marked useful", flag_restore: "Flag restored",
  metadata_updated: "Deal details changed",
};

function summary(e) {
  const d = e.details || {};
  switch (e.action) {
    case "analysis_run": return `${d.top_risks} top risks, ${d.flags} flags, ${d.removed_by_citation_check} removed by citation check · ${d.seconds} s · $${d.cost_usd} · sent ${(d.outbound_calls || []).map((c) => c.chars).reduce((a, b) => a + b, 0).toLocaleString()} masked characters in ${(d.outbound_calls || []).length} calls · withheld lines: ${d.withheld_lines}`;
    case "register_extracted": return `${d.entries} entries · $${d.cost_usd}`;
    case "decision_recorded": return `${d.decision}${d.note ? " – " + d.note : ""}`;
    case "flag_dismiss": case "flag_wrong": return `${d.flag_id}: ${d.reason}`;
    case "register_confirmed": case "register_rejected": return d.summary;
    case "import_documents": return `${d.added} added, ${d.updated} updated`;
    default: return Object.keys(d).length ? JSON.stringify(d).slice(0, 160) : "";
  }
}

export default function Audit() {
  const { onError } = useApp();
  const [rows, setRows] = useState(null);
  useEffect(() => { api.data("audit").then((d) => setRows(d.entries)).catch(onError); }, [onError]);
  if (!rows) return <Spinner label="Loading the audit log" />;
  return (
    <>
      <div className="page-head"><div><h1>Audit log</h1><p>Who did what, and when: every upload, analysis, flag decision, register change and signing record. Entries can't be edited or deleted.</p></div></div>
      <div className="table-wrap">
        <table className="qtable">
          <thead><tr><th>When</th><th>Who</th><th>What</th><th className="hide-sm">Details</th></tr></thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.id}>
                <td className="nowrap small">{fmtTime(e.created_at)}</td>
                <td>{USER_NAMES[e.actor] || e.actor}</td>
                <td>{e.target ? <a href={`#/contract/${e.target}`}>{LABEL[e.action] || e.action}</a> : LABEL[e.action] || e.action}</td>
                <td className="small muted hide-sm">{summary(e)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
