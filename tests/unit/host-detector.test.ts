import { describe, it, expect } from 'vitest'
import { parseKnownHost, buildSelfHostedHost } from '../../src/core/host-detector.js'

describe('parseKnownHost', () => {
  it('identifies GitHub Cloud', () => {
    const result = parseKnownHost('https://github.com/org/my-repo')
    expect(result).not.toBeNull()
    expect(result!.type).toBe('github')
    expect(result!.owner).toBe('org')
    expect(result!.repo).toBe('my-repo')
    expect(result!.apiBase).toBe('https://api.github.com')
    expect(result!.rawBase).toBe('https://raw.githubusercontent.com')
  })

  it('identifies GitHub Cloud with trailing slash', () => {
    const result = parseKnownHost('https://github.com/org/my-repo/')
    expect(result!.type).toBe('github')
    expect(result!.owner).toBe('org')
    expect(result!.repo).toBe('my-repo')
  })

  it('identifies GitLab Cloud', () => {
    const result = parseKnownHost('https://gitlab.com/org/my-repo')
    expect(result!.type).toBe('gitlab')
    expect(result!.owner).toBe('org')
    expect(result!.repo).toBe('my-repo')
    expect(result!.apiBase).toBe('https://gitlab.com/api/v4')
  })

  it('identifies Bitbucket Cloud', () => {
    const result = parseKnownHost('https://bitbucket.org/workspace/my-repo')
    expect(result!.type).toBe('bitbucket-cloud')
    expect(result!.owner).toBe('workspace')
    expect(result!.repo).toBe('my-repo')
    expect(result!.apiBase).toBe('https://api.bitbucket.org/2.0')
  })

  it('returns null for unknown domain', () => {
    const result = parseKnownHost('https://git.company.com/org/repo')
    expect(result).toBeNull()
  })

  it('throws for malformed URL (no owner/repo path segments)', () => {
    expect(() => parseKnownHost('https://github.com')).toThrow()
  })

  it('strips .git suffix from repo name', () => {
    const result = parseKnownHost('https://github.com/org/my-repo.git')
    expect(result!.repo).toBe('my-repo')
  })
})

describe('buildSelfHostedHost', () => {
  it('builds GitHub Enterprise host', () => {
    const result = buildSelfHostedHost('https://git.corp.com/org/repo', 'github-enterprise')
    expect(result.type).toBe('github-enterprise')
    expect(result.apiBase).toBe('https://git.corp.com/api/v3')
    expect(result.owner).toBe('org')
    expect(result.repo).toBe('repo')
  })

  it('builds self-hosted GitLab host', () => {
    const result = buildSelfHostedHost('https://git.corp.com/org/repo', 'gitlab')
    expect(result.type).toBe('gitlab')
    expect(result.apiBase).toBe('https://git.corp.com/api/v4')
  })

  it('builds Gitea host', () => {
    const result = buildSelfHostedHost('https://git.corp.com/org/repo', 'gitea')
    expect(result.type).toBe('gitea')
    expect(result.apiBase).toBe('https://git.corp.com/api/v1')
  })

  it('builds Bitbucket Server host', () => {
    const result = buildSelfHostedHost('https://git.corp.com/org/repo', 'bitbucket-server')
    expect(result.type).toBe('bitbucket-server')
    expect(result.apiBase).toBe('https://git.corp.com/rest/api/1.0')
  })
})
