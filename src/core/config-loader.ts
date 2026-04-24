import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { MergedConfig, UserConfig, ProjectConfig } from './types.js'

interface ConfigLoaderOptions {
  cwd: string
  userConfigDir: string
}

export class ConfigLoader {
  private cwd: string
  private userConfigDir: string

  constructor(options: ConfigLoaderOptions) {
    this.cwd = options.cwd
    this.userConfigDir = options.userConfigDir
  }

  async load(cliFlags: Partial<MergedConfig> = {}): Promise<MergedConfig> {
    const userConfig = await this.loadUserConfig()
    const projectConfig = await this.loadProjectConfig()

    const merged: MergedConfig = {
      ...userConfig,
      ...projectConfig,
      ...Object.fromEntries(
        Object.entries(cliFlags).filter(([, v]) => v !== undefined),
      ),
    }

    return merged
  }

  private async loadUserConfig(): Promise<UserConfig> {
    const path = join(this.userConfigDir, 'ghost', 'config.json')
    try {
      const raw = await readFile(path, 'utf8')
      const parsed = JSON.parse(raw) as Record<string, unknown>
      // Strip project-scoped keys from user config
      const { installMode: _i, destinations: _d, repo: _r, ...userScoped } = parsed
      return userScoped as UserConfig
    } catch {
      return {}
    }
  }

  private async loadProjectConfig(): Promise<ProjectConfig> {
    const path = join(this.cwd, '.ghost', 'config.json')
    try {
      const raw = await readFile(path, 'utf8')
      return JSON.parse(raw) as ProjectConfig
    } catch {
      return {}
    }
  }
}

export function createDefaultConfigLoader(cwd: string): ConfigLoader {
  return new ConfigLoader({ cwd, userConfigDir: join(homedir(), '.config') })
}
