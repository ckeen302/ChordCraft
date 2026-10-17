"""MIDI audit, part 1: dump TheoryTab's raw chords for a sample of the library.

    SONGS_HTTP_CACHE=... uv run python scripts/audit_expected.py <N songs> expected.json
    npx tsx scripts/audit-midi.ts expected.json      # part 2 (repo root)

Reads each song's section straight from TheoryTab (not from the database) and writes every chord's
pitch classes and start beat, for comparison with the exported MIDI.
"""
import json
import random
import sys

from chordcraft.songs import db, http
from chordcraft.songs.hooktheory import MODES, PC, chord_tones, parse_page, section_json, time_signature

with db.open_db() as conn:
    songs = db.all_songs(conn)
random.seed(7)
sample = random.sample(songs, int(sys.argv[1]))
out = []
for s in sample:
    tab = parse_page(s.sourceUrl, http.get(s.sourceUrl))
    meta = next(m for m in tab.sections if m["name"] == s.section)
    raw = section_json(meta["hash"])
    k = raw["keys"][0]
    tonic, home = PC[k["tonic"]], MODES[k["scale"]]
    sig, unit = time_signature(raw["meters"], raw["endBeat"])
    rawbpm = raw["tempos"][0]["bpm"]
    if unit == 1 and sig in ("6/4", "12/4") and rawbpm >= 120:
        unit = 3  # the converter's compound-ballad rule, see hooktheory.convert
    chords = [c for c in raw["chords"] if not c.get("isRest")]
    seq = []
    for c in chords:
        ch = chord_tones(c, home)
        pcs = sorted({(tonic + ch.root + i) % 12 for i in ch.intervals}
                     | ({(tonic + ch.root + ch.intervals[c["inversion"]]) % 12} if c.get("inversion") else set()))
        beat = c["beat"] / unit
        root = (tonic + ch.root) % 12
        if seq and seq[-1]["pcs"] == pcs and seq[-1]["inv"] == c.get("inversion", 0) and seq[-1]["root"] == root:
            seq[-1]["beats"] += c["duration"] / unit
        else:
            seq.append({"pcs": pcs, "inv": c.get("inversion", 0), "root": root, "start": beat,
                        "beats": c["duration"] / unit})
    out.append({"id": s.id, "title": s.title, "artist": s.artist, "year": s.year, "section": s.section,
                "rawBpm": rawbpm, "unit": unit, "raw": seq})
with open(sys.argv[2], "w") as f:
    json.dump(out, f, indent=1)
print(len(out))
