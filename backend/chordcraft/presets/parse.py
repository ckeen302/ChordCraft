"""Parse a solved r/findthepreset post into a preset entry.

Solved posts are usually written like::

    title:    Playboi Carti - Old Money
    selftext: Serum - Pads - PD Quasar

or one sound per line (``FM8 > Mallets > Bells > Stereo Bells``). The parser
only accepts posts it can read unambiguously — a known synth, a preset name,
no hedging — and returns a reason otherwise, so the post can go to the review
queue instead of the library.
"""

from __future__ import annotations

import html
import re
from dataclasses import dataclass

# Canonical synth name → spellings seen on the sub. Longest/most specific first
# so "Fruity DX10" wins over a bare "DX".
VST_ALIASES: dict[str, list[str]] = {
    "Spectrasonics Omnisphere": ["omnisphere 2", "omnisphere", "omni", "omnipshere"],
    "Spectrasonics Keyscape": ["keyscape"],
    "Spectrasonics Trilian": ["trilian"],
    "reFX Nexus": ["nexus 2", "nexus 3", "nexus 4", "nexus 5", "nexus"],
    "Xfer Serum": ["serum 2", "serum"],
    "LUXONIX Purity": ["purity"],
    "Tone2 ElectraX": ["electrax", "electra x", "electra 2", "electra2", "electra"],
    "Tone2 Gladiator": ["gladiator"],
    "Image-Line Sytrus": ["sytrus"],
    "Image-Line Harmor": ["harmor"],
    "Image-Line Ogun": ["ogun"],
    "Image-Line GMS": ["gms"],
    "FL Studio FL Keys": ["fl keys"],
    "FL Studio Fruity DX10": ["fruity dx10", "dx10"],
    "Toxic Biohazard": ["toxic biohazard"],
    "NI FM8": ["fm8"],
    "NI Massive": ["massive x", "massive"],
    "NI Kontakt": ["kontakt"],
    "NI Absynth 5": ["absynth 5", "absynth"],
    "Sylenth1": ["sylenth1", "sylenth 1", "sylenth"],
    "FabFilter Twin 2": ["twin 2", "twin2"],
    "Synapse DUNE 3": ["dune 3", "dune 2", "dune3", "dune2", "dune"],
    "u-he Hive": ["hive 2", "hive"],
    "u-he Zebra2": ["zebra 2", "zebra2", "zebra"],
    "u-he Diva": ["diva"],
    "u-he TyrellN6": ["tyrelln6", "tyrell n6", "tyrell"],
    "u-he Bazille": ["bazille"],
    "AIR Xpand!2": ["xpand!2", "xpand! 2", "xpand 2", "xpand2", "xpand"],
    "AIR Hybrid": ["hybrid 3", "hybrid"],
    "Korg M1": ["korg m1", "m1"],
    "Korg Triton": ["korg triton", "triton"],
    "Korg Wavestation": ["wavestation"],
    "Roland ZENOLOGY Pro": ["zenology pro", "zenology"],
    "Roland Juno-106": ["juno-106", "juno 106", "juno106"],
    "Roland D-50": ["roland d-50", "roland d50", "d-50"],
    "Yamaha DX7": ["dx7 v", "dx7"],
    "Arturia Analog Lab": ["analog lab 4", "analog lab 5", "analog lab"],
    "Arturia Pigments": ["pigments"],
    "Spitfire LABS": ["spitfire labs", "labs"],
    "Output Exhale": ["exhale"],
    "Vital": ["vital"],
    "SQ8L": ["sq8l", "sq-8l"],
    "Albino 3": ["albino 3", "albino3", "albino"],
    "Lush-101": ["lush-101", "lush 101", "lush 2", "lush101"],
    "Reveal Sound Spire": ["spire"],
}

_ALIAS_RE = [
    (canonical, re.compile(r"(?<![\w!])" + re.escape(alias) + r"(?![\w!])", re.I))
    for canonical, aliases in VST_ALIASES.items()
    for alias in aliases
]
_ALIAS_RE.sort(key=lambda pair: -len(pair[1].pattern))  # longest spelling first

_HEDGES = re.compile(
    r"\b(maybe|might|not sure|i think|idk|unsure|probably|close to|similar|sounds like|not 100|guess)\b|\?", re.I)
_SEPARATORS = re.compile(r"\s*(?:>+|→|->|-{1,2}>|::|\||/|\s-\s|–|—|:)\s*")
_FILLER = re.compile(r"^(?:vst|preset|presets|preset name|bank|in|from|the|is|it'?s|called|under|section)\b[:\s]*",
                     re.I)
# Vendor names and "by Native Instruments"-style credits are noise around a preset name.
_VENDOR = re.compile(r"\b(?:by\s+)?(?:native instruments|fabfilter|refx|arturia|image-?line|spectrasonics|tone2|"
                     r"xfer(?: records)?|u-he|luxonix|gross beat studio|lennar digital|synapse audio|roland|korg|"
                     r"output|spitfire(?: audio)?)\b", re.I)
# Prose that means the "preset" segment is really a sentence, not a name.
_PROSE = re.compile(r"\b(?:this|that|me|my|found|sounds?|exactly|lol|was|were|have|just|all in|all|"
                    r"randomly|kit|pack|file|link|download)\b|\.fst\b", re.I)
