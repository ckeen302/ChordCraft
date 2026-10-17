/**
 * Regenerate fixtures/theory.json from the TypeScript theory engine.
 * Run after any intentional theory change: `npm run fixtures`.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { buildTheoryFixtures } from '../lib/theory/fixtures'

const FIXTURE_PATH = resolve(__dirname, '../fixtures/theory.json')

const fixtures = buildTheoryFixtures()
mkdirSync(dirname(FIXTURE_PATH), { recursive: true })
writeFileSync(FIXTURE_PATH, JSON.stringify(fixtures, null, 1) + '\n')
console.log(`wrote ${FIXTURE_PATH}: ${fixtures.parse.length} parse cases, ${fixtures.analyze.length} analyses`)
