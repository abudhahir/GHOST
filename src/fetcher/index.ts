import { parseKnownHost, buildSelfHostedHost } from '../core/host-detector.js'
import { probeHost } from './host-prober.js'
import { fetchTree, GhostFetchError } from './api-tree-scanner.js'
import { downloadFiles } from './file-downloader.js'
import { fetchViaGit } from './git-fallback.js'
import { FileFilter } from '../core/file-filter.js'
import type { FetchConfig, ResolvedFile, DetectedHost } from '../core/types.js'

export { GhostFetchError }

interface FetchResult {
  files: ResolvedFile[]
  failedDownloads: string[]
  skippedCount: number
}

export async function fetchResources(config: FetchConfig): Promise<FetchResult> {
  const { repoUrl, categories, token, hostType } = config

  // 1. Determine host
  let host: DetectedHost
  let useGitFallback = false

  if (hostType) {
    const known = parseKnownHost(repoUrl)
    host = known ?? buildSelfHostedHost(repoUrl, hostType)
  } else {
    const known = parseKnownHost(repoUrl)
    if (known) {
      host = known
    } else {
      const url = new URL(repoUrl)
      const base = `${url.protocol}//${url.hostname}`
      const detected = await probeHost(base, token)
      if (detected) {
        host = buildSelfHostedHost(repoUrl, detected)
      } else {
        useGitFallback = true
        // build a placeholder host — won't be used for API calls
        host = buildSelfHostedHost(repoUrl, 'git-fallback')
      }
    }
  }

  // 2. Git fallback path
  if (useGitFallback) {
    const files = await fetchViaGit(repoUrl, categories)
    if (files.length === 0) {
      throw new GhostFetchError('No matching resources found for requested categories')
    }
    return { files, failedDownloads: [], skippedCount: 0 }
  }

  // 3. Fetch file tree via API
  let treePaths: string[]
  try {
    treePaths = await fetchTree(host, token)
  } catch (err) {
    // GitHub truncation → fall back to git clone
    if (err instanceof GhostFetchError && err.message.includes('truncated')) {
      process.stderr.write(`Warning: ${err.message}\n`)
      const files = await fetchViaGit(repoUrl, categories)
      return { files, failedDownloads: [], skippedCount: 0 }
    }
    throw err
  }

  // 4. Filter paths by categories (path-only classification — no content yet)
  const filter = new FileFilter()
  const noContent = async (_path: string) => ''
  const { matched, skipped } = await filter.filter(treePaths, categories, noContent)

  if (matched.length === 0) {
    throw new GhostFetchError('No matching resources found for requested categories')
  }

  // 5. Download matched files
  const { succeeded, failed: failedDownloads } = await downloadFiles(host, matched, token)

  // 6. Re-classify with actual content (frontmatter override)
  const reclassified: ResolvedFile[] = []
  for (const file of succeeded) {
    const actualCategory = await filter.classify(file.path, async () => file.content)
    const finalCategory = actualCategory ?? (categories.includes(file.category) ? file.category : null)
    if (finalCategory && categories.includes(finalCategory)) {
      reclassified.push({ path: file.path, content: file.content, category: finalCategory })
    }
  }

  return {
    files: reclassified,
    failedDownloads,
    skippedCount: skipped.length,
  }
}
