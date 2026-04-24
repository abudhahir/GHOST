// src/fetcher/api-tree-scanner.ts

import { fetch } from 'undici'
import type { DetectedHost } from '../core/types.js'

export class GhostFetchError extends Error {
  constructor(message: string, public readonly exitCode: 2 = 2) {
    super(message)
    this.name = 'GhostFetchError'
  }
}

function authHeader(
  token: string | undefined,
  hostType: DetectedHost['type'],
): Record<string, string> {
  if (!token) return {}
  if (hostType === 'bitbucket-cloud') {
    return { Authorization: `Basic ${Buffer.from(token).toString('base64')}` }
  }
  return { Authorization: `Bearer ${token}` }
}

async function fetchJson(url: string, headers: Record<string, string>): Promise<unknown> {
  const res = await fetch(url, { headers })
  if (res.status === 401 || res.status === 403) {
    throw new GhostFetchError('Private repo — provide --token')
  }
  if (res.status === 404) {
    throw new GhostFetchError('Repo not found or inaccessible')
  }
  if (!res.ok) {
    throw new GhostFetchError(`HTTP ${res.status} from ${url}`)
  }
  return res.json()
}

async function fetchTreeGitHub(host: DetectedHost, token: string | undefined): Promise<string[]> {
  const url = `${host.apiBase}/repos/${host.owner}/${host.repo}/git/trees/HEAD?recursive=1`
  const headers = authHeader(token, host.type)
  const data = await fetchJson(url, headers) as {
    truncated: boolean
    tree: Array<{ path: string; type: string }>
  }

  if (data.truncated) {
    throw new GhostFetchError(
      'GitHub API response truncated: repository tree too large, falling back to git clone',
    )
  }

  return data.tree.filter(e => e.type === 'blob').map(e => e.path)
}

async function fetchTreeGitLab(host: DetectedHost, token: string | undefined): Promise<string[]> {
  const encodedPath = encodeURIComponent(`${host.owner}/${host.repo}`)
  const headers = authHeader(token, host.type)
  const paths: string[] = []
  let page = 1

  while (true) {
    const url = `${host.apiBase}/projects/${encodedPath}/repository/tree?recursive=true&per_page=100&page=${page}`
    const res = await fetch(url, { headers })
    if (res.status === 401 || res.status === 403) throw new GhostFetchError('Private repo — provide --token')
    if (res.status === 404) throw new GhostFetchError('Repo not found or inaccessible')
    if (!res.ok) throw new GhostFetchError(`HTTP ${res.status}`)

    const data = await res.json() as Array<{ path: string; type: string }>
    paths.push(...data.filter(e => e.type === 'blob').map(e => e.path))

    const nextPage = res.headers.get('X-Next-Page')
    if (!nextPage) break
    page = parseInt(nextPage, 10)
  }

  return paths
}

async function fetchTreeBitbucketCloud(host: DetectedHost, token: string | undefined): Promise<string[]> {
  const headers = authHeader(token, host.type)
  const paths: string[] = []
  let url: string | null =
    `${host.apiBase}/repositories/${host.owner}/${host.repo}/src?pagelen=100`

  while (url) {
    const res = await fetch(url, { headers })
    if (res.status === 401 || res.status === 403) throw new GhostFetchError('Private repo — provide --token')
    if (res.status === 404) throw new GhostFetchError('Repo not found or inaccessible')
    if (!res.ok) throw new GhostFetchError(`HTTP ${res.status}`)

    const data = await res.json() as {
      values: Array<{ path: string; type: string }>
      next?: string
    }
    paths.push(...data.values.filter(e => e.type === 'commit_file').map(e => e.path))
    url = data.next ?? null
  }

  return paths
}

async function fetchTreeBitbucketServer(host: DetectedHost, token: string | undefined): Promise<string[]> {
  const headers = authHeader(token, host.type)
  const paths: string[] = []
  let start = 0

  while (true) {
    const url = `${host.apiBase}/projects/${host.owner}/repos/${host.repo}/files?limit=500&start=${start}`
    const res = await fetch(url, { headers })
    if (res.status === 401 || res.status === 403) throw new GhostFetchError('Private repo — provide --token')
    if (res.status === 404) throw new GhostFetchError('Repo not found or inaccessible')
    if (!res.ok) throw new GhostFetchError(`HTTP ${res.status}`)

    const data = await res.json() as {
      values: string[]
      isLastPage: boolean
      nextPageStart?: number
    }
    paths.push(...data.values)

    if (data.isLastPage) break
    start = data.nextPageStart ?? start + 500
  }

  return paths
}

async function fetchTreeGitea(host: DetectedHost, token: string | undefined): Promise<string[]> {
  const headers = authHeader(token, host.type)

  const repoData = await fetchJson(
    `${host.apiBase}/repos/${host.owner}/${host.repo}`,
    headers,
  ) as { default_branch: string }

  const branchData = await fetchJson(
    `${host.apiBase}/repos/${host.owner}/${host.repo}/branches/${repoData.default_branch}`,
    headers,
  ) as { commit: { id: string } }

  const sha = branchData.commit.id

  const treeData = await fetchJson(
    `${host.apiBase}/repos/${host.owner}/${host.repo}/git/trees/${sha}?recursive=true`,
    headers,
  ) as { tree: Array<{ path: string; type: string }> }

  return treeData.tree.filter(e => e.type === 'blob').map(e => e.path)
}

export async function fetchTree(host: DetectedHost, token: string | undefined): Promise<string[]> {
  switch (host.type) {
    case 'github':
    case 'github-enterprise':
      return fetchTreeGitHub(host, token)
    case 'gitlab':
      return fetchTreeGitLab(host, token)
    case 'bitbucket-cloud':
      return fetchTreeBitbucketCloud(host, token)
    case 'bitbucket-server':
      return fetchTreeBitbucketServer(host, token)
    case 'gitea':
      return fetchTreeGitea(host, token)
    default:
      throw new GhostFetchError(`Unsupported host type for API fetch: ${host.type}`)
  }
}
