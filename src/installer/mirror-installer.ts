// src/installer/mirror-installer.ts
//
// Implements mirror-mode installation: preserves the source directory structure
// when writing files to the local filesystem.  Per-category `destinations`
// config overrides the base directory for that category.  Files whose category
// has no override fall back to `config.dest` (if set) or `config.cwd`.
//
// Writes are performed atomically: content is written to a temporary file in
// the SAME directory as the final destination (guaranteeing a same-filesystem
// rename), then renamed to the final path.  On failure the tmp file is removed.

import { mkdir, writeFile, rename, unlink } from 'node:fs/promises'
import { join, dirname, basename } from 'node:path'
import { randomBytes } from 'node:crypto'
import type { ResolvedFile, InstallConfig } from '../core/types.js'

export interface WriteResult {
  path: string
  dest: string
}

/**
 * Write `content` to `dest` atomically.
 *
 * A temporary file is created in the same directory as `dest` so that the
 * final rename(2) is guaranteed to stay on a single filesystem.  If any step
 * fails the temporary file is cleaned up before re-throwing.
 */
export async function atomicWrite(dest: string, content: string): Promise<void> {
  const dir = dirname(dest)
  await mkdir(dir, { recursive: true })

  const tmpPath = join(dir, `.ghost-tmp-${randomBytes(6).toString('hex')}-${basename(dest)}`)

  try {
    await writeFile(tmpPath, content, 'utf8')
    await rename(tmpPath, dest)
  } catch (err) {
    try {
      await unlink(tmpPath)
    } catch {
      // Best-effort cleanup — ignore secondary errors.
    }
    throw err
  }
}

/**
 * Strip the leading category segment from a source-relative path.
 *
 * Source paths are expected to start with the category name as the first
 * directory segment (e.g. "agents/coding/refactor.md").  When a per-category
 * destination override is configured, the destination root replaces that
 * leading segment so that the installed path mirrors the sub-structure only:
 *   "agents/foo.md"  +  destinations.agents = ".claude/agents/"
 *   → base = "<cwd>/.claude/agents/"
 *   → relative = "foo.md"
 *   → dest = "<cwd>/.claude/agents/foo.md"
 *
 * If the path does not start with the expected category prefix (edge case),
 * the full path is returned unchanged.
 */
function stripCategoryPrefix(filePath: string, category: string): string {
  const prefix = `${category}/`
  return filePath.startsWith(prefix) ? filePath.slice(prefix.length) : filePath
}

/**
 * Install `files` preserving their source directory structure.
 *
 * Resolution order for each file's base directory and path handling:
 *   1. `config.destinations[file.category]` is set:
 *      - base  = join(cwd, destinations[category])
 *      - relative path = file.path with the leading category segment stripped
 *   2. `config.dest` is set:
 *      - base  = join(cwd, dest)
 *      - relative path = file.path as-is (preserves full source structure)
 *   3. Fallback:
 *      - base  = cwd
 *      - relative path = file.path as-is
 *
 * All paths in `destinations` and `dest` are treated as relative to `config.cwd`.
 */
export async function mirrorInstall(
  files: ResolvedFile[],
  config: InstallConfig,
): Promise<WriteResult[]> {
  const written: WriteResult[] = []

  for (const file of files) {
    const categoryRoot = config.destinations?.[file.category]

    let base: string
    let relativePath: string

    if (categoryRoot) {
      // Category-specific override: the destination root replaces the leading
      // category segment so that ".claude/agents/" acts as the new "agents/" root.
      base = join(config.cwd, categoryRoot)
      relativePath = stripCategoryPrefix(file.path, file.category)
    } else if (config.dest) {
      base = join(config.cwd, config.dest)
      relativePath = file.path
    } else {
      base = config.cwd
      relativePath = file.path
    }

    const dest = join(base, relativePath)
    await atomicWrite(dest, file.content)
    written.push({ path: file.path, dest })
  }

  return written
}
