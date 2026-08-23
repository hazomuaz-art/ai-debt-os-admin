#!/usr/bin/env node

const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root })
  .toString('utf8')
  .split('\0')
  .filter(Boolean)

const forbiddenArtifacts = [
  /(^|\/)(n8n-cookie\.txt)$/i,
  /(^|\/)(?:test-|waha[-_]|whatsapp-)qr(?:\d+)?\.(?:png|txt)$/i,
]

const textExtensions = new Set([
  '.js', '.cjs', '.mjs', '.ts', '.tsx', '.json', '.yml', '.yaml', '.toml',
  '.md', '.txt', '.sql', '.ps1', '.sh', '.env', '',
])

const patterns = [
  { name: 'JWT/API token', regex: /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g },
  { name: 'OpenAI API key', regex: /sk-(?!test-)[A-Za-z0-9_-]{20,}/g },
  { name: 'Supabase secret key', regex: /sb_secret_[A-Za-z0-9_-]{16,}/g },
  { name: 'GitHub token', regex: /gh[opurs]_[A-Za-z0-9]{20,}/g },
  {
    name: 'hardcoded credential assignment',
    regex: /(?:api[_-]?key|service[_-]?role[_-]?key|access[_-]?token|password)\s*[:=]\s*['"]([^'"]{8,})['"]/gi,
    valueGroup: 1,
  },
  {
    // Catches one-off scripts that write a token into a generic `.value`
    // field instead of naming the variable key/token/password.
    name: 'high-entropy quoted secret',
    regex: /['"]((?=[A-Za-z0-9_-]{28,}['"])(?=[A-Za-z0-9_-]*[a-z])(?=[A-Za-z0-9_-]*[A-Z])(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{28,})['"]/g,
    valueGroup: 1,
  },
]

function isPlaceholder(value) {
  const normalized = value.toLowerCase()
  return normalized.includes('process.env') || normalized.includes('${') ||
    normalized.includes('your-') || normalized.includes('example') ||
    normalized.includes('test') || normalized.includes('mock') ||
    normalized.includes('dummy') || normalized.startsWith('not-') ||
    normalized === 'securepass123!' || normalized === 'waha-key' ||
    normalized === 'the-real-secret' || /^x+$/.test(normalized)
}

const findings = []
for (const relative of tracked) {
  const normalized = relative.replaceAll('\\', '/')
  if (forbiddenArtifacts.some(pattern => pattern.test(normalized))) {
    findings.push(`${normalized}: sensitive session/QR artifact must not be tracked`)
    continue
  }

  const extension = path.extname(relative).toLowerCase()
  if (!textExtensions.has(extension)) continue

  const absolute = path.join(root, relative)
  let content
  try { content = fs.readFileSync(absolute, 'utf8') } catch { continue }

  for (const pattern of patterns) {
    pattern.regex.lastIndex = 0
    for (const match of content.matchAll(pattern.regex)) {
      const value = match[pattern.valueGroup ?? 0]
      if (isPlaceholder(value)) continue
      const line = content.slice(0, match.index).split(/\r?\n/).length
      findings.push(`${normalized}:${line}: ${pattern.name}`)
    }
  }
}

if (findings.length) {
  console.error('Secret scan failed (values intentionally redacted):')
  for (const finding of findings) console.error(`- ${finding}`)
  process.exit(1)
}

console.log(`Secret scan passed across ${tracked.length} tracked files`)
