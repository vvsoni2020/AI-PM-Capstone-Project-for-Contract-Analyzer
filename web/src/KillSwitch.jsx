// ACA kill switch (decided 10 Oct, Vaibhav). Only KD sees the STOP / START button.
// While ACA is stopped: no contract is sent to ACA, the Top risk column shows "ACA Disabled",
// and each POC checks the contract by hand against every compliance point.
import { useState } from "react";
import { api } from "./api.js";
import { Modal, useApp } from "./ui.jsx";

export const MANUAL_CHECKS = [
  "Commitments in AtliQ's signed contracts (the Commitments register): non-competes, exclusivity, pricing promises, IP, no-hire",
  "KD's positions: liability no more than 1x fees, LD 0.5% per week capped at 5%, client delays excluded, mutual indemnity, payment 30–45 days, governing law matches the signing entity, mutual NDAs only",
  "Entity and invoicing: which AtliQ entity signs, governing law and venue, who is invoiced (US clients: AtliQ Inc; others: AtliQ Technologies Pvt Ltd)",
  "Healthcare and data paperwork: a signed BAA before any patient data moves, DPA and transfer terms, data location",
  "Liability, liquidated damages and indemnity against the contract value",
  "Regulations that apply to the client's country and sector (confirm with counsel)",
];

export function AcaBanner({ enabled }) {
  if (enabled !== false) return null;
  return (
    <div className="panel" style={{ borderColor: "#b42318", background: "#fff5f4", marginBottom: 14 }}>
      <h3 style={{ color: "#b42318" }}>ACA Disabled</h3>
      <p>KD has stopped ACA. No contract is sent to ACA until he starts it again. Review each contract by hand against all of these:</p>
      <ul className="small">{MANUAL_CHECKS.map((c) => <li key={c}>{c}</li>)}</ul>
    </div>
  );
}

export function KillSwitchButton({ enabled, onChanged }) {
  const { isKD, onError, notify } = useApp();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!isKD) return null;
  const on = enabled !== false;
  const toggle = async () => {
    setBusy(true);
    try {
      await api.action({ type: "kill_switch", enabled: !on });
      notify(on ? "ACA stopped" : "ACA started");
      setOpen(false);
      onChanged();
    } catch (e) { onError(e); } finally { setBusy(false); }
  };
  return (
    <>
      <button className={`btn ${on ? "danger" : "primary"}`} onClick={() => setOpen(true)}>{on ? "STOP ACA" : "START ACA"}</button>
      {open && (
        <Modal title={on ? "Stop ACA?" : "Start ACA?"} onClose={() => setOpen(false)}>
          <p>{on
            ? "While ACA is stopped, no contract is sent to ACA. The Top risk column shows ACA Disabled, and each POC reviews contracts by hand against all compliance points. This is logged in the audit log."
            : "ACA will review contracts again, and the Analyze buttons come back. This is logged in the audit log."}</p>
          <div className="risk-actions">
            <button className={`btn ${on ? "danger" : "primary"}`} disabled={busy} onClick={toggle}>{on ? "Stop ACA" : "Start ACA"}</button>
            <button className="btn" onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </Modal>
      )}
    </>
  );
}
