"""POST /api/review (Python function on Vercel)."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from aca.endpoints import review  # noqa: E402
from http.server import BaseHTTPRequestHandler  # noqa: E402

from aca.http import make_handler  # noqa: E402

_Base = make_handler(review)


class handler(_Base, BaseHTTPRequestHandler):  # Vercel looks for a top-level `handler` class
    pass
