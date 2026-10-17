'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  Shuffle, ChevronDown, Download, Copy, ArrowRight, Music, Sparkles, Dices,
  Loader2, History, Trash2, Undo2, Redo2, Bookmark, BookmarkPlus, X, Check, Brain,
} from 'lucide-react'
import { ChordStrip } from './ChordStrip'
import { ChatPanel, type ChatMessage } from './ChatPanel'
import { PianoRoll } from '@/components/piano/PianoRoll'
import { useStore } from '@/store/useStore'
import { useProgressionEditor } from '@/hooks/useProgressionEditor'
import {
  generateSmartRich,
  generateRandom,
  generateFromTemplate,
  TEMPLATE_NAMES,
  MOOD_LABELS,
  type Mood,
} from '@/lib/theory/progressions'
import { KEY_NAMES } from '@/lib/theory/keys'
import { MOOD_MODE } from '@/lib/theory/harmony'
import { parallelKey, transposeKeyName } from '@/lib/theory/transpose'
import { DEFAULT_SETTINGS, parseRequest, type ChatSettings } from '@/lib/chat/parse'
import { describeProgression, HELP_TEXT, UNKNOWN_TEXT } from '@/lib/chat/reply'
import { analyzeProgression } from '@/lib/theory/analysis'
import { setChordRoll } from '@/lib/audio/engine'
import { loadChordModel } from '@/lib/ai/model'
import { generateWithModel } from '@/lib/ai/generate'
import { downloadMidiFromNotes, GM_PROGRAM } from '@/lib/midi/export'
import { copyToClipboard, progressionToString } from '@/lib/utils'
import { cn } from '@/lib/utils'
import type { InstrumentName, ParsedChord } from '@/types'

const INSTRUMENTS: InstrumentName[] = [
  'Piano', 'Electric Piano', 'Pad', 'Synth Lead', 'Organ',
  'Guitar', 'Strings', 'Bass', 'Harp', 'Bell', 'Brass',
]

const MOODS = Object.entries(MOOD_LABELS) as [Mood, string][]

const MOOD_DESCRIPTIONS: Record<Mood, string> = {
  uplifting:   'Axis anthems (I–V–vi–IV), Mixolydian bVII lifts, add9 shimmer — "Don\'t Stop Believin\'", "Let It Be", stadium EDM.',
  melancholic: 'The sad-pop loop, Andalusian descents, and the "saddest move" IV→iv ("Creep", "In My Life"). Slow, low, unresolved.',
  dreamy:      'Lydian I–II floats ("Dreams", "Teenage Dream"), plagal drift, maj7 on everything. No dominant pull — weightless.',
  romantic:    'Standards turnarounds, the "All of Me" yearning loop, III7 drama, half-cadence longing. maj7 and 9ths throughout.',
  nostalgic:   'Doo-wop changes ("Stand By Me", "Blue Moon"), vintage 6ths, the golden III7 mediant, and the sepia IV→iv fade.',
  tense:       'Phrygian bII stabs, Herrmann\'s "Hitchcock chord" (mΔ7), Psycho dim7 drift. Thriller unease that refuses to resolve.',
  jazz:        'ii–V–I engines, tritone subs, backdoor cadences, secondary-dominant chains. Everything wears 7ths, 9ths, and 6ths.',
  epic:        'The minor axis ("Numb"), the Mario cadence bVI–bVII–I, battle loops — trailer-sized, ending unresolved on VII.',
  aggressive:  'Phrygian i–bII slams, metal i–VI–VII loops, punk I–IV–V at 140+ BPM. Raw triads, no ornaments.',
}

function SelectField({
  label, value, onChange, children, icon,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  children: React.ReactNode
  icon?: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[10px] text-text-muted font-semibold uppercase tracking-[2px]">{label}</label>
      <div className="relative flex items-center">
        {icon && <span className="absolute left-2.5 text-text-muted pointer-events-none">{icon}</span>}
        <select
          value={value}
          // Blur after choosing so Space returns to play/pause instead of
          // reopening the dropdown (focused selects swallow the shortcut).
          onChange={e => { onChange(e.target.value); e.target.blur() }}
          className={cn(
            'appearance-none w-full bg-bg-raised border border-border rounded-xl',
            'text-sm text-text pr-8 py-2 cursor-pointer',
            'focus:outline-none focus:border-accent/50',
            icon ? 'pl-7' : 'pl-3',
          )}
        >
          {children}
        </select>
        <ChevronDown size={12} className="absolute right-2.5 text-text-muted pointer-events-none" />
      </div>
    </div>
  )
}

