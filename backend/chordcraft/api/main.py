"""ChordCraft API.

Run locally:  uv run uvicorn chordcraft.api.main:app --reload
Docs:         http://localhost:8000/docs
"""

from __future__ import annotations

import os
import random
import sqlite3
from dataclasses import replace
from typing import Literal

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from chordcraft.presets import db as presets_db
from chordcraft.songs import db as songs_db
from chordcraft.theory import (
    KEY_NAMES,
    KEYS,
    NOTE_MAP,
    QUALITY_INTERVALS,
    ChordParseError,
    analyze_progression,
    parse_chord,
    parse_chord_strict,
)
from chordcraft.theory.analysis import FAMILY
from chordcraft.theory.harmony import MOOD_LABELS, MOODS, PROFILES, generate_smart, spell_degrees
from chordcraft.theory.voicing import voice_lead_progression

from .model_engine import ModelEngine
from .schemas import (
    AnalyzeRequest,
    AnalyzeResponse,
    Chord,
    GenerateRequest,
    GenerateResponse,
    MetaResponse,
    ParseRequest,
    ParseResponse,
    ParseResult,
    PresetFacets,
    PresetOut,
    PresetPage,
    SongOut,
    SongPage,
    ValidatedChord,
    ValidateRequest,
    ValidateResponse,
    VstCount,
)

engine = ModelEngine()

app = FastAPI(
    title="ChordCraft API",
    version="0.1.0",
    description="Chord theory engine and progression generation for ChordCraft.",
)

# Local dev servers plus any deployed frontends (comma-separated env var).
_origins = [o.strip() for o in os.getenv("ALLOWED_ORIGINS", "").split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    # Local dev on any port, plus an optional pattern for deployed frontends
    # (e.g. every Vercel preview of the project).
    allow_origin_regex=r"^http://localhost:\d+$" + (
        f"|{os.environ['ALLOWED_ORIGIN_REGEX']}" if os.getenv("ALLOWED_ORIGIN_REGEX") else ""
    ),
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "model": engine.available}


@app.get("/v1/meta", response_model=MetaResponse)
def meta() -> MetaResponse:
    status = engine.status()
    return MetaResponse(keys=KEY_NAMES, moods=MOOD_LABELS, qualities=list(QUALITY_INTERVALS),
                        model={"available": status["available"], "error": status["error"]})


@app.post("/v1/parse", response_model=ParseResponse)
def parse(req: ParseRequest) -> ParseResponse:
    results = []
    for sym in req.symbols:
        try:
            chord = parse_chord(sym, strict=req.strict)
            results.append(ParseResult(symbol=sym, ok=True, chord=Chord(**chord.to_dict())))
        except ChordParseError as e:
            results.append(ParseResult(symbol=sym, ok=False, error=str(e)))
    return ParseResponse(results=results)


@app.post("/v1/analyze", response_model=AnalyzeResponse)
def analyze(req: AnalyzeRequest) -> AnalyzeResponse:
    chords = [parse_chord(s) for s in req.symbols if _parses(s)]
    result = analyze_progression(chords, req.key, req.patternName)
    return AnalyzeResponse(romans=result.romans, summary=result.summary)


@app.post("/v1/validate", response_model=ValidateResponse)
def validate(req: ValidateRequest) -> ValidateResponse:
    """Check model output: strict parse, roman numeral, and diatonic membership per chord."""
    pool = {_root_pc_family(sym) for sym in KEYS[req.key]}
    out: list[ValidatedChord] = []
    parsed = []
    for sym in req.symbols:
        try:
            c = parse_chord_strict(sym)
        except ChordParseError as e:
            out.append(ValidatedChord(symbol=sym, ok=False, error=str(e)))
            continue
        parsed.append(c)
        fam = FAMILY.get(c.quality, "maj")
        pc = NOTE_MAP[c.root] % 12
        diatonic = any(p == pc for p, _ in pool) if fam == "sus" else (pc, fam) in pool
        out.append(ValidatedChord(symbol=sym, ok=True, diatonic=diatonic))

    romans = analyze_progression(parsed, req.key).romans if len(parsed) >= 2 else []
    for vc, roman in zip((v for v in out if v.ok), romans, strict=False):
        vc.roman = roman

    ok = [v for v in out if v.ok]
    return ValidateResponse(
        valid=len(ok) == len(out),
        diatonicRatio=round(sum(v.diatonic for v in ok) / len(ok), 4) if ok else 0.0,
        chords=out,
    )


