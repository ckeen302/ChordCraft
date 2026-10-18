"""Build the library: TheoryTab section → exact chords, then an independent tempo/key check.

A candidate is published only when
  1. TheoryTab has it and one of its sections converts exactly (see hooktheory.py), and
  2. songbpm.com's tempo agrees with TheoryTab's (allowing half/double time), or
  3. the two disagree and the candidate carries an explicit tempo override, which a third
     source (a Songsterr tab's tempo map) confirms, along with TheoryTab or songbpm.
  4. the chords are confirmed by the notes of a Songsterr transcription (see chordcheck.py):
     the first section, most recognisable first, whose chords fit the tab beat for beat is
     published, trimmed to the stretch the tab confirms when only part of it does. If the
     tab only matches in another key, songbpm has to confirm TheoryTab's key instead.
Anything else goes to the ``rejected`` table with the reason. songbpm's key (Spotify's
automatic estimate) is recorded as agreeing or not, but isn't grounds for rejection.
The release year is published only when two of MusicBrainz, Wikidata and the candidate
file agree on it within a year (see musicbrainz.py); otherwise it's left unknown.

Overrides settle live-tempo drift and triplet-feel readings. The override is the tempo to
publish in TheoryTab's pulse (the chords' beats are counted in it), so it may differ from
TheoryTab's section tempo by at most OVERRIDE_DRIFT; anything further means the sources
count different beats and the chords would play at the wrong speed.
"""

from __future__ import annotations

import sqlite3
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path

from . import chordcheck, db, musicbrainz, songbpm, songsterr
from .hooktheory import PC, Section, TheoryTab, Unusable, find, sections, slug


@dataclass
class Candidate:
    title: str
    artist: str
    year: int
    slugs: tuple[str, str] | None = None  # explicit TheoryTab artist/song slugs when guessing fails
    song_id: str | None = None
    tempo: float | None = None        # override: the tempo to publish, in TheoryTab's pulse
    tempo_source: str | None = None   # the Songsterr tab that confirms it


OVERRIDE_DRIFT = 0.10


@dataclass
class Report:
    added: list[str] = field(default_factory=list)
    rejected: list[tuple[str, str]] = field(default_factory=list)

    def summary(self) -> str:
        return f"{len(self.added)} verified, {len(self.rejected)} rejected"


def read_candidates(path: Path) -> list[Candidate]:
    """``title|artist|year[|artist-slug/song-slug[|id[|bpm|songsterr-url]]]`` per line; # comments allowed.
    The year may be left empty when MusicBrainz should supply it."""
    out = []
    for line in path.read_text().splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        parts = line.split("|") + [""] * 7
        slugs = tuple(parts[3].split("/", 1)) if parts[3] else None
        if bool(parts[5]) != bool(parts[6]):
            raise ValueError(f"tempo override needs both a BPM and its source URL: {line}")
        out.append(Candidate(parts[0], parts[1], int(parts[2] or 0), slugs,  # type: ignore[arg-type]
                             parts[4] or None, float(parts[5]) if parts[5] else None, parts[6] or None))
    return out


def verify(c: Candidate) -> db.Song:
    tab = find(c.title, c.artist, c.slugs)
    if not tab:
        raise Unusable("not on TheoryTab")
    section, chords, verdict = _confirmed_section(tab, c)
    if not 40 <= section.bpm <= 240:
        raise Unusable(f"TheoryTab tempo {section.bpm} outside 40-240 BPM")
    check = songbpm.lookup(tab.title, tab.artist) or songbpm.lookup(c.title, c.artist)
    if not check:
        raise Unusable("no independent tempo (songbpm.com) to confirm against")
    compound = section.time_signature.endswith("/8") or section.time_signature in ("6/4", "12/4")
    bpm, source, source_bpm = section.bpm, None, None
    if c.tempo is not None:
        bpm, source, source_bpm = _override(c, section.bpm, check.bpm, compound)
    elif not songbpm.tempo_agrees(section.bpm, check.bpm, compound):
        raise Unusable(f"tempo conflict: TheoryTab {section.bpm} vs songbpm {check.bpm}")
    key_check = songbpm.key_agreement(PC[section.tonic], section.key.endswith("Minor"), check.key)
    if not verdict.key_agrees and key_check not in ("exact", "relative"):
        raise Unusable(f"key unconfirmed: the tab ({verdict.url}) is in another key and songbpm doesn't confirm "
                       f"TheoryTab's {section.key}")
    year, year_url = musicbrainz.release_year([(tab.title, tab.artist), (c.title, c.artist)], c.year or None)
    return db.Song(
        id=c.song_id or slug(tab.title), title=tab.title, artist=tab.artist, year=year, key=section.key,
        mode=section.mode, bpm=bpm, timeSignature=section.time_signature, section=section.name,
        sourceUrl=tab.url, youtubeId=tab.youtube_id, tempoCheckUrl=check.url, tempoCheckBpm=check.bpm,
        keyCheck=key_check, tempoSourceUrl=source, tempoSourceBpm=source_bpm,
        chordCheckUrl=verdict.url, chordCheckKey="same" if verdict.key_agrees else "transposed",
        yearSourceUrl=year_url, chords=[db.SongChord(s, b) for s, b in chords],
    )


