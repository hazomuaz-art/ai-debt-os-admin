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

const OPTIONAL = [
  'WHATSAPP_PHONE_NUMBER_ID',
  'WHATSAPP_ACCESS_TOKEN',
  'WHATSAPP_VERIFY_TOKEN',
  'WHATSAPP_BUSINESS_ACCOUNT_ID',
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
const waSet = OPTIONAL.filter(k => process.env[k])
if (waSet.length > 0 && waSet.length < OPTIONAL.length) {
  warnings.push(`WhatsApp partially configured (${waSet.length}/${OPTIONAL.length} vars set)`)
}
for (const key of OPTIONAL) {
  if (!process.env[key]) warnings.push(`Optional ${key} not set`)
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
