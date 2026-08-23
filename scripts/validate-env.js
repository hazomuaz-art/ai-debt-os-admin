#!/usr/bin/env node
/**
 * validate-env.js
 * Run before deployment: node scripts/validate-env.js
 * Exits with code 1 if any required variable is missing or invalid.
 */

const REQUIRED = [
  {
    key:      'NEXT_PUBLIC_SUPABASE_URL',
    validate: v => v.startsWith('https://') && v.includes('.supabase.co')
      ? null : 'Must be https://xxx.supabase.co',
  },
  {
    key:      'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    validate: v => v.length > 20 ? null : 'Appears too short',
  },
  {
    key:      'SUPABASE_SERVICE_ROLE_KEY',
    validate: v => v.length > 20 ? null : 'Appears too short',
  },
  // Real gap found during a full-system audit: this checked OPENAI_API_KEY,
  // a variable the app hasn't actually used since migrating every AI call to
  // OpenRouter (see src/lib/env.ts, the one actually enforced at runtime,
  // which already checks the right variable) — this standalone script was
  // never updated to match, so it always reported the real key as "missing"
  // while never validating the one that actually matters.
  {
    key:      'OPENROUTER_API_KEY',
    validate: v => v.startsWith('sk-or-') ? null : 'OpenRouter key must start with sk-or-',
  },
  {
    key:      'APP_SECRET',
    validate: v => v.length >= 32 ? null : 'Must be at least 32 characters',
  },
  {
    key:      'NEXT_PUBLIC_APP_URL',
    validate: v => v.startsWith('http') ? null : 'Must be a full URL',
  },
]

const OPTIONAL_GROUPS = [
  {
    name: 'WAHA',
    keys: ['WAHA_API_URL', 'WAHA_API_KEY', 'WAHA_WEBHOOK_SECRET', 'WAHA_SESSION', 'WAHA_SESSION_COMPANY_MAP'],
  },
  { name: 'Rasf inbound', keys: ['RASF_WEBHOOK_SECRET', 'RASF_WEBHOOK_COMPANY_MAP'] },
  { name: 'Email inbound', keys: ['EMAIL_INBOUND_SECRET', 'EMAIL_INBOUND_COMPANY_MAP'] },
  { name: 'n8n', keys: ['N8N_BASE_URL', 'N8N_API_KEY'] },
]

const OPTIONAL = [
  ...OPTIONAL_GROUPS.flatMap(group => group.keys),
  'INTEGRATION_ALLOWED_HOSTS',
  'CRON_SECRET',
]

const errors   = []
const warnings = []

// Check required
for (const { key, validate } of REQUIRED) {
  const value = process.env[key]
  if (!value) {
    errors.push(`  MISSING: ${key}`)
  } else if (validate) {
    const err = validate(value)
    if (err) errors.push(`  INVALID: ${key} — ${err}`)
  }
}

// Check optional
for (const group of OPTIONAL_GROUPS) {
  const configured = group.keys.filter(key => process.env[key])
  if (configured.length > 0 && configured.length < group.keys.length) {
    errors.push(`  PARTIAL: ${group.name} — missing ${group.keys.filter(key => !process.env[key]).join(', ')}`)
  }
}
for (const key of OPTIONAL) {
  if (!process.env[key]) warnings.push(`Optional ${key} not set`)
}

for (const key of ['WAHA_SESSION_COMPANY_MAP', 'RASF_WEBHOOK_COMPANY_MAP', 'EMAIL_INBOUND_COMPANY_MAP']) {
  if (!process.env[key]) continue
  try {
    const parsed = JSON.parse(process.env[key])
    const values = parsed && !Array.isArray(parsed) && typeof parsed === 'object' ? Object.values(parsed) : []
    if (values.length === 0 || values.some(value => typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))) {
      errors.push(`  INVALID: ${key} — must map routing keys to company UUIDs`)
    }
  } catch {
    errors.push(`  INVALID: ${key} — must be a JSON object`)
  }
}

// Report
if (warnings.length) {
  console.log('\n⚠️  Warnings:')
  warnings.forEach(w => console.log(' ', w))
}

if (errors.length) {
  console.error('\n❌ Environment validation failed:\n')
  errors.forEach(e => console.error(e))
  console.error('\nSet these variables in your .env.local or deployment environment.\n')
  process.exit(1)
}

console.log('\n✅ Environment validation passed\n')
process.exit(0)
