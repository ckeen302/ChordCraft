"""Release years from MusicBrainz and Wikidata, published only when two sources agree.

Neither source alone is reliable for a song's original release: MusicBrainz's search can
rank a reissue above the original recording (Hound Dog comes back as 1969), and Wikidata
has gaps and its own slips. So a year is used only when two of MusicBrainz, Wikidata and
the candidate file agree within a year; otherwise the song's year is left unknown.
"""

from __future__ import annotations

import json
import re
import threading
import time
import urllib.error
import urllib.parse

from . import http

USER_AGENT = "ChordCraft/1.0 ( https://github.com/ckeen302/ChordCraft )"
_ONE_AT_A_TIME = threading.Lock()  # MusicBrainz allows one request per second per client


def _norm(s: str) -> str:
    s = re.sub(r"\(.*?\)|\[.*?\]", "", s.lower().replace("&", "and"))
    return re.sub(r"[^a-z0-9]+", "", re.sub(r"^the ", "", s.strip()))


def _get(url: str, lock: threading.Lock | None, delay: float, accept: str | None = None) -> str | None:
    for attempt in range(6):
        try:
            if lock:
                with lock:
                    return http.get(url, user_agent=USER_AGENT, delay=delay)
            return http.get(url, user_agent=USER_AGENT, delay=delay)
        except urllib.error.HTTPError as e:  # 503/429 = rate limiting; back off and retry
            if e.code not in (429, 503) or attempt == 5:
                raise
            time.sleep(5 * (attempt + 1))
    return None


def musicbrainz_year(title: str, artist: str) -> tuple[int, str] | None:
    """Earliest first-release year among the artist's recordings of this title."""
    q = f'recording:"{title}" AND artist:"{artist}"'
    body = _get(f"https://musicbrainz.org/ws/2/recording/?query={urllib.parse.quote(q)}&fmt=json&limit=100",
                _ONE_AT_A_TIME, 1.1)
    best: tuple[str, str] | None = None
    for r in json.loads(body or "{}").get("recordings", []):
        credit = "".join(c.get("name", "") + c.get("joinphrase", "") for c in r.get("artist-credit", []))
        date = r.get("first-release-date") or ""
        if (_norm(r.get("title", "")) == _norm(title) and _norm(artist) in _norm(credit)
                and re.match(r"\d{4}", date) and (best is None or date < best[0])):
            best = (date, f"https://musicbrainz.org/recording/{r['id']}")
    return (int(best[0][:4]), best[1]) if best else None


def wikidata_year(title: str, artist: str) -> tuple[int, str] | None:
    """Earliest publication year of a Wikidata item with this English title, performed by the artist."""
    names = " ".join(json.dumps(n) + "@en" for n in dict.fromkeys([artist, re.sub(r"(?i)^the ", "", artist)]))
    q = ("SELECT ?song ?date WHERE { VALUES ?name { " + names + " } ?song rdfs:label " + json.dumps(title)
         + "@en; wdt:P175 ?p; wdt:P577 ?date. ?p rdfs:label ?name. }")
    body = _get("https://query.wikidata.org/sparql?format=json&query=" + urllib.parse.quote(q), None, 0.5)
    rows = [(b["date"]["value"][:4], b["song"]["value"]) for b in json.loads(body or "{}").get("results", {})
            .get("bindings", []) if re.match(r"\d{4}", b["date"]["value"])]
    if not rows:
        return None
    year, item = min(rows)
    return int(year), item.replace("http://", "https://")


def _first(lookup, names: list[tuple[str, str]]) -> tuple[int, str] | None:
    for title, artist in dict.fromkeys(names):
        if found := lookup(title, artist):
            return found
    return None


def release_year(names: list[tuple[str, str]], listed: int | None) -> tuple[int | None, str | None]:
    """(year, source URL) when two of MusicBrainz, Wikidata and the candidate file agree within a
    year (the earlier of the two is taken); (None, None) when they don't. ``names`` are the
    (title, artist) spellings to try: TheoryTab's, then the candidate file's."""
    votes: list[tuple[int, str | None]] = []
    if mb := _first(musicbrainz_year, names):
        votes.append(mb)
    if wd := _first(wikidata_year, names):
        votes.append(wd)
    if listed:
        votes.append((listed, None))
    agreeing = [(min(a[0], b[0]), a[1] or b[1]) for i, a in enumerate(votes) for b in votes[i + 1:]
                if abs(a[0] - b[0]) <= 1]
    if not agreeing:
        return None, None
    return min(agreeing, key=lambda v: v[0])
