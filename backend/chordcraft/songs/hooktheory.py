"""Convert Hooktheory TheoryTab sections into absolute chord symbols with real durations.

A TheoryTab song page (``/theorytab/view/<artist>/<song>``) embeds its sections: name, key,
tempo, meter, and the section's roman-numeral string (``rel``). Each section's full analysis
comes from ``/v1/songs/public/<hash>?fields=ID,xmlData,song,jsonData`` (what the page's own
player loads). In that JSON every chord is relative to the key:

    {"root": 5, "type": 7, "inversion": 1, "applied": 0, "borrowed": "harmonicMinor",
     "suspensions": [4], "adds": [9], "omits": [3], "alterations": ["b9"],
     "beat": 13, "duration": 4, "isRest": false}

``root`` is a scale degree, ``type`` how many thirds are stacked (5 = triad, 7 = seventh …),
``applied`` a secondary function (5 → V/root), ``borrowed`` the mode the chord is taken from.
Durations count the meter's beat (eighths in x/8, where ``beatUnit`` = 3 eighths per pulse).

The conversion refuses anything it can't spell exactly as a chord the app's strict parser
accepts, and checks its own roman numerals against the page's ``rel`` string, so a misread
of the format fails loudly instead of producing a wrong progression.
"""

from __future__ import annotations

import json
import re
import unicodedata
from dataclasses import dataclass

from . import http

MODES = {
    "major": [0, 2, 4, 5, 7, 9, 11], "dorian": [0, 2, 3, 5, 7, 9, 10], "phrygian": [0, 1, 3, 5, 7, 8, 10],
    "lydian": [0, 2, 4, 6, 7, 9, 11], "mixolydian": [0, 2, 4, 5, 7, 9, 10], "minor": [0, 2, 3, 5, 7, 8, 10],
    "locrian": [0, 1, 3, 5, 6, 8, 10], "harmonicMinor": [0, 2, 3, 5, 7, 8, 11],
    "phrygianDominant": [0, 1, 4, 5, 7, 8, 10],
}
BRIGHT_MODES = {"major", "lydian", "mixolydian"}
SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
FLAT = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"]
PC = {n: i for i, n in enumerate(SHARP)} | {n: i for i, n in enumerate(FLAT)} | {"Cb": 11, "Fb": 4, "E#": 5, "B#": 0}
# The app's 24 key names (lib/theory/keys.ts)
MAJOR_NAME = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"]
MINOR_NAME = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "G#", "A", "Bb", "B"]
FLAT_KEYS = {"F Major", "Bb Major", "Eb Major", "Ab Major", "Db Major",
             "D Minor", "G Minor", "C Minor", "F Minor", "Bb Minor", "Eb Minor"}
# Pitch-class sets (relative to the root) → suffix; only qualities lib/theory/chords.ts parses strictly.
QUALITIES = {
    (0, 4, 7): "", (0, 3, 7): "m", (0, 3, 6): "dim", (0, 4, 8): "aug", (0, 4, 7, 10): "7",
    (0, 4, 7, 11): "maj7", (0, 3, 7, 10): "m7", (0, 3, 6, 9): "dim7", (0, 3, 6, 10): "m7b5",
    (0, 3, 7, 11): "mmaj7", (0, 2, 7): "sus2", (0, 5, 7): "sus4", (0, 5, 7, 10): "7sus4",
    (0, 4, 7, 9): "6", (0, 3, 7, 9): "m6", (0, 2, 4, 7): "add9", (0, 2, 4, 7, 10): "9",
    (0, 2, 3, 7, 10): "m9", (0, 2, 4, 7, 11): "maj9", (0, 2, 4, 5, 7, 10): "11", (0, 2, 3, 5, 7, 10): "m11",
    (0, 1, 4, 7, 10): "7b9", (0, 3, 4, 7, 10): "7#9", (0, 7): "5",
}
STACK = {5: 3, 7: 4, 9: 5, 11: 6, 13: 7}
ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII"]
SECTION_ORDER = ["chorus", "verse", "pre-chorus", "intro", "bridge", "instrumental", "outro", "solo"]
MAX_BEATS = 96


