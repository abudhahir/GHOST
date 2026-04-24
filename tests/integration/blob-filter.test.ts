import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher } from 'undici'
import type { Dispatcher } from 'undici'
import { fetchResources } from '../../src/fetcher/index.js'

describe('blob-only filtering', () => {
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

  it('directory entries are excluded from results', async () => {
    // GitHub tree with mixed blob and tree entries
    mockAgent.get('https://api.github.com')
      .intercept({ path: '/repos/org/my-repo/git/trees/HEAD?recursive=1', method: 'GET' })
      .reply(200, {
        truncated: false,
        tree: [
          { path: 'agents/', type: 'tree' },      // directory — must be excluded
          { path: 'agents/a.md', type: 'blob' },   // file — must be included
        ],
      })

    // Mock the download of agents/a.md
    mockAgent.get('https://raw.githubusercontent.com')
      .intercept({ path: '/org/my-repo/HEAD/agents/a.md', method: 'GET' })
      .reply(200, '# Agent A')

    const result = await fetchResources({
      repoUrl: 'https://github.com/org/my-repo',
      categories: ['agents'],
    })

    expect(result.files).toHaveLength(1)
    expect(result.files[0]?.path).toBe('agents/a.md')
  })
})
