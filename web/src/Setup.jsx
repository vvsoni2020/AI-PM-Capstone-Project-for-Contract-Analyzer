import { useCallback, useEffect, useState } from "react";
import { api, session } from "./api.js";
import { Spinner, useApp } from "./ui.jsx";

// Deliverable #4 (cost estimate, Median case, Claude Sonnet 5.5)
const ESTIMATE = { per_review: 0.16, seconds: 300 };

export default function Setup() {
  const { onError, notify } = useApp();
  const [stats, setStats] = useState(null);
  const [busy, setBusy] = useState("");
  const [pass, setPass] = useState(session.passcode);
  const load = useCallback(() => api.data("stats").then(setStats).catch(onError), [onError]);
  useEffect(() => { load(); }, [load]);

  const importFolder = async (fileList) => {
    const files = [...fileList].filter((f) => /\.(md|csv|txt)$/i.test(f.name) && !/key|secret|\.env/i.test(f.name));
    if (!files.length) return notify("No .md or .csv files found in that folder", true);
    setBusy(`Reading ${files.length} files`);
    try {
      const payload = await Promise.all(files.map(async (f) => ({ path: (f.webkitRelativePath || f.name).split("/").slice(1).join("/") || f.name, text: await f.text() })));
      setBusy(`Importing ${payload.length} files`);
      const r = await api.intake({ mode: "dataset", files: payload });
      notify(`Imported: ${r.added} added, ${r.updated} updated`);
      load();
    } catch (e) { onError(e); } finally { setBusy(""); }
  };

  const importBundled = async () => {
    setBusy("Loading the AtliQ dataset");
    try {
      const r = await api.intake({ mode: "bundled" });
      notify(`Dataset loaded: ${r.added} added, ${r.updated} updated`);
      load();
    } catch (e) { onError(e); } finally { setBusy(""); }
  };

  const importSamples = async () => {
    setBusy("Adding the edge-case test contracts");
    try {
      const list = await (await fetch("/samples/index.json")).json();
      let n = 0, failed = 0;
      for (const s of list) {
        try {
          const blob = await (await fetch(`/samples/${s.file}`)).blob();
          const b64 = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob); });
          await api.intake({ mode: "upload", filename: s.file, content_b64: b64, meta: s.meta || {} });
          n += 1;
        } catch { failed += 1; }
      }
      notify(`${n} edge-case contracts added to the queue${failed ? ` (${failed} could not be added)` : ""}`);
    } catch (e) { onError(e); } finally { setBusy(""); }
  };

  return (
    <>
      <div className="page-head"><div><h1>Setup and costs</h1><p>Load AtliQ's documents, add the edge-case test contracts, and compare what analyses really cost with the cost estimate.</p></div></div>
      <div className="stack">
        <section className="panel">
          <h2>1. Load the AtliQ dataset</h2>
          <p>The synthetic AtliQ dataset ships with the app and loads automatically the first time the queue opens. Use these buttons to load it again, or to load your own copy of the folder. ACA reads the signed contracts, incoming drafts, KD's checklist, the negotiation notes, the meeting notes, the entity sheet and the tracker (for POC, deadline and value). Loading again updates files with the same name.</p>
          {busy ? <Spinner label={busy} /> : (<>
            <button className="btn primary" onClick={importBundled} style={{ marginRight: 8 }}>Load the included dataset</button>
            <label className="btn" style={{ display: "inline-block" }}>
              Choose a Dataset folder
              <input type="file" webkitdirectory="" directory="" multiple onChange={(e) => importFolder(e.target.files)} style={{ display: "none" }} />
            </label>
          </>)}
          <p className="small muted" style={{ marginTop: 8 }}>Files with “key” or “secret” in the name are skipped.</p>
        </section>
        <section className="panel">
          <h2>2. Build the commitments register</h2>
          <p>Go to the <a href="#/register">Commitments register</a> and extract obligations from the signed contracts, then confirm each entry as KD.</p>
        </section>
        <section className="panel">
          <h2>3. Add the edge-case test contracts</h2>
          <p>Four synthetic contracts written for ACA's tests: a contract with an instruction aimed at the AI, a healthcare SOW with a patient-data extract pasted in, a Dubai hotel deal forwarded by email, and a $24k deal with $500k liability. They are described in the README.</p>
          <button className="btn" onClick={importSamples} disabled={!!busy}>Add the edge-case contracts</button>
        </section>
        <section className="panel">
          <h2>What analyses really cost</h2>
          {!stats ? <Spinner label="Loading" /> : (
            <>
              <div style={{ margin: "8px 0 12px" }}>
                <span className="stat"><b>{stats.analyses}</b><span className="small muted">analyses run</span></span>
                <span className="stat"><b>${stats.avg_cost_usd}</b><span className="small muted">average per contract (estimate ${ESTIMATE.per_review})</span></span>
                <span className="stat"><b>{stats.avg_seconds} s</b><span className="small muted">average time (target under {ESTIMATE.seconds / 60} min)</span></span>
                <span className="stat"><b>${stats.total_cost_usd}</b><span className="small muted">total spent</span></span>
              </div>
              <p className="small muted">{(stats.input_tokens || 0).toLocaleString()} input and {(stats.output_tokens || 0).toLocaleString()} output tokens so far. Slowest analysis: {stats.max_seconds} s. Storage: {stats.storage}.</p>
            </>
          )}
        </section>
        <section className="panel">
          <h2>Access passcode</h2>
          <p className="small">If the deployment sets a passcode, every request must carry it. It is stored only in this browser.</p>
          <form onSubmit={(e) => { e.preventDefault(); session.passcode = pass; notify("Passcode saved in this browser"); }} style={{ display: "flex", gap: 8, maxWidth: 420 }}>
            <input type="password" value={pass} onChange={(e) => setPass(e.target.value)} aria-label="Passcode" />
            <button className="btn" type="submit">Save</button>
          </form>
        </section>
      </div>
    </>
  );
}
