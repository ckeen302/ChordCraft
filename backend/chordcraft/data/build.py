"""Build the chord-model training set from the raw Chordonomicon CSV.

    uv run python -m chordcraft.data.build \\
        --raw data/raw/chordonomicon/chordonomicon_v2.csv --out data/processed

Pipeline per song: normalise chords → estimate key over the whole song →
one key-relative phrase per section (repeats merged, loops reduced to a
cycle) → weak mood label → split by artist (no artist spans two splits) →
cap duplicates of each identical phrase so stock loops can't drown the rest.

Outputs ``{train,val,test}.jsonl.gz``, ``vocab.json``, and ``stats.json``.
"""

from __future__ import annotations

import argparse
import csv
import gzip
import json
import time
import zlib
from collections import Counter
from contextlib import ExitStack
from pathlib import Path

from .chordonomicon import normalize_chord, parse_sections
from .keyfind import estimate_key
from .moods import label_mood
from .phrases import MAX_LEN, extract_phrase, to_degrees
from .tokenizer import GENRES, ChordTokenizer

MAX_DROPPED_SHARE = 0.10  # skip songs where >10% of chords are unparseable
MIN_SONG_CHORDS = 4


def split_for(artist: str) -> str:
    bucket = zlib.crc32(artist.encode()) % 100
    return "train" if bucket < 90 else "val" if bucket < 95 else "test"


def build(raw: Path, out: Path, dup_cap: int, limit: int | None) -> dict:
    out.mkdir(parents=True, exist_ok=True)
    csv.field_size_limit(10**8)
    stack = ExitStack()
    writers = {
        s: stack.enter_context(gzip.open(out / f"{s}.jsonl.gz", "wt", encoding="utf-8"))  # noqa: SIM115
        for s in ("train", "val", "test")
    }
    dup_counts: Counter[tuple] = Counter()
    stats: dict[str, Counter] = {k: Counter() for k in (
        "songs", "phrases", "mode", "mood", "mood_source", "genre", "length", "quality", "chords")}
    started = time.time()

    with stack, open(raw, newline="", encoding="utf-8") as f:
        for i, row in enumerate(csv.DictReader(f)):
            if limit and i >= limit:
                break
            stats["songs"]["read"] += 1
            sections = parse_sections(row["chords"])
            norm_sections, total, dropped = [], 0, 0
            for name, tokens in sections:
                chords = []
                for t in tokens:
                    total += 1
                    c = normalize_chord(t)
                    if c is None:
                        dropped += 1
                    else:
                        chords.append(c)
                        stats["chords"]["approx" if c.approx else "exact"] += 1
                norm_sections.append((name, chords))
            stats["chords"]["dropped"] += dropped
            all_chords = [c for _, cs in norm_sections for c in cs]
            if len(all_chords) < MIN_SONG_CHORDS or (total and dropped / total > MAX_DROPPED_SHARE):
                stats["songs"]["skipped"] += 1
                continue
            key = estimate_key(all_chords)
            if key is None:
                stats["songs"]["skipped"] += 1
                continue
            stats["songs"]["used"] += 1

            genre = row["main_genre"] if row["main_genre"] in GENRES else "any"
            split = split_for(row["artist_id"] or row["id"])
            seen_in_song: set[tuple] = set()
            for name, chords in norm_sections:
                phrase = extract_phrase(to_degrees(chords, key.tonic))
                if phrase is None or tuple(phrase) in seen_in_song:
                    continue
                seen_in_song.add(tuple(phrase))
                dup_key = (key.mode, tuple(phrase))
                if dup_counts[dup_key] >= dup_cap:
                    stats["phrases"]["capped"] += 1
                    continue
                dup_counts[dup_key] += 1
                mood, source = label_mood(phrase, key.mode, genre)
                record = {
                    "id": row["id"], "section": name, "mode": key.mode, "genre": genre,
                    "mood": mood, "moodSource": source, "decade": row["decade"] or None,
                    "keyMargin": round(key.margin, 4), "degrees": [list(d) for d in phrase],
                }
                writers[split].write(json.dumps(record, separators=(",", ":")) + "\n")
                stats["phrases"][split] += 1
                stats["mode"][key.mode] += 1
                stats["mood"][mood] += 1
                stats["mood_source"][source] += 1
                stats["genre"][genre] += 1
                stats["length"][len(phrase)] += 1
                for _, q in phrase:
                    stats["quality"][q] += 1
            if (i + 1) % 100_000 == 0:
                print(f"  {i + 1:,} songs  ({time.time() - started:.0f}s)", flush=True)

    ChordTokenizer().save(out / "vocab.json")
    summary = {k: dict(v.most_common()) for k, v in stats.items()}
    summary["unique_phrases"] = len(dup_counts)
    summary["max_len"] = MAX_LEN
    summary["dup_cap"] = dup_cap
    summary["seconds"] = round(time.time() - started, 1)
    (out / "stats.json").write_text(json.dumps(summary, indent=1))
    return summary


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--raw", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--dup-cap", type=int, default=50, help="max copies of any identical phrase")
    ap.add_argument("--limit", type=int, default=None, help="only read the first N songs")
    args = ap.parse_args()
    s = build(args.raw, args.out, args.dup_cap, args.limit)
    print(json.dumps({k: s[k] for k in ("songs", "phrases", "unique_phrases", "mood_source", "seconds")}, indent=1))


if __name__ == "__main__":
    main()
