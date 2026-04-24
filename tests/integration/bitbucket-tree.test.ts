// tests/integration/bitbucket-tree.test.ts

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher } from 'undici'
import type { Dispatcher } from 'undici'
import { fetchTree, GhostFetchError } from '../../src/fetcher/api-tree-scanner.js'
import type { DetectedHost } from '../../src/core/types.js'

const BBC_HOST: DetectedHost = {
  type: 'bitbucket-cloud',
  apiBase: 'https://api.bitbucket.org/2.0',
  rawBase: 'https://api.bitbucket.org/2.0',
  owner: 'workspace',
  repo: 'my-repo',
  host: 'https://bitbucket.org',
}

const BBS_HOST: DetectedHost = {
  type: 'bitbucket-server',
  apiBase: 'https://bitbucket.example.com/rest/api/1.0',
  rawBase: 'https://bitbucket.example.com',
  owner: 'PROJECT',
  repo: 'my-repo',
  host: 'https://bitbucket.example.com',
}

describe('fetchTree — Bitbucket Cloud pagination', () => {
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

  it('follows "next" cursor URL until absent, collecting all commit_file entries', async () => {
    const mockPool = mockAgent.get('https://api.bitbucket.org')

    // First page — has a next cursor
    mockPool.intercept({
      path: '/2.0/repositories/workspace/my-repo/src?pagelen=100',
      method: 'GET',
    }).reply(200, {
      values: [{ path: 'agents/a.md', type: 'commit_file' }],
      next: 'https://api.bitbucket.org/2.0/repositories/workspace/my-repo/src?page=2&pagelen=100',
    })

    // Second page — no next cursor (end of pagination)
    mockPool.intercept({
      path: '/2.0/repositories/workspace/my-repo/src?page=2&pagelen=100',
      method: 'GET',
    }).reply(200, {
      values: [{ path: 'skills/b.md', type: 'commit_file' }],
    })

    const paths = await fetchTree(BBC_HOST, undefined)
    expect(paths).toEqual(['agents/a.md', 'skills/b.md'])
  })

  it('filters out non-commit_file entries (directories)', async () => {
    const mockPool = mockAgent.get('https://api.bitbucket.org')

    mockPool.intercept({
      path: '/2.0/repositories/workspace/my-repo/src?pagelen=100',
      method: 'GET',
    }).reply(200, {
      values: [
        { path: 'agents/', type: 'commit_directory' },
        { path: 'agents/a.md', type: 'commit_file' },
      ],
    })

    const paths = await fetchTree(BBC_HOST, undefined)
    expect(paths).toEqual(['agents/a.md'])
  })

  it('encodes Basic auth from username:app_password token for Bitbucket Cloud', async () => {
    const token = 'user:app_password'
    const encoded = Buffer.from(token).toString('base64')
    const mockPool = mockAgent.get('https://api.bitbucket.org')

    mockPool.intercept({
      path: '/2.0/repositories/workspace/my-repo/src?pagelen=100',
      method: 'GET',
      headers: { authorization: `Basic ${encoded}` },
    }).reply(200, { values: [] })

    await expect(fetchTree(BBC_HOST, token)).resolves.toEqual([])
  })

  it('throws GhostFetchError with "Private repo" on HTTP 401', async () => {
    const mockPool = mockAgent.get('https://api.bitbucket.org')

    mockPool.intercept({
      path: '/2.0/repositories/workspace/my-repo/src?pagelen=100',
      method: 'GET',
    }).reply(401, { type: 'error', error: { message: 'Unauthorized' } })

    const err = await fetchTree(BBC_HOST, undefined).catch(e => e)
    expect(err).toBeInstanceOf(GhostFetchError)
    expect(err.message).toContain('Private repo')
  })

  it('throws GhostFetchError with "not found" on HTTP 404', async () => {
    const mockPool = mockAgent.get('https://api.bitbucket.org')

    mockPool.intercept({
      path: '/2.0/repositories/workspace/my-repo/src?pagelen=100',
      method: 'GET',
    }).reply(404, { type: 'error', error: { message: 'Not Found' } })

    const err = await fetchTree(BBC_HOST, undefined).catch(e => e)
    expect(err).toBeInstanceOf(GhostFetchError)
    expect(err.message.toLowerCase()).toContain('not found')
  })
})

describe('fetchTree — Bitbucket Server pagination', () => {
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

  it('paginates using isLastPage=false and nextPageStart offset', async () => {
    const mockPool = mockAgent.get('https://bitbucket.example.com')

    // First page — not last, nextPageStart at 500
    mockPool.intercept({
      path: '/rest/api/1.0/projects/PROJECT/repos/my-repo/files?limit=500&start=0',
      method: 'GET',
    }).reply(200, {
      values: ['agents/a.md', 'skills/b.md'],
      isLastPage: false,
      nextPageStart: 500,
    })

    // Second page — is last page
    mockPool.intercept({
      path: '/rest/api/1.0/projects/PROJECT/repos/my-repo/files?limit=500&start=500',
      method: 'GET',
    }).reply(200, {
      values: ['prompts/c.md'],
      isLastPage: true,
    })

    const paths = await fetchTree(BBS_HOST, undefined)
    expect(paths).toEqual(['agents/a.md', 'skills/b.md', 'prompts/c.md'])
  })

  it('stops on first page when isLastPage is true', async () => {
    const mockPool = mockAgent.get('https://bitbucket.example.com')

    mockPool.intercept({
      path: '/rest/api/1.0/projects/PROJECT/repos/my-repo/files?limit=500&start=0',
      method: 'GET',
    }).reply(200, {
      values: ['README.md'],
      isLastPage: true,
    })

    const paths = await fetchTree(BBS_HOST, undefined)
    expect(paths).toEqual(['README.md'])
  })

  it('sends Authorization Bearer header for Bitbucket Server', async () => {
    const mockPool = mockAgent.get('https://bitbucket.example.com')

    mockPool.intercept({
      path: '/rest/api/1.0/projects/PROJECT/repos/my-repo/files?limit=500&start=0',
      method: 'GET',
      headers: { authorization: 'Bearer bbstoken' },
    }).reply(200, { values: [], isLastPage: true })

    await expect(fetchTree(BBS_HOST, 'bbstoken')).resolves.toEqual([])
  })

  it('throws GhostFetchError with "Private repo" on HTTP 403', async () => {
    const mockPool = mockAgent.get('https://bitbucket.example.com')

    mockPool.intercept({
      path: '/rest/api/1.0/projects/PROJECT/repos/my-repo/files?limit=500&start=0',
      method: 'GET',
    }).reply(403, { errors: [{ message: 'Forbidden' }] })

    const err = await fetchTree(BBS_HOST, undefined).catch(e => e)
    expect(err).toBeInstanceOf(GhostFetchError)
    expect(err.message).toContain('Private repo')
  })
})
