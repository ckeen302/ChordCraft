"""Popular Songs CLI.

    uv run python -m chordcraft.songs ingest db/songs-candidates.txt
    uv run python -m chordcraft.songs export ../lib/data/popular-songs.json
    uv run python -m chordcraft.songs stats

Set SONGS_HTTP_CACHE=<dir> to cache fetched pages between runs.
"""

from __future__ import annotations

import argparse
from pathlib import Path

from . import db
from .ingest import ingest, read_candidates


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m chordcraft.songs")
    ap.add_argument("--db", type=Path, help="database file (default: backend/db/songs.sqlite)")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("stats")
    p_ingest = sub.add_parser("ingest", help="verify candidates against TheoryTab + songbpm and store them")
    p_ingest.add_argument("candidates", type=Path)
    p_ingest.add_argument("--workers", type=int, default=1, help="candidates verified in parallel")
    p_export = sub.add_parser("export", help="write the JSON the site bundles")
    p_export.add_argument("out", type=Path)
    args = ap.parse_args(argv)

    with db.open_db(args.db) as conn:
        if args.cmd == "stats":
            songs = conn.execute("SELECT count(*) FROM songs").fetchone()[0]
            chords = conn.execute("SELECT count(*) FROM song_chords").fetchone()[0]
            rejected = conn.execute("SELECT count(*) FROM rejected").fetchone()[0]
            print(f"{songs} songs ({chords} chords), {rejected} candidates rejected")
        elif args.cmd == "ingest":
            print(ingest(conn, read_candidates(args.candidates), workers=args.workers).summary())
        elif args.cmd == "export":
            print(f"exported {db.export_json(conn, args.out)} songs to {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