def _confirmed_section(tab: TheoryTab, c: Candidate) -> tuple[Section, list[tuple[str, float]], chordcheck.Verdict]:
    """The first exactly-converted section whose chords a Songsterr tab confirms."""
    found, reasons = sections(tab)
    if not found:
        raise Unusable("; ".join(reasons) or "no sections")
    url = songsterr.search(tab.title, tab.artist) or songsterr.search(c.title, c.artist)
    if not url:
        raise Unusable("no Songsterr tab to confirm the chords against")
    tried = []
    for section in found:
        verdict = chordcheck.check(tab.title, tab.artist, section.chords, section.time_signature, url=url)
        if verdict.status == "confirmed":
            lo, hi = verdict.window or (0, len(section.chords) - 1)
            return section, section.chords[lo:hi + 1], verdict
        tried.append(f"{section.name}: {verdict.detail}")
    raise Unusable(f"chords not confirmed by {url} ({'; '.join(tried)})")


def _override(c: Candidate, theorytab: float, check: float, compound: bool) -> tuple[float, str, float]:
    """The override's tempo, its Songsterr tab and the tab tempo that confirms it, or Unusable."""
    assert c.tempo is not None and c.tempo_source is not None
    if not songsterr.PAGE.match(c.tempo_source):
        raise Unusable(f"tempo override source isn't a Songsterr tab: {c.tempo_source}")
    if abs(c.tempo - theorytab) > OVERRIDE_DRIFT * theorytab:
        raise Unusable(f"tempo override {c.tempo:g} is off TheoryTab's pulse ({theorytab})")
    if not (songbpm.tempo_agrees(c.tempo, theorytab, compound) or songbpm.tempo_agrees(c.tempo, check, compound)):
        raise Unusable(f"tempo override {c.tempo:g} agrees with neither TheoryTab {theorytab} nor songbpm {check}")
    tab = songsterr.tempo_map(c.tempo_source)
    if not tab:
        raise Unusable(f"no tempo map at {c.tempo_source}")
    confirmed = tab.supporting(c.tempo, compound)
    if confirmed is None:
        raise Unusable(f"tempo override {c.tempo:g} not confirmed by Songsterr (main tempo {tab.main:g})")
    return c.tempo, c.tempo_source, confirmed


def _free_id(conn: sqlite3.Connection, song: db.Song) -> db.Song:
    taken = conn.execute("SELECT song_key FROM songs WHERE id = ?", (song.id,)).fetchone()
    if taken and taken[0] != db.song_key(song.artist, song.title):
        song = db.Song(**{**song.__dict__, "id": f"{song.id}-{slug(song.artist)}"})
    return song


def _attempt(c: Candidate) -> db.Song | str:
    """The verified song, or why it was refused (network failures included, so a re-run retries)."""
    try:
        return verify(c)
    except Unusable as e:
        return str(e)
    except Exception as e:  # noqa: BLE001 — one flaky fetch shouldn't stop a 2,000-song run
        return f"fetch error, retry later: {e!r}"


def ingest(conn: sqlite3.Connection, candidates: list[Candidate], log=print, workers: int = 1) -> Report:
    """Verify candidates (``workers`` at a time: it's all network) and store them in file order."""
    report = Report()
    with ThreadPoolExecutor(max_workers=workers) as pool:
        for c, result in zip(candidates, pool.map(_attempt, candidates), strict=True):
            _store(conn, c, result, report, log)
    return report


def _store(conn: sqlite3.Connection, c: Candidate, result: db.Song | str, report: Report, log) -> None:
    if isinstance(result, str):
        db.reject(conn, c.title, c.artist, result)
        report.rejected.append((f"{c.title} — {c.artist}", result))
        log(f"  - {c.title} — {c.artist}: {result}")
    else:
        song = _free_id(conn, result)
        db.upsert(conn, song)
        db.unreject(conn, c.title, c.artist)  # TheoryTab may spell the title differently
        report.added.append(song.id)
        log(f"  + {song.id}: {song.key} {song.bpm} BPM {song.section} "
            + " ".join(f"{ch.symbol}:{ch.beats:g}" for ch in song.chords))
    conn.commit()
