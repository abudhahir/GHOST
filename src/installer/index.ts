// src/installer/index.ts
//
// Install orchestrator — dispatches to mirror or flat mode depending on
// `config.mode` and collects results, isolating individual file write failures
// (flat mode only) so a single bad file does not abort the entire operation.

import { join, basename } from 'node:path'
import type { ResolvedFile, InstallConfig } from '../core/types.js'
import { mirrorInstall, atomicWrite } from './mirror-installer.js'
import { resolveDestinations } from './flat-installer.js'

export interface InstallResult {
  written: Array<{ path: string; dest: string }>
  failed: string[]
}

/**
 * Install resolved files according to `config`.
 *
 * Mirror mode:
 *   - Preserves the source directory structure under the base directory.
 *   - Per-category `destinations` override the base directory for that category.
 *   - Any write failure throws (entire batch is considered failed).
 *
 * Flat mode:
 *   - Strips source structure; all files land in a single directory.
 *   - Collision resolution is handled by `resolveDestinations`.
 *   - Per-category `destinations` override the base directory for that category.
 *   - Individual write failures are collected in `result.failed` rather than
 *     aborting the whole batch.
 */
export async function install(files: ResolvedFile[], config: InstallConfig): Promise<InstallResult> {
  const written: InstallResult['written'] = []
  const failed: string[] = []

  if (config.mode === 'mirror') {
    const results = await mirrorInstall(files, config)
    written.push(...results)
  } else {
    // Flat mode: resolve collision-free destination paths first, then apply
    // per-category destination overrides.
    const destDir = config.dest ?? config.cwd
    const destinations = resolveDestinations(files, destDir)

    for (const { file, dest } of destinations) {
      const categoryRoot = config.destinations?.[file.category]

      // When a category-specific root is configured, replace the destDir
      // prefix with the override root but keep the resolved basename so
      // collision resolution is still respected.
      const finalDest = categoryRoot
        ? join(config.cwd, categoryRoot, basename(dest))
        : dest

      try {
        await atomicWrite(finalDest, file.content)
        written.push({ path: file.path, dest: finalDest })
      } catch {
        failed.push(file.path)
      }
    }
  }

  return { written, failed }
}
