// tests/integration/gitlab-tree.test.ts

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher } from 'undici'
import type { Dispatcher } from 'undici'
import { fetchTree, GhostFetchError } from '../../src/fetcher/api-tree-scanner.js'
import type { DetectedHost } from '../../src/core/types.js'

const GITLAB_HOST: DetectedHost = {
  type: 'gitlab',
  apiBase: 'https://gitlab.com/api/v4',
  rawBase: 'https://gitlab.com',
  owner: 'org',
  repo: 'my-repo',
  host: 'https://gitlab.com',
}

describe('fetchTree — GitLab pagination', () => {
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

  it('follows X-Next-Page header across multiple pages until empty header', async () => {
    const mockPool = mockAgent.get('https://gitlab.com')

    // Page 1 — returns X-Next-Page: 2
    mockPool.intercept({
      path: '/api/v4/projects/org%2Fmy-repo/repository/tree?recursive=true&per_page=100&page=1',
      method: 'GET',
    }).reply(200, [{ path: 'agents/a.md', type: 'blob' }], { headers: { 'x-next-page': '2' } })

    // Page 2 — returns empty X-Next-Page (end of pagination)
    mockPool.intercept({
      path: '/api/v4/projects/org%2Fmy-repo/repository/tree?recursive=true&per_page=100&page=2',
      method: 'GET',
    }).reply(200, [{ path: 'skills/b.md', type: 'blob' }], { headers: { 'x-next-page': '' } })

    const paths = await fetchTree(GITLAB_HOST, undefined)
    expect(paths).toEqual(['agents/a.md', 'skills/b.md'])
  })

  it('filters out tree (directory) type entries, keeps only blobs', async () => {
    const mockPool = mockAgent.get('https://gitlab.com')

    mockPool.intercept({
      path: '/api/v4/projects/org%2Fmy-repo/repository/tree?recursive=true&per_page=100&page=1',
      method: 'GET',
    }).reply(200, [
      { path: 'agents/', type: 'tree' },
      { path: 'agents/a.md', type: 'blob' },
    ], { headers: { 'x-next-page': '' } })

    const paths = await fetchTree(GITLAB_HOST, undefined)
    expect(paths).toEqual(['agents/a.md'])
  })

  it('sends Authorization Bearer header when token is provided', async () => {
    const mockPool = mockAgent.get('https://gitlab.com')

    mockPool.intercept({
      path: '/api/v4/projects/org%2Fmy-repo/repository/tree?recursive=true&per_page=100&page=1',
      method: 'GET',
      headers: { authorization: 'Bearer glpat-token' },
    }).reply(200, [], { headers: { 'x-next-page': '' } })

    await expect(fetchTree(GITLAB_HOST, 'glpat-token')).resolves.toEqual([])
  })

  it('throws GhostFetchError with "Private repo" on HTTP 401', async () => {
    const mockPool = mockAgent.get('https://gitlab.com')

    mockPool.intercept({
      path: '/api/v4/projects/org%2Fmy-repo/repository/tree?recursive=true&per_page=100&page=1',
      method: 'GET',
    }).reply(401, { message: 'Unauthorized' })

    const err = await fetchTree(GITLAB_HOST, undefined).catch(e => e)
    expect(err).toBeInstanceOf(GhostFetchError)
    expect(err.message).toContain('Private repo')
  })

  it('throws GhostFetchError with "not found" on HTTP 404', async () => {
    const mockPool = mockAgent.get('https://gitlab.com')

    mockPool.intercept({
      path: '/api/v4/projects/org%2Fmy-repo/repository/tree?recursive=true&per_page=100&page=1',
      method: 'GET',
    }).reply(404, { message: 'Not Found' })

    const err = await fetchTree(GITLAB_HOST, undefined).catch(e => e)
    expect(err).toBeInstanceOf(GhostFetchError)
    expect(err.message.toLowerCase()).toContain('not found')
  })

  it('stops pagination when X-Next-Page header is absent', async () => {
    const mockPool = mockAgent.get('https://gitlab.com')

    // No X-Next-Page header at all on first page
    mockPool.intercept({
      path: '/api/v4/projects/org%2Fmy-repo/repository/tree?recursive=true&per_page=100&page=1',
      method: 'GET',
    }).reply(200, [{ path: 'README.md', type: 'blob' }], { headers: {} })

    const paths = await fetchTree(GITLAB_HOST, undefined)
    expect(paths).toEqual(['README.md'])
  })
})