class Unusable(Exception):
    """A section (or song) that can't be converted exactly."""


@dataclass
class Section:
    name: str
    key: str
    mode: str
    tonic: str
    bpm: float
    time_signature: str
    chords: list[tuple[str, float]]
    rel: str


@dataclass
class TheoryTab:
    url: str
    title: str
    artist: str
    youtube_id: str | None
    sections: list[dict]


def slug(s: str) -> str:
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower().replace("&", "and")
    s = re.sub(r"['’.!?,]", "", s)
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")


def slug_candidates(title: str, artist: str) -> list[tuple[str, str]]:
    titles = [title, re.sub(r"\s*\(.*?\)\s*", " ", title).strip()]
    if m := re.search(r"\((.*?)\)", title):
        titles.append(m.group(1))
    artists = [artist, re.sub(r"^the ", "", artist, flags=re.I), "the " + artist]
    out: list[tuple[str, str]] = []
    for a in artists:
        for t in titles:
            if (k := (slug(a), slug(t))) not in out:
                out.append(k)
    return out


def parse_page(url: str, html: str) -> TheoryTab | None:
    s = html.replace('\\"', '"')
    m = re.search(r'"sections":(\[\{"wikiHash".*?\}\]),"youTubeID"', s)
    t = re.search(r'"song":\{"title":"((?:[^"\\]|\\.)*)","artist":"((?:[^"\\]|\\.)*)"', s)
    if not (m and t):
        return None
    yt = re.search(r'"youTubeID":"([^"]*)"', s)
    return TheoryTab(url=url, title=json.loads(f'"{t.group(1)}"'), artist=json.loads(f'"{t.group(2)}"'),
                     youtube_id=yt.group(1) if yt and yt.group(1) else None, sections=json.loads(m.group(1)))


def find(title: str, artist: str, slugs: tuple[str, str] | None = None) -> TheoryTab | None:
    for a, t in [slugs] if slugs else slug_candidates(title, artist):
        url = f"https://www.hooktheory.com/theorytab/view/{a}/{t}"
        html = http.get(url)
        if html and (tab := parse_page(url, html)) and tab.sections:
            return tab
    return None


def section_json(section_hash: str) -> dict:
    raw = http.get(f"https://www.hooktheory.com/v1/songs/public/{section_hash}?fields=ID,xmlData,song,jsonData")
    if raw is None:
        raise Unusable("section data missing")
    data = json.loads(raw)["jsonData"]
    return json.loads(data) if isinstance(data, str) else data


# ── chord spelling ───────────────────────────────────────────────────────────


