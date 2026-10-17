// ─── Chord Theory ────────────────────────────────────────────────────────────

export type ChordQuality =
  | 'maj' | 'm' | 'dim' | 'aug'
  | '7' | 'maj7' | 'm7' | 'dim7'
  | 'sus2' | 'sus4'
  | '6' | 'm6'
  | '7sus4' | 'add9' | '9' | 'm9'
  | 'mmaj7' | 'maj9' | 'm7b5'
  | '11' | 'm11' | '13'
  | '7b9' | '7#9' | '5';

export interface ParsedChord {
  /** Original symbol as written, e.g. "F#m7" or "G/B" */
  symbol: string;
  /** Root note letter + optional accidental, e.g. "F#" */
  root: string;
  /** Normalised chord quality */
  quality: ChordQuality;
  /** MIDI note numbers for every note in the voicing */
  notes: number[];
  /**
   * Short display suffix rendered below the root on a chord card.
   * Empty string for major chords (root alone is sufficient).
   */
  displayQuality: string;
  /**
   * Duration in quarter-note beats. When set (song progressions), it overrides
   * the transport's global beats-per-chord; generated chords leave it unset.
   */
  beats?: number;
}

// ─── Piano-roll note events ──────────────────────────────────────────────────

/**
 * A single note in the piano roll — FL Studio-style, with its own position,
 * length, and velocity, independent of chord columns.
 */
export interface NoteEvent {
  /** Stable id for React keys, selection, and drag tracking. */
  id: string;
  /** MIDI pitch. */
  midi: number;
  /** Start position in quarter-note beats from the top of the progression. */
  start: number;
  /** Length in quarter-note beats. */
  duration: number;
  /** Normalised velocity 0–1 (FL's default is ~0.78). */
  velocity: number;
}

// ─── Playback ────────────────────────────────────────────────────────────────

export type InstrumentName =
  | 'Piano'
  | 'Electric Piano'
  | 'Pad'
  | 'Synth Lead'
  | 'Organ'
  | 'Guitar'
  | 'Strings'
  | 'Bass'
  | 'Harp'
  | 'Bell'
  | 'Brass';
