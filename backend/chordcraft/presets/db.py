"""SQLite store for the Preset Finder library.

One file (``backend/db/presets.sqlite``) holds:

- ``presets``       — published identifications (what the API and the site serve)
- ``presets_fts``   — an FTS5 index over artist/context/vst/preset for search
- ``review_queue``  — solved threads the ingest parser couldn't read confidently
- ``meta``          — key/value state, e.g. the ingest watermark

The FTS index is an external-content table kept in sync by triggers, so writers
only ever touch ``presets``.
"""

from __future__ import annotations

import os
import re
import sqlite3
from collections.abc import Iterable, Iterator
from contextlib import contextmanager
from dataclasses import asdict, dataclass
from pathlib import Path
from urllib.parse import urlparse

DEFAULT_DB = Path(__file__).resolve().parents[2] / "db" / "presets.sqlite"

SCHEMA = """
CREATE TABLE IF NOT EXISTS presets (
    id            TEXT PRIMARY KEY,
    artist        TEXT NOT NULL CHECK (artist <> ''),
    context       TEXT NOT NULL CHECK (context <> ''),
    vst           TEXT NOT NULL CHECK (vst <> ''),
    preset        TEXT NOT NULL CHECK (preset <> ''),
    notes         TEXT NOT NULL CHECK (notes <> ''),
    status        TEXT NOT NULL CHECK (status IN ('confirmed', 'community')),
    source_url    TEXT NOT NULL CHECK (source_url LIKE 'https://%'),
    source_label  TEXT NOT NULL,
    source_kind   TEXT NOT NULL CHECK (source_kind IN ('Reddit', 'YouTube', 'Web')),
    reddit_post   TEXT,
    song_key      TEXT NOT NULL UNIQUE,  -- dedupe: lower(artist) | normalised song title
    added_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS presets_vst ON presets (vst);
CREATE INDEX IF NOT EXISTS presets_artist ON presets (artist COLLATE NOCASE);

CREATE VIRTUAL TABLE IF NOT EXISTS presets_fts USING fts5 (
    artist, context, vst, preset,
    content = 'presets', content_rowid = 'rowid', tokenize = 'unicode61 remove_diacritics 2'
);
CREATE TRIGGER IF NOT EXISTS presets_ai AFTER INSERT ON presets BEGIN
    INSERT INTO presets_fts (rowid, artist, context, vst, preset)
    VALUES (new.rowid, new.artist, new.context, new.vst, new.preset);
END;
CREATE TRIGGER IF NOT EXISTS presets_ad AFTER DELETE ON presets BEGIN
    INSERT INTO presets_fts (presets_fts, rowid, artist, context, vst, preset)
    VALUES ('delete', old.rowid, old.artist, old.context, old.vst, old.preset);
END;
CREATE TRIGGER IF NOT EXISTS presets_au AFTER UPDATE ON presets BEGIN
    INSERT INTO presets_fts (presets_fts, rowid, artist, context, vst, preset)
    VALUES ('delete', old.rowid, old.artist, old.context, old.vst, old.preset);
    INSERT INTO presets_fts (rowid, artist, context, vst, preset)
    VALUES (new.rowid, new.artist, new.context, new.vst, new.preset);
END;

CREATE TABLE IF NOT EXISTS review_queue (
    post_id     TEXT PRIMARY KEY,
    title       TEXT NOT NULL,
    selftext    TEXT NOT NULL,
    created_utc INTEGER NOT NULL,
    reason      TEXT NOT NULL,
    queued_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
"""

@dataclass(frozen=True)
class Preset:
    id: str
    artist: str
    context: str
    vst: str
    preset: str
    notes: str
    status: str
    sourceUrl: str  # noqa: N815 — field names match the TypeScript PresetEntry
    sourceLabel: str  # noqa: N815

    def to_json(self) -> dict:
        return asdict(self)


def source_kind(url: str) -> str:
    host = urlparse(url).hostname or ""
    if host.endswith("reddit.com"):
        return "Reddit"
    if host.endswith("youtube.com") or host == "youtu.be":
        return "YouTube"
    return "Web"


def song_key(artist: str, context: str) -> str:
    """Dedupe key — same artist, same song. Song is the quoted title in a context like '"Sky" — main melody'."""
    m = re.match(r'\s*"([^"]+)"', context)
    title = m.group(1) if m else context.split("—")[0]
    def norm(s: str) -> str:
        return re.sub(r"[^a-z0-9]+", "", s.lower())
    return f"{norm(artist)}|{norm(title)}"


def db_path() -> Path:
    return Path(os.getenv("PRESETS_DB", DEFAULT_DB))


