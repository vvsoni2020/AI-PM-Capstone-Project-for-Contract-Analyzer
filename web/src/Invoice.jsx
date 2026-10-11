import { useEffect, useState } from "react";
import { api } from "./api.js";
import { Spinner, fmtDate, money, useApp } from "./ui.jsx";

// Invoice setup card for a signed contract (added 10 Oct).
// Rules only, no AI: US clients -> AtliQ Inc, every other region -> AtliQ Technologies Pvt Ltd.
// Draft for finance: ACA never issues or sends an invoice.
export default function Invoice({ id }) {
  const { onError } = useApp();
  const [c, setC] = useState(null);
  useEffect(() => { api.data("invoice", { id }).then(setC).catch(onError); }, [id, onError]);
  if (!c) return <Spinner label="Preparing the invoice setup" />;
  const d = c.doc;
  return (
    <>
      <div className="page-head">
        <div>
          <p className="small"><a href={`#/contract/${d.id}`}>← {d.counterparty}</a> · <a href="#/">Signed Contract History</a></p>
          <h1>Invoice setup</h1>
          <p>{d.counterparty} · {d.doc_type}{d.tracker_id ? ` · ${d.tracker_id}` : ""} · signed {fmtDate(d.signed_on)}</p>
        </div>
        {c.billable && <button className="btn" onClick={() => window.print()}>Print / save as PDF</button>}
      </div>

      {c.warnings.length > 0 && (
        <div className="panel" style={{ borderColor: "#d9822b", background: "#fff8ef" }}>
          <h3>Check before invoicing</h3>
          <ul>{c.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
        </div>
      )}

      {!c.billable ? (
        <div className="panel">
          <h3>No AtliQ invoice for this document</h3>
          <p>{c.reason}</p>
          <p className="small muted">AtliQ's role: {c.atliq_role}</p>
        </div>
      ) : (
        <div className="panel invoice">
          <div className="grid2">
            <div>
              <span className="small muted">INVOICE FROM (issuing entity)</span>
              <h2 style={{ margin: "4px 0" }}>{c.issuer.name}</h2>
              <div className="small">{c.issuer.type}</div>
              <div>{c.issuer.address}</div>
              {c.issuer.ids.map(([k, v]) => <div key={k}><b>{k}</b> {v}</div>)}
              <div className="small muted" style={{ marginTop: 6 }}>Authorized signatory: {c.issuer.signatory}</div>
            </div>
            <div>
              <span className="small muted">BILL TO</span>
              <h2 style={{ margin: "4px 0" }}>{c.bill_to.name}</h2>
              <div>{c.bill_to.country || "Country not recorded"}</div>
              <div className="small muted" style={{ marginTop: 6 }}>Billing address and tax ID: from the contract's party clause / client's finance team</div>
            </div>
          </div>
          <hr />
          <div className="kv">
            <div><span>Why this entity</span>{c.rule}</div>
            <div><span>AtliQ entity named in the contract</span>{c.contract_entity || "Not stated"}</div>
            <div><span>Tax regime</span>{c.issuer.tax}</div>
            <div><span>Invoice currency</span>{c.currency} <span className="small muted">(entity allows {c.issuer.currencies.join(", ")})</span></div>
            <div><span>Contract value (tracker)</span>{money(d.value_usd)}</div>
            <div><span>Contract term ends</span>{d.expiry ? fmtDate(d.expiry) : "Not set in tracker"}</div>
            <div><span>Payment terms</span>{c.payment_terms ? `${c.payment_terms.days} days` : "Not found – check the contract"}</div>
            <div><span>Bank account</span>Per finance – not stored in ACA</div>
            <div><span>POC</span>{d.poc || "–"}</div>
          </div>
          {c.payment_terms && (
            <p className="small" style={{ marginTop: 12 }}>
              <span className="muted">Payment clause found in the contract (verify):</span><br />“{c.payment_terms.quote}”
            </p>
          )}
        </div>
      )}
      <p className="note">{c.note}</p>
    </>
  );
}
