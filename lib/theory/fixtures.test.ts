import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildTheoryFixtures } from './fixtures'
import { POPULAR_SONGS } from '@/lib/data/popular-songs'

describe('golden theory fixtures', () => {
  it('fixtures/theory.json matches the current engine (run `npm run fixtures` after intentional changes)', () => {
    const committed = JSON.parse(readFileSync(resolve(__dirname, '../../fixtures/theory.json'), 'utf8'))
    expect(committed).toEqual(JSON.parse(JSON.stringify(buildTheoryFixtures())))
  })

  it('fixtures/popular-songs.json matches lib/data/popular-songs.ts', () => {
    const committed = JSON.parse(readFileSync(resolve(__dirname, '../../fixtures/popular-songs.json'), 'utf8'))
    expect(committed).toEqual(JSON.parse(JSON.stringify(POPULAR_SONGS)))
  })
})