# A "preset" that is just a part name or a credit isn't an answer.
_GENERIC = re.compile(r"(?:main |the )?(?:lead|leads|pad|pads|keys|bell|bells|pluck|arp|bass|synth|melody|sound|"
                      r"factory bank|bank|expansion|kontakt|v)\s*\d*", re.I)
_CREDIT = re.compile(r"@|\bprod\b|produced|\bcredit", re.I)
# Lines that give tweak tips ("turn off the reverb") rather than a preset.
_TIP = re.compile(r"^(?:turn|set|remove|add|eq|use|play|lower|raise|put|then|just|and)\b", re.I)
# Kontakt / Analog Lab are hosts: a library named on the same line is the better answer.
_HOSTS = {"NI Kontakt", "Arturia Analog Lab"}
_URL = re.compile(r"https?://\S+|\[([^\]]*)\]\([^)]*\)")


@dataclass(frozen=True)
class Parsed:
    artist: str
    song: str
    vst: str
    preset: str

    @property
    def context(self) -> str:
        return f'"{self.song}" — main sound'


@dataclass(frozen=True)
class Rejected:
    reason: str


def split_title(title: str) -> tuple[str, str] | None:
    """'Artist - Song' → (artist, song). Strips '(prod. …)', '[…]' and 'preset found' noise."""
    t = html.unescape(title)
    t = re.sub(r"\[[^\]]*\]|\((?:prod|feat|ft)[^)]*\)|\bpreset(?:s)? found\b|\bpresets?\b", "", t, flags=re.I)
    pieces = re.split(r"\s+[-–—]\s+|\s*[-–—]{1,2}\s*(?=[A-Z0-9\"'])", t)
    parts = [p.strip(" -–—|:") for p in pieces if p.strip(" -–—|:")]
    if len(parts) != 2:
        return None
    artist, song = parts
    if not artist or not song or len(artist) > 60 or len(song) > 80:
        return None
    return artist, song.strip("\"'")


def _clean_line(line: str) -> str:
    line = _URL.sub(lambda m: m.group(1) or "", html.unescape(line))
    line = re.sub(r"[*_`#]+|&#x200B;|\u200b", "", line)
    line = re.sub(r"(?<!\w)[:;=]-?[()DPp]+|[\U0001F300-\U0001FAFF\u2600-\u27BF]", "", line)  # emoticons, emoji
    return line.strip(" \t-•*")


def find_vst(line: str) -> tuple[str, re.Match] | None:
    hits = [(canonical, m) for canonical, rx in _ALIAS_RE if (m := rx.search(line))]
    if not hits:
        return None
    specific = [h for h in hits if h[0] not in _HOSTS]
    return (specific or hits)[0]


def preset_from_line(line: str, carried_vst: str | None = None) -> tuple[str, str] | None:
    """One line → (vst, preset), or None when the line names no synth (or carried one) or no preset."""
    if _TIP.match(line):
        return None
    hit = find_vst(line)
    if hit:
        vst, m = hit
        rest = line[: m.start()] + " | " + line[m.end() :]
    elif carried_vst:
        vst, rest = carried_vst, line
    else:
        return None
    # Everything except the synth name, split into path segments ("Pads > PD Quasar").
    rest = _VENDOR.sub("", rest).strip()
    rest = re.sub(r"\((?:[^)]*(?:turn|remove|add|set|eq|with|half|off)[^)]*)\)", "", rest, flags=re.I)  # tweak tips
    segments = [_FILLER.sub("", s).strip(" '\"“”.,;") for s in _SEPARATORS.split(rest)]
    segments = [s.strip(" -") for s in segments]
    segments = [s for s in segments if s and not re.fullmatch(r"(?:factory|stock|default|presets?|bank|vst)", s, re.I)]
    if not segments:
        return None
    preset = segments[-1]
    if _PROSE.search(preset) or any(_PROSE.search(seg) for seg in segments[:-1]):
        return None
    if _GENERIC.fullmatch(preset) or any(_CREDIT.search(seg) for seg in segments) or find_vst(preset):
        return None
    category = " › ".join(segments[:-1][-2:])
    if len(preset) < 2 or len(preset) > 60:
        return None
    return vst, f"{preset} ({category})" if category else preset


def parse_post(title: str, selftext: str) -> Parsed | Rejected:
    names = split_title(title)
    if not names:
        return Rejected("title is not 'Artist - Song'")
    text = selftext or ""
    if text.strip() in ("", "[removed]", "[deleted]"):
        return Rejected("no post text")
    lines = [_clean_line(line) for line in re.split(r"\n+|<br>", text)]
    lines = [line for line in lines if line]
    if any(_HEDGES.search(line) for line in lines):
        return Rejected("answer is hedged")
    found: list[tuple[str, str]] = []
    carried: str | None = None  # "VST: Twin 2" on one line, "Preset: X" on the next
    for line in lines:
        hit = preset_from_line(line, carried)
        if hit:
            found.append(hit)
        elif (v := find_vst(line)) and len(_VENDOR.sub("", _FILLER.sub("", line)).strip()) <= len(v[1].group(0)) + 2:
            carried = v[0]
    if not found:
        return Rejected("no known synth + preset in the post")
    if len(found) > 3:
        return Rejected("too many sounds to summarise automatically")
    vsts = list(dict.fromkeys(v for v, _ in found))
    if len(vsts) > 2:
        return Rejected("more than two synths")
    artist, song = names
    return Parsed(artist=artist, song=song, vst=" · ".join(vsts), preset=" · ".join(p for _, p in found))
