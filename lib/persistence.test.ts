import { beforeEach, describe, expect, it } from 'vitest'
import { readHistory, readSaved } from './persistence'

const store = new Map<string, string>()
globalThis.localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v) },
  removeItem: (k: string) => { store.delete(k) },
} as unknown as Storage

describe('persistence', () => {
  beforeEach(() => store.clear())

  it('drops malformed history entries instead of crashing the lab', () => {
    store.set('chordcraft-history', JSON.stringify([{}, { symbols: 'C', key: 'C Major' }, { symbols: ['C', 'G'], key: 'C Major', ts: 1 }]))
    expect(readHistory()).toEqual([{ symbols: ['C', 'G'], key: 'C Major', ts: 1 }])
    store.set('chordcraft-history', '{not json')
    expect(readHistory()).toEqual([])
  })

  it('discards a saved progression\'s broken note timeline but keeps its chords', () => {
    const chords = [{ symbol: 'C', notes: [60, 64, 67] }]
    store.set('chordcraft-saved', JSON.stringify([
      { id: '1', name: 'ok', key: 'C Major', ts: 1, chords, notes: [{ id: 'n', midi: 60, start: 0, duration: 2, velocity: 0.8 }] },
      { id: '2', name: 'bad notes', key: 'C Major', ts: 1, chords, notes: [{ id: 'n', midi: 60, start: 'x', duration: 2, velocity: 0.8 }] },
      { id: '3', name: 'no key', ts: 1, chords },
    ]))
    const saved = readSaved()
    expect(saved.map(s => s.id)).toEqual(['1', '2'])
    expect(saved[0].notes).toHaveLength(1)
    expect(saved[1].notes).toBeUndefined()
  })
})