export function ChordLab({ active = true }: { active?: boolean }) {
  const { progression: storeProgression, source, bpm, setBpm, instrument, setInstrument } = useStore()

  const {
    selectedKey, setSelectedKey,
    localChords, localNotes, romans, patternName, rolledMood,
    history, saved, canUndo, canRedo, undo, redo,
    loadGenerated, recallHistory, clearHistory,
    saveCurrent, deleteSaved, loadSaved,
    handleRollChange, deleteChord, appendChordSlot, transpose,
  } = useProgressionEditor({ active })

  const [mode, setMode]               = useState<'ai' | 'smart' | 'random' | string>('ai')
  // The AI model runs in the browser; it starts downloading (15 MB) shortly
  // after the page loads so the first Generate doesn't wait on it.
  const [aiStatus, setAiStatus]       = useState<'loading' | 'ready' | 'error'>('loading')
  // Default is 'random' — a fresh mood is rolled on every generate; picking
  // a specific mood pins it (like the old behaviour) until Random is chosen again.
  const [mood, setMood]               = useState<Mood | 'random'>('random')
  const [length, setLength]           = useState(4)
  const [excludeDim, setExcludeDim]   = useState(false)
  const [chromatic, setChromatic]     = useState(false)
  const [autoVibe, setAutoVibe]       = useState(true)
  const [matchKey, setMatchKey]       = useState(true)
  const [generating, setGenerating]   = useState(false)
  const [copyLabel, setCopyLabel]     = useState('Copy')
  const [error, setError]             = useState<string | null>(null)
  const [saveOpen, setSaveOpen]       = useState(false)
  const [saveName, setSaveName]       = useState('')
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [chatBusy, setChatBusy]         = useState(false)
  const [chatSettings, setChatSettings] = useState<ChatSettings>(DEFAULT_SETTINGS)

  useEffect(() => {
    let cancelled = false
    const timer = setTimeout(() => {
      loadChordModel().then(
        () => { if (!cancelled) setAiStatus('ready') },
        () => { if (!cancelled) setAiStatus('error') },
      )
    }, 1500)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [])

  function handleSaveConfirm() {
    saveCurrent(saveName)
    setSaveOpen(false)
    setSaveName('')
  }

  // ── Analysis ───────────────────────────────────────────────────────────────

  const analysis = useMemo(
    () => (localChords.length >= 2
      ? analyzeProgression(localChords, selectedKey, patternName || undefined)
      : null),
    [localChords, selectedKey, patternName],
  )

  // ── Generate / export ──────────────────────────────────────────────────────

  const isAI     = mode === 'ai'
  const isSmart  = mode === 'smart'
  const isRandom = mode === 'random'
  const usesMood = isAI || isSmart

  const isLoaded =
    localChords.length > 0 &&
    source.startsWith('Chord Lab') &&
    storeProgression.length === localChords.length &&
    storeProgression[0]?.symbol === localChords[0]?.symbol

  /** Mood tempo/timbre/articulation, or strip the harmonic rhythm when auto-vibe is off. */
  function applyVibe(chords: ParsedChord[], vibe: { bpm: number; rollMs: number; instrument: InstrumentName | null }) {
    if (!autoVibe) {
      setChordRoll(12)
      return chords.map(c => ({ ...c, beats: undefined }))
    }
    setBpm(vibe.bpm)
    setChordRoll(vibe.rollMs)
    // The mood's timbre applies only until the user picks an instrument
    // themselves — an explicit choice always wins.
    if (vibe.instrument && !useStore.getState().instrumentTouched) setInstrument(vibe.instrument)
    return chords
  }

  async function handleGenerate() {
    setError(null)
    setGenerating(true)
    try {
      let chords: ParsedChord[]
      let romans: string[] = []
      let patternName = ''
      let rolledMood: Mood | null = null
      let genKey = selectedKey
      if (isAI) {
        setAiStatus(s => (s === 'ready' ? s : 'loading'))
        const model = await loadChordModel()
        setAiStatus('ready')
        const effectiveMood: Mood = mood === 'random'
          ? MOODS[Math.floor(Math.random() * MOODS.length)][0]
          : mood
        rolledMood = mood === 'random' ? effectiveMood : null
        // Minor moods in a major key (and vice versa) blur the mood; by default
        // keep the tonic and switch to the mood's natural mode.
        if (matchKey) genKey = parallelKey(selectedKey, MOOD_MODE[effectiveMood])
        const res = await generateWithModel(model, {
          key: genKey, mood: effectiveMood, length, excludeDiminished: excludeDim,
        })
        romans = res.romans
        patternName = res.patternName
        chords = applyVibe(res.chords, { bpm: res.bpm, rollMs: res.rollMs, instrument: res.instrument })
      } else if (isSmart) {
        // 'random' rolls a fresh mood every generate; a pinned mood repeats it.
        const effectiveMood: Mood = mood === 'random'
          ? MOODS[Math.floor(Math.random() * MOODS.length)][0]
          : mood
        rolledMood = mood === 'random' ? effectiveMood : null

        const result = generateSmartRich(selectedKey, {
          mood: effectiveMood, length,
          excludeDiminished: excludeDim,
          chromaticColor: chromatic,
        })
        romans = result.romans
        patternName = result.patternName
        // Mood = harmony + rhythm + tempo + timbre + articulation.
        chords = applyVibe(result.chords, { bpm: result.bpm, rollMs: result.rollMs, instrument: result.instrument })
      } else {
        chords = isRandom
          ? generateRandom(selectedKey, length, excludeDim)
          : generateFromTemplate(selectedKey, mode)
      }

      if (!chords.length) {
        setError('Generation produced no playable chords — try again.')
        return
      }
      loadGenerated({ chords, romans, patternName, rolledMood, key: genKey })
    } catch (e) {
      if (isAI) setAiStatus('error')
      setError(isAI
        ? `The AI model couldn't run (${(e as Error).message}). Try again, or use Smart Generate.`
        : (e as Error).message)
    } finally {
      setGenerating(false)
    }
  }

  // ── Chord Chat ─────────────────────────────────────────────────────────────

  async function handleChat(text: string) {
    setChatMessages(m => [...m, { role: 'user', text }])
    const reply = (t: string) => setChatMessages(m => [...m, { role: 'assistant', text: t }])
    setChatBusy(true)
    try {
      const prev: ChatSettings = {
        ...chatSettings,
        key: chatSettings.keyPinned ? chatSettings.key : selectedKey,
        bpm: chatSettings.bpm ?? bpm,
      }
      const req = parseRequest(text, prev)
      const s = req.settings
      if (req.help) return reply(HELP_TEXT)
      if (req.unknown) return reply(UNKNOWN_TEXT)

      if (req.transpose) {
        if (!localChords.length) return reply("There's nothing to transpose yet — describe a progression first.")
        const newKey = transposeKeyName(selectedKey, req.transpose)
        transpose(req.transpose)
        setChatSettings({ ...s, key: newKey, keyPinned: true })
        return reply(`Done — ${req.notes.join(', ')}. It's now in ${newKey}.`)
      }

      if (req.keepChords) {
        const changes: string[] = []
        if (s.bpm && s.bpm !== bpm) { setBpm(s.bpm); changes.push(`${s.bpm} BPM`) }
        if (s.instrument && s.instrument !== instrument) {
          useStore.getState().chooseInstrument(s.instrument)
          changes.push(`playing on ${s.instrument.toLowerCase()}`)
        }
        setChatSettings(s)
        return reply(changes.length
          ? `Done — ${changes.join(', ')}. Same chords.`
          : `That's already how it's set. Ask for a different mood, key, or "another one" for new chords.`)
      }

      setAiStatus(st => (st === 'ready' ? st : 'loading'))
      const model = await loadChordModel()
      setAiStatus('ready')
      const key = s.keyPinned ? s.key : parallelKey(selectedKey, MOOD_MODE[s.mood])
      const res = await generateWithModel(model, {
        key, mood: s.mood, length: s.length, excludeDiminished: s.excludeDiminished, resolve: s.resolve,
      })
      const st = useStore.getState()
      const playBpm = s.bpm ?? res.bpm
      let playInstrument = st.instrumentTouched ? st.instrument : res.instrument
      if (s.instrument) { st.chooseInstrument(s.instrument); playInstrument = s.instrument }
      else if (!st.instrumentTouched) setInstrument(res.instrument)
      setBpm(playBpm)
      setChordRoll(res.rollMs)
      // Keep the side-panel controls in step with what the chat asked for.
      setMode('ai')
      setMood(s.mood)
      setLength(s.length)
      setExcludeDim(s.excludeDiminished)
      loadGenerated({ chords: res.chords, romans: res.romans, patternName: res.patternName, rolledMood: null, key })
      setChatSettings({ ...s, key, bpm: playBpm })
      reply(describeProgression({
        chords: res.chords, romans: res.romans, key, mood: s.mood, bpm: playBpm, instrument: playInstrument,
        summary: analyzeProgression(res.chords, key).summary,
        keyFollowedMood: !s.keyPinned && key !== selectedKey, notes: req.notes,
      }))
    } catch (e) {
      setAiStatus('error')
      reply(`The AI model couldn't run (${(e as Error).message}). Check your connection and try again.`)
    } finally {
      setChatBusy(false)
    }
  }

  async function handleCopy() {
    if (!localChords.length) return
    const ok = await copyToClipboard(progressionToString(localChords.map(c => c.symbol)))
    if (ok) {
      setCopyLabel('Copied!')
      setTimeout(() => setCopyLabel('Copy'), 2000)
    }
  }

  async function handleExport() {
    if (!localNotes.length) return
    await downloadMidiFromNotes(
      localNotes,
      bpm,
      `chordcraft-${selectedKey.replace(/\s+/g, '-').toLowerCase()}`,
      GM_PROGRAM[instrument],
    )
  }

  return (
    <div className="flex h-full min-h-0">

      {/* ── Left panel: Controls ─────────────────────────────────────────── */}
      {/* Generate is the app's core action, so it's pinned in its own footer
          below — never scrolled out of view, no matter how tall the mood
          picker / saved / recent lists get. Everything else scrolls above it. */}
      <div className="w-72 flex-shrink-0 flex flex-col min-h-0 border-r border-border bg-bg-panel">
      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-5 p-6">

        <div>
          <h2 className="text-lg font-extrabold text-text">Chord Lab</h2>
          <p className="text-text-muted text-xs mt-0.5 leading-relaxed">
            Musically-informed progressions.
          </p>
        </div>

        <SelectField label="Key" value={selectedKey} onChange={setSelectedKey}>
          {KEY_NAMES.map(k => <option key={k} value={k}>{k}</option>)}
        </SelectField>

        <SelectField label="Mode" value={mode} onChange={setMode}>
          <option value="ai">
            {'✦ AI · Chord Transformer' + ({ loading: ' (loading model…)', ready: '', error: ' (unavailable)' } as const)[aiStatus]}
          </option>
          <option value="smart">◆ Smart Generate (rules)</option>
          <option value="random">🎲 Fully Random</option>
          <optgroup label="Classic Templates">
            {TEMPLATE_NAMES.map(t => <option key={t} value={t}>{t}</option>)}
          </optgroup>
        </SelectField>

        <SelectField
          label="Instrument"
          value={instrument}
          onChange={v => useStore.getState().chooseInstrument(v as InstrumentName)}
          icon={<Music size={12} />}
        >
          {INSTRUMENTS.map(i => <option key={i} value={i}>{i}</option>)}
        </SelectField>

        {/* Mood panel — shared by the AI model and the rule-based harmony engine */}
        {usesMood && (
          <div className="flex flex-col gap-4 p-3.5 rounded-xl border border-accent/20 bg-accent/5">
            <div className="flex items-center gap-2">
              {isAI ? <Brain size={12} className="text-accent" /> : <Sparkles size={12} className="text-accent" />}
              <span className="text-[10px] font-bold text-accent uppercase tracking-[2px]">
                {isAI ? 'Chord Transformer' : 'Harmony Engine'}
              </span>
            </div>
            {isAI && (
              <p className="text-[11px] text-text-dim leading-relaxed -mt-2">
                A 14M-parameter transformer trained on 1.4M progressions from real songs, running right in
                your browser. Mood steers it; every chord is spelled and checked by the theory engine.
              </p>
            )}

            {/* Mood — Random by default; pin a specific mood if you want it. */}
            <div className="flex flex-col gap-2">
              <span className="text-[10px] text-text-muted font-semibold uppercase tracking-[2px]">Mood</span>
              <div className="flex flex-wrap gap-1.5">
                <button
                  onClick={() => setMood('random')}
                  title="Roll a fresh mood — harmony, tempo, and timbre — every time you generate."
                  className={cn(
                    'flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-colors cursor-pointer',
                    mood === 'random'
                      ? 'bg-accent border-accent text-bg-deep'
                      : 'bg-bg-raised border-border text-text-muted hover:text-text',
                  )}
                >
                  <Dices size={11} />
                  Random
                </button>
                {MOODS.map(([id, label]) => (
                  <button
                    key={id}
                    onClick={() => setMood(id)}
                    className={cn(
                      'px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-colors cursor-pointer',
                      mood === id
                        ? 'bg-accent border-accent text-bg-deep'
                        : 'bg-bg-raised border-border text-text-muted hover:text-text',
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-text-dim italic leading-relaxed">
                {mood === 'random'
                  ? (rolledMood
                      ? `Rolled ${MOOD_LABELS[rolledMood]} — ${MOOD_DESCRIPTIONS[rolledMood]}`
                      : 'Each generate rolls a fresh mood — harmony, tempo, and timbre all follow it.')
                  : MOOD_DESCRIPTIONS[mood]}
              </p>
            </div>

            {/* Auto vibe: mood sets tempo + instrument too */}
            <button
              onClick={() => {
                const next = !autoVibe
                setAutoVibe(next)
                // Re-enabling is an explicit opt-in to mood timbres again.
                if (next) useStore.getState().setInstrumentTouched(false)
              }}
              title="Each mood has a researched tempo range and timbre — generating sets the transport BPM and instrument to match. Picking an instrument yourself always overrides the mood's suggestion."
              className={cn(
                'w-full py-1.5 rounded-lg text-[11px] font-semibold border transition-colors cursor-pointer',
                autoVibe
                  ? 'bg-accent/15 border-accent/40 text-accent'
                  : 'bg-bg-raised border-border text-text-muted hover:text-text',
              )}
            >
              {autoVibe ? '✓ Auto tempo & sound' : 'Auto tempo & sound'}
            </button>

            {/* Key follows mood (AI): melancholic in C → C minor */}
            {isAI && (
              <button
                onClick={() => setMatchKey(v => !v)}
                title="Keep the tonic but switch to the mood's natural mode — e.g. Melancholic in C Major plays in C Minor. Turn off to force the selected key."
                className={cn(
                  'w-full py-1.5 rounded-lg text-[11px] font-semibold border transition-colors cursor-pointer',
                  matchKey
                    ? 'bg-accent/15 border-accent/40 text-accent'
                    : 'bg-bg-raised border-border text-text-muted hover:text-text',
                )}
              >
                {matchKey ? '✓ Match key to mood' : 'Match key to mood'}
              </button>
            )}

            {/* Chromatic colour (secondary dominants) — rule engine only */}
            {isSmart && (
            <button
              onClick={() => setChromatic(v => !v)}
              title="Swap one chord for the secondary dominant (V7) of the chord after it — adds a colour chord from outside the key."
              className={cn(
                'w-full py-1.5 rounded-lg text-[11px] font-semibold border transition-colors cursor-pointer',
                chromatic
                  ? 'bg-accent/15 border-accent/40 text-accent'
                  : 'bg-bg-raised border-border text-text-muted hover:text-text',
              )}
            >
              {chromatic ? '✓ Chromatic colour (V7/x)' : 'Chromatic colour (V7/x)'}
            </button>
            )}
          </div>
        )}

        {/* Random-mode panel */}
        {isRandom && (
          <div className="flex flex-col gap-2 p-3.5 rounded-xl border border-border bg-bg-raised/50">
            <div className="flex items-center gap-2">
              <Dices size={12} className="text-text-muted" />
              <span className="text-[10px] font-bold text-text-muted uppercase tracking-[2px]">
                Pure Chance
              </span>
            </div>
            <p className="text-[11px] text-text-dim italic leading-relaxed">
              No music theory rules — every chord in the key is equally likely.
              Great for happy accidents; use Smart Generate for progressions
              that resolve.
            </p>
          </div>
        )}

        {/* Length + Avoid dim (AI, Smart, and Random) */}
        {(usesMood || isRandom) && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <span className="text-[10px] text-text-muted font-semibold uppercase tracking-[2px]">Length</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setLength(l => Math.max(2, l - 1))}
                  className="w-7 h-7 flex items-center justify-center rounded-lg bg-bg-raised border border-border text-text-muted hover:text-text cursor-pointer text-sm"
                >−</button>
                <span className="w-6 text-center font-mono text-sm text-text font-bold">{length}</span>
                <button
                  onClick={() => setLength(l => Math.min(12, l + 1))}
                  className="w-7 h-7 flex items-center justify-center rounded-lg bg-bg-raised border border-border text-text-muted hover:text-text cursor-pointer text-sm"
                >+</button>
                <span className="text-[10px] text-text-dim ml-1">chords</span>
              </div>
            </div>

            <button
              onClick={() => setExcludeDim(v => !v)}
              className={cn(
                'w-full py-1.5 rounded-lg text-[11px] font-semibold border transition-colors cursor-pointer',
                excludeDim
                  ? 'bg-accent/15 border-accent/40 text-accent'
                  : 'bg-bg-raised border-border text-text-muted hover:text-text',
              )}
            >
              {excludeDim ? '✓ Avoiding °dim chords' : 'Avoid °dim chords'}
            </button>
          </div>
        )}

        {error && <p className="text-red-400 text-xs">{error}</p>}

        {/* Saved progressions */}
        {saved.length > 0 && (
          <div className="flex flex-col gap-2">
            <span className="flex items-center gap-1.5 text-[10px] text-text-muted font-semibold uppercase tracking-[2px]">
              <Bookmark size={11} />
              Saved
            </span>
            <div className="flex flex-col gap-1">
              {saved.map(s => (
                <div key={s.id} className="group relative">
                  <button
                    onClick={() => loadSaved(s)}
                    title={`${s.chords.map(c => c.symbol).join(' – ')} (${s.key})`}
                    className={cn(
                      'flex flex-col items-start gap-0.5 w-full px-2.5 py-1.5 rounded-lg border border-border bg-bg-raised/50',
                      'hover:border-accent/40 hover:bg-bg-raised cursor-pointer text-left transition-colors',
                    )}
                  >
                    <span className="text-[11px] font-semibold text-text truncate w-full pr-5">
                      {s.name}
                    </span>
                    <span className="text-[10px] font-mono text-text-dim truncate w-full">
                      {s.chords.map(c => c.symbol).join(' – ')}
                    </span>
                  </button>
                  <button
                    onClick={() => deleteSaved(s.id)}
                    title={`Delete "${s.name}"`}
                    className="absolute right-2 top-2 hidden group-hover:block text-text-dim hover:text-red-400 cursor-pointer"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Recent progressions */}
        {history.length > 0 && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-[10px] text-text-muted font-semibold uppercase tracking-[2px]">
                <History size={11} />
                Recent
              </span>
              <button
                onClick={clearHistory}
                title="Clear history"
                className="text-text-dim hover:text-red-400 cursor-pointer"
              >
                <Trash2 size={11} />
              </button>
            </div>
            <div className="flex flex-col gap-1">
              {history.map(entry => (
                <button
                  key={entry.ts}
                  onClick={() => recallHistory(entry)}
                  title={`${entry.symbols.join(' – ')} (${entry.key})`}
                  className={cn(
                    'flex flex-col items-start gap-0.5 px-2.5 py-1.5 rounded-lg border border-border bg-bg-raised/50',
                    'hover:border-accent/40 hover:bg-bg-raised cursor-pointer text-left transition-colors',
                  )}
                >
                  <span className="text-[11px] font-mono text-text truncate w-full">
                    {entry.symbols.join(' – ')}
                  </span>
                  <span className="text-[9px] text-text-dim uppercase tracking-wider">{entry.key}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

        {/* Pinned Generate footer — the app's core action, always reachable
            without scrolling regardless of how tall the panel above gets. */}
        <div className="flex-shrink-0 p-4 border-t border-border bg-bg-panel">
          <button
            onClick={handleGenerate}
            disabled={generating}
            className={cn(
              'flex items-center justify-center gap-2 w-full py-2.5 rounded-xl',
              'bg-accent hover:bg-accent-hover text-bg-deep font-bold text-sm',
              'transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-wait',
            )}
          >
            {generating
              ? <Loader2 size={14} className="animate-spin" />
              : isAI
                ? <Brain size={14} />
                : isSmart
                ? <Sparkles size={14} />
                : isRandom
                  ? <Dices size={14} />
                  : <Shuffle size={14} />}
            {generating ? 'Generating…' : 'Generate'}
          </button>
        </div>
      </div>

      {/* ── Right panel: Output ──────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-y-auto p-6 gap-6">

        <ChatPanel messages={chatMessages} busy={chatBusy} onSend={handleChat} />

        {/* Progression strip — or empty hint */}
        {localChords.length > 0 ? (
          <div>
            <div className="flex items-center gap-2 mb-3 flex-wrap">
              <p className="text-[10px] uppercase tracking-[2px] text-text-muted font-semibold">
                Progression — {selectedKey}
                {romans.length > 0 && (
                  <span className="ml-2 text-accent font-mono normal-case tracking-normal">
                    ({romans.join(' – ')})
                  </span>
                )}
              </p>
              {patternName && (
                <span className="px-2 py-0.5 rounded-full bg-accent/10 border border-accent/25 text-[10px] text-accent">
                  {patternName}
                </span>
              )}
              {rolledMood && (
                <span
                  title="Rolled by Random mood"
                  className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-bg-raised border border-border text-[10px] text-text-muted"
                >
                  <Dices size={9} />
                  {MOOD_LABELS[rolledMood]}
                </span>
              )}

              {/* Transpose */}
              <div className="ml-auto flex items-center gap-1">
                <span className="text-[10px] text-text-dim uppercase tracking-wider mr-0.5">Transpose</span>
                <button
                  onClick={() => transpose(-1)}
                  title="Down a semitone"
                  className="w-7 h-7 flex items-center justify-center rounded-lg bg-bg-raised border border-border text-text-muted hover:text-text hover:border-accent/40 cursor-pointer text-sm font-mono"
                >♭</button>
                <button
                  onClick={() => transpose(1)}
                  title="Up a semitone"
                  className="w-7 h-7 flex items-center justify-center rounded-lg bg-bg-raised border border-border text-text-muted hover:text-text hover:border-accent/40 cursor-pointer text-sm font-mono"
                >♯</button>
              </div>
            </div>
            <ChordStrip chords={localChords} onDelete={deleteChord} />
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
            <Sparkles size={24} className="text-text-dim" />
            <p className="text-text-muted text-sm">No progression yet</p>
            <p className="text-text-dim text-xs max-w-xs">
              Pick a key and mood on the left, then hit{' '}
              <strong className="text-accent">Generate</strong>.
            </p>
          </div>
        )}

        {/* MIDI piano roll — always visible, click to edit */}
        <div>
          <div className="flex items-center mb-3">
            <p className="text-[10px] uppercase tracking-[2px] text-text-muted font-semibold">
              Piano Roll
              <span className="ml-2 normal-case tracking-normal font-normal text-text-dim">
                — click to add/remove notes, even while playing
              </span>
            </p>

            {/* Undo / redo — always reachable, even after undoing to empty */}
            <div className="ml-auto flex items-center gap-1">
              <button
                onClick={undo}
                disabled={!canUndo}
                title="Undo (⌘Z)"
                className="w-7 h-7 flex items-center justify-center rounded-lg bg-bg-raised border border-border text-text-muted hover:text-text hover:border-accent/40 cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed disabled:hover:text-text-muted disabled:hover:border-border"
              >
                <Undo2 size={13} />
              </button>
              <button
                onClick={redo}
                disabled={!canRedo}
                title="Redo (⇧⌘Z)"
                className="w-7 h-7 flex items-center justify-center rounded-lg bg-bg-raised border border-border text-text-muted hover:text-text hover:border-accent/40 cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed disabled:hover:text-text-muted disabled:hover:border-border"
              >
                <Redo2 size={13} />
              </button>
            </div>
          </div>
          <PianoRoll
            chords={localChords}
            notes={localNotes}
            onNotesChange={handleRollChange}
            onDeleteWindow={deleteChord}
            onAppendWindow={appendChordSlot}
          />
        </div>

        {localChords.length > 0 && (
          <>
            {/* Chord analysis */}
            <div>
              <p className="text-[10px] uppercase tracking-[2px] text-text-muted font-semibold mb-3">
                Chord Details
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {localChords.map((chord, i) => (
                  <div
                    key={i}
                    className="flex flex-col gap-1 p-3 rounded-xl bg-bg-raised border border-border"
                  >
                    <span className="text-xs text-text-dim font-mono">#{i + 1}</span>
                    <span className="text-lg font-extrabold text-text leading-none">{chord.root}</span>
                    <span className="text-[11px] text-text-muted">{chord.displayQuality || 'major'}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Harmonic analysis — instant, rule-based */}
            {analysis && (
              <div>
                <p className="text-[10px] uppercase tracking-[2px] text-text-muted font-semibold mb-3">
                  Analysis
                </p>
                <div className="p-4 rounded-xl bg-bg-raised border border-border">
                  <p className="text-sm text-text-muted leading-relaxed">{analysis.summary}</p>
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              {!isLoaded ? (
                <button
                  onClick={() => useStore.getState().loadProgressionWithNotes(localChords, localNotes, `Chord Lab · ${selectedKey}`)}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-accent text-bg-deep font-semibold text-sm hover:bg-accent-hover cursor-pointer transition-colors"
                >
                  <ArrowRight size={13} />
                  Send to Transport
                </button>
              ) : (
                <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-accent/10 border border-accent/25 text-accent text-xs font-medium">
                  <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse inline-block" />
                  Loaded in transport
                </span>
              )}
              <button
                onClick={handleExport}
                className="flex items-center gap-2 px-4 py-2 rounded-xl border border-border text-text-muted hover:text-text hover:border-border-bright text-sm cursor-pointer transition-colors"
              >
                <Download size={13} />
                Export MIDI
              </button>
              <button
                onClick={handleCopy}
                className="flex items-center gap-2 px-4 py-2 rounded-xl border border-border text-text-muted hover:text-text hover:border-border-bright text-sm cursor-pointer transition-colors"
              >
                <Copy size={13} />
                {copyLabel}
              </button>

              {/* Save as favourite */}
              {saveOpen ? (
                <div className="flex items-center gap-1.5">
                  <input
                    autoFocus
                    value={saveName}
                    onChange={e => setSaveName(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') handleSaveConfirm()
                      if (e.key === 'Escape') { setSaveOpen(false); setSaveName('') }
                    }}
                    placeholder="Name this progression…"
                    className="w-48 bg-bg-raised border border-accent/40 rounded-xl text-sm text-text px-3 py-2 focus:outline-none focus:border-accent/70 placeholder:text-text-dim"
                  />
                  <button
                    onClick={handleSaveConfirm}
                    title="Save"
                    className="w-9 h-9 flex items-center justify-center rounded-xl bg-accent text-bg-deep hover:bg-accent-hover cursor-pointer transition-colors"
                  >
                    <Check size={14} />
                  </button>
                  <button
                    onClick={() => { setSaveOpen(false); setSaveName('') }}
                    title="Cancel"
                    className="w-9 h-9 flex items-center justify-center rounded-xl border border-border text-text-muted hover:text-text cursor-pointer transition-colors"
                  >
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setSaveOpen(true)}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl border border-border text-text-muted hover:text-text hover:border-border-bright text-sm cursor-pointer transition-colors"
                >
                  <BookmarkPlus size={13} />
                  Save
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
