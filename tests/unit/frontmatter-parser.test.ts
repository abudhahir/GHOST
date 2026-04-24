import { describe, it, expect } from 'vitest'
import { parseFrontmatterCategory } from '../../src/core/frontmatter-parser.js'

describe('parseFrontmatterCategory', () => {
  it('extracts category from valid frontmatter', () => {
    const content = '---\ncategory: agents\n---\n# content'
    expect(parseFrontmatterCategory(content)).toBe('agents')
  })

  it('returns null when no frontmatter at all', () => {
    const content = '# Just a markdown file\nno frontmatter here'
    expect(parseFrontmatterCategory(content)).toBeNull()
  })

  it('returns null when opening --- missing (first line is not ---)', () => {
    const content = 'category: agents\n---\n# content'
    expect(parseFrontmatterCategory(content)).toBeNull()
  })

  it('returns null when closing --- is absent (EOF reached)', () => {
    const content = '---\ncategory: agents\nno closing delimiter'
    expect(parseFrontmatterCategory(content)).toBeNull()
  })

  it('returns null when category value is not a known category', () => {
    const content = '---\ncategory: unknown-value\n---\n# content'
    expect(parseFrontmatterCategory(content)).toBeNull()
  })

  it('trims whitespace around category value', () => {
    const content = '---\ncategory:   skills  \n---\n# content'
    expect(parseFrontmatterCategory(content)).toBe('skills')
  })

  it('returns null when category key is absent from frontmatter', () => {
    const content = '---\ntitle: My File\nauthor: someone\n---\n# content'
    expect(parseFrontmatterCategory(content)).toBeNull()
  })

  it('handles CRLF line endings', () => {
    const content = '---\r\ncategory: rules\r\n---\r\n# content'
    expect(parseFrontmatterCategory(content)).toBe('rules')
  })

  it('recognises all known categories', () => {
    for (const cat of ['agents', 'skills', 'prompts', 'instructions', 'rules']) {
      const content = `---\ncategory: ${cat}\n---\n`
      expect(parseFrontmatterCategory(content)).toBe(cat)
    }
  })
})
