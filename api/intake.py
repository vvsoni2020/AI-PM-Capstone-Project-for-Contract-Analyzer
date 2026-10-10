"""POST /api/intake (Python function on Vercel)."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from aca.endpoints import intake  # noqa: E402
from aca.http import make_handler  # noqa: E402

handler = make_handler(intake)
