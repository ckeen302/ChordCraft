"""Pull newly solved r/findthepreset threads into the presets database.

Reddit blocks unauthenticated API access, so posts come from the Arctic Shift
archive (https://arctic-shift.photon-reddit.com), which mirrors Reddit. Each
run asks for posts newer than the stored watermark, parses the ones flaired
"PRESET FOUND", inserts confident parses, and queues the rest for review.
"""

from __future__ import annotations

import json
import re
import sqlite3
import time
import unicodedata
import urllib.parse
import urllib.request
from collections.abc import Callable, Iterator
from dataclasses import dataclass, field

from . import db
from .parse import Parsed, parse_post

ARCTIC_SHIFT = "https://arctic-shift.photon-reddit.com/api/posts/search"
SUBREDDIT = "findthepreset"
SOLVED_FLAIRS = {"PRESET FOUND", "REQUEST / SOLVED"}
WATERMARK = "reddit_watermark"
# Request threads are usually flaired as solved days after they're posted, so each
# run re-scans this window behind the watermark (re-scans are deduped by post id).
LOOKBACK_S = 30 * 24 * 3600
AUTO_NOTE = "Parsed automatically from the solved thread's post."

Fetch = Callable[[str], dict]


def http_get_json(url: str) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": "chordcraft-preset-ingest"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.load(resp)


def fetch_posts_after(after_utc: int, fetch: Fetch = http_get_json, max_pages: int = 50) -> Iterator[dict]:
    """Yield posts created after ``after_utc``, oldest first, paging by creation time."""
    cursor = after_utc
    seen: set[str] = set()
    for _ in range(max_pages):
        params = {"subreddit": SUBREDDIT, "after": str(cursor), "sort": "asc", "limit": "100",
                  "fields": "id,title,selftext,created_utc,link_flair_text"}
        for attempt in range(3):
            try:
                page = fetch(f"{ARCTIC_SHIFT}?{urllib.parse.urlencode(params)}")["data"]
                break
            except OSError:
                if attempt == 2:
                    raise
                time.sleep(2 + 3 * attempt)
        if not page:
            return
        fresh = [p for p in page if p["id"] not in seen]
        seen.update(p["id"] for p in page)
        yield from fresh
        if len(page) < 100 or not fresh:
            return
        # Step back one second so posts sharing the last timestamp aren't skipped
        # at the page boundary; the id set above drops the overlap.
        cursor = max(p["created_utc"] for p in page) - 1


def slug(text: str) -> str:
    ascii_text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode().lower()
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", ascii_text)).strip("-")[:60].strip("-") or "preset"


def thread_url(post_id: str) -> str:
    return f"https://www.reddit.com/r/{SUBREDDIT}/comments/{post_id}/"


def to_preset(conn: sqlite3.Connection, post_id: str, parsed: Parsed) -> db.Preset:
    return db.Preset(
        id=db.unique_id(conn, slug(f"{parsed.artist} {parsed.song}")),
        artist=parsed.artist,
        context=parsed.context,
        vst=parsed.vst,
        preset=parsed.preset,
        notes=AUTO_NOTE,
        status="community",
        sourceUrl=thread_url(post_id),
        sourceLabel="r/findthepreset thread",
    )


@dataclass
class IngestReport:
    seen: int = 0
    solved: int = 0
    added: list[str] = field(default_factory=list)
    duplicates: int = 0
    queued: int = 0
    watermark: int = 0

    def summary(self) -> str:
        return (f"seen {self.seen} posts, {self.solved} solved: added {len(self.added)}, "
                f"skipped {self.duplicates} duplicates, queued {self.queued} for review "
                f"(watermark {self.watermark})")


def ingest(conn: sqlite3.Connection, fetch: Fetch = http_get_json, since: int | None = None,
           dry_run: bool = False) -> IngestReport:
    """One ingest pass. Commits unless ``dry_run``; the watermark only moves on success."""
    watermark = since if since is not None else int(db.get_meta(conn, WATERMARK, "0") or 0)
    start = watermark if since is not None else max(0, watermark - LOOKBACK_S)
    report = IngestReport(watermark=watermark)
    known = {r[0] for r in conn.execute("SELECT reddit_post FROM presets WHERE reddit_post IS NOT NULL")}
    queue: list[tuple[str, str, str, int, str]] = []
    for post in fetch_posts_after(start, fetch):
        report.seen += 1
        report.watermark = max(report.watermark, int(post["created_utc"]))
        if post.get("link_flair_text") not in SOLVED_FLAIRS or post["id"] in known:
            continue
        report.solved += 1
        parsed = parse_post(post.get("title") or "", post.get("selftext") or "")
        if not isinstance(parsed, Parsed):
            queue.append((post["id"], post.get("title") or "", post.get("selftext") or "",
                          int(post["created_utc"]), parsed.reason))
            continue
        preset = to_preset(conn, post["id"], parsed)
        if db.insert(conn, preset, reddit_post=post["id"]):
            report.added.append(preset.id)
        else:
            report.duplicates += 1
    report.queued = db.queue_for_review(conn, queue)
    db.set_meta(conn, WATERMARK, str(report.watermark))
    if dry_run:
        conn.rollback()
    else:
        conn.commit()
    return report