@app.post("/v1/generate", response_model=GenerateResponse)
def generate(req: GenerateRequest) -> GenerateResponse:
    rng = random.Random(req.seed)
    mood = rng.choice(MOODS) if req.mood == "random" else req.mood
    use_model = req.engine == "model" or (req.engine == "auto" and engine.available)
    if use_model:
        if not engine.available:
            raise HTTPException(503, f"Chord model unavailable: {engine.status()['error']}")
        return _generate_with_model(req, mood, rng)

    r = generate_smart(req.key, mood, req.length, req.excludeDiminished, req.chromaticColor, rng)
    return GenerateResponse(
        engine="rules",
        key=req.key,
        mood=mood,
        chords=[Chord(**c.to_dict()) for c in r.chords],
        romans=r.romans,
        patternName=r.pattern_name,
        bpm=r.bpm,
        instrument=r.instrument,
        rollMs=r.roll_ms,
    )


def _generate_with_model(req: GenerateRequest, mood: str, rng: random.Random) -> GenerateResponse:
    """Sample degrees from the transformer, then reuse the theory pipeline: spell, time, voice-lead."""
    mode = "minor" if req.key.endswith("Minor") else "major"
    result = engine.generate(mode=mode, length=req.length, mood=mood,
                             exclude_diminished=req.excludeDiminished, seed=req.seed)
    profile = PROFILES[mood]
    symbols = spell_degrees(req.key, result.degrees)
    rhythm = profile.rhythm
    chords = [replace(parse_chord(s), beats=rhythm[i % len(rhythm)]) for i, s in enumerate(symbols)]
    chords = voice_lead_progression(chords)
    lo, hi = profile.bpm
    return GenerateResponse(
        engine="model",
        key=req.key,
        mood=mood,
        chords=[Chord(**c.to_dict()) for c in chords],
        romans=analyze_progression(chords, req.key).romans,
        patternName="AI · chord transformer",
        bpm=round(lo + rng.random() * (hi - lo)),
        instrument=rng.choice(profile.instruments),
        rollMs=profile.roll_ms,
    )


# ── Preset Finder ────────────────────────────────────────────────────────────


def _presets_conn():
    try:
        return presets_db.connect_readonly()
    except sqlite3.Error as e:
        raise HTTPException(503, f"Preset database unavailable: {e}") from e


@app.get("/v1/presets", response_model=PresetPage)
def list_presets(
    q: str = Query("", max_length=100, description="Full-text search over artist, song, synth and preset"),
    vst: str | None = Query(None, max_length=100),
    source: Literal["Reddit", "YouTube", "Web"] | None = None,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> PresetPage:
    conn = _presets_conn()
    try:
        page = presets_db.query(conn, q=q, vst=vst, source=source, limit=limit, offset=offset)
    finally:
        conn.close()
    return PresetPage(total=page.total, offset=offset, limit=limit,
                      items=[PresetOut(**p.to_json()) for p in page.items])


@app.get("/v1/presets/facets", response_model=PresetFacets)
def preset_facets() -> PresetFacets:
    conn = _presets_conn()
    try:
        vsts = presets_db.vst_counts(conn)
        sources = dict(conn.execute("SELECT source_kind, count(*) FROM presets GROUP BY 1").fetchall())
    finally:
        conn.close()
    return PresetFacets(total=sum(n for _, n in vsts), vsts=[VstCount(vst=v, count=n) for v, n in vsts],
                        sources=sources)


@app.get("/v1/presets/{preset_id}", response_model=PresetOut)
def get_preset(preset_id: str) -> PresetOut:
    conn = _presets_conn()
    try:
        preset = presets_db.get(conn, preset_id)
    finally:
        conn.close()
    if not preset:
        raise HTTPException(404, f"No preset with id {preset_id!r}")
    return PresetOut(**preset.to_json())


# ── Popular Songs ────────────────────────────────────────────────────────────


def _songs_conn():
    try:
        return songs_db.connect_readonly()
    except sqlite3.Error as e:
        raise HTTPException(503, f"Songs database unavailable: {e}") from e


@app.get("/v1/songs", response_model=SongPage)
def list_songs(
    q: str = Query("", max_length=100, description="Full-text search over title and artist"),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> SongPage:
    conn = _songs_conn()
    try:
        total, songs = songs_db.query(conn, q=q, limit=limit, offset=offset)
    finally:
        conn.close()
    return SongPage(total=total, offset=offset, limit=limit, items=[SongOut(**s.to_json()) for s in songs])


@app.get("/v1/songs/{song_id}", response_model=SongOut)
def get_song(song_id: str) -> SongOut:
    conn = _songs_conn()
    try:
        song = songs_db.get(conn, song_id)
    finally:
        conn.close()
    if not song:
        raise HTTPException(404, f"No song with id {song_id!r}")
    return SongOut(**song.to_json())


def _parses(symbol: str) -> bool:
    try:
        parse_chord(symbol)
        return True
    except ChordParseError:
        return False


def _root_pc_family(sym: str) -> tuple[int, str]:
    root = sym[:2] if len(sym) > 1 and sym[1] in "#b" else sym[0]
    rest = sym[len(root) :]
    fam = "dim" if rest == "dim" else "min" if rest == "m" else "maj"
    return NOTE_MAP[root] % 12, fam