def _tone(scale: list[int], step: int) -> int:
    """Semitones above the scale's tonic for a 1-based (possibly compound) scale step."""
    return scale[(step - 1) % 7] + 12 * ((step - 1) // 7)


@dataclass
class _Chord:
    root: int           # pitch class relative to the key's tonic
    intervals: list[int]
    members: list[str]
    base_third: int     # third of the unaltered chord, for roman-numeral case
    degree: int
    applied: bool


def chord_tones(c: dict, home: list[int]) -> _Chord:
    borrowed = c.get("borrowed")
    if borrowed in (None, ""):
        scale = home
    elif isinstance(borrowed, str) and borrowed in MODES:
        scale = MODES[borrowed]
    else:
        raise Unusable(f"borrowed {borrowed!r}")
    degree, kind = c["root"], c["type"]
    if kind not in STACK:
        raise Unusable(f"chord type {kind}")
    applied = c.get("applied") or 0
    if applied:
        # Secondary chords (V/x, vii/x …) are built from the major scale of their target.
        offset, scale, step = _tone(scale, degree) % 12, MODES["major"], applied
    else:
        offset, step = 0, degree
    root = offset + _tone(scale, step)
    steps = [step + 2 * i for i in range(STACK[kind])]
    ivs = [_tone(scale, s) - _tone(scale, step) for s in steps]
    members = ["1", "3", "5", "7", "9", "11", "13"][: len(ivs)]
    base_third = ivs[1] % 12

    sus = c.get("suspensions") or []
    if sus:
        if len(sus) != 1 or sus[0] not in (2, 4):
            raise Unusable(f"suspensions {sus}")
        ivs[1] = _tone(scale, step + (1 if sus[0] == 2 else 3)) - _tone(scale, step)
        members[1] = f"sus{sus[0]}"
    for add in c.get("adds") or []:
        if add in (2, 9):
            ivs.append(14)
            members.append("add9")
        elif add in (6, 13) and len(ivs) == 3:
            ivs.append(9)
            members.append("6")
        else:
            raise Unusable(f"add {add}")
    for omit in map(str, c.get("omits") or []):
        if omit == "5" and "3" in members:
            continue  # a no-5 voicing is still the same chord symbol
        if omit not in members:
            raise Unusable(f"omit {omit}")
        i = members.index(omit)
        del ivs[i], members[i]
    for alt in map(str, c.get("alterations") or []):
        m = re.fullmatch(r"([b#])(\d+)", alt)
        if not m:
            raise Unusable(f"alteration {alt}")
        shift = -1 if m.group(1) == "b" else 1
        if m.group(2) in members:
            ivs[members.index(m.group(2))] += shift
        elif (base := {"9": 14, "11": 17, "13": 21}.get(m.group(2))) is not None:
            ivs.append(base + shift)
            members.append(m.group(2))
        else:
            raise Unusable(f"alteration {alt}")
    if c.get("inversion") and (c.get("omits") or c["inversion"] >= len(ivs)):
        raise Unusable("inversion of an incomplete chord")
    return _Chord(root % 12, ivs, members, base_third, degree, bool(applied))


def spell(c: dict, tonic_pc: int, home: list[int], key_flats: bool) -> tuple[str, str]:
    """(chord symbol, roman numeral root) for one TheoryTab chord."""
    ch = chord_tones(c, home)
    pcs = tuple(sorted({i % 12 for i in ch.intervals}))
    if pcs not in QUALITIES:
        raise Unusable(f"no exact chord symbol for intervals {pcs}")
    accidental = {0: "", 1: "#", 11: "b"}.get((ch.root - home[ch.degree - 1]) % 12, "?")
    diatonic = ch.root in {x % 12 for x in home}
    flats = key_flats if diatonic or ch.applied else accidental == "b"
    names = FLAT if flats else SHARP
    root_pc = (tonic_pc + ch.root) % 12
    symbol = names[root_pc] + QUALITIES[pcs]
    if inv := c.get("inversion"):
        symbol += "/" + names[(root_pc + ch.intervals[inv]) % 12]
    if ch.applied:
        numeral = "APPLIED"
    else:
        n = ROMAN[ch.degree - 1]
        numeral = accidental + (n.lower() if ch.base_third == 3 else n)
    return symbol, numeral


def rel_numerals(rel: str) -> list[str]:
    out = []
    for tok in rel.split():
        if re.match(r"^[b#]?[ivxIVX]+[^/]*/[b#]?[ivxIVX]+", tok):
            out.append("APPLIED")
            continue
        m = re.match(r"^([b#]?)(vii|iii|ii|iv|vi|v|i|VII|III|II|IV|VI|V|I)", tok)
        out.append(m.group(1) + m.group(2) if m else "?" + tok)
    return out


def _dedupe(xs: list) -> list:
    return [x for i, x in enumerate(xs) if i == 0 or xs[i - 1] != x]


def time_signature(meters: list[dict], end_beat: float) -> tuple[str, int]:
    if len({m["beatUnit"] for m in meters}) != 1:
        raise Unusable("beat unit changes")
    spans: dict[int, float] = {}
    for i, m in enumerate(meters):
        stop = meters[i + 1]["beat"] if i + 1 < len(meters) else end_beat
        spans[m["numBeats"]] = spans.get(m["numBeats"], 0) + stop - m["beat"]
    n, unit = max(spans, key=spans.__getitem__), meters[0]["beatUnit"]
    if unit == 1:
        return f"{n}/4", 1
    if unit == 3:
        return f"{n}/8", 3
    raise Unusable(f"meter {n} / unit {unit}")


def app_key(tonic: str, mode: str) -> str:
    pc = PC[tonic]
    return f"{MAJOR_NAME[pc]} Major" if mode in BRIGHT_MODES else f"{MINOR_NAME[pc]} Minor"


def one_cycle(chords: list[tuple[str, float]]) -> list[tuple[str, float]]:
    """A section that is the same loop repeated is stored once."""
    n = len(chords)
    for p in range(2, n):
        if n % p == 0 and chords == chords[:p] * (n // p):
            return chords[:p]
    return chords


def convert(meta: dict, data: dict) -> Section:
    if len(data["keys"]) != 1:
        raise Unusable("key changes")
    if len({t["bpm"] for t in data["tempos"]}) != 1:
        raise Unusable("tempo changes")
    tonic, mode = data["keys"][0]["tonic"], data["keys"][0]["scale"]
    if mode not in MODES:
        raise Unusable(f"scale {mode}")
    home = MODES[mode]
    sig, unit = time_signature(data["meters"], data["endBeat"])
    bpm = data["tempos"][0]["bpm"]
    if unit == 1 and sig in ("6/4", "12/4") and bpm >= 120:
        # Compound-time ballads entered in eighth notes (Perfect: "6/4" at 190) → n/8 in dotted quarters.
        sig, unit, bpm = sig.replace("/4", "/8"), 3, round(bpm / 3, 1)
    key = app_key(tonic, mode)
    chords = list(data["chords"])
    while chords and chords[0].get("isRest"):
        chords.pop(0)
    while chords and chords[-1].get("isRest"):
        chords.pop()
    out: list[tuple[str, float]] = []
    numerals: list[str] = []
    for c in chords:
        if c.get("isRest"):
            raise Unusable("rest inside the progression")
        if c.get("pedal") or c.get("alternate") or c.get("substitutions"):
            raise Unusable("pedal / alternate / substitution chord")
        symbol, numeral = spell(c, PC[tonic], home, key in FLAT_KEYS)
        numerals.append(numeral)
        beats = c["duration"] / unit
        if out and out[-1][0] == symbol:  # one held chord split across two cells
            out[-1] = (symbol, out[-1][1] + beats)
        else:
            out.append((symbol, beats))
    if not out:
        raise Unusable("no chords")
    expected = _dedupe(rel_numerals(meta["rel"]))
    if expected != _dedupe(numerals):
        raise Unusable(f"numerals {_dedupe(numerals)} disagree with TheoryTab's {expected}")
    out = one_cycle([(s, round(b, 4)) for s, b in out])
    total = sum(b for _, b in out)
    if len(out) < 2 or not 4 <= total <= MAX_BEATS:
        raise Unusable(f"length {len(out)} chords / {total} beats")
    return Section(name=meta["name"], key=key, mode=mode, tonic=tonic, bpm=bpm,
                   time_signature=sig, chords=out, rel=meta["rel"])


def _rank(name: str) -> int:
    n = name.lower()
    if n in ("chorus", "verse"):
        return 0 if n == "chorus" else 1
    return next((2 + i for i, p in enumerate(SECTION_ORDER) if p in n), 20)


def best_section(tab: TheoryTab) -> tuple[Section, list[str]]:
    """The most recognisable section that converts exactly (chorus first, then verse …)."""
    reasons = []
    for meta in sorted(tab.sections, key=lambda s: _rank(s["name"])):
        try:
            return convert(meta, section_json(meta["hash"])), reasons
        except Unusable as e:
            reasons.append(f"{meta['name']}: {e}")
    raise Unusable("; ".join(reasons) or "no sections")
