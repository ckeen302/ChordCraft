"""Polite GET with an optional on-disk cache (SONGS_HTTP_CACHE) so re-runs don't re-fetch."""

from __future__ import annotations

import hashlib
import os
import time
import urllib.error
import urllib.request
from pathlib import Path

USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124 Safari/537.36"
DELAY_S = 0.8
_MISSING = "__404__"


def get(url: str) -> str | None:
    """Body of a 200 response, or None for 404. Other HTTP errors raise."""
    cache_dir = os.getenv("SONGS_HTTP_CACHE")
    cached = Path(cache_dir) / hashlib.md5(url.encode()).hexdigest() if cache_dir else None
    if cached and cached.exists():
        body = cached.read_text()
        return None if body == _MISSING else body
    time.sleep(DELAY_S)
    try:
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(req, timeout=30) as r:
            body = r.read().decode("utf8")
    except urllib.error.HTTPError as e:
        if e.code != 404:
            raise
        body = _MISSING
    if cached:
        cached.parent.mkdir(parents=True, exist_ok=True)
        cached.write_text(body)
    return None if body == _MISSING else body
