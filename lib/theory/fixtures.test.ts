import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildTheoryFixtures } from './fixtures'

describe('golden theory fixtures', () => {
  it('fixtures/theory.json matches the current engine (run `npm run fixtures` after intentional changes)', () => {
    const committed = JSON.parse(readFileSync(resolve(__dirname, '../../fixtures/theory.json'), 'utf8'))
    expect(committed).toEqual(JSON.parse(JSON.stringify(buildTheoryFixtures())))
  })
})
