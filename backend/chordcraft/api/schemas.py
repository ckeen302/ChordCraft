"""Request/response models. Field names match the TypeScript frontend (camelCase)."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from chordcraft.theory import KEY_NAMES
from chordcraft.theory.harmony import MOODS

KeyName = Literal[tuple(KEY_NAMES)]  # type: ignore[valid-type]
MoodName = Literal[tuple(MOODS)]  # type: ignore[valid-type]


class Chord(BaseModel):
    symbol: str
    root: str
    quality: str
    notes: list[int]
    displayQuality: str  # noqa: N815
    beats: float | None = None


class ParseRequest(BaseModel):
    symbols: list[str] = Field(min_length=1, max_length=64)
    strict: bool = True


class ParseResult(BaseModel):
    symbol: str
    ok: bool
    chord: Chord | None = None
    error: str | None = None


class ParseResponse(BaseModel):
    results: list[ParseResult]


class AnalyzeRequest(BaseModel):
    symbols: list[str] = Field(min_length=1, max_length=64)
    key: KeyName
    patternName: str | None = None  # noqa: N815


class AnalyzeResponse(BaseModel):
    romans: list[str]
    summary: str


class ValidateRequest(BaseModel):
    symbols: list[str] = Field(min_length=1, max_length=64)
    key: KeyName


class ValidatedChord(BaseModel):
    symbol: str
    ok: bool
    error: str | None = None
    roman: str | None = None
    diatonic: bool = False


class ValidateResponse(BaseModel):
    valid: bool
    """Every symbol parsed strictly."""
    diatonicRatio: float  # noqa: N815
    """Share of chords drawn from the key's diatonic set (chromatic colour is allowed, just measured)."""
    chords: list[ValidatedChord]


class GenerateRequest(BaseModel):
    key: KeyName = "C Major"
    mood: MoodName | Literal["random"] = "random"
    length: int = Field(4, ge=2, le=16)
    excludeDiminished: bool = False  # noqa: N815
    chromaticColor: bool = False  # noqa: N815
    seed: int | None = Field(None, ge=0, le=2**63 - 1)
    engine: Literal["auto", "model", "rules"] = "auto"
    """auto = the trained chord transformer when loaded, else the rule engine."""


class GenerateResponse(BaseModel):
    engine: Literal["rules", "model"]
    """Which generator produced this progression."""
    key: str
    mood: str
    chords: list[Chord]
    romans: list[str]
    patternName: str  # noqa: N815
    bpm: int
    instrument: str
    rollMs: int  # noqa: N815


class MetaResponse(BaseModel):
    keys: list[str]
    moods: dict[str, str]
    qualities: list[str]
    model: dict


class PresetOut(BaseModel):
    id: str
    artist: str
    context: str
    vst: str
    preset: str
    notes: str
    status: Literal["confirmed", "community"]
    sourceUrl: str  # noqa: N815
    sourceLabel: str  # noqa: N815


class PresetPage(BaseModel):
    total: int
    offset: int
    limit: int
    items: list[PresetOut]


class VstCount(BaseModel):
    vst: str
    count: int


class PresetFacets(BaseModel):
    total: int
    vsts: list[VstCount]
    sources: dict[str, int]


class SongChordOut(BaseModel):
    symbol: str
    beats: float


class SongOut(BaseModel):
    id: str
    title: str
    artist: str
    year: int
    key: str
    mode: str
    bpm: float
    timeSignature: str  # noqa: N815
    section: str
    sourceUrl: str  # noqa: N815
    youtubeId: str | None  # noqa: N815
    tempoCheckUrl: str | None  # noqa: N815
    tempoCheckBpm: float | None  # noqa: N815
    keyCheck: Literal["exact", "relative", "differs", "unavailable"]  # noqa: N815
    tempoSourceUrl: str | None = None  # noqa: N815
    tempoSourceBpm: float | None = None  # noqa: N815
    chords: list[SongChordOut]


class SongPage(BaseModel):
    total: int
    offset: int
    limit: int
    items: list[SongOut]
