"""SQLite store for the Popular Songs library.

One file (``backend/db/songs.sqlite``) holds:

- ``songs``        — one verified progression per song: key, tempo, meter, section and sources
- ``song_chords``  — the progression itself, one row per chord with its duration in beats
- ``songs_fts``    — an FTS5 index over title/artist for search
- ``rejected``     — candidates the ingest looked at and refused, with the reason

Every song is converted from a Hooktheory TheoryTab section (chords, rhythm, key, tempo)
and its tempo is cross-checked against songbpm.com; where the two disagree, an explicit
override confirmed by a Songsterr tab (``tempo_source_*``) settles it. See ``ingest.py``.
"""

from __future__ import annotations

import json
import os
import re
import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import asdict, dataclass, field
from pathlib import Path

DEFAULT_DB = Path(__file__).resolve().parents[2] / "db" / "songs.sqlite"

SCHEMA = """
CREATE TABLE IF NOT EXISTS songs (
    id              TEXT PRIMARY KEY,
    title           TEXT NOT NULL CHECK (title <> ''),
    artist          TEXT NOT NULL CHECK (artist <> ''),
    year            INTEGER CHECK (year IS NULL OR year BETWEEN 1600 AND 2100),
    key             TEXT NOT NULL CHECK (key LIKE '% Major' OR key LIKE '% Minor'),
    mode            TEXT NOT NULL,          -- TheoryTab scale: major, minor, dorian, mixolydian, ...
    bpm             REAL NOT NULL CHECK (bpm BETWEEN 40 AND 240),
    time_signature  TEXT NOT NULL,
    section         TEXT NOT NULL,
    source_url      TEXT NOT NULL CHECK (source_url LIKE 'https://www.hooktheory.com/theorytab/view/%'),
    youtube_id      TEXT,
    tempo_check_url TEXT CHECK (tempo_check_url IS NULL OR tempo_check_url LIKE 'https://%'),
    tempo_check_bpm REAL,
    key_check       TEXT CHECK (key_check IN ('exact', 'relative', 'differs', 'unavailable')),
    tempo_source_url TEXT CHECK (tempo_source_url IS NULL OR tempo_source_url LIKE 'https://www.songsterr.com/%'),
    tempo_source_bpm REAL,
    song_key        TEXT NOT NULL UNIQUE,   -- dedupe: normalised artist | title
    added_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS songs_artist ON songs (artist COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS song_chords (
    song_id  TEXT NOT NULL REFERENCES songs (id) ON DELETE CASCADE,
    position INTEGER NOT NULL CHECK (position >= 0),
    symbol   TEXT NOT NULL CHECK (symbol <> ''),
    beats    REAL NOT NULL CHECK (beats > 0),
    PRIMARY KEY (song_id, position)
);

CREATE VIRTUAL TABLE IF NOT EXISTS songs_fts USING fts5 (
    title, artist, content = 'songs', content_rowid = 'rowid', tokenize = 'unicode61 remove_diacritics 2'
);
CREATE TRIGGER IF NOT EXISTS songs_ai AFTER INSERT ON songs BEGIN
    INSERT INTO songs_fts (rowid, title, artist) VALUES (new.rowid, new.title, new.artist);
END;
CREATE TRIGGER IF NOT EXISTS songs_ad AFTER DELETE ON songs BEGIN
    INSERT INTO songs_fts (songs_fts, rowid, title, artist) VALUES ('delete', old.rowid, old.title, old.artist);
END;
CREATE TRIGGER IF NOT EXISTS songs_au AFTER UPDATE ON songs BEGIN
    INSERT INTO songs_fts (songs_fts, rowid, title, artist) VALUES ('delete', old.rowid, old.title, old.artist);
    INSERT INTO songs_fts (rowid, title, artist) VALUES (new.rowid, new.title, new.artist);
END;

CREATE TABLE IF NOT EXISTS rejected (
    title      TEXT NOT NULL,
    artist     TEXT NOT NULL,
    reason     TEXT NOT NULL,
    checked_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (title, artist)
);
"""


@dataclass(frozen=True)
class SongChord:
    symbol: str
    beats: float


