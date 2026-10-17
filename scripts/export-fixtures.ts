/**
 * Regenerate fixtures/theory.json from the TypeScript theory engine.
 * Run after any intentional theory change: `npm run fixtures`.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { buildTheoryFixtures } from '../lib/theory/fixtures'
import { POPULAR_SONGS } from '../lib/data/popular-songs'

const FIXTURE_PATH = resolve(__dirname, '../fixtures/theory.json')

const fixtures = buildTheoryFixtures()
mkdirSync(dirname(FIXTURE_PATH), { recursive: true })
writeFileSync(FIXTURE_PATH, JSON.stringify(fixtures, null, 1) + '\n')
console.log(`wrote ${FIXTURE_PATH}: ${fixtures.parse.length} parse cases, ${fixtures.analyze.length} analyses`)

// Verified songs (real key, BPM, harmonic rhythm) — the backend uses them to
// evaluate key estimation and as a held-out set for the chord model.
const SONGS_PATH = resolve(__dirname, '../fixtures/popular-songs.json')
writeFileSync(SONGS_PATH, JSON.stringify(POPULAR_SONGS, null, 1) + '\n')
console.log(`wrote ${SONGS_PATH}: ${POPULAR_SONGS.length} songs`)
