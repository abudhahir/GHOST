import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { install } from '../../src/installer/index.js'
import type { ResolvedFile, InstallConfig } from '../../src/core/types.js'

describe('install — mirror mode', () => {
  let cwd: string

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'ghost-install-test-'))
  })

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true })
  })

  it('writes files preserving source directory structure', async () => {
    const files: ResolvedFile[] = [
      { path: 'agents/coding/refactor.md', content: '# Refactor', category: 'agents' },
    ]
    const config: InstallConfig = { mode: 'mirror', cwd }

    const result = await install(files, config)
    expect(result.written).toHaveLength(1)
    expect(existsSync(join(cwd, 'agents', 'coding', 'refactor.md'))).toBe(true)
    expect(readFileSync(join(cwd, 'agents', 'coding', 'refactor.md'), 'utf8')).toBe('# Refactor')
  })

  it('uses destinations config as root for matching category', async () => {
    const files: ResolvedFile[] = [
      { path: 'agents/foo.md', content: '# Foo', category: 'agents' },
    ]
    const config: InstallConfig = {
      mode: 'mirror',
      cwd,
      destinations: { agents: '.claude/agents/' },
    }
    await install(files, config)
    expect(existsSync(join(cwd, '.claude', 'agents', 'foo.md'))).toBe(true)
  })

  it('falls back to cwd for categories not in destinations', async () => {
    const files: ResolvedFile[] = [
      { path: 'skills/helper.md', content: '# Helper', category: 'skills' },
    ]
    const config: InstallConfig = {
      mode: 'mirror',
      cwd,
      destinations: { agents: '.claude/agents/' },
    }
    await install(files, config)
    expect(existsSync(join(cwd, 'skills', 'helper.md'))).toBe(true)
  })

  it('overwrites existing files', async () => {
    const config: InstallConfig = { mode: 'mirror', cwd }
    await install([{ path: 'agents/a.md', content: 'old', category: 'agents' }], config)
    await install([{ path: 'agents/a.md', content: 'new', category: 'agents' }], config)
    expect(readFileSync(join(cwd, 'agents', 'a.md'), 'utf8')).toBe('new')
  })

  it('leaves no tmp files after successful write', async () => {
    const files: ResolvedFile[] = [
      { path: 'agents/a.md', content: '# A', category: 'agents' },
    ]
    await install(files, { mode: 'mirror', cwd })
    const agentDir = join(cwd, 'agents')
    const entries = readdirSync(agentDir)
    expect(entries.every(f => !f.startsWith('.ghost-tmp-'))).toBe(true)
    expect(existsSync(join(agentDir, 'a.md'))).toBe(true)
  })
})

describe('install — flat mode', () => {
  let cwd: string

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'ghost-install-flat-test-'))
  })

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true })
  })

  it('writes all files to dest dir stripping directory structure', async () => {
    const files: ResolvedFile[] = [
      { path: 'agents/coding/refactor.md', content: '# Refactor', category: 'agents' },
    ]
    const config: InstallConfig = { mode: 'flat', dest: join(cwd, 'output'), cwd }
    await install(files, config)
    expect(existsSync(join(cwd, 'output', 'refactor.md'))).toBe(true)
  })

  it('resolves collision with full-path underscore prefix', async () => {
    const files: ResolvedFile[] = [
      { path: 'agents/coding/refactor.md', content: 'A', category: 'agents' },
      { path: 'agents/search/refactor.md', content: 'B', category: 'agents' },
    ]
    const config: InstallConfig = { mode: 'flat', dest: join(cwd, 'output'), cwd }
    await install(files, config)
    expect(existsSync(join(cwd, 'output', 'refactor.md'))).toBe(true)
    expect(existsSync(join(cwd, 'output', 'search_refactor.md'))).toBe(true)
  })
})
