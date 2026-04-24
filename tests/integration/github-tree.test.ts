// tests/integration/github-tree.test.ts

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher } from 'undici'
import type { Dispatcher } from 'undici'
import { fetchTree, GhostFetchError } from '../../src/fetcher/api-tree-scanner.js'
import type { DetectedHost } from '../../src/core/types.js'

const GITHUB_HOST: DetectedHost = {
  type: 'github',
  apiBase: 'https://api.github.com',
  rawBase: 'https://raw.githubusercontent.com',
  owner: 'org',
  repo: 'my-repo',
  host: 'https://github.com',
}

describe('fetchTree — GitHub', () => {
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

  it('returns flat list of blob paths, filtering out tree (directory) entries', async () => {
    const mockPool = mockAgent.get('https://api.github.com')
    mockPool.intercept({
      path: '/repos/org/my-repo/git/trees/HEAD?recursive=1',
      method: 'GET',
    }).reply(200, {
      truncated: false,
      tree: [
        { path: 'agents/refactor.md', type: 'blob', sha: 'abc' },
        { path: 'agents/', type: 'tree', sha: 'def' },
        { path: 'skills/helper.md', type: 'blob', sha: 'ghi' },
      ],
    })

    const paths = await fetchTree(GITHUB_HOST, undefined)
    expect(paths).toEqual(['agents/refactor.md', 'skills/helper.md'])
  })

  it('throws GhostFetchError containing "truncated" when tree is truncated', async () => {
    const mockPool = mockAgent.get('https://api.github.com')
    mockPool.intercept({
      path: '/repos/org/my-repo/git/trees/HEAD?recursive=1',
      method: 'GET',
    }).reply(200, { truncated: true, tree: [] })

    await expect(fetchTree(GITHUB_HOST, undefined)).rejects.toThrow('truncated')
  })

  it('sends Authorization Bearer header when token is provided', async () => {
    const mockPool = mockAgent.get('https://api.github.com')
    mockPool.intercept({
      path: '/repos/org/my-repo/git/trees/HEAD?recursive=1',
      method: 'GET',
      headers: { authorization: 'Bearer mytoken' },
    }).reply(200, { truncated: false, tree: [] })

    await expect(fetchTree(GITHUB_HOST, 'mytoken')).resolves.toEqual([])
  })

  it('throws GhostFetchError with "Private repo" message on HTTP 401', async () => {
    const mockPool = mockAgent.get('https://api.github.com')
    mockPool.intercept({
      path: '/repos/org/my-repo/git/trees/HEAD?recursive=1',
      method: 'GET',
    }).reply(401, { message: 'Bad credentials' })

    const err = await fetchTree(GITHUB_HOST, undefined).catch(e => e)
    expect(err).toBeInstanceOf(GhostFetchError)
    expect(err.message).toContain('Private repo')
  })

  it('throws GhostFetchError with "not found" message on HTTP 404', async () => {
    const mockPool = mockAgent.get('https://api.github.com')
    mockPool.intercept({
      path: '/repos/org/my-repo/git/trees/HEAD?recursive=1',
      method: 'GET',
    }).reply(404, { message: 'Not Found' })

    const err = await fetchTree(GITHUB_HOST, undefined).catch(e => e)
    expect(err).toBeInstanceOf(GhostFetchError)
    expect(err.message.toLowerCase()).toContain('not found')
  })

  it('throws GhostFetchError with "Private repo" message on HTTP 403', async () => {
    const mockPool = mockAgent.get('https://api.github.com')
    mockPool.intercept({
      path: '/repos/org/my-repo/git/trees/HEAD?recursive=1',
      method: 'GET',
    }).reply(403, { message: 'Forbidden' })

    const err = await fetchTree(GITHUB_HOST, undefined).catch(e => e)
    expect(err).toBeInstanceOf(GhostFetchError)
    expect(err.message).toContain('Private repo')
  })

  it('works for github-enterprise host type with Bearer auth', async () => {
    const gheHost: DetectedHost = {
      ...GITHUB_HOST,
      type: 'github-enterprise',
      apiBase: 'https://github.example.com/api/v3',
      host: 'https://github.example.com',
    }
    const mockPool = mockAgent.get('https://github.example.com')
    mockPool.intercept({
      path: '/api/v3/repos/org/my-repo/git/trees/HEAD?recursive=1',
      method: 'GET',
      headers: { authorization: 'Bearer ghetoken' },
    }).reply(200, {
      truncated: false,
      tree: [{ path: 'README.md', type: 'blob', sha: 'zzz' }],
    })

    const paths = await fetchTree(gheHost, 'ghetoken')
    expect(paths).toEqual(['README.md'])
  })
})
