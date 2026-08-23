#!/usr/bin/env node

const fs = require('node:fs')
const path = require('node:path')

const migrationsDir = path.join(__dirname, '..', 'supabase', 'migrations')
const files = fs.readdirSync(migrationsDir)
  .filter(name => name.endsWith('.sql'))
  .sort((a, b) => a.localeCompare(b))

if (files.length === 0) {
  throw new Error('No SQL migrations were found')
}

const numbers = files.map(name => {
  const match = name.match(/^(\d{3})_[a-z0-9_]+\.sql$/)
  if (!match) throw new Error(`Invalid migration filename: ${name}`)
  return Number(match[1])
})

const duplicates = numbers.filter((number, index) => numbers.indexOf(number) !== index)
if (duplicates.length) {
  throw new Error(`Duplicate migration numbers: ${[...new Set(duplicates)].join(', ')}`)
}

for (let expected = numbers[0]; expected <= numbers.at(-1); expected += 1) {
  if (!numbers.includes(expected)) {
    throw new Error(`Missing migration ${String(expected).padStart(3, '0')}`)
  }
}

for (const file of files) {
  const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8')
  if (!sql.trim()) throw new Error(`${file} is empty`)
  if (/^(<{7}|={7}|>{7})/m.test(sql)) {
    throw new Error(`${file} contains an unresolved merge conflict`)
  }

  const begins = (sql.match(/\bBEGIN\s*;/gi) ?? []).length
  const commits = (sql.match(/\bCOMMIT\s*;/gi) ?? []).length
  if (begins !== commits) {
    throw new Error(`${file} has an unbalanced BEGIN/COMMIT pair`)
  }
}

console.log(`Validated ${files.length} sequential migrations (${files[0]} -> ${files.at(-1)})`)
