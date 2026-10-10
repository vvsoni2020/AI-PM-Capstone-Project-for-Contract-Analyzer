// GET /api/data?view=queue|doc|register|audit|outbound|stats  (Node.js function on Vercel)
import { authenticate, getData, HttpError } from "../server/api.js";

export default async function handler(req, res) {
  try {
    const user = authenticate(req.headers);
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json(await getData(req.query || {}, user));
  } catch (e) {
    res.status(e instanceof HttpError ? e.status : 500).json({ error: e.message });
  }
}
