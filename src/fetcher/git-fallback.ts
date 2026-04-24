// src/fetcher/git-fallback.ts

import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readdir, readFile, stat } from 'node:fs/promises'
import simpleGit from 'simple-git'
import type { ResolvedFile, Category } from '../core/types.js'
import { FileFilter } from '../core/file-filter.js'

async function walkDir(dir: string, base: string, paths: string[]): Promise<void> {
  const entries = await readdir(dir)
  for (const entry of entries) {
    if (entry === '.git') continue
    const fullPath = join(dir, entry)
    const s = await stat(fullPath)
    if (s.isDirectory()) {
      await walkDir(fullPath, base, paths)
    } else {
      // Store path relative to clone root
      paths.push(fullPath.slice(base.length + 1))
    }
  }
}

export async function fetchViaGit(repoUrl: string, categories: Category[]): Promise<ResolvedFile[]> {
  const tmpDir = mkdtempSync(join(tmpdir(), 'ghost-clone-'))

  try {
    await simpleGit().clone(repoUrl, tmpDir, ['--depth', '1'])

    const allPaths: string[] = []
    await walkDir(tmpDir, tmpDir, allPaths)

    const filter = new FileFilter()
    const getContent = async (path: string): Promise<string> => {
      try {
        return await readFile(join(tmpDir, path), 'utf8')
      } catch {
        return ''
      }
    }

    const { matched } = await filter.filter(allPaths, categories, getContent)

    const resolved: ResolvedFile[] = await Promise.all(
      matched.map(async ({ path, category }) => ({
        path,
        content: await readFile(join(tmpDir, path), 'utf8'),
        category,
      })),
    )

    return resolved
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
}
