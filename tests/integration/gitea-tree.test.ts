// tests/integration/gitea-tree.test.ts

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher } from 'undici'
import type { Dispatcher } from 'undici'
import { fetchTree, GhostFetchError } from '../../src/fetcher/api-tree-scanner.js'
import type { DetectedHost } from '../../src/core/types.js'

const GITEA_HOST: DetectedHost = {
  type: 'gitea',
  apiBase: 'https://gitea.example.com/api/v1',
  rawBase: 'https://gitea.example.com',
  owner: 'org',
  repo: 'my-repo',
  host: 'https://gitea.example.com',
}

describe('fetchTree — Gitea SHA resolution', () => {
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

  it('resolves default branch, then SHA, then fetches tree with blob filtering', async () => {
    const mockPool = mockAgent.get('https://gitea.example.com')

    // Step 1: fetch repo metadata to get default_branch
    mockPool.intercept({
      path: '/api/v1/repos/org/my-repo',
      method: 'GET',
    }).reply(200, { default_branch: 'main' })

    // Step 2: fetch branch to resolve SHA
    mockPool.intercept({
      path: '/api/v1/repos/org/my-repo/branches/main',
      method: 'GET',
    }).reply(200, { commit: { id: 'abc123sha' } })

    // Step 3: fetch git tree using the resolved SHA
    mockPool.intercept({
      path: '/api/v1/repos/org/my-repo/git/trees/abc123sha?recursive=true',
      method: 'GET',
    }).reply(200, {
      tree: [
        { path: 'agents/a.md', type: 'blob' },
        { path: 'agents/', type: 'tree' },
      ],
    })

    const paths = await fetchTree(GITEA_HOST, undefined)
    expect(paths).toEqual(['agents/a.md'])
  })

  it('sends Authorization Bearer header on all three Gitea requests', async () => {
    const mockPool = mockAgent.get('https://gitea.example.com')

    mockPool.intercept({
      path: '/api/v1/repos/org/my-repo',
      method: 'GET',
      headers: { authorization: 'Bearer giteaToken' },
    }).reply(200, { default_branch: 'develop' })

    mockPool.intercept({
      path: '/api/v1/repos/org/my-repo/branches/develop',
      method: 'GET',
      headers: { authorization: 'Bearer giteaToken' },
    }).reply(200, { commit: { id: 'deadbeef' } })

    mockPool.intercept({
      path: '/api/v1/repos/org/my-repo/git/trees/deadbeef?recursive=true',
      method: 'GET',
      headers: { authorization: 'Bearer giteaToken' },
    }).reply(200, {
      tree: [{ path: 'README.md', type: 'blob' }],
    })

    const paths = await fetchTree(GITEA_HOST, 'giteaToken')
    expect(paths).toEqual(['README.md'])
  })

  it('throws GhostFetchError with "Private repo" on HTTP 401 at repo metadata step', async () => {
    const mockPool = mockAgent.get('https://gitea.example.com')

    mockPool.intercept({
      path: '/api/v1/repos/org/my-repo',
      method: 'GET',
    }).reply(401, { message: 'Unauthorized' })

    const err = await fetchTree(GITEA_HOST, undefined).catch(e => e)
    expect(err).toBeInstanceOf(GhostFetchError)
    expect(err.message).toContain('Private repo')
  })

  it('throws GhostFetchError with "not found" on HTTP 404 at repo metadata step', async () => {
    const mockPool = mockAgent.get('https://gitea.example.com')

    mockPool.intercept({
      path: '/api/v1/repos/org/my-repo',
      method: 'GET',
    }).reply(404, { message: 'Not Found' })

    const err = await fetchTree(GITEA_HOST, undefined).catch(e => e)
    expect(err).toBeInstanceOf(GhostFetchError)
    expect(err.message.toLowerCase()).toContain('not found')
  })

  it('throws GhostFetchError with "Private repo" on HTTP 403 at branch SHA resolution step', async () => {
    const mockPool = mockAgent.get('https://gitea.example.com')

    mockPool.intercept({
      path: '/api/v1/repos/org/my-repo',
      method: 'GET',
    }).reply(200, { default_branch: 'main' })

    mockPool.intercept({
      path: '/api/v1/repos/org/my-repo/branches/main',
      method: 'GET',
    }).reply(403, { message: 'Forbidden' })

    const err = await fetchTree(GITEA_HOST, undefined).catch(e => e)
    expect(err).toBeInstanceOf(GhostFetchError)
    expect(err.message).toContain('Private repo')
  })
})
