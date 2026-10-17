import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, asInstrument, checkBackend, generateProgression, toParsedChords } from './client'

afterEach(() => vi.unstubAllGlobals())

const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))

describe('toParsedChords', () => {
  it('keeps valid chords and their beats', () => {
    const out = toParsedChords([
      { symbol: 'Am7', root: 'A', quality: 'm7', notes: [57, 60, 64, 67], displayQuality: 'm7', beats: 4 },
      { symbol: 'D', root: 'D', quality: 'maj', notes: [50, 66, 69], displayQuality: '', beats: null },
    ])
    expect(out.map(c => [c.symbol, c.quality, c.beats])).toEqual([['Am7', 'm7', 4], ['D', 'maj', undefined]])
  })

  it('drops malformed chords instead of crashing playback', () => {
    expect(toParsedChords([
      { symbol: 'X', root: 'X', quality: 'not-a-quality', notes: [60], displayQuality: '' },
      { symbol: 'C', root: 'C', quality: 'maj', notes: [], displayQuality: '' },
      { symbol: 'C', root: 'C', quality: 'maj', notes: [60, 200], displayQuality: '' },
      { symbol: 'C', root: 'C', quality: 'toString', notes: [60], displayQuality: '' },
    ])).toEqual([])
  })
})

describe('checkBackend', () => {
  it('reports the model status from /health', async () => {
    vi.stubGlobal('fetch', vi.fn(() => json({ status: 'ok', model: true })))
    expect(await checkBackend()).toEqual({ online: true, model: true })
  })

  it('treats network failure as offline', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))))
    expect(await checkBackend()).toEqual({ online: false, model: false })
  })
})

describe('generateProgression', () => {
  it('posts the request as JSON', async () => {
    const fetchMock = vi.fn(() => json({ engine: 'model', chords: [] }))
    vi.stubGlobal('fetch', fetchMock)
    await generateProgression({ key: 'A Minor', mood: 'epic', length: 8, engine: 'model' })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toMatch(/\/v1\/generate$/)
    expect(JSON.parse(init.body as string)).toEqual({ key: 'A Minor', mood: 'epic', length: 8, engine: 'model' })
  })

  it('surfaces the server detail message', async () => {
    vi.stubGlobal('fetch', vi.fn(() => json({ detail: 'Chord model unavailable' }, 503)))
    await expect(generateProgression({ key: 'C Major', mood: 'jazz', length: 4 }))
      .rejects.toEqual(new ApiError('Chord model unavailable'))
  })
})

it('asInstrument only accepts known instruments', () => {
  expect(asInstrument('Strings')).toBe('Strings')
  expect(asInstrument('Theremin')).toBeNull()
})
