"""Minimal Claude Messages API client using only the standard library.

Every call forces a tool so the answer comes back as structured JSON, and returns token usage
and cost so ACA can show what each analysis cost (feeds the Deliverable #4 cost model).
"""
import json
import os
import time
import urllib.error
import urllib.request

from .config import CACHE_READ_FACTOR, CACHE_WRITE_FACTOR, MODEL, PRICES

API_URL = "https://api.anthropic.com/v1/messages"


class ClaudeError(RuntimeError):
    pass


def _api_key():
    key = os.environ.get("ANTHROPIC_API_KEY")
    if not key:
        path = os.environ.get("ANTHROPIC_API_KEY_FILE")
        if path and os.path.exists(path):
            key = open(path).read().strip()
    if not key:
        raise ClaudeError("ANTHROPIC_API_KEY is not set")
    return key


def cost_usd(model, usage):
    pin, pout = PRICES.get(model, PRICES["claude-sonnet-5-5"])
    i = usage.get("input_tokens", 0)
    cr = usage.get("cache_read_input_tokens", 0) or 0
    cw = usage.get("cache_creation_input_tokens", 0) or 0
    o = usage.get("output_tokens", 0)
    return round((i * pin + cr * pin * CACHE_READ_FACTOR + cw * pin * CACHE_WRITE_FACTOR + o * pout) / 1_000_000, 5)


def strict(schema):
    """Structured outputs: every object closed with additionalProperties: false."""
    if isinstance(schema, dict):
        out = {k: strict(v) for k, v in schema.items()}
        if out.get("type") == "object" or "properties" in out:
            out["additionalProperties"] = False
        return out
    if isinstance(schema, list):
        return [strict(x) for x in schema]
    return schema


def call_tool(system, user_content, tool, max_tokens=6000, model=None, retries=3, effort=None):
    """Send one request whose answer must match tool["input_schema"] (structured outputs). Returns dict with input, usage, cost."""
    model = model or MODEL
    body = {
        "model": model,
        "max_tokens": max_tokens,
        "system": system,
        "messages": [{"role": "user", "content": user_content}],
        "output_config": {"format": {"type": "json_schema", "schema": strict(tool["input_schema"])}},
    }
    if effort:  # low / medium / high: how much the model thinks before answering (thinking is billed as output)
        body["output_config"]["effort"] = effort
    data = json.dumps(body).encode()
    last_err = None
    for attempt in range(retries + 1):
        req = urllib.request.Request(API_URL, data=data, method="POST", headers={
            "x-api-key": _api_key(),
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        })
        t0 = time.time()
        try:
            with urllib.request.urlopen(req, timeout=240) as resp:
                out = json.loads(resp.read())
            usage = out.get("usage", {})
            if out.get("stop_reason") == "max_tokens":
                raise ClaudeError("Model output was cut off (max_tokens)")
            text = "".join(b.get("text", "") for b in out.get("content", []) if b.get("type") == "text")
            try:
                parsed = json.loads(text)
            except ValueError:
                raise ClaudeError("Model did not return valid structured output")
            return {
                "input": parsed,
                "usage": usage,
                "model": out.get("model", model),
                "cost_usd": cost_usd(model, usage),
                "seconds": round(time.time() - t0, 1),
            }
        except urllib.error.HTTPError as e:
            msg = e.read()[:400].decode("utf-8", "replace")
            last_err = ClaudeError(f"Claude API error {e.code}: {msg}")
            if e.code in (429, 500, 502, 503, 529) and attempt < retries:
                time.sleep(2 * (attempt + 1) ** 2)
                continue
            raise last_err
        except (urllib.error.URLError, TimeoutError) as e:
            last_err = ClaudeError(f"Claude API unreachable: {e}")
            if attempt < retries:
                time.sleep(2 * (attempt + 1))
                continue
            raise last_err
    raise last_err
