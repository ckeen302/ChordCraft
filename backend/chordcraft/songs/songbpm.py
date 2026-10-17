"""songbpm.com: an independent (Spotify audio-analysis) tempo, and key when it has one."""

from __future__ import annotations

import html
import re
from dataclasses import dataclass

from . import http
from .hooktheory import PC, slug


@dataclass
class TempoCheck:
    url: str
    bpm: float
    key: tuple[int, str] | None  # (tonic pitch class, 'major' | 'minor')


# Listing entries that aren't the studio recording.
_NOT_STUDIO = re.compile(r"cover|live|acoustic|transcription|version|mix|demo|take|karaoke|instrumental|"
                         r"session|edit|bbc|anthology|mono|piano|orchestra|tribute|medley|reprise")


def _listed(artist_slug: str, title_slug: str) -> list[str]:
    """Track slugs for this title on the artist's alphabetical listing, studio versions first."""
    page = http.get(f"https://songbpm.com/@{artist_slug}?after={title_slug[:-1]}")
    if not page:
        return []
    found = re.findall(rf'href="/@{re.escape(artist_slug)}/({re.escape(title_slug)}(?:-[^"]*)?)"', page)
    def rank(s: str) -> int:
        rest = s[len(title_slug):]
        if not rest:
            return 0
        return 1 if "remaster" in rest and not _NOT_STUDIO.search(rest) else 2
    return sorted((s for s in dict.fromkeys(found) if not _NOT_STUDIO.search(s[len(title_slug):])), key=rank)


def lookup(title: str, artist: str) -> TempoCheck | None:
    titles = [title, re.sub(r"\s*\(.*?\)\s*", " ", title).strip()]
    artists = [artist, re.sub(r"^the ", "", artist, flags=re.I), "the " + artist]
    tried: list[tuple[str, str]] = []
    for a in artists:
        for t in titles:
            if (slug(a), slug(t)) not in tried:
                tried.append((slug(a), slug(t)))
    urls = [f"https://songbpm.com/@{a}/{t}" for a, t in tried]
    for a, t in tried:
        urls += [f"https://songbpm.com/@{a}/{s}" for s in _listed(a, t)[:2]]
    for url in dict.fromkeys(urls):
        page = http.get(url)
        if page:
            text = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", html.unescape(page)))
            bpm = re.search(r"with a tempo of (\d+(?:\.\d+)?) BPM", text)
            if not bpm:
                continue
            k = re.search(r"with an? ([A-G][#♯b♭]?) key and an? (major|minor) mode", text)
            key = (PC[k.group(1).replace("♯", "#").replace("♭", "b")], k.group(2)) if k else None
            return TempoCheck(url=url, bpm=float(bpm.group(1)), key=key)
    return None


def tempo_agrees(bpm: float, check: float, compound: bool) -> bool:
    """Within 4%, allowing the half/double-time (and, in compound meter, ×3) readings."""
    ratios = [1, 0.5, 2] + ([1 / 3, 3, 2 / 3, 1.5] if compound else [])
    return any(abs(bpm - check * r) <= 0.04 * check * r for r in ratios)


def key_agreement(tonic_pc: int, minor: bool, key: tuple[int, str] | None) -> str:
    """'exact', 'relative' (same notes, other tonic), 'differs', or 'unavailable'.

    songbpm's key is Spotify's automatic estimate, which is often a fifth off (it calls
    Havana D major and Royals G major), so a difference is recorded, not treated as an error.
    """
    if key is None:
        return "unavailable"
    pc, mode = key
    if (pc, mode) == (tonic_pc, "minor" if minor else "major"):
        return "exact"
    relative = (tonic_pc + 3) % 12 if minor else (tonic_pc - 3) % 12
    if pc == relative and mode == ("major" if minor else "minor"):
        return "relative"
    return "differs"
