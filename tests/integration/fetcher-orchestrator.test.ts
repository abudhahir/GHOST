// tests/integration/fetcher-orchestrator.test.ts
//
// Coverage for uncovered branches in src/fetcher/index.ts:
//   - hostType override with a known cloud host  (line 25-26)
//   - self-hosted URL where probeHost returns null → git fallback  (lines 37-42)
//   - git fallback returns empty list → throws GhostFetchError  (lines 48-50)
//   - truncated GitHub tree → falls back to git clone  (lines 60-63)
//   - reclassification step drops files whose final category is not in requested list (lines 83-87)

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execSync } from 'node:child_process'
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher } from 'undici'
import type { Dispatcher } from 'undici'
import { fetchResources, GhostFetchError } from '../../src/fetcher/index.js'

// ---------------------------------------------------------------------------
// Fixture local git repo (shared across tests that exercise the git fallback)
// ---------------------------------------------------------------------------
let repoPath: string
let tmpBase: string

beforeAll(() => {
  tmpBase = mkdtempSync(join(tmpdir(), 'ghost-fetcher-orch-test-'))
  repoPath = join(tmpBase, 'fixture-repo')
  mkdirSync(repoPath)

  execSync('git init', { cwd: repoPath })
  execSync('git config user.email "test@test.com"', { cwd: repoPath })
  execSync('git config user.name "Test"', { cwd: repoPath })

  mkdirSync(join(repoPath, 'agents'))
  writeFileSync(join(repoPath, 'agents', 'a.md'), '# Agent A')
  mkdirSync(join(repoPath, 'skills'))
  writeFileSync(join(repoPath, 'skills', 'b.md'), '# Skill B')
  writeFileSync(join(repoPath, 'readme.md'), '# Readme')

  execSync('git add .', { cwd: repoPath })
  execSync('git commit -m "init"', { cwd: repoPath })
})

