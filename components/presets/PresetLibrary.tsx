'use client'

/**
 * PresetLibrary
 *
 * A browsable collection of famous VST preset identifications — "what preset
 * is that sound?" — in the spirit of r/findthepreset. Pure data browser: no
 * generation, no playback. Search, filter by VST, grouped by artist.
 */
import { useMemo, useState } from 'react'
import { Search, ExternalLink, SlidersHorizontal, BadgeCheck, Users } from 'lucide-react'
import { PRESETS, PRESET_VSTS, type PresetEntry } from '@/lib/data/presets'
import { cn } from '@/lib/utils'

function StatusChip({ status }: { status: PresetEntry['status'] }) {
  const confirmed = status === 'confirmed'
  return (
    <span
      title={confirmed
        ? 'Factual/official documentation (e.g. factory-bank authorship)'
        : 'Accepted community identification — strong lore, not gospel'}
      className={cn(
        'flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-semibold uppercase tracking-wider border',
        confirmed
          ? 'bg-accent/10 border-accent/30 text-accent'
          : 'bg-bg-raised border-border text-text-muted',
      )}
    >
      {confirmed ? <BadgeCheck size={9} /> : <Users size={9} />}
      {confirmed ? 'Confirmed' : 'Community ID'}
    </span>
  )
}

export function PresetLibrary() {
  const [query, setQuery] = useState('')
  const [vstFilter, setVstFilter] = useState<string | null>(null)

  const q = query.trim().toLowerCase()
  const filtered = useMemo(
    () => PRESETS.filter(p => {
      if (vstFilter && p.vst !== vstFilter) return false
      if (!q) return true
      return (
        p.artist.toLowerCase().includes(q) ||
        p.context.toLowerCase().includes(q) ||
        p.vst.toLowerCase().includes(q) ||
        p.preset.toLowerCase().includes(q)
      )
    }),
    [q, vstFilter],
  )

  // Group by artist, artists alphabetical.
  const grouped = useMemo(() => {
    const map = new Map<string, PresetEntry[]>()
    for (const p of filtered) {
      const list = map.get(p.artist) ?? []
      list.push(p)
      map.set(p.artist, list)
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [filtered])

  return (
    <div className="flex h-full min-h-0">

      {/* ── Left: intro + search + filters ─────────────────────────────── */}
      <div className="w-72 flex-shrink-0 flex flex-col gap-5 p-6 border-r border-border bg-bg-panel overflow-y-auto">
        <div>
          <h2 className="text-lg font-extrabold text-text">Preset Finder</h2>
          <p className="text-text-muted text-xs mt-0.5 leading-relaxed">
            The famous &ldquo;what preset is that?&rdquo; answers — the synths
            and patches behind well-known artist sounds.
          </p>
        </div>

        <div className="relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-dim pointer-events-none" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search artist, song, VST…"
            className={cn(
              'w-full bg-bg-raised border border-border rounded-xl',
              'text-sm text-text pl-9 pr-3 py-2',
              'focus:outline-none focus:border-accent/50 placeholder:text-text-dim',
            )}
          />
        </div>

        {/* VST filter chips */}
        <div className="flex flex-col gap-2">
          <span className="flex items-center gap-1.5 text-[10px] text-text-muted font-semibold uppercase tracking-[2px]">
            <SlidersHorizontal size={11} />
            Filter by VST
          </span>
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => setVstFilter(null)}
              className={cn(
                'px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-colors cursor-pointer',
                vstFilter === null
                  ? 'bg-accent border-accent text-bg-deep'
                  : 'bg-bg-raised border-border text-text-muted hover:text-text',
              )}
            >
              All
            </button>
            {PRESET_VSTS.map(v => (
              <button
                key={v}
                onClick={() => setVstFilter(f => (f === v ? null : v))}
                className={cn(
                  'px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-colors cursor-pointer',
                  vstFilter === v
                    ? 'bg-accent border-accent text-bg-deep'
                    : 'bg-bg-raised border-border text-text-muted hover:text-text',
                )}
              >
                {v}
              </button>
            ))}
          </div>
        </div>

        {/* Provenance note */}
        <div className="flex flex-col gap-1.5 p-3.5 rounded-xl border border-border bg-bg-raised/50">
          <span className="text-[10px] font-bold text-text-muted uppercase tracking-[2px]">
            About this data
          </span>
          <p className="text-[11px] text-text-dim leading-relaxed">
            Curated in the spirit of{' '}
            <a
              href="https://www.reddit.com/r/findthepreset/"
              target="_blank"
              rel="noreferrer"
              className="text-accent hover:underline"
            >
              r/findthepreset
            </a>
            . <strong className="text-text-muted">Confirmed</strong> = official
            documentation; <strong className="text-text-muted">Community ID</strong> ={' '}
            the accepted identification from forums, remakes, and producer
            streams — strong lore, not gospel. Every entry links its source.
          </p>
        </div>
      </div>

      {/* ── Right: artist-grouped entries ──────────────────────────────── */}
      <div className="flex-1 min-w-0 overflow-y-auto p-6">
        {grouped.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
            <Search size={24} className="text-text-dim" />
            <p className="text-text-muted text-sm">No presets match</p>
            <p className="text-text-dim text-xs">Try a different search or clear the VST filter.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-6 max-w-3xl">
            {grouped.map(([artist, entries]) => (
              <div key={artist}>
                <h3 className="text-sm font-extrabold text-text uppercase tracking-widest mb-2.5">
                  {artist}
                </h3>
                <div className="flex flex-col gap-2">
                  {entries.map(p => (
                    <div
                      key={p.id}
                      className="flex flex-col gap-1.5 p-4 rounded-xl bg-bg-raised border border-border hover:border-border-bright transition-colors"
                    >
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-text">{p.context}</span>
                        <StatusChip status={p.status} />
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="px-2 py-0.5 rounded-full bg-accent/10 border border-accent/25 text-[11px] text-accent font-semibold">
                          {p.vst}
                        </span>
                        <span className="text-[12px] font-mono text-text-muted">{p.preset}</span>
                      </div>
                      <p className="text-xs text-text-dim leading-relaxed">{p.notes}</p>
                      {p.sourceUrl && (
                        <a
                          href={p.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center gap-1 self-start text-[11px] text-text-muted hover:text-accent transition-colors"
                        >
                          <ExternalLink size={10} />
                          {p.sourceLabel ?? 'Source'}
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
