// src/core/types.ts

export type HostType =
  | 'github'
  | 'github-enterprise'
  | 'gitlab'
  | 'bitbucket-cloud'
  | 'bitbucket-server'
  | 'gitea'
  | 'git-fallback'

export type Category = 'agents' | 'skills' | 'prompts' | 'instructions' | 'rules'

export const KNOWN_CATEGORIES: Category[] = [
  'agents',
  'skills',
  'prompts',
  'instructions',
  'rules',
]

export const CATEGORY_ALIASES: Record<string, Category> = {
  agent: 'agents',
  agents: 'agents',
  skill: 'skills',
  skills: 'skills',
  prompt: 'prompts',
  prompts: 'prompts',
  instruction: 'instructions',
  instructions: 'instructions',
  rule: 'rules',
  rules: 'rules',
}

export interface DetectedHost {
  type: HostType
  apiBase: string
  rawBase: string
  owner: string
  repo: string
  host: string
}

export interface ResolvedFile {
  path: string       // relative source path in repo
  content: string    // raw file content
  category: Category
}

export interface FetchConfig {
  repoUrl: string
  categories: Category[]
  token?: string
  hostType?: HostType
}

export interface InstallConfig {
  mode: 'mirror' | 'flat'
  dest?: string
  destinations?: Partial<Record<Category, string>>
  cwd: string
}

export interface UserConfig {
  token?: string
  hostType?: HostType
  categories?: Category[]
}

export interface ProjectConfig {
  repo?: string
  categories?: Category[]
  destinations?: Partial<Record<Category, string>>
  installMode?: 'mirror' | 'flat'
}

export interface MergedConfig {
  repo?: string
  categories?: Category[]
  destinations?: Partial<Record<Category, string>>
  installMode?: 'mirror' | 'flat'
  token?: string
  hostType?: HostType
}
