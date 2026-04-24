// tests/integration/host-probe.test.ts

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher } from 'undici'
import type { Dispatcher } from 'undici'
import { probeHost } from '../../src/fetcher/host-prober.js'

const BASE = 'https://git.company.com'

describe('probeHost', () => {
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

  it('identifies GitHub Enterprise Server', async () => {
    const pool = mockAgent.get(BASE)
    pool.intercept({ path: '/api/v3', method: 'GET' }).reply(200, { current_user_url: 'https://git.company.com/api/v3/user' })
    pool.intercept({ path: '/api/v4/version', method: 'GET' }).reply(404, '')
    pool.intercept({ path: '/api/v1/version', method: 'GET' }).reply(404, '')
    pool.intercept({ path: '/rest/api/1.0/application-properties', method: 'GET' }).reply(404, '')

    const result = await probeHost(BASE, undefined)
    expect(result).toBe('github-enterprise')
  })

  it('identifies self-hosted GitLab', async () => {
    const pool = mockAgent.get(BASE)
    pool.intercept({ path: '/api/v3', method: 'GET' }).reply(404, '')
    pool.intercept({ path: '/api/v4/version', method: 'GET' }).reply(200, { version: '16.0.0' })
    pool.intercept({ path: '/api/v1/version', method: 'GET' }).reply(404, '')
    pool.intercept({ path: '/rest/api/1.0/application-properties', method: 'GET' }).reply(404, '')

    const result = await probeHost(BASE, undefined)
    expect(result).toBe('gitlab')
  })

  it('identifies Gitea', async () => {
    const pool = mockAgent.get(BASE)
    pool.intercept({ path: '/api/v3', method: 'GET' }).reply(404, '')
    pool.intercept({ path: '/api/v4/version', method: 'GET' }).reply(404, '')
    pool.intercept({ path: '/api/v1/version', method: 'GET' }).reply(200, { version: '1.21.0' })
    pool.intercept({ path: '/rest/api/1.0/application-properties', method: 'GET' }).reply(404, '')

    const result = await probeHost(BASE, undefined)
    expect(result).toBe('gitea')
  })

  it('identifies Bitbucket Server', async () => {
    const pool = mockAgent.get(BASE)
    pool.intercept({ path: '/api/v3', method: 'GET' }).reply(404, '')
    pool.intercept({ path: '/api/v4/version', method: 'GET' }).reply(404, '')
    pool.intercept({ path: '/api/v1/version', method: 'GET' }).reply(404, '')
    pool.intercept({ path: '/rest/api/1.0/application-properties', method: 'GET' }).reply(200, {})

    const result = await probeHost(BASE, undefined)
    expect(result).toBe('bitbucket-server')
  })

  it('returns null when all probes fail', async () => {
    const pool = mockAgent.get(BASE)
    pool.intercept({ path: '/api/v3', method: 'GET' }).reply(404, '')
    pool.intercept({ path: '/api/v4/version', method: 'GET' }).reply(404, '')
    pool.intercept({ path: '/api/v1/version', method: 'GET' }).reply(404, '')
    pool.intercept({ path: '/rest/api/1.0/application-properties', method: 'GET' }).reply(404, '')

    const result = await probeHost(BASE, undefined)
    expect(result).toBeNull()
  })
})
