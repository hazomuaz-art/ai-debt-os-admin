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

check('Environment: AI provider key', () => {
  const key = process.env.OPENAI_API_KEY || process.env.OPENROUTER_API_KEY
  if (!key) throw new Error('Missing OPENAI_API_KEY or OPENROUTER_API_KEY')
  if (!key.startsWith('sk-')) throw new Error('AI provider key has an unexpected format')
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

check('WAHA: configuration present', () => {
  const vars = ['WAHA_API_URL', 'WAHA_API_KEY', 'WAHA_WEBHOOK_SECRET', 'WAHA_SESSION']
  const missing = vars.filter(k => !process.env[k])
  if (missing.length === vars.length) return 'WARN: WAHA not configured — WhatsApp messaging disabled'
  if (missing.length > 0) throw new Error(`Partially configured — missing: ${missing.join(', ')}`)
})

check('Security: WAHA session tenant map', () => {
  if (!process.env.WAHA_SESSION_COMPANY_MAP) return 'WARN: database session mapping must resolve every WAHA session uniquely'
  const parsed = JSON.parse(process.env.WAHA_SESSION_COMPANY_MAP)
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object' || Object.keys(parsed).length === 0) {
    throw new Error('WAHA_SESSION_COMPANY_MAP must be a non-empty JSON object')
  }
  if (Object.values(parsed).some(value => typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))) {
    throw new Error('Every WAHA session must map to a company UUID')
  }
})

check('Security: Rasf inbound tenant map', () => {
  const secret = process.env.RASF_WEBHOOK_SECRET
  const rawMap = process.env.RASF_WEBHOOK_COMPANY_MAP
  if (!secret && !rawMap) return 'INFO: Rasf inbound webhook disabled'
  if (!secret || !rawMap) throw new Error('RASF_WEBHOOK_SECRET and RASF_WEBHOOK_COMPANY_MAP must be configured together')

  const parsed = JSON.parse(rawMap)
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object' || Object.keys(parsed).length === 0) {
    throw new Error('RASF_WEBHOOK_COMPANY_MAP must be a non-empty JSON object')
  }
  if (Object.values(parsed).some(value => typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))) {
    throw new Error('Every Rasf routing key must map to a company UUID')
  }
})

check('Security: integration outbound allowlist', () => {
  const hosts = String(process.env.INTEGRATION_ALLOWED_HOSTS || '').split(',').map(v => v.trim()).filter(Boolean)
  if (hosts.length === 0) throw new Error('INTEGRATION_ALLOWED_HOSTS is required in production')
})

check('Migrations: sequence and transaction validation', () => {
  execSync('node scripts/validate-migrations.js', { cwd: path.join(__dirname, '..'), stdio: 'pipe' })
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

check('Security: no secrets in tracked repository', () => {
  execSync('node scripts/check-secrets.js', { cwd: path.join(__dirname, '..'), stdio: 'pipe' })
})

check('Package: Next.js 16 production baseline', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf-8'))
  const nextVersion = pkg.dependencies?.next ?? ''
  if (!/^\^?16\./.test(nextVersion)) throw new Error(`Expected Next.js 16, found ${nextVersion || 'missing'}`)
})

check('Hostinger/PM2: deployment script configured', () => {
  const deploy = fs.readFileSync(path.join(__dirname, '../deploy.ps1'), 'utf-8')
  if (!deploy.includes('pm2 restart') || !deploy.includes('/api/health')) {
    throw new Error('deploy.ps1 must restart PM2 and verify /api/health')
  }
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
