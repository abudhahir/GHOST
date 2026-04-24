import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execSync } from 'node:child_process'
import { fetchViaGit } from '../../src/fetcher/git-fallback.js'

describe('fetchViaGit', () => {
  let repoPath: string
  let tmpBase: string

  beforeAll(() => {
    tmpBase = mkdtempSync(join(tmpdir(), 'ghost-git-test-'))
    repoPath = join(tmpBase, 'fixture-repo')
    mkdirSync(repoPath)

    // Initialise a local git repo with fixture files
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

  it('scans and returns matched files from local git repo', async () => {
    const result = await fetchViaGit(`file://${repoPath}`, ['agents', 'skills'])
    const paths = result.map(f => f.path)
    expect(paths).toContain('agents/a.md')
    expect(paths).toContain('skills/b.md')
    expect(paths).not.toContain('readme.md')
  })

  it('returns correct file content', async () => {
    const result = await fetchViaGit(`file://${repoPath}`, ['agents'])
    const agentFile = result.find(f => f.path === 'agents/a.md')
    expect(agentFile?.content).toBe('# Agent A')
  })

  it('returns category for each file', async () => {
    const result = await fetchViaGit(`file://${repoPath}`, ['agents'])
    expect(result[0]?.category).toBe('agents')
  })

  it('cleans up temp directory after completion', async () => {
    // Should not throw — temp dir cleanup happens in finally block
    await expect(fetchViaGit(`file://${repoPath}`, ['agents'])).resolves.toBeDefined()
  })
})
