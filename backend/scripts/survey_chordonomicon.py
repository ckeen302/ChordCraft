"""One-off survey of the raw Chordonomicon CSV: genres, suffix vocabulary, lengths."""
import csv
import re
import sys
from collections import Counter

path = sys.argv[1]
csv.field_size_limit(10**8)
genres, suffixes, sections, lengths = Counter(), Counter(), Counter(), []
rows = 0
with open(path, newline="", encoding="utf-8") as f:
    for row in csv.DictReader(f):
        rows += 1
        genres[row["main_genre"]] += 1
        toks = row["chords"].split()
        n = 0
        for t in toks:
            if t.startswith("<"):
                sections[re.sub(r"_\d+>$", ">", t)] += 1
                continue
            n += 1
            body = t.split("/")[0]
            m = re.match(r"^[A-G](s|b)?", body)
            suffixes[body[m.end():] if m else "?" + body] += 1
        lengths.append(n)
print("rows", rows)
print("genres", genres.most_common())
print("sections", sections.most_common(15))
tot = sum(suffixes.values())
print("distinct suffixes", len(suffixes), "total chords", tot)
cum = 0
for s, c in suffixes.most_common(60):
    cum += c
    print(f"  {s!r:12} {c:>10} {100*cum/tot:6.2f}%")
lengths.sort()
print("chords/song median", lengths[len(lengths)//2], "p95", lengths[int(len(lengths)*.95)])
