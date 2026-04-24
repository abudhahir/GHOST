import { describe, it, expect } from 'vitest'
import { FileFilter } from '../../src/core/file-filter.js'

describe('FileFilter.classify', () => {
  const noContent = async (_path: string) => ''

  it('classifies by ancestor directory name', async () => {
    const filter = new FileFilter()
    expect(await filter.classify('repo/agents/my-agent.md', noContent)).toBe('agents')
  })

  it('classifies by file extension convention (.agent.md)', async () => {
    const filter = new FileFilter()
    expect(await filter.classify('tools/coder.agent.md', noContent)).toBe('agents')
  })

  it('classifies by extension: .skill.md', async () => {
    const filter = new FileFilter()
    expect(await filter.classify('tools/helper.skill.md', noContent)).toBe('skills')
  })

  it('classifies by extension: .prompt.md', async () => {
    const filter = new FileFilter()
    expect(await filter.classify('tools/chat.prompt.md', noContent)).toBe('prompts')
  })

  it('classifies by extension: .instruction.md', async () => {
    const filter = new FileFilter()
    expect(await filter.classify('tools/setup.instruction.md', noContent)).toBe('instructions')
  })

  it('classifies by extension: .rule.md', async () => {
    const filter = new FileFilter()
    expect(await filter.classify('tools/style.rule.md', noContent)).toBe('rules')
  })

  it('frontmatter overrides directory classification', async () => {
    const filter = new FileFilter()
    const withFrontmatter = async () => '---\ncategory: skills\n---\n# content'
    expect(await filter.classify('prompts/chat.md', withFrontmatter)).toBe('skills')
  })

  it('returns null for file with no signal', async () => {
    const filter = new FileFilter()
    expect(await filter.classify('stuff/deploy.md', noContent)).toBeNull()
  })

  it('falls through to next rule when frontmatter has unknown category', async () => {
    const filter = new FileFilter()
    const withBadFrontmatter = async () => '---\ncategory: unknown\n---\n'
    expect(await filter.classify('agents/foo.md', withBadFrontmatter)).toBe('agents')
  })

  it('falls through to next rule when frontmatter closing --- is absent', async () => {
    const filter = new FileFilter()
    const malformed = async () => '---\ncategory: skills\nno closing delimiter'
    expect(await filter.classify('agents/foo.md', malformed)).toBe('agents')
  })

  it('resolves aliases in directory names (agent → agents)', async () => {
    const filter = new FileFilter()
    expect(await filter.classify('agent/foo.md', noContent)).toBe('agents')
  })

  it('resolves aliases in directory names (skill → skills)', async () => {
    const filter = new FileFilter()
    expect(await filter.classify('skill/foo.md', noContent)).toBe('skills')
  })
})

describe('FileFilter.filter', () => {
  const noContent = async (_path: string) => ''

  it('returns only matched files for requested categories', async () => {
    const filter = new FileFilter()
    const paths = ['agents/a.md', 'skills/b.md', 'stuff/c.md']
    const result = await filter.filter(paths, ['agents'], noContent)
    expect(result.matched).toHaveLength(1)
    expect(result.matched[0]?.path).toBe('agents/a.md')
    expect(result.skipped).toContain('stuff/c.md')
  })

  it('skipped list includes files that matched a different category than requested', async () => {
    const filter = new FileFilter()
    const paths = ['agents/a.md', 'skills/b.md']
    const result = await filter.filter(paths, ['agents'], noContent)
    expect(result.skipped).toContain('skills/b.md')
  })

  it('returns all categories when all requested', async () => {
    const filter = new FileFilter()
    const paths = ['agents/a.md', 'skills/b.md', 'stuff/c.md']
    const result = await filter.filter(paths, ['agents', 'skills', 'prompts', 'instructions', 'rules'], noContent)
    expect(result.matched).toHaveLength(2)
    expect(result.skipped).toContain('stuff/c.md')
  })
})
