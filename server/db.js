// Tiny storage layer for the Node.js data API (mirror of aca/db.py).
// Supabase (PostgREST) on Vercel; JSON files in ACA_LOCAL_DB (default ./.localdb) locally.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, "+00:00");

class LocalDB {
  constructor(root) {
    this.root = root || process.env.ACA_LOCAL_DB || path.join(process.cwd(), ".localdb");
    fs.mkdirSync(this.root, { recursive: true });
  }
  _p(t) { return path.join(this.root, `${t}.json`); }
  _load(t) { try { return JSON.parse(fs.readFileSync(this._p(t), "utf8")); } catch { return []; } }
  _save(t, rows) { const tmp = this._p(t) + ".tmpn"; fs.writeFileSync(tmp, JSON.stringify(rows, null, 1)); fs.renameSync(tmp, this._p(t)); }
  async select(t, { eq = {}, order, desc = false, limit, columns } = {}) {
    let rows = this._load(t).filter((r) => Object.entries(eq).every(([k, v]) => r[k] === v));
    if (order) rows.sort((a, b) => ((a[order] ?? "") < (b[order] ?? "") ? -1 : (a[order] ?? "") > (b[order] ?? "") ? 1 : 0) * (desc ? -1 : 1));
    if (limit) rows = rows.slice(0, limit);
    if (columns) rows = rows.map((r) => Object.fromEntries(columns.map((c) => [c, r[c]])));
    return rows;
  }
  async insert(t, row) {
    const data = this._load(t);
    const r = { ...row };
    if (t === "audit_log") r.id = r.id ?? data.length + 1; else r.id = r.id ?? crypto.randomUUID();
    r.created_at = r.created_at ?? nowIso();
    data.push(r);
    this._save(t, data);
    return r;
  }
  async update(t, eq, patch) {
    if (t === "audit_log") throw new Error("audit_log is append-only");
    const data = this._load(t);
    const out = [];
    for (const r of data) if (Object.entries(eq).every(([k, v]) => r[k] === v)) { Object.assign(r, patch); out.push(r); }
    this._save(t, data);
    return out;
  }
}

class SupabaseDB {
  constructor(url, key) { this.base = url.replace(/\/$/, "") + "/rest/v1/"; this.key = key; }
  async _req(method, t, params = {}, body, prefer) {
    const qs = new URLSearchParams(params).toString();
    const res = await fetch(this.base + t + (qs ? "?" + qs : ""), {
      method,
      headers: { apikey: this.key, Authorization: `Bearer ${this.key}`, "Content-Type": "application/json", ...(prefer ? { Prefer: prefer } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Supabase ${method} ${t} failed: ${res.status} ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : [];
  }
  _filters(eq) {
    const p = {};
    for (const [k, v] of Object.entries(eq || {})) p[k] = v === null ? "is.null" : `eq.${v}`;
    return p;
  }
  async select(t, { eq, order, desc = false, limit, columns } = {}) {
    const p = { select: columns ? columns.join(",") : "*", ...this._filters(eq) };
    if (order) p.order = `${order}.${desc ? "desc" : "asc"}`;
    if (limit) p.limit = String(limit);
    return this._req("GET", t, p);
  }
  async insert(t, row) {
    const r = { ...row };
    if (t !== "audit_log") r.id = r.id ?? crypto.randomUUID();
    r.created_at = r.created_at ?? nowIso();
    const out = await this._req("POST", t, {}, [r], "return=representation");
    return out[0];
  }
  async update(t, eq, patch) {
    if (t === "audit_log") throw new Error("audit_log is append-only");
    return this._req("PATCH", t, this._filters(eq), patch, "return=representation");
  }
}

let _db;
export function getDb() {
  if (!_db) {
    const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
    if (!(SUPABASE_URL && SUPABASE_SERVICE_KEY) && process.env.VERCEL) {
      throw new Error("Storage is not set up: add SUPABASE_URL and SUPABASE_SERVICE_KEY in Vercel → Settings → Environment Variables, then redeploy.");
    }
    _db = SUPABASE_URL && SUPABASE_SERVICE_KEY ? new SupabaseDB(SUPABASE_URL, SUPABASE_SERVICE_KEY) : new LocalDB();
  }
  return _db;
}

export async function audit(actor, action, target = null, details = {}) {
  return getDb().insert("audit_log", { actor: actor || "system", action, target, details });
}

export { nowIso };
export const storageLabel = () => (process.env.SUPABASE_URL ? "Supabase" : "local files (development only)");
