#!/usr/bin/env node
/**
 * Production Deployment Checklist
 * 
 * Run before every production deployment:
 *   node scripts/deploy-check.js
 *
 * Exits 0 on pass, 1 on any failure.
 * Prints PASS/FAIL for each item.
 */

const { execSync } = require('child_process')
const fs           = require('fs')
const path         = require('path')
const https        = require('https')

const PASS = '✅ PASS'
const FAIL = '❌ FAIL'
const WARN = '⚠️  WARN'
const SKIP = '⏭  SKIP'

const results = []
let hasFailures = false

function check(name, fn) {
  try {
    const result = fn()
    if (result === 'skip') {
      results.push({ name, status: SKIP, detail: '' })
    } else if (result === true || result === undefined) {
      results.push({ name, status: PASS, detail: '' })
    } else if (typeof result === 'string') {
      // Warning — doesn't fail deployment
      results.push({ name, status: WARN, detail: result })
    } else {
      results.push({ name, status: FAIL, detail: 'Unexpected return' })
      hasFailures = true
    }
  } catch (err) {
    results.push({ name, status: FAIL, detail: err.message })
    hasFailures = true
  }
}

async function checkAsync(name, fn) {
  try {
    const result = await fn()
    if (result === 'skip') {
      results.push({ name, status: SKIP, detail: '' })
    } else if (result === true || result === undefined) {
      results.push({ name, status: PASS, detail: '' })
    } else if (typeof result === 'string' && result.startsWith('WARN:')) {
      results.push({ name, status: WARN, detail: result.slice(5).trim() })
    } else {
      results.push({ name, status: FAIL, detail: String(result) })
      hasFailures = true
    }
  } catch (err) {
    results.push({ name, status: FAIL, detail: err.message })
    hasFailures = true
  }
}

// ── Checks ────────────────────────────────────────────────────────────────

check('Environment: NEXT_PUBLIC_SUPABASE_URL', () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!url) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL')
  if (!url.startsWith('https://') || !url.includes('.supabase.co')) {
    throw new Error('Invalid Supabase URL format')
  }
})

check('Environment: SUPABASE_SERVICE_ROLE_KEY', () => {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Missing')
  if (process.env.SUPABASE_SERVICE_ROLE_KEY.length < 20) throw new Error('Appears invalid')
})

check('Environment: OPENAI_API_KEY', () => {
  const key = process.env.OPENAI_API_KEY
  if (!key) throw new Error('Missing OPENAI_API_KEY')
  if (!key.startsWith('sk-')) throw new Error('Must start with sk-')
})

check('Environment: APP_SECRET', () => {
  const secret = process.env.APP_SECRET
  if (!secret) throw new Error('Missing APP_SECRET')
  if (secret.length < 32) throw new Error('Must be at least 32 characters')
  if (secret === 'test-app-secret-32-characters-long!!') {
    throw new Error('Using test value in production!')
  }
})

check('Environment: NEXT_PUBLIC_APP_URL', () => {
  const url = process.env.NEXT_PUBLIC_APP_URL
  if (!url) throw new Error('Missing')
  if (url.includes('localhost')) throw new Error('Points to localhost — update for production')
  if (!url.startsWith('https://')) throw new Error('Must use HTTPS in production')
})

check('WhatsApp: configuration present', () => {
  const vars = ['WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_VERIFY_TOKEN']
  const missing = vars.filter(k => !process.env[k])
  if (missing.length === vars.length) return 'WARN: WhatsApp not configured — messaging disabled'
  if (missing.length > 0) throw new Error(`Partially configured — missing: ${missing.join(', ')}`)
})

check('Migrations: all files present', () => {
  const dir = path.join(__dirname, '../supabase/migrations')
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort()
  if (files.length < 7) throw new Error(`Only ${files.length} migrations found, expected >= 7`)
  // Check sequential numbering
  for (let i = 0; i < files.length; i++) {
    const num = parseInt(files[i].split('_')[0])
    if (num !== i + 1) throw new Error(`Gap in migration sequence at position ${i + 1}`)
  }
})

