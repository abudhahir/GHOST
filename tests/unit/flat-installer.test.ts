import { describe, it, expect } from 'vitest'
import { resolveDestinations } from '../../src/installer/flat-installer.js'
import type { ResolvedFile } from '../../src/core/types.js'

describe('resolveDestinations (flat mode collision resolution)', () => {
  const makeFile = (path: string): ResolvedFile => ({
    path,
    content: '',
    category: 'agents',
  })

  it('writes filename directly into dest dir when no collision', () => {
    const files = [makeFile('agents/coding/refactor.agent.md')]
    const result = resolveDestinations(files, '.ghost/')
    expect(result[0]?.dest).toBe('.ghost/refactor.agent.md')
  })

  it('uses full-path underscore substitution on collision', () => {
    const files = [
      makeFile('agents/coding/refactor.agent.md'),
      makeFile('agents/search/refactor.agent.md'),
    ]
    const result = resolveDestinations(files, '.ghost/')
    const destNames = result.map(r => r.dest)
    expect(destNames).toContain('.ghost/refactor.agent.md')
    expect(destNames).toContain('.ghost/search_refactor.agent.md')
  })

  it('three files same basename — all get unique destinations', () => {
    const files = [
      makeFile('a/refactor.agent.md'),
      makeFile('b/refactor.agent.md'),
      makeFile('c/refactor.agent.md'),
    ]
    const result = resolveDestinations(files, '.ghost/')
    const destNames = result.map(r => r.dest)
    expect(new Set(destNames).size).toBe(3)
  })

  it('deep path collision uses ALL intermediate segments joined with underscores', () => {
    const files = [
      makeFile('agents/coding/refactor.agent.md'),
      makeFile('agents/coding/deep/refactor.agent.md'),
    ]
    const result = resolveDestinations(files, '.ghost/')
    const destNames = result.map(r => r.dest)
    // First file takes the simple basename
    expect(destNames).toContain('.ghost/refactor.agent.md')
    // Second file must include ALL intermediate segments: coding + deep
    expect(destNames).toContain('.ghost/coding_deep_refactor.agent.md')
  })

  it('normalises dest path without trailing slash', () => {
    const files = [makeFile('agents/foo.md')]
    const result = resolveDestinations(files, '.ghost')
    expect(result[0]?.dest).toBe('.ghost/foo.md')
  })

  it('preserves file reference in result', () => {
    const file = makeFile('agents/a.md')
    const result = resolveDestinations([file], '.ghost/')
    expect(result[0]?.file).toBe(file)
  })
})
