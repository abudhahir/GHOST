import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ConfigLoader } from '../../src/core/config-loader.js'

describe('ConfigLoader', () => {
  let cwd: string

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'ghost-test-'))
  })

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true })
  })

  it('returns empty merged config when no config files exist', async () => {
    const loader = new ConfigLoader({ cwd, userConfigDir: join(cwd, 'no-user') })
    const config = await loader.load()
    expect(config).toEqual({})
  })

  it('loads project config from .ghost/config.json in cwd', async () => {
    const ghostDir = join(cwd, '.ghost')
    mkdirSync(ghostDir)
    writeFileSync(join(ghostDir, 'config.json'), JSON.stringify({
      repo: 'https://github.com/org/repo',
      categories: ['agents'],
    }))
    const loader = new ConfigLoader({ cwd, userConfigDir: join(cwd, 'no-user') })
    const config = await loader.load()
    expect(config.repo).toBe('https://github.com/org/repo')
    expect(config.categories).toEqual(['agents'])
  })

  it('loads user config from userConfigDir/ghost/config.json', async () => {
    const userConfigDir = join(cwd, 'user-home')
    mkdirSync(join(userConfigDir, 'ghost'), { recursive: true })
    writeFileSync(join(userConfigDir, 'ghost', 'config.json'), JSON.stringify({
      token: 'ghp_test',
    }))
    const loader = new ConfigLoader({ cwd, userConfigDir })
    const config = await loader.load()
    expect(config.token).toBe('ghp_test')
  })

  it('project config overrides user config for shared keys', async () => {
    const userConfigDir = join(cwd, 'user-home')
    mkdirSync(join(userConfigDir, 'ghost'), { recursive: true })
    writeFileSync(join(userConfigDir, 'ghost', 'config.json'), JSON.stringify({
      categories: ['skills'],
    }))
    const ghostDir = join(cwd, '.ghost')
    mkdirSync(ghostDir)
    writeFileSync(join(ghostDir, 'config.json'), JSON.stringify({
      categories: ['agents'],
    }))
    const loader = new ConfigLoader({ cwd, userConfigDir })
    const config = await loader.load()
    expect(config.categories).toEqual(['agents'])
  })

  it('CLI flags override everything', async () => {
    const ghostDir = join(cwd, '.ghost')
    mkdirSync(ghostDir)
    writeFileSync(join(ghostDir, 'config.json'), JSON.stringify({
      categories: ['agents'],
    }))
    const loader = new ConfigLoader({ cwd, userConfigDir: join(cwd, 'no-user') })
    const config = await loader.load({ categories: ['skills'] })
    expect(config.categories).toEqual(['skills'])
  })

  it('installMode is project-scoped only — ignored in user config', async () => {
    const userConfigDir = join(cwd, 'user-home')
    mkdirSync(join(userConfigDir, 'ghost'), { recursive: true })
    writeFileSync(join(userConfigDir, 'ghost', 'config.json'), JSON.stringify({
      installMode: 'flat',
    }))
    const loader = new ConfigLoader({ cwd, userConfigDir })
    const config = await loader.load()
    expect(config.installMode).toBeUndefined()
  })

  it('destinations from project config are preserved', async () => {
    const ghostDir = join(cwd, '.ghost')
    mkdirSync(ghostDir)
    const destinations = { agents: '.claude/agents/', skills: '.claude/skills/' }
    writeFileSync(join(ghostDir, 'config.json'), JSON.stringify({ destinations }))
    const loader = new ConfigLoader({ cwd, userConfigDir: join(cwd, 'no-user') })
    const config = await loader.load()
    expect(config.destinations).toEqual(destinations)
  })
})
