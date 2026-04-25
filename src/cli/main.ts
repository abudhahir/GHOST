import { Command } from 'commander'
import { confirm, checkbox, input, select } from '@inquirer/prompts'
import { createConfigCommand } from './config-cmd.js'
import { fetchResources, GhostFetchError } from '../fetcher/index.js'
import { install } from '../installer/index.js'
import { createDefaultConfigLoader } from '../core/config-loader.js'
import { KNOWN_CATEGORIES } from '../core/types.js'
import type { Category, HostType, InstallConfig } from '../core/types.js'

const KNOWN_HOST_TYPES: HostType[] = [
  'github',
  'github-enterprise',
  'gitlab',
  'bitbucket-cloud',
  'bitbucket-server',
  'gitea',
  'git-fallback',
]

export async function runCLI(argv: string[]): Promise<void> {
  const cwd = process.cwd()
  const program = new Command()

  program
    .name('ghost')
    .description('Fetch and install AI agent resources from any git repository')
    .version('0.1.0')
    .option('--repo <url>', 'Git repository URL')
    .option('--categories <list>', 'Comma-separated categories or "all"')
    .option('--dest <path>', 'Target directory for flat install mode')
    .option('--token <token>', 'Auth token for the resolved host')
    .option('--host-type <type>', 'Declare platform: github|gitlab|gitea|bitbucket-server')
    .option('-y, --yes', 'Skip confirmation prompt')

  program.addCommand(createConfigCommand(cwd))

  program.action(async (options: {
    repo?: string
    categories?: string
    dest?: string
    token?: string
    hostType?: string
    yes?: boolean
  }) => {
    try {
      const loader = createDefaultConfigLoader(cwd)
      const fileConfig = await loader.load()

      // Determine repo
      let repo = options.repo ?? fileConfig.repo
      if (!repo) {
        repo = await input({ message: 'Git repository URL:' })
      }

      // Determine categories
      let categories: Category[]
      const rawCategories = options.categories ?? fileConfig.categories?.join(',')
      if (rawCategories) {
        if (rawCategories === 'all') {
          categories = [...KNOWN_CATEGORIES]
        } else {
          const parsedCategories = rawCategories.split(',').map(c => c.trim())
          const unknownCats = parsedCategories.filter(c => !KNOWN_CATEGORIES.includes(c as Category))
          if (unknownCats.length > 0) {
            process.stderr.write(`Error: unknown categories: ${unknownCats.join(', ')}. Valid values: ${KNOWN_CATEGORIES.join(', ')}\n`)
            process.exit(2)
          }
          categories = parsedCategories as Category[]
        }
      } else {
        const selected = await checkbox({
          message: 'Categories to install:',
          choices: KNOWN_CATEGORIES.map(c => ({ name: c, value: c, checked: false })),
        })
        categories = selected as Category[]
      }

      // Determine install mode
      let installMode: 'mirror' | 'flat' = fileConfig.installMode ?? 'mirror'
      let destDir: string | undefined = options.dest

      if (!options.dest && !fileConfig.installMode) {
        const modeChoice = await select({
          message: 'Install mode:',
          choices: [
            { name: 'Mirror source structure (default)', value: 'mirror' },
            { name: 'Flat install into a folder', value: 'flat' },
          ],
        })
        installMode = modeChoice as 'mirror' | 'flat'
        if (installMode === 'flat') {
          destDir = await input({ message: 'Target folder:', default: '.ghost/' })
        }
      }

      // Validate --host-type if provided
      const resolvedHostType = options.hostType ?? fileConfig.hostType
      if (resolvedHostType !== undefined && !KNOWN_HOST_TYPES.includes(resolvedHostType as HostType)) {
        process.stderr.write(`Error: unknown host type: ${resolvedHostType}. Valid values: ${KNOWN_HOST_TYPES.join(', ')}\n`)
        process.exit(2)
      }

      // Fetch files
      const { files, failedDownloads, skippedCount } = await fetchResources({
        repoUrl: repo,
        categories,
        token: options.token ?? fileConfig.token,
        hostType: resolvedHostType as HostType | undefined,
      })

      // Pre-install confirmation
      if (!options.yes) {
        const byCategory = new Map<Category, number>()
        for (const f of files) {
          byCategory.set(f.category, (byCategory.get(f.category) ?? 0) + 1)
        }
        console.log(`\nReady to install from ${repo}`)
        for (const [cat, count] of byCategory) {
          const dest = fileConfig.destinations?.[cat] ?? destDir ?? './'
          console.log(`  ${cat.padEnd(14)} → ${dest}  (${count} files)`)
        }
        const proceed = await confirm({ message: 'Proceed?', default: true })
        if (!proceed) {
          console.log('Aborted.')
          return
        }
      }

      // Install
      const installConfig: InstallConfig = {
        mode: installMode,
        dest: destDir,
        destinations: fileConfig.destinations,
        cwd,
      }
      const { written, failed: writeFailed } = await install(files, installConfig)

      // Post-install summary
      const byCategory = new Map<Category, { count: number; dest: string }>()
      for (const w of written) {
        const file = files.find(f => f.path === w.path)
        if (!file) continue
        const cat = file.category
        if (!byCategory.has(cat)) {
          const destDisplay = w.dest.replace(cwd, '.').replace(/\/[^/]+$/, '/') + ''
          byCategory.set(cat, { count: 0, dest: destDisplay })
        }
        byCategory.get(cat)!.count++
      }

      console.log(`\nInstalled ${written.length} files from ${repo}`)
      for (const [cat, { count, dest }] of byCategory) {
        console.log(`  ${cat.padEnd(14)} (${count})  →  ${dest}`)
      }
      if (skippedCount > 0) {
        process.stderr.write(`Skipped ${skippedCount} unrecognised files\n`)
      }

      // Exit codes
      if (writeFailed.length > 0 || failedDownloads.length > 0) {
        const allFailed = [...failedDownloads, ...writeFailed]
        process.stderr.write(`Failed files:\n${allFailed.map(f => `  ${f}`).join('\n')}\n`)
        process.exit(1)
      }
    } catch (err) {
      if (err instanceof GhostFetchError) {
        process.stderr.write(`Error: ${err.message}\n`)
        process.exit(2)
      }
      throw err
    }
  })

  await program.parseAsync(argv)
}
