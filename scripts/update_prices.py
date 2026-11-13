#!/usr/bin/env python3
"""Fetch delayed Yahoo quotes for model holdings and write data/prices.json.

Stdlib only. Set FORCE=1 to run outside 9:25 AM–4:20 PM America/New_York.
"""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
MODELS_PATH = ROOT / "data" / "models.json"
PRICES_PATH = ROOT / "data" / "prices.json"
TZ = ZoneInfo("America/New_York")
UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/120.0.0.0 Safari/537.36"
)
BATCH_SIZE = 20
TIMEOUT = 20
RETRIES = 3


def log(msg: str) -> None:
    print(msg, flush=True)


def in_market_window(now: datetime | None = None) -> bool:
    if os.environ.get("FORCE", "").strip() in {"1", "true", "TRUE", "yes", "YES"}:
        return True
    now = now or datetime.now(TZ)
    if now.weekday() >= 5:
        return False
    start = now.replace(hour=9, minute=25, second=0, microsecond=0)
    end = now.replace(hour=16, minute=20, second=0, microsecond=0)
    return start <= now <= end


def et_label(now: datetime) -> str:
    hour = now.strftime("%I").lstrip("0") or "12"
    return f"{now.strftime('%a %b')} {now.day}, {now.year}, {hour}{now.strftime(':%M %p')} ET"


def load_json(path: Path):
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def symbols_from_models(models_data: dict) -> list[str]:
    seen = []
    got = set()
    for m in models_data.get("models") or []:
        for h in m.get("holdings") or []:
            if h.get("unpriced"):
                continue
            sym = (h.get("symbol") or "").strip()
            if not sym or sym.upper() == "CASH" or sym in got:
                continue
            got.add(sym)
            seen.append(sym)
    return seen


def http_get_json(url: str) -> dict | None:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    last_err = None
    for attempt in range(1, RETRIES + 1):
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, ValueError, json.JSONDecodeError) as e:
            last_err = e
            time.sleep(0.6 * attempt)
    log(f"  request failed after {RETRIES} tries: {last_err}")
    return None


def quote_from_meta(meta: dict | None) -> dict | None:
    if not meta:
        return None
    price = meta.get("regularMarketPrice")
    if price is None:
        price = meta.get("fulldayPrice")
    prev = meta.get("chartPreviousClose")
    if prev is None:
        prev = meta.get("previousClose")
    if price is None:
        return None
    try:
        price = float(price)
    except (TypeError, ValueError):
        return None
    prev_f = None
    if prev is not None:
        try:
            prev_f = float(prev)
        except (TypeError, ValueError):
            prev_f = None
    change_pct = 0.0
    if prev_f not in (None, 0):
        change_pct = (price - prev_f) / prev_f * 100.0
    return {"price": price, "prev_close": prev_f, "change_pct": change_pct}


def fetch_spark(batch: list[str]) -> tuple[dict[str, dict], str | None]:
    quotes = {}
    market_state = None
    qs = urllib.parse.urlencode({"symbols": ",".join(batch), "range": "1d", "interval": "5m"})
    url = f"https://query1.finance.yahoo.com/v7/finance/spark?{qs}"
    data = http_get_json(url)
    if not data:
        return quotes, market_state
    results = (data.get("spark") or {}).get("result") or []
    for item in results:
        sym = item.get("symbol")
        responses = item.get("response") or []
        meta = responses[0].get("meta") if responses else None
        q = quote_from_meta(meta)
        if q and sym:
            quotes[sym] = q
        if meta and not market_state:
            market_state = meta.get("marketState")
    return quotes, market_state


def fetch_chart(sym: str) -> tuple[dict | None, str | None]:
    qs = urllib.parse.urlencode({"range": "1d", "interval": "5m"})
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(sym)}?{qs}"
    data = http_get_json(url)
    if not data:
        return None, None
    results = (data.get("chart") or {}).get("result") or []
    if not results:
        return None, None
    meta = results[0].get("meta") or {}
    return quote_from_meta(meta), meta.get("marketState")


def infer_market_state(now: datetime) -> str:
    if now.weekday() >= 5:
        return "CLOSED"
    t = now.hour * 60 + now.minute
    if 4 * 60 <= t < 9 * 60 + 30:
        return "PRE"
    if 9 * 60 + 30 <= t < 16 * 60:
        return "REGULAR"
    if 16 * 60 <= t < 20 * 60:
        return "POST"
    return "CLOSED"


def main() -> int:
    now = datetime.now(TZ)
    if not in_market_window(now):
        log(f"Outside 9:25 AM–4:20 PM ET window ({et_label(now)}); skipping (no write).")
        return 0

    models = load_json(MODELS_PATH)
    if not models:
        log(f"Missing {MODELS_PATH}")
        return 1

    symbols = symbols_from_models(models)
    previous = (load_json(PRICES_PATH) or {}).get("quotes") or {}
    quotes: dict[str, dict] = {}
    market_state = None
    fetched = 0

    for i in range(0, len(symbols), BATCH_SIZE):
        batch = symbols[i : i + BATCH_SIZE]
        log(f"Spark batch {i // BATCH_SIZE + 1}: {', '.join(batch)}")
        batch_quotes, state = fetch_spark(batch)
        if state and not market_state:
            market_state = state
        quotes.update(batch_quotes)
        fetched += len(batch_quotes)
        time.sleep(0.25)

    missing = [s for s in symbols if s not in quotes]
    for sym in missing:
        log(f"Chart fallback for {sym}")
        q, state = fetch_chart(sym)
        if state and not market_state:
            market_state = state
        if q:
            quotes[sym] = q
            fetched += 1
        time.sleep(0.2)

    kept_prev = 0
    for sym in symbols:
        if sym not in quotes and sym in previous:
            quotes[sym] = previous[sym]
            kept_prev += 1
            log(f"Kept previous quote for {sym}")

    if not quotes:
        log("Nothing could be fetched and no previous quotes are available.")
        return 1

    if not market_state:
        # Try one chart call for a liquid symbol to read marketState.
        probe = "AAPL" if "AAPL" in symbols else (symbols[0] if symbols else None)
        if probe:
            _, state = fetch_chart(probe)
            if state:
                market_state = state
    if not market_state:
        market_state = infer_market_state(now)

    out = {
        "updated_utc": datetime.now(ZoneInfo("UTC")).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "updated_et_label": et_label(datetime.now(TZ)),
        "market_state": market_state,
        "quotes": {s: quotes[s] for s in symbols if s in quotes},
    }
    PRICES_PATH.parent.mkdir(parents=True, exist_ok=True)
    PRICES_PATH.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    still_missing = [s for s in symbols if s not in out["quotes"]]
    log(
        f"Wrote {PRICES_PATH}: {len(out['quotes'])} quotes "
        f"({fetched} fetched this run, {kept_prev} kept from previous, "
        f"{len(still_missing)} missing). market_state={market_state}"
    )
    if still_missing:
        log("Missing: " + ", ".join(still_missing))
    return 0


if __name__ == "__main__":
    sys.exit(main())
