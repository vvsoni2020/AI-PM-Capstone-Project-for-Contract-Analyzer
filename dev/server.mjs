// Local dev server: static files from public/, Node API in-process, Python API proxied.
// Usage: node dev/server.mjs [port]   (needs python3; reads ANTHROPIC_API_KEY or ANTHROPIC_API_KEY_FILE)
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
process.chdir(root);
const { default: dataHandler } = await import("../api/data.js");
const { default: actionHandler } = await import("../api/action.js");
const PORT = Number(process.argv[2] || 3000);
const PY_PORT = PORT + 1;
const py = spawn("python3", [path.join(root, "dev/pyserver.py"), String(PY_PORT)], { stdio: "inherit" });
process.on("exit", () => py.kill());
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".md": "text/markdown", ".eml": "message/rfc822" };

function wrapRes(res) {
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (o) => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(o)); return res; };
  return res;
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks);
  if (url.pathname === "/api/data" || url.pathname === "/api/action") {
    req.query = Object.fromEntries(url.searchParams);
    req.body = raw.length ? JSON.parse(raw.toString()) : {};
    return (url.pathname === "/api/data" ? dataHandler : actionHandler)(req, wrapRes(res));
  }
  if (url.pathname.startsWith("/api/")) {
    const p = http.request({ host: "127.0.0.1", port: PY_PORT, path: url.pathname, method: req.method, headers: req.headers }, (pr) => {
      res.writeHead(pr.statusCode, pr.headers); pr.pipe(res);
    });
    p.on("error", (e) => { res.statusCode = 502; res.end(JSON.stringify({ error: String(e) })); });
    return p.end(raw);
  }
  let file = path.join(root, "public", decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname));
  if (!file.startsWith(path.join(root, "public")) || !fs.existsSync(file)) file = path.join(root, "public", "index.html");
  res.setHeader("Content-Type", TYPES[path.extname(file)] || "application/octet-stream");
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => console.log(`ACA dev server on http://localhost:${PORT}`));
