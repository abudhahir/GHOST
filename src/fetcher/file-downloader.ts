// src/fetcher/file-downloader.ts

import { fetch } from 'undici'
import pLimit from 'p-limit'
import type { DetectedHost, Category, ResolvedFile } from '../core/types.js'

export interface DownloadInput {
  path: string
  category: Category
}

export interface DownloadResult {
  succeeded: ResolvedFile[]
  failed: string[]
}

export function buildRawUrl(host: DetectedHost, filePath: string): string {
  switch (host.type) {
    case 'github':
      return `${host.rawBase}/${host.owner}/${host.repo}/HEAD/${filePath}`
    case 'github-enterprise':
      return `${host.host}/${host.owner}/${host.repo}/raw/HEAD/${filePath}`
    case 'gitlab': {
      const encodedProject = encodeURIComponent(`${host.owner}/${host.repo}`)
      const encodedFile = encodeURIComponent(filePath)
      return `${host.apiBase}/projects/${encodedProject}/repository/files/${encodedFile}/raw?ref=HEAD`
    }
    case 'bitbucket-cloud':
      return `${host.apiBase}/repositories/${host.owner}/${host.repo}/src/HEAD/${filePath}`
    case 'bitbucket-server':
      return `${host.apiBase}/projects/${host.owner}/repos/${host.repo}/raw/${filePath}`
    case 'gitea':
      return `${host.apiBase}/repos/${host.owner}/${host.repo}/raw/${filePath}?ref=HEAD`
    default:
      throw new Error(`Cannot build raw URL for host type: ${(host as DetectedHost).type}`)
  }
}

export function authHeader(
  token: string | undefined,
  hostType: DetectedHost['type'],
): Record<string, string> {
  if (!token) return {}
  if (hostType === 'bitbucket-cloud') {
    return { Authorization: `Basic ${Buffer.from(token).toString('base64')}` }
  }
  return { Authorization: `Bearer ${token}` }
}

type DownloadAttempt =
  | { ok: true; path: string; content: string; category: Category }
  | { ok: false; path: string }

export async function downloadFiles(
  host: DetectedHost,
  files: DownloadInput[],
  token: string | undefined,
): Promise<DownloadResult> {
  const limit = pLimit(5)
  const headers = authHeader(token, host.type)

  const results = await Promise.all(
    files.map(file =>
      limit(async (): Promise<DownloadAttempt> => {
        try {
          const url = buildRawUrl(host, file.path)
          const res = await fetch(url, { headers })
          if (!res.ok) {
            return { ok: false, path: file.path }
          }
          const content = await res.text()
          return { ok: true, path: file.path, content, category: file.category }
        } catch {
          return { ok: false, path: file.path }
        }
      }),
    ),
  )

  const succeeded: ResolvedFile[] = results
    .filter((r): r is Extract<DownloadAttempt, { ok: true }> => r.ok)
    .map(r => ({ path: r.path, content: r.content, category: r.category }))

  const failed = results
    .filter((r): r is Extract<DownloadAttempt, { ok: false }> => !r.ok)
    .map(r => r.path)

  return { succeeded, failed }
}