def connect(path: str | Path | None = None) -> sqlite3.Connection:
    conn = sqlite3.connect(path or db_path())
    conn.row_factory = sqlite3.Row
    return conn


def connect_readonly(path: str | Path | None = None) -> sqlite3.Connection:
    """For the API: a missing database is an error, never silently created, and writes fail."""
    target = Path(path or db_path()).resolve()
    conn = sqlite3.connect(f"{target.as_uri()}?mode=ro", uri=True, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def init_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(SCHEMA)
    conn.commit()


@contextmanager
def open_db(path: str | Path | None = None) -> Iterator[sqlite3.Connection]:
    conn = connect(path)
    try:
        init_schema(conn)
        yield conn
    finally:
        conn.close()


def _row(r: sqlite3.Row) -> Preset:
    return Preset(id=r["id"], artist=r["artist"], context=r["context"], vst=r["vst"], preset=r["preset"],
                  notes=r["notes"], status=r["status"], sourceUrl=r["source_url"], sourceLabel=r["source_label"])


def insert(conn: sqlite3.Connection, p: Preset, reddit_post: str | None = None) -> bool:
    """Insert one preset. Returns False (and changes nothing) when the id or song already exists."""
    try:
        conn.execute(
            "INSERT INTO presets (id, artist, context, vst, preset, notes, status, source_url, source_label,"
            " source_kind, reddit_post, song_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (p.id, p.artist, p.context, p.vst, p.preset, p.notes, p.status, p.sourceUrl, p.sourceLabel,
             source_kind(p.sourceUrl), reddit_post, song_key(p.artist, p.context)),
        )
    except sqlite3.IntegrityError as e:
        if "UNIQUE" in str(e):
            return False
        raise
    return True


def unique_id(conn: sqlite3.Connection, base: str) -> str:
    candidate, n = base, 2
    while conn.execute("SELECT 1 FROM presets WHERE id = ?", (candidate,)).fetchone():
        candidate, n = f"{base}-{n}", n + 1
    return candidate


def _fts_query(q: str) -> str:
    """Turn free text into an FTS5 query: every word must match, as a prefix."""
    words = re.findall(r"\w+", q.lower())
    return " ".join(f'"{w}"*' for w in words)


@dataclass(frozen=True)
class Page:
    total: int
    items: list[Preset]


def query(
    conn: sqlite3.Connection,
    q: str = "",
    vst: str | None = None,
    source: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> Page:
    """Search + filter, ordered by artist then id (the site groups consecutive rows by artist)."""
    where, args = [], []
    match = _fts_query(q) if q.strip() else ""
    if match:
        where.append("p.rowid IN (SELECT rowid FROM presets_fts WHERE presets_fts MATCH ?)")
        args.append(match)
    if vst:
        where.append("p.vst = ?")
        args.append(vst)
    if source:
        where.append("p.source_kind = ?")
        args.append(source)
    clause = f"WHERE {' AND '.join(where)}" if where else ""
    total = conn.execute(f"SELECT count(*) FROM presets p {clause}", args).fetchone()[0]
    rows = conn.execute(
        f"SELECT p.* FROM presets p {clause} ORDER BY p.artist COLLATE NOCASE, p.id LIMIT ? OFFSET ?",
        [*args, limit, offset],
    ).fetchall()
    return Page(total=total, items=[_row(r) for r in rows])


def vst_counts(conn: sqlite3.Connection) -> list[tuple[str, int]]:
    """Every VST with its entry count, most-used first."""
    rows = conn.execute("SELECT vst, count(*) n FROM presets GROUP BY vst ORDER BY n DESC, vst COLLATE NOCASE")
    return [(r["vst"], r["n"]) for r in rows]


def all_presets(conn: sqlite3.Connection) -> list[Preset]:
    return [_row(r) for r in conn.execute("SELECT * FROM presets ORDER BY artist COLLATE NOCASE, id")]


def get(conn: sqlite3.Connection, preset_id: str) -> Preset | None:
    r = conn.execute("SELECT * FROM presets WHERE id = ?", (preset_id,)).fetchone()
    return _row(r) if r else None


def get_meta(conn: sqlite3.Connection, key: str, default: str | None = None) -> str | None:
    r = conn.execute("SELECT value FROM meta WHERE key = ?", (key,)).fetchone()
    return r["value"] if r else default


def set_meta(conn: sqlite3.Connection, key: str, value: str) -> None:
    conn.execute("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
                 (key, value))


def queue_for_review(conn: sqlite3.Connection, rows: Iterable[tuple[str, str, str, int, str]]) -> int:
    cur = conn.executemany(
        "INSERT OR IGNORE INTO review_queue (post_id, title, selftext, created_utc, reason) VALUES (?, ?, ?, ?, ?)",
        rows,
    )
    return cur.rowcount