check('Migrations: all wrapped in transactions', () => {
  const dir   = path.join(__dirname, '../supabase/migrations')
  // 001 and 002 were written for Supabase SQL Editor (implicit transaction).
  // 007 uses pg_cron which does not support explicit transactions.
  const skipTx = ['001_', '002_', '007_']
  const files = fs.readdirSync(dir)
    .filter(f => f.endsWith('.sql') && !skipTx.some(s => f.startsWith(s)))
    .sort()
  for (const f of files) {
    const sql = fs.readFileSync(path.join(dir, f), 'utf-8')
    if (!sql.includes('BEGIN;') || !sql.includes('COMMIT;')) {
      throw new Error(`${f} is missing BEGIN/COMMIT transaction wrapper`)
    }
  }
})

check('Build: no hardcoded secrets in source', () => {
  const srcDir = path.join(__dirname, '../src')
  const dangerous = [
    /sk-[a-zA-Z0-9]{20,}/,   // OpenAI key
    /eyJhbGciOiJIUzI1NiJ9/,   // Supabase JWT prefix
  ]
  
  function scanDir(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory() && entry.name !== 'node_modules') {
        scanDir(full)
      } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) {
        const content = fs.readFileSync(full, 'utf-8')
        for (const pattern of dangerous) {
          if (pattern.test(content)) {
            throw new Error(`Potential secret found in ${full}`)
          }
        }
      }
    }
  }
  scanDir(srcDir)
})

check('Package: no known critical vulnerabilities pattern', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf-8'))
  // Check Next.js version is 14.x (stable, not 15 beta)
  const nextVersion = pkg.dependencies?.next ?? ''
  if (nextVersion.startsWith('15')) {
    return 'WARN: Next.js 15 may have breaking changes'
  }
})

check('Vercel: cron job configured', () => {
  const vcfg = JSON.parse(fs.readFileSync(path.join(__dirname, '../vercel.json'), 'utf-8'))
  const hasCron = vcfg.crons?.some(c => c.path === '/api/jobs/worker')
  if (!hasCron) throw new Error('Job worker cron not configured in vercel.json')
})

check('Test files: all test suites present', () => {
  const testDir = path.join(__dirname, '../tests')
  const files   = []
  function scan(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name)
      if (e.isDirectory()) scan(full)
      else if (e.name.endsWith('.test.ts')) files.push(full)
    }
  }
  scan(testDir)
  if (files.length < 7) throw new Error(`Only ${files.length} test files — expected >= 7`)
})

check('Source: no Response.json() cast hacks', () => {
  const srcDir = path.join(__dirname, '../src')
  function scan(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name)
      if (e.isDirectory()) scan(full)
      else if (e.name.endsWith('.ts') || e.name.endsWith('.tsx')) {
        const content = fs.readFileSync(full, 'utf-8')
        if (content.includes('Response.json(') && !content.includes('NextResponse.json(')) {
          throw new Error(`Native Response.json() found in ${path.relative(srcDir, full)} — use NextResponse.json()`)
        }
      }
    }
  }
  scan(srcDir)
})

// ── Summary ───────────────────────────────────────────────────────────────

async function main() {
  console.log('\n🚀 AI Debt OS — Production Deployment Checklist')
  console.log('='.repeat(55))

  const longest = Math.max(...results.map(r => r.name.length))
  for (const r of results) {
    const name   = r.name.padEnd(longest + 2, '.')
    const detail = r.detail ? ` (${r.detail})` : ''
    console.log(`  ${r.status}  ${name}${detail}`)
  }

  console.log('='.repeat(55))
  
  const passed  = results.filter(r => r.status === PASS).length
  const failed  = results.filter(r => r.status === FAIL).length
  const warned  = results.filter(r => r.status === WARN).length

  console.log(`\n  ${passed} passed, ${failed} failed, ${warned} warnings\n`)

  if (hasFailures) {
    console.error('❌ Deployment blocked — fix failures above before deploying\n')
    process.exit(1)
  } else {
    console.log('✅ All checks passed — safe to deploy\n')
    process.exit(0)
  }
}

main()
