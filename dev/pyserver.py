"""Local dev server for the Python endpoints (/api/intake, /api/review, /api/extract)."""
import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from aca import endpoints  # noqa: E402
from aca.http import handle  # noqa: E402

ROUTES = {"/api/intake": endpoints.intake, "/api/review": endpoints.review, "/api/extract": endpoints.extract}


class H(BaseHTTPRequestHandler):
    def do_POST(self):
        fn = ROUTES.get(self.path.split("?")[0])
        if not fn:
            self.send_error(404)
            return
        n = int(self.headers.get("content-length") or 0)
        status, payload = handle(fn, dict(self.headers), self.rfile.read(n))
        data = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8788
    ThreadingHTTPServer(("127.0.0.1", port), H).serve_forever()
