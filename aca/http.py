"""Shared plumbing for the Python functions (Vercel BaseHTTPRequestHandler + local dev server)."""
import json
import os
import traceback

from .config import USERS


class HttpError(Exception):
    def __init__(self, status, msg):
        super().__init__(msg)
        self.status = status


def authenticate(headers):
    passcode = os.environ.get("ACA_PASSCODE")
    if passcode and headers.get("x-aca-passcode") != passcode:
        raise HttpError(401, "Wrong or missing passcode")
    user = headers.get("x-aca-user")
    if user not in USERS:
        raise HttpError(401, "Pick who you are (KD, Bhavin, Dhaval, Jay or Pranav)")
    return user


def handle(fn, headers, raw_body):
    """Run fn(body, user) and return (status, payload)."""
    try:
        user = authenticate({k.lower(): v for k, v in headers.items()})
        body = json.loads(raw_body or b"{}")
        return 200, fn(body, user)
    except HttpError as e:
        return e.status, {"error": str(e)}
    except Exception as e:  # noqa: BLE001
        traceback.print_exc()
        return 500, {"error": f"{type(e).__name__}: {e}"[:500]}


def make_handler(fn):
    from http.server import BaseHTTPRequestHandler

    class handler(BaseHTTPRequestHandler):  # noqa: N801  (Vercel looks for this name)
        def do_POST(self):
            n = int(self.headers.get("content-length") or 0)
            status, payload = handle(fn, dict(self.headers), self.rfile.read(n) if n else b"")
            data = json.dumps(payload, ensure_ascii=False).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

    return handler
