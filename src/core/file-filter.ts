import { CATEGORY_ALIASES, type Category } from './types.js'
import { parseFrontmatterCategory } from './frontmatter-parser.js'

type ContentFetcher = (path: string) => Promise<string>

interface FilterResult {
  matched: Array<{ path: string; category: Category }>
  skipped: string[]
}

export class FileFilter {
  async classify(filePath: string, getContent: ContentFetcher): Promise<Category | null> {
    // Rule 1: frontmatter override — highest priority
    const content = await getContent(filePath)
    const frontmatterCategory = parseFrontmatterCategory(content)
    if (frontmatterCategory !== null) return frontmatterCategory

    // Rule 2: file extension convention (e.g. foo.agent.md → agents)
    const basename = filePath.split('/').pop() ?? ''
    const extMatch = basename.match(/\.(\w+)\.md$/)
    if (extMatch) {
      const ext = extMatch[1]
      if (ext && ext in CATEGORY_ALIASES) {
        return CATEGORY_ALIASES[ext] ?? null
      }
    }

    // Rule 3: ancestor directory name — lowest priority
    const segments = filePath.split('/')
    for (const segment of segments.slice(0, -1)) {
      const lower = segment.toLowerCase()
      if (lower in CATEGORY_ALIASES) {
        return CATEGORY_ALIASES[lower] ?? null
      }
    }

    return null
  }

  async filter(
    paths: string[],
    categories: Category[],
    getContent: ContentFetcher,
  ): Promise<FilterResult> {
    const matched: FilterResult['matched'] = []
    const skipped: string[] = []
    const categorySet = new Set<Category>(categories)

    for (const path of paths) {
      const category = await this.classify(path, getContent)
      if (category !== null && categorySet.has(category)) {
        matched.push({ path, category })
      } else {
        skipped.push(path)
      }
    }

    return { matched, skipped }
  }
}
