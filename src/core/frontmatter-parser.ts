import { KNOWN_CATEGORIES, type Category } from './types.js'

export function parseFrontmatterCategory(content: string): Category | null {
  const lines = content.split(/\r?\n/)

  if (lines[0]?.trim() !== '---') return null

  let closingFound = false
  let categoryValue: string | null = null

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]
    if (line?.trim() === '---') {
      closingFound = true
      break
    }
    const match = line?.match(/^category:\s*(.+?)\s*$/)
    if (match) {
      categoryValue = match[1] ?? null
    }
  }

  if (!closingFound) return null
  if (!categoryValue) return null
  if (!(KNOWN_CATEGORIES as string[]).includes(categoryValue)) return null

  return categoryValue as Category
}
