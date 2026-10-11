"""ACA kill switch (decided 10 Oct, Vaibhav). KD can stop and start ACA.

The current state is the latest audit_log row with action "kill_switch" (details.enabled).
No row means ACA is on. Every switch is audit-logged, and the log is append-only.
While ACA is off, no contract is sent to the Claude API: review and register extraction are refused.
"""
from .db import get_db


def aca_enabled():
    rows = get_db().select("audit_log", eq={"action": "kill_switch"}, order="id", desc=True, limit=1)
    if not rows:
        return True
    return (rows[0].get("details") or {}).get("enabled") is not False
