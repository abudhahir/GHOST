// src/installer/flat-installer.ts
//
// Resolves destination file paths for flat install mode.
// In flat mode all matched files are written into a single destination directory
// with the source directory structure stripped.  When two source files share the
// same basename a deterministic collision-resolution strategy is applied:
//
//   1. First file keeps the simple basename.
//   2. Subsequent colliding files use the full relative source path with every
//      forward slash replaced by an underscore.
//   3. If the full-path substitution still collides (extreme edge case) a
//      numeric suffix (_2, _3, …) is appended before the file extension.

import { join, basename } from 'node:path'
import type { ResolvedFile } from '../core/types.js'

export interface DestinationEntry {
  file: ResolvedFile
  dest: string
}

/**
 * Compute a unique destination path for every source file when installing in
 * flat mode.
 *
 * @param files   - Ordered list of resolved source files.
 * @param destDir - Target directory (trailing slash is normalised away).
 * @returns An array of {file, dest} pairs in the same order as the input.
 */
export function resolveDestinations(
  files: ResolvedFile[],
  destDir: string,
): DestinationEntry[] {
  // Strip trailing slash so that join() produces predictable paths.
  const normalised = destDir.endsWith('/') ? destDir.slice(0, -1) : destDir

  const taken = new Set<string>()
  const result: DestinationEntry[] = []

  for (const file of files) {
    const name = basename(file.path)
    let candidate = join(normalised, name)

    if (taken.has(candidate)) {
      // Strategy 1 – prefix with ALL intermediate directory segments between
      // the category root (first segment) and the final basename, joined with
      // underscores.
      //
      // For paths with only two segments (category/basename) there are no
      // intermediate segments, so fall back to the immediate parent (segments[0]).
      //
      // Examples:
      //   agents/search/refactor.agent.md      → search_refactor.agent.md
      //   agents/coding/deep/refactor.md        → coding_deep_refactor.md
      //   b/refactor.md                         → b_refactor.md  (2-segment fallback)
      const segments = file.path.split('/')
      // segments[0] is the category root; segments[last] is the basename.
      // Intermediate segments are everything in between.
      const intermediates = segments.slice(1, segments.length - 1)
      const prefix =
        intermediates.length > 0 ? intermediates.join('_') : (segments[0] ?? '')
      const prefixedName = prefix ? `${prefix}_${name}` : name
      candidate = join(normalised, prefixedName)
    }

    // Strategy 2 – numeric suffix if the prefixed name still collides.
    if (taken.has(candidate)) {
      const segments = file.path.split('/')
      const intermediates = segments.slice(1, segments.length - 1)
      const prefix =
        intermediates.length > 0 ? intermediates.join('_') : (segments[0] ?? '')
      const prefixedName = prefix ? `${prefix}_${name}` : name
      const base = join(normalised, prefixedName)
      const dotIdx = base.lastIndexOf('.')
      // Only treat a dot as an extension separator when it appears after the
      // directory portion of the path.
      const hasDotInName = dotIdx > normalised.length + 1

      let counter = 2
      do {
        candidate = hasDotInName
          ? `${base.slice(0, dotIdx)}_${counter}${base.slice(dotIdx)}`
          : `${base}_${counter}`
        counter++
      } while (taken.has(candidate))
    }

    taken.add(candidate)
    result.push({ file, dest: candidate })
  }

  return result
}
