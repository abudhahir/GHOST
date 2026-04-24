import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher } from 'undici'
import type { Dispatcher } from 'undici'
import { fetchResources, GhostFetchError } from '../../src/fetcher/index.js'

describe('fetchResources — error handling', () => {
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

  it('throws GhostFetchError with "Private repo" on 401', async () => {
    mockAgent.get('https://api.github.com')
      .intercept({ path: '/repos/org/private-repo/git/trees/HEAD?recursive=1', method: 'GET' })
      .reply(401, { message: 'Bad credentials' })

    await expect(
      fetchResources({ repoUrl: 'https://github.com/org/private-repo', categories: ['agents'] }),
    ).rejects.toThrow('Private repo')
  })

  it('throws GhostFetchError with "not found" on 404', async () => {
    mockAgent.get('https://api.github.com')
      .intercept({ path: '/repos/org/missing/git/trees/HEAD?recursive=1', method: 'GET' })
      .reply(404, {})

    await expect(
      fetchResources({ repoUrl: 'https://github.com/org/missing', categories: ['agents'] }),
    ).rejects.toThrow(/not found/i)
  })

  it('throws "No matching resources" when tree has no classifiable files', async () => {
    mockAgent.get('https://api.github.com')
      .intercept({ path: '/repos/org/my-repo/git/trees/HEAD?recursive=1', method: 'GET' })
      .reply(200, {
        truncated: false,
        tree: [
          { path: 'readme.md', type: 'blob' },
          { path: 'src/app.ts', type: 'blob' },
        ],
      })

    await expect(
      fetchResources({ repoUrl: 'https://github.com/org/my-repo', categories: ['agents'] }),
    ).rejects.toThrow('No matching resources')
  })

  it('GhostFetchError is thrown (not generic Error)', async () => {
    mockAgent.get('https://api.github.com')
      .intercept({ path: '/repos/org/my-repo/git/trees/HEAD?recursive=1', method: 'GET' })
      .reply(401, {})

    try {
      await fetchResources({ repoUrl: 'https://github.com/org/my-repo', categories: ['agents'] })
      expect.fail('Should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(GhostFetchError)
      expect((err as GhostFetchError).exitCode).toBe(2)
    }
  })
})