@dataclass(frozen=True)
class Song:
    """Field names match the TypeScript ``PopularSong`` the site renders."""

    id: str
    title: str
    artist: str
    year: int | None
    key: str
    mode: str
    bpm: float
    timeSignature: str  # noqa: N815
    section: str
    sourceUrl: str  # noqa: N815
    youtubeId: str | None  # noqa: N815
    tempoCheckUrl: str | None  # noqa: N815
    tempoCheckBpm: float | None  # noqa: N815
    keyCheck: str  # noqa: N815
    tempoSourceUrl: str | None = None  # noqa: N815  -- tempo override's confirming tab, if any
    tempoSourceBpm: float | None = None  # noqa: N815
    chordCheckUrl: str | None = None  # noqa: N815  -- Songsterr tab whose notes confirm the chords
    chordCheckKey: str | None = None  # noqa: N815  -- 'same': confirmed in the tab's key; 'transposed': shape only
    yearSourceUrl: str | None = None  # noqa: N815  -- MusicBrainz recording or Wikidata item the year comes from
    chords: list[SongChord] = field(default_factory=list)

    def to_json(self) -> dict:
        d = asdict(self)
        d["bpm"] = _num(self.bpm)
        if self.tempoCheckBpm is not None:
            d["tempoCheckBpm"] = _num(self.tempoCheckBpm)
        if self.tempoSourceUrl is None:
            del d["tempoSourceUrl"], d["tempoSourceBpm"]
        else:
            d["tempoSourceBpm"] = _num(self.tempoSourceBpm or 0)
        for optional in ("chordCheckUrl", "chordCheckKey", "yearSourceUrl"):
            if d[optional] is None:
                del d[optional]
        d["chords"] = [{"symbol": c.symbol, "beats": _num(c.beats)} for c in self.chords]
        return d


def _num(x: float) -> int | float:
    return int(x) if float(x).is_integer() else round(x, 4)


def song_key(artist: str, title: str) -> str:
    def norm(s: str) -> str:
        return re.sub(r"[^a-z0-9]+", "", s.lower())
    return f"{norm(artist)}|{norm(title)}"


def db_path() -> Path:
    return Path(os.getenv("SONGS_DB", DEFAULT_DB))


def connect(path: str | Path | None = None) -> sqlite3.Connection:
    conn = sqlite3.connect(path or db_path())
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def connect_readonly(path: str | Path | None = None) -> sqlite3.Connection:
    target = Path(path or db_path()).resolve()
    conn = sqlite3.connect(f"{target.as_uri()}?mode=ro", uri=True, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


@contextmanager
def open_db(path: str | Path | None = None) -> Iterator[sqlite3.Connection]:
    conn = connect(path)
    try:
        conn.executescript(SCHEMA)
        _migrate(conn)
        conn.commit()
        yield conn
    finally:
        conn.close()


_ADDED_COLUMNS = {
    "tempo_source_url": "TEXT CHECK (tempo_source_url IS NULL OR tempo_source_url LIKE 'https://www.songsterr.com/%')",
    "tempo_source_bpm": "REAL",
    "chord_check_url": "TEXT CHECK (chord_check_url IS NULL OR chord_check_url LIKE 'https://www.songsterr.com/%')",
    "chord_check_key": "TEXT CHECK (chord_check_key IS NULL OR chord_check_key IN ('same', 'transposed'))",
    "year_source_url": "TEXT CHECK (year_source_url IS NULL OR year_source_url LIKE 'https://musicbrainz.org/%'"
                       " OR year_source_url LIKE 'https://www.wikidata.org/%')",
}


def _migrate(conn: sqlite3.Connection) -> None:
    have = {r[1] for r in conn.execute("PRAGMA table_info(songs)")}
    for name, decl in _ADDED_COLUMNS.items():
        if name not in have:
            conn.execute(f"ALTER TABLE songs ADD COLUMN {name} {decl}")


def upsert(conn: sqlite3.Connection, s: Song) -> None:
    """Insert or replace one song and its chords (re-ingesting a song refreshes it), all or nothing."""
    conn.execute("SAVEPOINT upsert")
    try:
        _upsert(conn, s)
    except BaseException:
        conn.execute("ROLLBACK TO upsert")
        raise
    finally:
        conn.execute("RELEASE upsert")


def _upsert(conn: sqlite3.Connection, s: Song) -> None:
    conn.execute("DELETE FROM songs WHERE id = ? OR song_key = ?", (s.id, song_key(s.artist, s.title)))
    conn.execute(
        "INSERT INTO songs (id, title, artist, year, key, mode, bpm, time_signature, section, source_url,"
        " youtube_id, tempo_check_url, tempo_check_bpm, key_check, tempo_source_url, tempo_source_bpm,"
        " chord_check_url, chord_check_key, year_source_url, song_key)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (s.id, s.title, s.artist, s.year, s.key, s.mode, s.bpm, s.timeSignature, s.section, s.sourceUrl,
         s.youtubeId, s.tempoCheckUrl, s.tempoCheckBpm, s.keyCheck, s.tempoSourceUrl, s.tempoSourceBpm,
         s.chordCheckUrl, s.chordCheckKey, s.yearSourceUrl, song_key(s.artist, s.title)),
    )
    conn.executemany(
        "INSERT INTO song_chords (song_id, position, symbol, beats) VALUES (?, ?, ?, ?)",
        [(s.id, i, c.symbol, c.beats) for i, c in enumerate(s.chords)],
    )
    unreject(conn, s.title, s.artist)


