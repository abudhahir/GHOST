// tests/unit/installer-coverage.test.ts
//
// Targeted tests for uncovered branches in:
//   src/installer/index.ts   — flat mode categoryRoot override (line 52),
//                              write failure collection (lines 58-60)
//   src/installer/flat-installer.ts — numeric suffix Strategy 2 (lines 54-71)
//   src/installer/mirror-installer.ts — atomicWrite error-cleanup path (lines 38-46)

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { install } from '../../src/installer/index.js'
import { resolveDestinations } from '../../src/installer/flat-installer.js'
import { atomicWrite } from '../../src/installer/mirror-installer.js'
import type { ResolvedFile, InstallConfig } from '../../src/core/types.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeFile(path: string, category = 'agents', content = '# content'): ResolvedFile {
  return { path, content, category }
}

// ---------------------------------------------------------------------------
// install() — flat mode with per-category destination override
// ---------------------------------------------------------------------------
describe('install() — flat mode with categoryRoot override', () => {
  let cwd: string

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'ghost-install-cat-test-'))
  })

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true })
  })

  it('places file in categoryRoot when destinations[category] is set (flat mode)', async () => {
    const files: ResolvedFile[] = [makeFile('agents/coding/refactor.md', 'agents')]
    const config: InstallConfig = {
      mode: 'flat',
      cwd,
      // Per-category override — flat mode should use basename inside this root
      destinations: { agents: '.claude/agents' },
    }

    const result = await install(files, config)

    expect(result.written).toHaveLength(1)
    // finalDest must be inside the override directory, not the default destDir
    const finalDest = result.written[0]!.dest
    expect(finalDest).toContain('.claude/agents')
    expect(existsSync(finalDest)).toBe(true)
    expect(result.failed).toHaveLength(0)
  })

  it('uses cwd as dest when no dest or destinations override is set (flat mode)', async () => {
    const files: ResolvedFile[] = [makeFile('skills/helper.md', 'skills')]
    const config: InstallConfig = {
      mode: 'flat',
      cwd,
      // No dest, no destinations — should fall back to cwd
    }

    const result = await install(files, config)
    expect(result.written).toHaveLength(1)
    expect(result.failed).toHaveLength(0)
    expect(result.written[0]!.dest.startsWith(cwd)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// install() — flat mode write failure collected rather than thrown
// ---------------------------------------------------------------------------
describe('install() — flat mode write failure handling', () => {
  let cwd: string

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'ghost-install-fail-test-'))
  })

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('collects failed paths instead of throwing when atomicWrite fails (flat mode)', async () => {
    // Stub atomicWrite to reject on the first call only
    const mirrorModule = await import('../../src/installer/mirror-installer.js')
    let callCount = 0
    vi.spyOn(mirrorModule, 'atomicWrite').mockImplementation(async () => {
      if (callCount++ === 0) throw new Error('Disk full')
    })

    const files: ResolvedFile[] = [
      makeFile('agents/first.md', 'agents'),
      makeFile('agents/second.md', 'agents'),
    ]
    const config: InstallConfig = { mode: 'flat', cwd, dest: join(cwd, 'output') }

    const result = await install(files, config)

    // First file failed; second should succeed
    expect(result.failed).toHaveLength(1)
    expect(result.failed[0]).toBe('agents/first.md')
    expect(result.written).toHaveLength(1)
    expect(result.written[0]!.path).toBe('agents/second.md')
  })
})

// ---------------------------------------------------------------------------
// resolveDestinations — numeric-suffix Strategy 2
// Triggered when the parent-segment prefix STILL collides with an existing
// destination (extremely rare, but the code handles it with a counter loop).
// ---------------------------------------------------------------------------
describe('resolveDestinations — numeric-suffix collision resolution (Strategy 2)', () => {
  it('appends numeric suffix when parent-prefix still collides', () => {
    // Three files:
    //   a/refactor.md  → first gets 'refactor.md'
    //   b/refactor.md  → collides; tries 'b_refactor.md'
    //   b/refactor.md  → same parent segment 'b', tries 'b_refactor.md' again
    //                    → collision → must produce 'b_refactor_2.md'
    //
    // We simulate the triple collision by using paths that share BOTH the
    // basename AND the parent segment.
    const files: ResolvedFile[] = [
      makeFile('a/refactor.md'),
      makeFile('b/refactor.md'),   // strategy 1 → b_refactor.md
      makeFile('b/refactor.md'),   // strategy 1 collides → strategy 2 → b_refactor_2.md
    ]

    const result = resolveDestinations(files, '/dest')
    const dests = result.map(r => r.dest)

    // All destinations must be unique
    expect(new Set(dests).size).toBe(3)

    // First file gets simple basename
    expect(dests[0]).toBe('/dest/refactor.md')
    // Second file gets parent-prefix
    expect(dests[1]).toBe('/dest/b_refactor.md')
    // Third file gets numeric suffix
    expect(dests[2]).toBe('/dest/b_refactor_2.md')
  })

  it('increments counter until unique when multiple numeric collisions exist', () => {
    // Force: a/f.md, b/f.md, b/f.md, b/f.md
    //   → f.md, b_f.md, b_f_2.md, b_f_3.md
    const files: ResolvedFile[] = [
      makeFile('a/f.md'),
      makeFile('b/f.md'),
      makeFile('b/f.md'),
      makeFile('b/f.md'),
    ]

    const result = resolveDestinations(files, '/out')
    const dests = result.map(r => r.dest)

    expect(new Set(dests).size).toBe(4)
    expect(dests).toContain('/out/f.md')
    expect(dests).toContain('/out/b_f.md')
    expect(dests).toContain('/out/b_f_2.md')
    expect(dests).toContain('/out/b_f_3.md')
  })

  it('handles file with no dot in name using suffix without extension separator', () => {
    // Path with no extension — the suffix must be appended without a dot
    const files: ResolvedFile[] = [
      makeFile('a/Makefile'),
      makeFile('b/Makefile'),
      makeFile('b/Makefile'),  // triggers numeric suffix on a dotless name
    ]

    const result = resolveDestinations(files, '/out')
    const dests = result.map(r => r.dest)

    expect(new Set(dests).size).toBe(3)
    // Third entry must end with _2 (no dot before counter)
    expect(dests[2]).toMatch(/_2$/)
  })
})

// ---------------------------------------------------------------------------
// atomicWrite — error cleanup path (lines 38-46 in mirror-installer.ts)
// If rename fails, the tmp file must be cleaned up and the error re-thrown.
// We trigger this by first writing a file and then making the destination
// a directory — rename() will fail because the target is a directory.
// ---------------------------------------------------------------------------
describe('atomicWrite — error cleanup on failed rename', () => {
  let cwd: string

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'ghost-atomic-test-'))
  })

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true })
  })

  it('re-throws the OS error and leaves no tmp files when rename fails', async () => {
    const { mkdirSync, readdirSync } = await import('node:fs')

    // Create a sub-directory at the destination path so rename() will fail
    // with EISDIR (cannot overwrite a directory with a file).
    const dest = join(cwd, 'output.md')
    mkdirSync(dest)  // dest is now a directory, not a file

    await expect(atomicWrite(dest, '# content')).rejects.toThrow()

    // The tmp file must have been cleaned up — no .ghost-tmp- files remain
    const entries = readdirSync(cwd).filter(f => f.startsWith('.ghost-tmp-'))
    expect(entries).toHaveLength(0)
  })
})