afterAll(() => {
  rmSync(tmpBase, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Tests that need HTTP mocking
// ---------------------------------------------------------------------------
describe('fetchResources — fetcher orchestrator branches', () => {
  let mockAgent: MockAgent
  let originalDispatcher: Dispatcher

  beforeEach(() => {
    originalDispatcher = getGlobalDispatcher()
    mockAgent = new MockAgent()
    mockAgent.disableNetConnect()
    setGlobalDispatcher(mockAgent)
  })

  afterEach(async () => {
    await mockAgent.close()
    setGlobalDispatcher(originalDispatcher)
  })

  // -------------------------------------------------------------------------
  // hostType override: caller supplies hostType for a known cloud URL
  // This exercises the `if (hostType)` branch (line 24-26).
  // We use a GitHub URL together with hostType = 'github' so parseKnownHost
  // returns a non-null host and buildSelfHostedHost is NOT reached.
  // -------------------------------------------------------------------------
  it('honours explicit hostType override and resolves a known GitHub URL', async () => {
    mockAgent.get('https://api.github.com')
      .intercept({ path: '/repos/org/repo/git/trees/HEAD?recursive=1', method: 'GET' })
      .reply(200, {
        truncated: false,
        tree: [
          { path: 'agents/helper.md', type: 'blob' },
        ],
      })

    // Download the single matched file
    mockAgent.get('https://raw.githubusercontent.com')
      .intercept({ path: '/org/repo/HEAD/agents/helper.md', method: 'GET' })
      .reply(200, '# Helper agent')

    const result = await fetchResources({
      repoUrl: 'https://github.com/org/repo',
      categories: ['agents'],
      hostType: 'github',
    })

    // Should have fetched one file via the API path (not git fallback)
    expect(result.files).toHaveLength(1)
    expect(result.files[0]?.path).toBe('agents/helper.md')
    expect(result.failedDownloads).toHaveLength(0)
  })

  // -------------------------------------------------------------------------
  // self-hosted URL where probeHost returns null → useGitFallback = true
  // This exercises lines 37-42 (else branch of `if (detected)`).
  // We serve 404 for all probe paths so probeHost returns null, then the
  // git fallback is used with a local file:// repo URL.
  //
  // Note: We can't easily mix an HTTP-mocked host probe with a file:// git
  // clone in a single call because fetchResources extracts the base URL from
  // the repoUrl.  We use the local repo URL directly and suppress net
  // connections only for the probe calls.
  // -------------------------------------------------------------------------
  it('falls back to git clone when probeHost returns null for unknown host', async () => {
    // The probe will fire against file:// — undici won't intercept that.
    // Re-enable connect for file:// (undici ignores file:// anyway).
    // We need to allow the git subprocess to run; disable the mock agent here.
    await mockAgent.close()
    setGlobalDispatcher(originalDispatcher)

    // Use a local file:// URL — the host probe will silently fail (no HTTP
    // server) and probeHost will return null, triggering the git fallback.
    const result = await fetchResources({
      repoUrl: `file://${repoPath}`,
      categories: ['agents'],
    })

    expect(result.files.length).toBeGreaterThan(0)
    const paths = result.files.map(f => f.path)
    expect(paths).toContain('agents/a.md')

    // Re-install a fresh mock for afterEach cleanup
    mockAgent = new MockAgent()
    setGlobalDispatcher(mockAgent)
  })

  // -------------------------------------------------------------------------
  // Truncated GitHub tree → fallback to git clone
  // This exercises lines 60-63.
  // -------------------------------------------------------------------------
  it('falls back to git clone when the GitHub tree response is truncated', async () => {
    // First the API call — returns a truncated tree
    mockAgent.get('https://api.github.com')
      .intercept({ path: '/repos/org/big-repo/git/trees/HEAD?recursive=1', method: 'GET' })
      .reply(200, {
        truncated: true,
        tree: [{ path: 'agents/a.md', type: 'blob' }],
      })

    // The git fallback will try to actually clone github.com/org/big-repo which
    // we cannot allow in CI.  We stub `fetchViaGit` to avoid network access.
    const gitFallbackModule = await import('../../src/fetcher/git-fallback.js')
    const spy = vi.spyOn(gitFallbackModule, 'fetchViaGit').mockResolvedValue([
      { path: 'agents/a.md', content: '# A', category: 'agents' },
    ])

    const result = await fetchResources({
      repoUrl: 'https://github.com/org/big-repo',
      categories: ['agents'],
    })

    expect(spy).toHaveBeenCalled()
    expect(result.files).toHaveLength(1)
    expect(result.files[0]?.path).toBe('agents/a.md')
    spy.mockRestore()
  })

  // -------------------------------------------------------------------------
  // After downloading, reclassification drops files that map to a different
  // category than what was requested.  This exercises lines 83-87 where
  // `finalCategory` is present but not in the requested `categories` list.
  //
  // We set up a tree with a file whose path says "agents/" but whose
  // frontmatter says `category: skills`.  The caller only wants 'agents'.
  // After reclassification the file must be dropped.
  // -------------------------------------------------------------------------
  it('drops reclassified files whose final category is not in requested list', async () => {
    mockAgent.get('https://api.github.com')
      .intercept({ path: '/repos/org/repo2/git/trees/HEAD?recursive=1', method: 'GET' })
      .reply(200, {
        truncated: false,
        tree: [
          { path: 'agents/mismatch.md', type: 'blob' },
        ],
      })

    // The file content has frontmatter declaring it as 'skills'
    mockAgent.get('https://raw.githubusercontent.com')
      .intercept({ path: '/org/repo2/HEAD/agents/mismatch.md', method: 'GET' })
      .reply(200, '---\ncategory: skills\n---\n# Mismatch')

    const result = await fetchResources({
      repoUrl: 'https://github.com/org/repo2',
      categories: ['agents'],
    })

    // File was classified as 'skills' via frontmatter but we only requested
    // 'agents' — it should be dropped from the final list.
    expect(result.files).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Git fallback returns no files → GhostFetchError thrown  (lines 48-50)
// ---------------------------------------------------------------------------
describe('fetchResources — git fallback with empty result', () => {
  it('throws GhostFetchError when git fallback returns no matching files', async () => {
    // Use an empty repo (no agent/skill files) so fetchViaGit returns []
    const emptyBase = mkdtempSync(join(tmpdir(), 'ghost-empty-repo-'))
    const emptyRepo = join(emptyBase, 'repo')
    mkdirSync(emptyRepo)
    execSync('git init', { cwd: emptyRepo })
    execSync('git config user.email "test@test.com"', { cwd: emptyRepo })
    execSync('git config user.name "Test"', { cwd: emptyRepo })
    // Commit only a non-classifiable file
    writeFileSync(join(emptyRepo, 'readme.md'), '# No categories here')
    execSync('git add .', { cwd: emptyRepo })
    execSync('git commit -m "init"', { cwd: emptyRepo })

    try {
      await expect(
        fetchResources({ repoUrl: `file://${emptyRepo}`, categories: ['agents'] }),
      ).rejects.toThrow('No matching resources')
    } finally {
      rmSync(emptyBase, { recursive: true, force: true })
    }
  })
})