def reject(conn: sqlite3.Connection, title: str, artist: str, reason: str) -> None:
    conn.execute(
        "INSERT INTO rejected (title, artist, reason) VALUES (?, ?, ?)"
        " ON CONFLICT (title, artist) DO UPDATE SET reason = excluded.reason, checked_at = datetime('now')",
        (title, artist, reason),
    )


def unreject(conn: sqlite3.Connection, title: str, artist: str) -> None:
    conn.execute("DELETE FROM rejected WHERE title = ? AND artist = ?", (title, artist))


def _fts_query(q: str) -> str:
    return " ".join(f'"{w}"*' for w in re.findall(r"\w+", q.lower()))


def _load(conn: sqlite3.Connection, rows: list[sqlite3.Row]) -> list[Song]:
    out = []
    for r in rows:
        chords = [SongChord(c["symbol"], c["beats"]) for c in conn.execute(
            "SELECT symbol, beats FROM song_chords WHERE song_id = ? ORDER BY position", (r["id"],))]
        out.append(Song(id=r["id"], title=r["title"], artist=r["artist"], year=r["year"], key=r["key"],
                        mode=r["mode"], bpm=r["bpm"], timeSignature=r["time_signature"], section=r["section"],
                        sourceUrl=r["source_url"], youtubeId=r["youtube_id"], tempoCheckUrl=r["tempo_check_url"],
                        tempoCheckBpm=r["tempo_check_bpm"], keyCheck=r["key_check"],
                        tempoSourceUrl=r["tempo_source_url"], tempoSourceBpm=r["tempo_source_bpm"],
                        chordCheckUrl=r["chord_check_url"], chordCheckKey=r["chord_check_key"],
                        yearSourceUrl=r["year_source_url"], chords=chords))
    return out


def query(conn: sqlite3.Connection, q: str = "", limit: int = 50, offset: int = 0) -> tuple[int, list[Song]]:
    """Search by title/artist, ordered by year then title (the tab's order)."""
    match = _fts_query(q) if q.strip() else ""
    clause = "WHERE rowid IN (SELECT rowid FROM songs_fts WHERE songs_fts MATCH ?)" if match else ""
    args = [match] if match else []
    total = conn.execute(f"SELECT count(*) FROM songs {clause}", args).fetchone()[0]
    order = "ORDER BY year IS NULL, year, title COLLATE NOCASE"
    rows = conn.execute(f"SELECT * FROM songs {clause} {order} LIMIT ? OFFSET ?", [*args, limit, offset]).fetchall()
    return total, _load(conn, rows)


def all_songs(conn: sqlite3.Connection) -> list[Song]:
    return _load(conn, conn.execute("SELECT * FROM songs ORDER BY year IS NULL, year, title COLLATE NOCASE").fetchall())


def get(conn: sqlite3.Connection, song_id: str) -> Song | None:
    found = _load(conn, conn.execute("SELECT * FROM songs WHERE id = ?", (song_id,)).fetchall())
    return found[0] if found else None


def export_json(conn: sqlite3.Connection, out: Path) -> int:
    songs = all_songs(conn)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps([s.to_json() for s in songs], ensure_ascii=False, indent=1) + "\n")
    return len(songs)
