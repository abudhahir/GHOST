// tests/integration/file-downloader.test.ts

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher } from 'undici'
import type { Dispatcher } from 'undici'
import { downloadFiles } from '../../src/fetcher/file-downloader.js'
import type { DetectedHost } from '../../src/core/types.js'

const GITHUB_HOST: DetectedHost = {
  type: 'github',
  apiBase: 'https://api.github.com',
  rawBase: 'https://raw.githubusercontent.com',
  owner: 'org',
  repo: 'my-repo',
  host: 'https://github.com',
}

describe('downloadFiles', () => {
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

  it('downloads a file from GitHub raw URL', async () => {
    const pool = mockAgent.get('https://raw.githubusercontent.com')
    pool.intercept({ path: '/org/my-repo/HEAD/agents/a.md', method: 'GET' }).reply(200, '# Agent A')

    const result = await downloadFiles(
      GITHUB_HOST,
      [{ path: 'agents/a.md', category: 'agents' }],
      undefined,
    )
    expect(result.succeeded).toHaveLength(1)
    expect(result.succeeded[0]?.content).toBe('# Agent A')
    expect(result.succeeded[0]?.path).toBe('agents/a.md')
    expect(result.succeeded[0]?.category).toBe('agents')
    expect(result.failed).toHaveLength(0)
  })

  it('reports partial failure when one file 404s', async () => {
    const pool = mockAgent.get('https://raw.githubusercontent.com')
    pool.intercept({ path: '/org/my-repo/HEAD/agents/a.md', method: 'GET' }).reply(200, '# A')
    pool.intercept({ path: '/org/my-repo/HEAD/agents/b.md', method: 'GET' }).reply(404, 'Not Found')

    const result = await downloadFiles(
      GITHUB_HOST,
      [
        { path: 'agents/a.md', category: 'agents' },
        { path: 'agents/b.md', category: 'agents' },
      ],
      undefined,
    )
    expect(result.succeeded).toHaveLength(1)
    expect(result.succeeded[0]?.path).toBe('agents/a.md')
    expect(result.failed).toHaveLength(1)
    expect(result.failed[0]).toBe('agents/b.md')
  })

  it('sends Bearer auth token for GitHub', async () => {
    const pool = mockAgent.get('https://raw.githubusercontent.com')
    pool
      .intercept({
        path: '/org/my-repo/HEAD/agents/a.md',
        method: 'GET',
        headers: { authorization: 'Bearer mytoken' },
      })
      .reply(200, 'content')

    const result = await downloadFiles(
      GITHUB_HOST,
      [{ path: 'agents/a.md', category: 'agents' }],
      'mytoken',
    )
    expect(result.succeeded).toHaveLength(1)
    expect(result.failed).toHaveLength(0)
  })

  it('uses Basic auth for Bitbucket Cloud', async () => {
    const bbHost: DetectedHost = {
      type: 'bitbucket-cloud',
      apiBase: 'https://api.bitbucket.org/2.0',
      rawBase: 'https://api.bitbucket.org/2.0',
      owner: 'workspace',
      repo: 'my-repo',
      host: 'https://bitbucket.org',
    }
    const token = 'user:pass'
    const encoded = Buffer.from(token).toString('base64')
    const pool = mockAgent.get('https://api.bitbucket.org')
    pool
      .intercept({
        path: '/2.0/repositories/workspace/my-repo/src/HEAD/agents/a.md',
        method: 'GET',
        headers: { authorization: `Basic ${encoded}` },
      })
      .reply(200, 'bb content')

    const result = await downloadFiles(bbHost, [{ path: 'agents/a.md', category: 'agents' }], token)
    expect(result.succeeded).toHaveLength(1)
    expect(result.succeeded[0]?.content).toBe('bb content')
    expect(result.failed).toHaveLength(0)
  })

  it('builds correct URL for GitLab with URL-encoded project and file path', async () => {
    const gitlabHost: DetectedHost = {
      type: 'gitlab',
      apiBase: 'https://gitlab.com/api/v4',
      rawBase: 'https://gitlab.com',
      owner: 'myorg',
      repo: 'my-project',
      host: 'https://gitlab.com',
    }
    const encodedProject = encodeURIComponent('myorg/my-project')
    const encodedFile = encodeURIComponent('agents/refactor.md')
    const pool = mockAgent.get('https://gitlab.com')
    pool
      .intercept({
        path: `/api/v4/projects/${encodedProject}/repository/files/${encodedFile}/raw?ref=HEAD`,
        method: 'GET',
      })
      .reply(200, '# GitLab Agent')

    const result = await downloadFiles(
      gitlabHost,
      [{ path: 'agents/refactor.md', category: 'agents' }],
      undefined,
    )
    expect(result.succeeded).toHaveLength(1)
    expect(result.succeeded[0]?.content).toBe('# GitLab Agent')
    expect(result.failed).toHaveLength(0)
  })

  it('returns all failed when network errors occur', async () => {
    const pool = mockAgent.get('https://raw.githubusercontent.com')
    pool
      .intercept({ path: '/org/my-repo/HEAD/agents/a.md', method: 'GET' })
      .replyWithError(new Error('connection refused'))

    const result = await downloadFiles(
      GITHUB_HOST,
      [{ path: 'agents/a.md', category: 'agents' }],
      undefined,
    )
    expect(result.succeeded).toHaveLength(0)
    expect(result.failed).toHaveLength(1)
    expect(result.failed[0]).toBe('agents/a.md')
  })
})
