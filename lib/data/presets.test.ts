import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { PRESET_SOURCES, presetSource, queryPresets, type PresetEntry, type PresetSnapshot } from './presets'

// The snapshot exported from backend/db/presets.sqlite — what the deployed site serves.
const snapshot: PresetSnapshot = JSON.parse(
  readFileSync(join(__dirname, '../../public/data/presets.json'), 'utf8'),
)
const PRESETS = snapshot.presets

describe('preset snapshot', () => {
  it('matches its own header', () => {
    expect(snapshot.count).toBe(PRESETS.length)
    expect(PRESETS.length).toBeGreaterThan(800)
    const counts = new Map<string, number>()
    for (const p of PRESETS) counts.set(p.vst, (counts.get(p.vst) ?? 0) + 1)
    expect(new Map(snapshot.vsts.map(v => [v.vst, v.count]))).toEqual(counts)
  })

  it('has unique kebab-case ids', () => {
    const ids = PRESETS.map(p => p.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
  })

  it('has no empty fields and a valid status', () => {
    for (const p of PRESETS) {
      for (const key of ['artist', 'context', 'vst', 'preset', 'notes', 'sourceLabel'] as const) {
        expect(p[key].trim(), `${p.id}.${key}`).not.toBe('')
      }
      expect(['confirmed', 'community'], p.id).toContain(p.status)
    }
  })

  it('links every entry to a checkable https source', () => {
    for (const p of PRESETS) {
      expect(new URL(p.sourceUrl).protocol, p.id).toBe('https:')
      expect(PRESET_SOURCES).toContain(presetSource(p))
      if (presetSource(p) === 'Reddit') {
        expect(p.sourceUrl, p.id).toMatch(/^https:\/\/www\.reddit\.com\/r\/findthepreset\/comments\/[a-z0-9]+\/$/)
      }
      if (presetSource(p) === 'YouTube') {
        expect(p.sourceUrl, p.id).toMatch(/^https:\/\/www\.youtube\.com\/watch\?v=[\w-]{11}(&t=\d+s)?$/)
      }
    }
  })
})

describe('queryPresets (snapshot mode — mirrors GET /v1/presets)', () => {
  const entry = (id: string, artist: string, context: string, vst: string, preset: string, url: string) =>
    ({ id, artist, context, vst, preset, notes: 'n', status: 'community', sourceUrl: url, sourceLabel: 's' }) as PresetEntry
  const reddit = 'https://www.reddit.com/r/findthepreset/comments/a/'
  const data = [
    entry('sky', 'Playboi Carti', '"Sky" — melody', 'Spectrasonics Omnisphere', 'Triangle Toon', reddit),
    entry('magnolia', 'Playboi Carti', '"Magnolia" — melody', 'NI FM8', 'Adam The Psycho', reddit),
    entry('vogue', 'Madonna', '"Vogue" — piano', 'Korg M1', "Piano 16'", 'https://www.youtube.com/watch?v=TVmZarPUc-Q'),
  ]

  it('prefix-matches every search word across fields', () => {
    expect(queryPresets(data, { q: 'tri' }).items.map(p => p.id)).toEqual(['sky'])
    expect(queryPresets(data, { q: 'carti fm8' }).items.map(p => p.id)).toEqual(['magnolia'])
    expect(queryPresets(data, { q: 'carti m1' }).total).toBe(0)
    expect(queryPresets(data, { q: '"(' }).total).toBe(3)
  })

  it('filters by VST and source, sorts by artist, and pages', () => {
    expect(queryPresets(data, { vst: 'Korg M1' }).items.map(p => p.id)).toEqual(['vogue'])
    expect(queryPresets(data, { source: 'YouTube' }).total).toBe(1)
    const page = queryPresets(data, { offset: 1, limit: 1 })
    expect(page.total).toBe(3)
    expect(page.items.map(p => p.id)).toEqual(['magnolia'])
    expect(queryPresets(data, {}).items.map(p => p.artist)).toEqual(['Madonna', 'Playboi Carti', 'Playboi Carti'])
  })
})
