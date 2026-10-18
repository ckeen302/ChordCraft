"""Build the library: TheoryTab section → exact chords, then an independent tempo/key check.

A candidate is published only when
  1. TheoryTab has it and one of its sections converts exactly (see hooktheory.py), and
  2. songbpm.com's tempo agrees with TheoryTab's (allowing half/double time), and
Anything else goes to the ``rejected`` table with the reason. songbpm's key (Spotify's
automatic estimate) is recorded as agreeing or not, but isn't grounds for rejection.
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass, field
from pathlib import Path

from . import db, songbpm
from .hooktheory import PC, Unusable, best_section, find, slug


@dataclass
class Candidate:
    title: str
    artist: str
    year: int
    slugs: tuple[str, str] | None = None  # explicit TheoryTab artist/song slugs when guessing fails
    song_id: str | None = None


@dataclass
class Report:
    added: list[str] = field(default_factory=list)
    rejected: list[tuple[str, str]] = field(default_factory=list)

    def summary(self) -> str:
        return f"{len(self.added)} verified, {len(self.rejected)} rejected"


def read_candidates(path: Path) -> list[Candidate]:
    """``title|artist|year[|artist-slug/song-slug[|id]]`` per line; # comments allowed."""
    out = []
    for line in path.read_text().splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        parts = line.split("|")
        slugs = tuple(parts[3].split("/", 1)) if len(parts) > 3 and parts[3] else None
        out.append(Candidate(parts[0], parts[1], int(parts[2]), slugs,  # type: ignore[arg-type]
                             parts[4] if len(parts) > 4 and parts[4] else None))
    return out


def verify(c: Candidate) -> db.Song:
    tab = find(c.title, c.artist, c.slugs)
    if not tab:
        raise Unusable("not on TheoryTab")
    section, _ = best_section(tab)
    if not 40 <= section.bpm <= 240:
        raise Unusable(f"TheoryTab tempo {section.bpm} outside 40-240 BPM")
    check = songbpm.lookup(tab.title, tab.artist) or songbpm.lookup(c.title, c.artist)
    if not check:
        raise Unusable("no independent tempo (songbpm.com) to confirm against")
    compound = section.time_signature.endswith("/8") or section.time_signature in ("6/4", "12/4")
    if not songbpm.tempo_agrees(section.bpm, check.bpm, compound):
        raise Unusable(f"tempo conflict: TheoryTab {section.bpm} vs songbpm {check.bpm}")
    key_check = songbpm.key_agreement(PC[section.tonic], section.key.endswith("Minor"), check.key)
    return db.Song(
        id=c.song_id or slug(tab.title), title=tab.title, artist=tab.artist, year=c.year, key=section.key,
        mode=section.mode, bpm=section.bpm, timeSignature=section.time_signature, section=section.name,
        sourceUrl=tab.url, youtubeId=tab.youtube_id, tempoCheckUrl=check.url, tempoCheckBpm=check.bpm,
        keyCheck=key_check, chords=[db.SongChord(s, b) for s, b in section.chords],
    )


def _free_id(conn: sqlite3.Connection, song: db.Song) -> db.Song:
    taken = conn.execute("SELECT song_key FROM songs WHERE id = ?", (song.id,)).fetchone()
    if taken and taken[0] != db.song_key(song.artist, song.title):
        song = db.Song(**{**song.__dict__, "id": f"{song.id}-{slug(song.artist)}"})
    return song


def ingest(conn: sqlite3.Connection, candidates: list[Candidate], log=print) -> Report:
    report = Report()
    for c in candidates:
        try:
            song = _free_id(conn, verify(c))
        except Unusable as e:
            db.reject(conn, c.title, c.artist, str(e))
            report.rejected.append((f"{c.title} — {c.artist}", str(e)))
            log(f"  - {c.title} — {c.artist}: {e}")
        else:
            db.upsert(conn, song)
            report.added.append(song.id)
            log(f"  + {song.id}: {song.key} {song.bpm} BPM {song.section} "
                + " ".join(f"{ch.symbol}:{ch.beats:g}" for ch in song.chords))
        conn.commit()
    return report
