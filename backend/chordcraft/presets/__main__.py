"""Preset library CLI.

    uv run python -m chordcraft.presets stats
    uv run python -m chordcraft.presets ingest [--dry-run] [--since UNIX_TIME]
    uv run python -m chordcraft.presets export ../public/data/presets.json
    uv run python -m chordcraft.presets import-json presets.json   # one-off seeding
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import UTC, datetime
from pathlib import Path

from . import db
from .ingest import WATERMARK, ingest


def export(conn, out: Path) -> int:
    """Write the static snapshot the site falls back to when no API is configured."""
    presets = db.all_presets(conn)
    payload = {
        "generatedAt": datetime.now(UTC).replace(microsecond=0).isoformat(),
        "count": len(presets),
        "vsts": [{"vst": v, "count": n} for v, n in db.vst_counts(conn)],
        "presets": [p.to_json() for p in presets],
    }
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n")
    return len(presets)


def import_json(conn, path: Path) -> tuple[int, int]:
    added = skipped = 0
    for raw in json.loads(path.read_text()):
        post = re.search(r"/comments/([a-z0-9]+)/", raw["sourceUrl"])
        preset = db.Preset(**{k: raw[k] for k in db.Preset.__dataclass_fields__})
        if db.insert(conn, preset, reddit_post=post.group(1) if post else None):
            added += 1
        else:
            skipped += 1
            print(f"  skipped duplicate: {preset.id}", file=sys.stderr)
    conn.commit()
    return added, skipped


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m chordcraft.presets")
    ap.add_argument("--db", type=Path, help="database file (default: backend/db/presets.sqlite)")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("stats")
    p_ingest = sub.add_parser("ingest", help="pull new solved threads from the Arctic Shift archive")
    p_ingest.add_argument("--dry-run", action="store_true")
    p_ingest.add_argument("--since", type=int, help="override the stored watermark (unix time)")
    p_export = sub.add_parser("export", help="write the static JSON snapshot")
    p_export.add_argument("out", type=Path)
    p_import = sub.add_parser("import-json", help="seed from a JSON array of PresetEntry objects")
    p_import.add_argument("path", type=Path)
    p_mark = sub.add_parser("set-watermark", help="set the ingest watermark (unix time)")
    p_mark.add_argument("utc", type=int)
    args = ap.parse_args(argv)

    with db.open_db(args.db) as conn:
        if args.cmd == "stats":
            total = conn.execute("SELECT count(*) FROM presets").fetchone()[0]
            queued = conn.execute("SELECT count(*) FROM review_queue").fetchone()[0]
            by_source = dict(conn.execute("SELECT source_kind, count(*) FROM presets GROUP BY 1").fetchall())
            print(f"{total} presets {by_source}, {queued} queued for review, "
                  f"watermark {db.get_meta(conn, WATERMARK, '0')}")
        elif args.cmd == "ingest":
            report = ingest(conn, since=args.since, dry_run=args.dry_run)
            print(report.summary())
            for preset_id in report.added:
                print(f"  + {preset_id}")
        elif args.cmd == "export":
            print(f"exported {export(conn, args.out)} presets to {args.out}")
        elif args.cmd == "import-json":
            added, skipped = import_json(conn, args.path)
            print(f"imported {added}, skipped {skipped} duplicates")
        elif args.cmd == "set-watermark":
            db.set_meta(conn, WATERMARK, str(args.utc))
            conn.commit()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
