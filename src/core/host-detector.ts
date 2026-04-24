// src/core/host-detector.ts

import type { DetectedHost, HostType } from './types.js'

const KNOWN_HOSTS: Record<string, { type: DetectedHost['type']; apiBase: string; rawBase: string }> = {
  'github.com': {
    type: 'github',
    apiBase: 'https://api.github.com',
    rawBase: 'https://raw.githubusercontent.com',
  },
  'gitlab.com': {
    type: 'gitlab',
    apiBase: 'https://gitlab.com/api/v4',
    rawBase: 'https://gitlab.com',
  },
  'bitbucket.org': {
    type: 'bitbucket-cloud',
    apiBase: 'https://api.bitbucket.org/2.0',
    rawBase: 'https://api.bitbucket.org/2.0',
  },
}

function extractOwnerRepo(url: URL): { owner: string; repo: string } {
  const pathParts = url.pathname
    .replace(/^\//, '')
    .replace(/\/$/, '')
    .replace(/\.git$/, '')
    .split('/')

  if (pathParts.length < 2 || !pathParts[0] || !pathParts[1]) {
    throw new Error(
      `Invalid repository URL: ${url.href} — expected format: https://host/owner/repo`,
    )
  }

  return { owner: pathParts[0], repo: pathParts[1] }
}

export function parseKnownHost(repoUrl: string): DetectedHost | null {
  const url = new URL(repoUrl)
  const { owner, repo } = extractOwnerRepo(url)
  const host = `${url.protocol}//${url.hostname}`
  const known = KNOWN_HOSTS[url.hostname]

  if (!known) return null

  return {
    type: known.type,
    apiBase: known.apiBase,
    rawBase: known.rawBase,
    owner,
    repo,
    host,
  }
}

const SELF_HOSTED_API_BASES: Partial<Record<HostType, (host: string) => string>> = {
  'github-enterprise': (h) => `${h}/api/v3`,
  'gitlab': (h) => `${h}/api/v4`,
  'gitea': (h) => `${h}/api/v1`,
  'bitbucket-server': (h) => `${h}/rest/api/1.0`,
}

export function buildSelfHostedHost(repoUrl: string, type: HostType): DetectedHost {
  const url = new URL(repoUrl)
  const { owner, repo } = extractOwnerRepo(url)
  const host = `${url.protocol}//${url.hostname}`
  const apiBaseFn = SELF_HOSTED_API_BASES[type]
  const apiBase = apiBaseFn ? apiBaseFn(host) : host

  return {
    type,
    apiBase,
    rawBase: host,
    owner,
    repo,
    host,
  }
}
