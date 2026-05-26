#!/usr/bin/env node
/**
 * migrate.js
 * Applies Supabase migrations in order via the Supabase Management API.
 *
 * Usage:
 *   SUPABASE_ACCESS_TOKEN=xxx SUPABASE_PROJECT_REF=yyy node scripts/migrate.js
 *   node scripts/migrate.js --dry-run   (print SQL without applying)
 *   node scripts/migrate.js --file 003  (apply specific migration)
 *
 * For local development, use the Supabase CLI instead:
 *   supabase db push
 */

const fs    = require('fs')
const path  = require('path')
const https = require('https')

const MIGRATIONS_DIR = path.join(__dirname, '../supabase/migrations')

const ACCESS_TOKEN  = process.env.SUPABASE_ACCESS_TOKEN
const PROJECT_REF   = process.env.SUPABASE_PROJECT_REF
const DRY_RUN       = process.argv.includes('--dry-run')
const FILE_FILTER   = process.argv.find(a => a.startsWith('--file='))?.split('=')[1]

if (!DRY_RUN && (!ACCESS_TOKEN || !PROJECT_REF)) {
  console.error('Required: SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF env vars')
  console.error('Or use --dry-run to just print the SQL')
  process.exit(1)
}

function getMigrations() {
  return fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort()
    .filter(f => !FILE_FILTER || f.startsWith(FILE_FILTER))
}

function runQuery(sql) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query: sql })
    const req = https.request({
      hostname: 'api.supabase.com',
      path:     `/v1/projects/${PROJECT_REF}/database/query`,
      method:   'POST',
      headers: {
        'Authorization': `Bearer ${ACCESS_TOKEN}`,
        'Content-Type':  'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, res => {
      let data = ''
      res.on('data', chunk => data += chunk)
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(JSON.parse(data))
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`))
        }
      })
    })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

async function createMigrationsTable() {
  const sql = `
    CREATE TABLE IF NOT EXISTS public._migrations (
      id          SERIAL PRIMARY KEY,
      filename    TEXT UNIQUE NOT NULL,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      checksum    TEXT NOT NULL
    );
  `
  await runQuery(sql)
}

function checksum(content) {
  // Simple hash: sum of char codes mod 65536, as hex
  let h = 0
  for (const c of content) h = (h * 31 + c.charCodeAt(0)) & 0xFFFF
  return h.toString(16).padStart(4, '0')
}

async function getAppliedMigrations() {
  const result = await runQuery('SELECT filename, checksum FROM public._migrations ORDER BY id')
  return new Map(result.map(r => [r.filename, r.checksum]))
}

async function applyMigration(filename, sql, cs) {
  // Wrap in transaction (migrations should already have BEGIN/COMMIT)
  const hasTransaction = /^\s*BEGIN\s*;/m.test(sql)
  const wrappedSql = hasTransaction ? sql : `BEGIN;\n${sql}\nCOMMIT;`

  await runQuery(wrappedSql)

  // Record migration
  await runQuery(`
    INSERT INTO public._migrations (filename, checksum)
    VALUES ('${filename.replace(/'/g, "''")}', '${cs}')
    ON CONFLICT (filename) DO NOTHING;
  `)
}

async function main() {
  const files = getMigrations()
  if (!files.length) {
    console.log('No migrations found')
    return
  }

  console.log(`Found ${files.length} migration(s)`)

  if (DRY_RUN) {
    for (const file of files) {
      console.log(`\n${'='.repeat(60)}`)
      console.log(`-- ${file}`)
      console.log('='.repeat(60))
      console.log(fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf-8'))
    }
    return
  }

  await createMigrationsTable()
  const applied = await getAppliedMigrations()

  let ran = 0
  let skipped = 0

  for (const file of files) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf-8')
    const cs  = checksum(sql)

    if (applied.has(file)) {
      const existingCs = applied.get(file)
      if (existingCs !== cs) {
        console.error(`\n⚠️  Checksum mismatch for ${file}!`)
        console.error(`   Expected: ${existingCs}`)
        console.error(`   Got:      ${cs}`)
        console.error('   Migration may have been modified after being applied.')
        console.error('   Fix the migration or reset the checksum in _migrations table.\n')
        process.exit(1)
      }
      console.log(`  skip  ${file} (already applied)`)
      skipped++
      continue
    }

    process.stdout.write(`  apply ${file} ... `)
    try {
      await applyMigration(file, sql, cs)
      console.log('✓')
      ran++
    } catch (err) {
      console.log('✗')
      console.error(`\nFailed to apply ${file}:`)
      console.error(err.message)
      process.exit(1)
    }
  }

  console.log(`\n✅ Migrations complete: ${ran} applied, ${skipped} skipped\n`)
}

main().catch(err => {
  console.error('Migration runner error:', err)
  process.exit(1)
})
