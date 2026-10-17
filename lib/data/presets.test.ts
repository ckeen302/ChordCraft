import { describe, it, expect } from 'vitest'
import { PRESETS, PRESET_VSTS, PRESET_SOURCES, presetSource } from './presets'

describe('preset library data', () => {
  it('has unique ids', () => {
    const ids = PRESETS.map(p => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('uses kebab-case ids', () => {
    for (const p of PRESETS) expect(p.id, p.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
  })

  it('has no empty fields', () => {
    for (const p of PRESETS) {
      for (const key of ['artist', 'context', 'vst', 'preset', 'notes', 'sourceLabel'] as const) {
        expect(p[key].trim(), `${p.id}.${key}`).not.toBe('')
      }
    }
  })

  it('has a valid status', () => {
    for (const p of PRESETS) expect(['confirmed', 'community'], p.id).toContain(p.status)
  })

  it('links every entry to an https source', () => {
    for (const p of PRESETS) {
      const url = new URL(p.sourceUrl)
      expect(url.protocol, p.id).toBe('https:')
    }
  })

  it('links Reddit entries to a real r/findthepreset thread', () => {
    for (const p of PRESETS.filter(p => presetSource(p) === 'Reddit')) {
      expect(p.sourceUrl, p.id).toMatch(/^https:\/\/www\.reddit\.com\/r\/findthepreset\/comments\/[a-z0-9]+\/$/)
    }
  })

  it('links YouTube entries to a specific video', () => {
    for (const p of PRESETS.filter(p => presetSource(p) === 'YouTube')) {
      expect(p.sourceUrl, p.id).toMatch(/^https:\/\/www\.youtube\.com\/watch\?v=[\w-]{11}(&t=\d+s)?$/)
    }
  })

  it('derives VST chips and sources from the data', () => {
    expect(new Set(PRESET_VSTS)).toEqual(new Set(PRESETS.map(p => p.vst)))
    for (const p of PRESETS) expect(PRESET_SOURCES).toContain(presetSource(p))
  })
})
