"""Tiny storage layer with no packages.

- On Vercel: Supabase (PostgREST over HTTPS) using SUPABASE_URL + SUPABASE_SERVICE_KEY.
- Locally / in tests: JSON files in ACA_LOCAL_DB (default ./.localdb).

Only the operations ACA needs: select with equality filters, insert, update. The audit log is
append-only: there is no update or delete path for it here, and Supabase blocks it with a trigger.
"""
import json
import os
import threading
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timezone

TABLES = ("docs", "reviews", "register", "comments", "flag_actions", "audit_log")
_lock = threading.Lock()


def now_iso():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class LocalDB:
    def __init__(self, root=None):
        self.root = root or os.environ.get("ACA_LOCAL_DB", os.path.join(os.getcwd(), ".localdb"))
        os.makedirs(self.root, exist_ok=True)

    def _path(self, table):
        return os.path.join(self.root, table + ".json")

    def _load(self, table):
        p = self._path(table)
        if not os.path.exists(p):
            return []
        with open(p, encoding="utf-8") as f:
            return json.load(f)

    def _save(self, table, rows):
        tmp = self._path(table) + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(rows, f, ensure_ascii=False, indent=1)
        os.replace(tmp, self._path(table))

    def select(self, table, eq=None, order=None, desc=False, limit=None, columns=None):
        with _lock:
            rows = self._load(table)
        if eq:
            rows = [r for r in rows if all(r.get(k) == v for k, v in eq.items())]
        if order:
            rows = sorted(rows, key=lambda r: (r.get(order) is None, r.get(order) or ""), reverse=desc)
        if limit:
            rows = rows[:limit]
        if columns:
            rows = [{c: r.get(c) for c in columns} for r in rows]
        return rows

    def insert(self, table, rows):
        single = isinstance(rows, dict)
        rows = [rows] if single else list(rows)
        out = []
        with _lock:
            data = self._load(table)
            for r in rows:
                r = dict(r)
                if table == "audit_log":
                    r.setdefault("id", len(data) + 1)
                else:
                    r.setdefault("id", str(uuid.uuid4()))
                r.setdefault("created_at", now_iso())
                data.append(r)
                out.append(r)
            self._save(table, data)
        return out[0] if single else out

    def update(self, table, eq, patch):
        if table == "audit_log":
            raise PermissionError("audit_log is append-only")
        out = []
        with _lock:
            data = self._load(table)
            for r in data:
                if all(r.get(k) == v for k, v in eq.items()):
                    r.update(patch)
                    out.append(r)
            self._save(table, data)
        return out


class SupabaseDB:
    def __init__(self, url, key):
        self.base = url.rstrip("/") + "/rest/v1/"
        self.key = key

    def _req(self, method, table, params=None, body=None, prefer=None):
        url = self.base + table
        if params:
            url += "?" + urllib.parse.urlencode(params, safe="*,.()")
        headers = {
            "apikey": self.key,
            "Authorization": "Bearer " + self.key,
            "Content-Type": "application/json",
        }
        if prefer:
            headers["Prefer"] = prefer
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(url, data=data, method=method, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                raw = resp.read()
                return json.loads(raw) if raw else []
        except urllib.error.HTTPError as e:
            raise RuntimeError(f"Supabase {method} {table} failed: {e.code} {e.read()[:300]!r}")

    @staticmethod
    def _filters(eq):
        params = {}
        for k, v in (eq or {}).items():
            if v is None:
                params[k] = "is.null"
            elif isinstance(v, bool):
                params[k] = "eq." + ("true" if v else "false")
            else:
                params[k] = "eq." + str(v)
        return params

    def select(self, table, eq=None, order=None, desc=False, limit=None, columns=None):
        params = {"select": ",".join(columns) if columns else "*"}
        params.update(self._filters(eq))
        if order:
            params["order"] = f"{order}.{'desc' if desc else 'asc'}"
        if limit:
            params["limit"] = str(limit)
        return self._req("GET", table, params)

    def insert(self, table, rows):
        single = isinstance(rows, dict)
        payload = [dict(r) for r in ([rows] if single else rows)]
        for r in payload:
            if table != "audit_log":
                r.setdefault("id", str(uuid.uuid4()))
            r.setdefault("created_at", now_iso())
        out = self._req("POST", table, body=payload, prefer="return=representation")
        return out[0] if single else out

    def update(self, table, eq, patch):
        if table == "audit_log":
            raise PermissionError("audit_log is append-only")
        return self._req("PATCH", table, self._filters(eq), body=patch, prefer="return=representation")


_db = None


def get_db():
    global _db
    if _db is None:
        url, key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_SERVICE_KEY")
        if not (url and key) and os.environ.get("VERCEL"):
            raise RuntimeError("Storage is not set up: add SUPABASE_URL and SUPABASE_SERVICE_KEY in Vercel → Settings → "
                               "Environment Variables, then redeploy.")
        _db = SupabaseDB(url, key) if url and key else LocalDB()
    return _db


def audit(actor, action, target=None, details=None):
    """Append one entry to the audit log (who, when, what). Never edited or deleted."""
    return get_db().insert("audit_log", {
        "actor": actor or "system",
        "action": action,
        "target": target,
        "details": details or {},
    })
