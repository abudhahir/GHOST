// tests/unit/cli-validation.test.ts
// Tests for M3 (--categories validation) and M4 (--host-type validation) in runCLI.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock interactive prompts so tests can run without a TTY
vi.mock('@inquirer/prompts', () => ({
  confirm: vi.fn(),
  checkbox: vi.fn(),
  input: vi.fn(),
  select: vi.fn(),
}))

// Mock fetchResources so tests don't make network calls
vi.mock('../../src/fetcher/index.js', () => ({
  fetchResources: vi.fn(),
  GhostFetchError: class GhostFetchError extends Error {
    constructor(message: string) { super(message); this.name = 'GhostFetchError' }
  },
}))

// Mock install so tests don't touch the filesystem
vi.mock('../../src/installer/index.js', () => ({
  install: vi.fn(),
}))

// Mock ConfigLoader so no real config files are read
vi.mock('../../src/core/config-loader.js', () => ({
  createDefaultConfigLoader: vi.fn(() => ({
    load: vi.fn().mockResolvedValue({}),
  })),
}))

import { runCLI } from '../../src/cli/main.js'

describe('CLI input validation', () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>
  let exitSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((_code?: number) => {
      throw new Error(`process.exit(${_code})`)
    })
  })

  afterEach(() => {
    stderrSpy.mockRestore()
    exitSpy.mockRestore()
    vi.clearAllMocks()
  })

  describe('M3 — --categories validation', () => {
    it('exits with code 2 and writes an error message for an unknown category', async () => {
      await expect(
        runCLI(['node', 'ghost', '--repo', 'https://github.com/org/repo', '--categories', 'foobar']),
      ).rejects.toThrow('process.exit(2)')

      expect(exitSpy).toHaveBeenCalledWith(2)
      const errorOutput = stderrSpy.mock.calls[0][0] as string
      expect(errorOutput).toContain('Error: unknown categories: foobar')
      expect(errorOutput).toContain('Valid values:')
    })

    it('exits with code 2 when one of multiple categories is unknown', async () => {
      await expect(
        runCLI(['node', 'ghost', '--repo', 'https://github.com/org/repo', '--categories', 'agents,foobar,skills']),
      ).rejects.toThrow('process.exit(2)')

      expect(exitSpy).toHaveBeenCalledWith(2)
      const errorOutput = stderrSpy.mock.calls[0][0] as string
      expect(errorOutput).toContain('foobar')
    })

    it('does not exit for the special "all" value', async () => {
      const { fetchResources } = await import('../../src/fetcher/index.js')
      const { install } = await import('../../src/installer/index.js')
      vi.mocked(fetchResources).mockResolvedValue({ files: [], failedDownloads: [], skippedCount: 0 })
      vi.mocked(install).mockResolvedValue({ written: [], failed: [] })

      // "all" is a reserved keyword — should not trigger validation error
      await expect(
        runCLI(['node', 'ghost', '--repo', 'https://github.com/org/repo', '--categories', 'all', '--yes']),
      ).resolves.toBeUndefined()

      expect(exitSpy).not.toHaveBeenCalledWith(2)
    })
  })

  describe('M4 — --host-type validation', () => {
    it('exits with code 2 and writes an error message for an unknown host type', async () => {
      await expect(
        runCLI(['node', 'ghost', '--repo', 'https://github.com/org/repo', '--categories', 'agents', '--host-type', 'badhost']),
      ).rejects.toThrow('process.exit(2)')

      expect(exitSpy).toHaveBeenCalledWith(2)
      const errorOutput = stderrSpy.mock.calls[0][0] as string
      expect(errorOutput).toContain('Error: unknown host type: badhost')
      expect(errorOutput).toContain('Valid values:')
    })

    it('does not exit for a valid host type (github)', async () => {
      const { fetchResources } = await import('../../src/fetcher/index.js')
      const { install } = await import('../../src/installer/index.js')
      vi.mocked(fetchResources).mockResolvedValue({ files: [], failedDownloads: [], skippedCount: 0 })
      vi.mocked(install).mockResolvedValue({ written: [], failed: [] })

      await expect(
        runCLI(['node', 'ghost', '--repo', 'https://github.com/org/repo', '--categories', 'agents', '--host-type', 'github', '--yes']),
      ).resolves.toBeUndefined()

      expect(exitSpy).not.toHaveBeenCalledWith(2)
    })

    it('does not exit for a valid host type (gitea)', async () => {
      const { fetchResources } = await import('../../src/fetcher/index.js')
      const { install } = await import('../../src/installer/index.js')
      vi.mocked(fetchResources).mockResolvedValue({ files: [], failedDownloads: [], skippedCount: 0 })
      vi.mocked(install).mockResolvedValue({ written: [], failed: [] })

      await expect(
        runCLI(['node', 'ghost', '--repo', 'https://github.com/org/repo', '--categories', 'agents', '--host-type', 'gitea', '--yes']),
      ).resolves.toBeUndefined()

      expect(exitSpy).not.toHaveBeenCalledWith(2)
    })
  })
})
