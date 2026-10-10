import { createContext, useContext, useEffect, useState } from "react";

export const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

const SEV_LABEL = { critical: "Critical", high: "High", medium: "Medium", low: "Low" };
export function Sev({ s }) {
  if (!s) return <span className="sev clean">No top risk</span>;
  return <span className={`sev ${s}`}>{SEV_LABEL[s] || s}</span>;
}

const RES_LABEL = { pass: "Pass", flag: "Flagged", needs_kd_check: "KD to check", not_applicable: "Not applicable", not_run: "Not run" };
export function Res({ r }) {
  return <span className={`res ${r}`}>{RES_LABEL[r] || r}</span>;
}

export const CATEGORY_LABEL = {
  commitment_conflict: "Collides with a signed contract",
  healthcare_bundle: "Healthcare paperwork",
  exposure: "Uncapped or disproportionate exposure",
  clause_risk: "Against KD's positions",
  mutuality: "Not truly mutual",
  fairness: "Unfair to the other side",
  flowdown: "Client obligations not passed down",
  entity_law: "Entity, law or invoicing",
  unusual_instruction: "Unusual instruction in the text",
};
export const SOURCE_LABEL = {
  register_entry: "Already signed",
  signed_contract: "Already signed",
  kd_position: "KD's position",
  incident: "Past incident",
  linked_document: "Linked deal document",
  rule: "Fixed rule",
  none: "Contract text only",
};

export function fmtDate(d) {
  if (!d) return "–";
  const dt = new Date(d.length <= 10 ? d + "T00:00:00" : d);
  if (Number.isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}
export function fmtTime(d) {
  if (!d) return "";
  const dt = new Date(d);
  return dt.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
export function money(v) {
  if (v === null || v === undefined || v === "") return "–";
  return "$" + Number(v).toLocaleString("en-US", { maximumFractionDigits: 0 });
}
export function Deadline({ d, days }) {
  if (!d) return <span className="muted">No date</span>;
  const cls = days !== null && days < 0 ? "overdue" : days !== null && days <= 3 ? "soon" : "";
  const txt = days === null ? "" : days < 0 ? `${-days} days late` : days === 0 ? "today" : `${days} days left`;
  return (
    <span>
      {fmtDate(d)}
      <br />
      <span className={`small ${cls}`}>{txt}</span>
    </span>
  );
}

export function Spinner({ label }) {
  return <span className="progress"><span className="spinner" aria-hidden="true" /> {label}</span>;
}

export function Elapsed({ start, hint }) {
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 1000); return () => clearInterval(t); }, []);
  const s = Math.round((Date.now() - start) / 1000);
  return <Spinner label={`${s} s${hint ? " · " + hint : ""}`} />;
}

export function Toast({ toast }) {
  if (!toast) return null;
  return <div role="status" className={`toast ${toast.err ? "err" : ""}`}>{toast.msg}</div>;
}

export function Modal({ title, children, onClose }) {
  useEffect(() => {
    const k = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}
