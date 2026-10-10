// Calls to the ACA backend. Every call carries who is acting (and the shared passcode, if set).
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
};
export const session = {
  get user() { return store.get("aca_user") || "KD"; },
  set user(v) { store.set("aca_user", v); },
  get passcode() { return store.get("aca_passcode") || ""; },
  set passcode(v) { store.set("aca_passcode", v); },
};

async function call(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json", "x-aca-user": session.user, "x-aca-passcode": session.passcode },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data;
  try { data = await res.json(); } catch { data = { error: `Server returned ${res.status}` }; }
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  data: (view, params = {}) => call("GET", `/api/data?${new URLSearchParams({ view, ...params })}`),
  action: (body) => call("POST", "/api/action", body),
  review: (doc_id) => call("POST", "/api/review", { doc_id }),
  extract: (doc_id) => call("POST", "/api/extract", { doc_id }),
  intake: (body) => call("POST", "/api/intake", body),
};

export const USERS = ["KD", "Bhavin", "Dhaval", "Jay", "Pranav"];
export const USER_NAMES = { KD: "Karandeep (KD)", Bhavin: "Bhavin", Dhaval: "Dhaval", Jay: "Jay", Pranav: "Pranav" };
