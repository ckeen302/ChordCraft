"""Songsterr: a third, human-transcribed tempo for songs TheoryTab and songbpm disagree on.

A Songsterr tab carries the transcriber's tempo map (every tempo change, by measure),
which is played back in sync with the recording, so it reflects the record's actual
tempo, drift included. Used only to settle conflicts, through explicit overrides in
the candidates file (see ``ingest.py``).
"""

from __future__ import annotations

import json
import re
import statistics
import urllib.parse
from dataclasses import dataclass

from . import http
from .songbpm import tempo_agrees

PAGE = re.compile(r"^https://www\.songsterr\.com/a/wsa/[\w-]+-tab-s(\d+)$")
_PARTS = "https://dqsljvtekg760.cloudfront.net"
MIN_RUN = 8


@dataclass
class TempoMap:
    url: str
    artist: str
    title: str
    measures: list[tuple[float, str]]  # (pulse BPM, time signature) in force at each measure

    @property
    def main(self) -> float:
        """Pulse BPM of the median measure: the tempo the bulk of the song is played at."""
        return statistics.median_low(b for b, _ in self.measures)

    @property
    def compound(self) -> bool:
        """Notated in a triple-pulse meter (as ingest.py counts them), so ×3 and 3:2 readings apply."""
        return any(_compound(sig) or sig in ("6/4", "12/4") for _, sig in self.measures)

    def runs(self) -> list[tuple[float, int]]:
        """(pulse BPM, consecutive measures) for each stretch at one tempo."""
        out: list[tuple[float, int]] = []
        for bpm, _ in self.measures:
            if out and out[-1][0] == bpm:
                out[-1] = (bpm, out[-1][1] + 1)
            else:
                out.append((bpm, 1))
        return out

    def supporting(self, bpm: float, compound: bool) -> float | None:
        """The tab tempo that confirms ``bpm``: the song's main tempo, or else a stretch of at
        least MIN_RUN measures (a section of a song that drifts, like Stairway to Heaven)."""
        compound = compound or self.compound
        if tempo_agrees(bpm, self.main, compound):
            return self.main
        return next((b for b, n in self.runs() if n >= MIN_RUN and tempo_agrees(bpm, b, compound)), None)


def _compound(sig: str) -> bool:
    n, d = map(int, sig.split("/"))
    return d == 8 and n % 3 == 0


def _pulse(quarter_bpm: float, sig: str) -> float:
    """The meter's pulse, as on TheoryTab: quarter notes in x/4, dotted quarters in compound x/8."""
    return round(quarter_bpm * 2 / 3, 2) if _compound(sig) else quarter_bpm


def _json(url: str) -> dict | list | None:
    body = http.get(url)
    return json.loads(body) if body else None


def page_url(song_id: int, artist: str, title: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", f"{artist} {title}".lower()).strip("-")
    return f"https://www.songsterr.com/a/wsa/{s}-tab-s{song_id}"


def search(title: str, artist: str) -> str | None:
    """The page of the tab whose artist and title match exactly, if Songsterr has one."""
    def norm(s: str) -> str:
        return re.sub(r"[^a-z0-9]+", "", re.sub(r"^the ", "", s.lower()))
    q = urllib.parse.quote(f"{artist} {title}")
    for hit in _json(f"https://www.songsterr.com/api/songs?pattern={q}") or []:
        if hit.get("isJunk") or not hit.get("hasPlayer"):
            continue
        if norm(hit["artist"]) == norm(artist) and norm(hit["title"]) == norm(title):
            return page_url(hit["songId"], hit["artist"], hit["title"])
    return None


def tempo_map(url: str) -> TempoMap | None:
    m = PAGE.match(url)
    if not m:
        raise ValueError(f"not a Songsterr tab URL: {url}")
    meta = _json(f"https://www.songsterr.com/api/meta/{m.group(1)}")
    if not meta or not meta.get("image"):
        return None
    track = meta.get("popularTrack") or meta.get("defaultTrack") or 0
    part = _json(f"{_PARTS}/{meta['songId']}/{meta['revisionId']}/{meta['image']}/{track}.json")
    tempos = (part or {}).get("automations", {}).get("tempo") or []
    if not part or not tempos:
        return None
    changes = {}
    for t in tempos:  # bpm counts notes of value 1/type (4 = quarter), optionally dotted
        changes[t["measure"]] = t["bpm"] * 4 / t.get("type", 4) * (1.5 if t.get("dotted") else 1)
    measures, bpm, sig = [], changes.get(0, next(iter(changes.values()))), "4/4"
    for i, m in enumerate(part["measures"]):
        bpm = changes.get(i, bpm)
        sig = "/".join(map(str, m["signature"])) if m.get("signature") else sig
        measures.append((_pulse(bpm, sig), sig))
    return TempoMap(url=url, artist=meta["artist"], title=meta["title"], measures=measures)
