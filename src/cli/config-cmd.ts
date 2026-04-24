import { Command } from 'commander'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'

const USER_SCOPED_KEYS = new Set(['token', 'hostType', 'categories'])
const PROJECT_SCOPED_KEYS = new Set(['repo', 'destinations', 'installMode'])

function userConfigPath(): string {
  return join(homedir(), '.config', 'ghost', 'config.json')
}

function projectConfigPath(cwd: string): string {
  return join(cwd, '.ghost', 'config.json')
}

async function readJsonFile(path: string): Promise<Record<string, unknown>> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
  } catch {
    return {}
  }
}

async function writeJsonFile(path: string, data: Record<string, unknown>): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, JSON.stringify(data, null, 2) + '\n', 'utf8')
}

export function createConfigCommand(cwd: string): Command {
  const cmd = new Command('config')
  cmd.description('Read and write Ghost configuration')

  cmd
    .command('set <key> <value>')
    .description('Set a configuration value')
    .action(async (key: string, value: string) => {
      const isUserKey = USER_SCOPED_KEYS.has(key)
      const isProjectKey = PROJECT_SCOPED_KEYS.has(key)

      if (!isUserKey && !isProjectKey) {
        process.stderr.write(`Unknown configuration key: ${key}\n`)
        process.exit(2)
      }

      // project-scoped keys go to project config; user-scoped to user config
      const targetPath = isProjectKey ? projectConfigPath(cwd) : userConfigPath()
      const existing = await readJsonFile(targetPath)

      let parsed: unknown
      try {
        parsed = JSON.parse(value)
      } catch {
        parsed = value
      }

      existing[key] = parsed
      await writeJsonFile(targetPath, existing)
      console.log(`Set ${key} in ${targetPath}`)
    })

  cmd
    .command('list')
    .description('Print merged effective configuration')
    .action(async () => {
      const userConfig = await readJsonFile(userConfigPath())
      const projectConfig = await readJsonFile(projectConfigPath(cwd))
      const merged = { ...userConfig, ...projectConfig }
      console.log(JSON.stringify(merged, null, 2))
    })

  return cmd
}
