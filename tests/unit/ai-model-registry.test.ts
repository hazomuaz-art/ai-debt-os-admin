import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AI_MODELS } from '@/lib/ai-models'

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap(name => {
    const path = join(directory, name)
    return statSync(path).isDirectory()
      ? sourceFiles(path)
      : /\.(ts|tsx)$/.test(name) ? [path] : []
  })
}

describe('AI model registry', () => {
  it('defines the supported workload tiers', () => {
    expect(Object.keys(AI_MODELS)).toEqual(['reasoning', 'balanced', 'fast'])
  })

  it('prevents raw provider model IDs outside the registry', () => {
    const offenders = sourceFiles('src')
      .filter(path => !path.endsWith('ai-models.ts'))
      .filter(path => /model\s*:\s*['"](?:anthropic|openai)\//.test(readFileSync(path, 'utf8')))
      .map(path => relative('.', path))

    expect(offenders).toEqual([])
  })
})
