// POST /api/action  {type, ...}  every human action, audit-logged (Node.js function on Vercel)
import { authenticate, HttpError, postAction } from "../server/api.js";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") throw new HttpError(405, "POST only");
    const user = authenticate(req.headers);
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    res.status(200).json(await postAction(body, user));
  } catch (e) {
    res.status(e instanceof HttpError ? e.status : 500).json({ error: e.message });
  }
}
